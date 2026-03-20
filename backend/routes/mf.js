/**
 * Mutual Fund Holdings API
 *
 * GET    /api/mf              — all holdings + summary
 * POST   /api/mf/upload       — upload MFCentral/CAMS/KFintech CAS PDF → parse + save
 * DELETE /api/mf/:id          — delete a holding
 * DELETE /api/mf              — clear all holdings (before fresh upload)
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const multer      = require('multer');
const { parseMFStatement, guessFundHouse, guessFundCategory } = require('../services/mfParser');
const { generatePdfPasswords } = require('../services/gmail');

// multer: memory storage, PDF only, max 20MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// ── GET all holdings with summary ────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('mf_holdings')
    .select('*')
    .eq('user_id', req.user.id)
    .order('current_value', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const holdings     = data || [];
  const totalValue   = holdings.reduce((s, h) => s + (h.current_value   || 0), 0);
  const totalInvested= holdings.reduce((s, h) => s + (h.invested_value  || 0), 0);
  const gainLoss     = totalValue - totalInvested;
  const gainLossPct  = totalInvested > 0 ? (gainLoss / totalInvested * 100) : 0;

  // Aggregates for charts
  const byFundHouse = {}, byCategory = {};
  for (const h of holdings) {
    const house = h.fund_house || 'Other';
    const cat   = h.fund_category || 'Equity';
    byFundHouse[house] = (byFundHouse[house] || 0) + (h.current_value || 0);
    byCategory[cat]    = (byCategory[cat]    || 0) + (h.current_value || 0);
  }

  // Fetch last MF sync logs for debug
  const { data: syncLogs } = await supabase
    .from('sync_logs')
    .select('phase, error_type, error_message, logged_at')
    .eq('user_id', req.user.id)
    .in('error_type', ['MF_BULK_OK', 'MF_BULK_ERROR', 'MF_SINGLE_ERROR'])
    .order('logged_at', { ascending: false })
    .limit(5);

  res.json({
    holdings,
    summary: {
      totalValue:    parseFloat(totalValue.toFixed(2)),
      totalInvested: parseFloat(totalInvested.toFixed(2)),
      totalGainLoss: parseFloat(gainLoss.toFixed(2)),
      gainLossPct:   parseFloat(gainLossPct.toFixed(2)),
      count:         holdings.length,
      byFundHouse:   Object.entries(byFundHouse)
                       .map(([name, value]) => ({ name, value: Math.round(value) }))
                       .sort((a, b) => b.value - a.value),
      byCategory:    Object.entries(byCategory)
                       .map(([name, value]) => ({ name, value: Math.round(value) }))
                       .sort((a, b) => b.value - a.value),
    },
    syncDebug: {
      rowCount:    holdings.length,
      lastStatus:  syncLogs?.[0]?.error_type  || 'NO_SYNC_YET',
      lastMessage: syncLogs?.[0]?.error_message || null,
      lastSyncAt:  syncLogs?.[0]?.logged_at   || null,
      logs:        syncLogs || [],
    }
  });
});

// ── POST /upload — parse uploaded MFCentral CAS PDF ──────────────────
router.post('/upload', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

  try {
    // Get user PAN for PDF password
    const { data: userProfile } = await supabase
      .from('users').select('pan, dob, name').eq('id', req.user.id).single();

    // Generate password candidates (MFCentral password = PAN in uppercase)
    const passwords = userProfile?.pan
      ? [userProfile.pan.toUpperCase(), ...(generatePdfPasswords(userProfile.pan, userProfile.dob) || [])]
      : [];

    // Extract text from PDF — use pdfjs directly
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    let text = '';
    try {
      const allPasswords = ['', ...passwords];
      for (const pwd of allPasswords) {
        try {
          const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(req.file.buffer), password: pwd || '' });
          const pdf = await loadingTask.promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(' ') + '\n';
          }
          if (fullText.trim().length > 200) { text = fullText; break; }
        } catch(e) { if (e.name !== 'PasswordException') break; }
      }
    } catch(e) { /* handled below */ }

    if (!text || text.trim().length < 200) {
      return res.status(422).json({
        error: 'Could not read PDF',
        message: 'PDF could not be unlocked. The password for MFCentral CAS is your PAN in UPPERCASE (e.g. ABCDE1234F). Please set your PAN in Profile & PAN settings.',
        passwordTried: passwords.length > 0,
      });
    }

    // Parse holdings from extracted text
    const parsed = parseMFStatement(text);

    if (!parsed || parsed.length === 0) {
      return res.status(422).json({
        error: 'No holdings found',
        message: 'PDF was read successfully but no mutual fund holdings were found. Please ensure this is an MFCentral CAS statement.',
        textLength: text.length,
        textPreview: text.slice(0, 300),
      });
    }

    // Clear existing holdings from this source before saving fresh data
    // (so a new upload always reflects the latest statement)
    const sourcesToClear = [...new Set(parsed.map(h => h.source))];
    for (const src of sourcesToClear) {
      await supabase.from('mf_holdings')
        .delete()
        .eq('user_id', req.user.id)
        .eq('source', src);
    }

    // Save all parsed holdings
    let saved = 0;
    const errors = [];
    for (const h of parsed) {
      const ok = await saveMFHolding(req.user.id, h);
      if (ok) saved++;
      else errors.push(h.fund_name);
    }

    // Return fresh data
    const { data: fresh } = await supabase
      .from('mf_holdings').select('*').eq('user_id', req.user.id)
      .order('current_value', { ascending: false });

    res.json({
      success:       true,
      parsed:        parsed.length,
      saved,
      statementDate: parsed[0]?.statement_date || null,
      source:        parsed[0]?.source || 'MFCENTRAL',
      passwordUsed:  passwordUsed ? 'PAN' : 'none',
      message:       `✅ Imported ${saved} mutual fund holdings from ${parsed[0]?.source || 'MFCentral'}`,
      holdings:      fresh || [],
      errors:        errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error(JSON.stringify({ event: 'MF_UPLOAD_ERROR', error: err.message, stack: err.stack?.slice(0,500) }));
    res.status(500).json({ error: 'Upload failed', message: err.message });
  }
});

