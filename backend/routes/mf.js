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

    // Extract text from PDF
    const { parsePdfWithPasswords } = require('../services/gmail');
    const { text, passwordUsed, failed } = await parsePdfWithPasswords(
      req.file.buffer, passwords, req.file.originalname
    );

    if (failed || !text || text.trim().length < 200) {
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

module.exports = router;
module.exports.saveMFHolding = saveMFHolding;