// ── DELETE /api/mf/:id — delete single holding ───────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('mf_holdings')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Helper: upsert one MF holding ────────────────────────────────────
async function saveMFHolding(userId, h) {
  const record = {
    user_id:        userId,
    isin:           h.isin           || null,
    folio_number:   h.folio_number   || null,
    fund_name:      h.fund_name      || 'Unknown Fund',
    fund_house:     h.fund_house     || guessFundHouse(h.fund_name || ''),
    fund_category:  h.fund_category  || guessFundCategory(h.fund_name || ''),
    units:          h.units          || 0,
    nav:            h.nav            || null,
    current_value:  h.current_value  || null,
    invested_value: h.invested_value || null,
    source:         h.source         || 'MFCENTRAL',
    statement_date: h.statement_date || new Date().toISOString().split('T')[0],
    cas_updated_at: new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  };

  // Upsert strategy: by ISIN (demat) > folio (SOA) > insert new
  let error;
  if (record.isin) {
    ({ error } = await supabase.from('mf_holdings')
      .upsert(record, { onConflict: 'user_id,isin' }));
  } else if (record.folio_number) {
    const { data: existing } = await supabase.from('mf_holdings')
      .select('id').eq('user_id', userId).eq('folio_number', record.folio_number).maybeSingle();
    if (existing) {
      ({ error } = await supabase.from('mf_holdings').update(record).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('mf_holdings').insert(record));
    }
  } else {
    // No ISIN or folio — match by fund_name
    const { data: existing } = await supabase.from('mf_holdings')
      .select('id').eq('user_id', userId).eq('fund_name', record.fund_name).maybeSingle();
    if (existing) {
      ({ error } = await supabase.from('mf_holdings').update(record).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('mf_holdings').insert(record));
    }
  }

  if (error) {
    console.error(JSON.stringify({ event: 'MF_SAVE_ERROR', fund: record.fund_name, error: error.message }));
    return false;
  }
  return true;
}

// ── POST /api/mf/sync-nav ─────────────────────────────────────────────────────
// Fetch latest NAV from AMFI (amfiindia.com) and update all user's MF holdings
router.post('/sync-nav', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // 1. Get user's holdings
  const { data: holdings, error } = await supabase
    .from('mf_holdings')
    .select('id, isin, folio_number, fund_name, units, nav, current_value')
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  if (!holdings || holdings.length === 0) {
    return res.json({ updated: 0, message: 'No mutual fund holdings found' });
  }

  // 2. Fetch AMFI NAV data
  let navMap = {}; // isin → { nav, navDate }
  let amfiError = null;

  try {
    const https = require('https');
    const rawData = await new Promise((resolve, reject) => {
      const req = https.get(
        'https://www.amfiindia.com/spages/NAVAll.txt',
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kanalyst/1.0)' } },
        (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('AMFI request timed out')); });
    });

    // Normalise line endings, parse semicolon-delimited rows
    // AMFI format: SchemeCode;ISINDivPayout;ISINDivReinvest;SchemeName;NAV;Date
    const today = new Date().toISOString().split('T')[0];
    let parsed = 0;
    for (const rawLine of rawData.replace(/\r/g, "").split("\n")) {


      const line = rawLine.trim();
      if (!line || !line.includes(';')) continue;
      const parts = line.split(';');
      if (parts.length < 5) continue;
      const nav = parseFloat(parts[4]);
      if (isNaN(nav) || nav <= 0) continue;
      const date = parts[5] ? parts[5].trim() : today;
      const isin1 = (parts[1] || '').trim();
      const isin2 = (parts[2] || '').trim();
      if (isin1.startsWith('INF') || isin1.startsWith('IN9')) {
        navMap[isin1] = { nav, navDate: date };
        parsed++;
      }
      if (isin2.startsWith('INF') || isin2.startsWith('IN9')) {
        navMap[isin2] = { nav, navDate: date };
        parsed++;
      }
    }
    console.log(JSON.stringify({ event: 'AMFI_PARSED', isinCount: parsed, navMapSize: Object.keys(navMap).length }));
  } catch (e) {
    amfiError = e.message;
    console.error(JSON.stringify({ event: 'AMFI_FETCH_ERROR', error: e.message }));
  }

  // 3. If AMFI failed or returned 0, try mfapi.in for each fund individually
  if (Object.keys(navMap).length === 0) {
    console.log(JSON.stringify({ event: 'FALLBACK_TO_MFAPI', amfiError }));
    // mfapi.in: GET /mf/search?q=<fund_name> → [{ schemeCode }]
    // then GET /mf/<schemeCode>/latest → { data: [{ nav, date }] }
    for (const h of holdings) {
      if (!h.fund_name) continue;
      try {
        const searchName = encodeURIComponent(h.fund_name.slice(0, 30));
        const searchData = await new Promise((resolve, reject) => {
          const r = require('https').get(`https://api.mfapi.in/mf/search?q=${searchName}`, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
          });
          r.on('error', reject);
          r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
        });
        if (!searchData || !searchData[0]) continue;
        const schemeCode = searchData[0].schemeCode;
        const navData = await new Promise((resolve, reject) => {
          const r = require('https').get(`https://api.mfapi.in/mf/${schemeCode}/latest`, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
          });
          r.on('error', reject);
          r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
        });
        if (navData?.data?.[0]?.nav && h.isin) {
          navMap[h.isin] = { nav: parseFloat(navData.data[0].nav), navDate: navData.data[0].date };
        }
      } catch(e) { /* skip */ }
    }
    console.log(JSON.stringify({ event: 'MFAPI_FALLBACK_DONE', resolved: Object.keys(navMap).length }));
  }

  // 4. Update each holding
  let updated = 0, notFound = 0, errors = 0;

  for (const h of holdings) {
    const key  = h.isin && navMap[h.isin] ? h.isin : null;
    const entry = key ? navMap[key] : null;

    if (!entry) { notFound++; continue; }

    const newNav = entry.nav;
    const newCurrentValue = parseFloat(h.units) * newNav;

    const { error: updateErr } = await supabase
      .from('mf_holdings')
      .update({
        nav:           newNav,
        current_value: parseFloat(newCurrentValue.toFixed(2)),
        gain_loss:     h.invested_value ? parseFloat((newCurrentValue - h.invested_value).toFixed(2)) : null,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', h.id)
      .eq('user_id', userId);

    if (updateErr) { console.error(JSON.stringify({ event: 'MF_UPDATE_ERR', fund: h.fund_name, error: updateErr.message })); errors++; }
    else updated++;
  }

  const navDate = Object.values(navMap)[0]?.navDate || new Date().toISOString().split('T')[0];
  return res.json({
    updated,
    notFound,
    errors,
    total:   holdings.length,
    navDate,
    amfiError,
    message: updated > 0
      ? `✅ Updated NAV for ${updated} of ${holdings.length} fund${holdings.length !== 1 ? 's' : ''} (as of ${navDate})${notFound > 0 ? ` · ${notFound} ISIN not matched` : ''}`
      : `⚠ Could not update NAV${amfiError ? ': ' + amfiError : ' — check Railway logs'}`,
  });
});
module.exports = router;
module.exports.saveMFHolding = saveMFHolding;
