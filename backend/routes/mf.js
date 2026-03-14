/**
 * Mutual Fund Holdings API
 *
 * GET  /api/mf              — all MF holdings + summary
 * POST /api/mf/request-cas  — trigger CAMS + KFintech email requests
 * POST /api/mf/manual       — add/update a manual MF holding
 * DELETE /api/mf/:id        — delete a holding
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── AMC name from fund name heuristic ───────────────────────────────
function guessFundHouse(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('hdfc'))          return 'HDFC AMC';
  if (n.includes('icici'))         return 'ICICI Prudential AMC';
  if (n.includes('sbi'))           return 'SBI Funds Management';
  if (n.includes('axis'))          return 'Axis AMC';
  if (n.includes('kotak'))         return 'Kotak Mahindra AMC';
  if (n.includes('nippon'))        return 'Nippon India AMC';
  if (n.includes('mirae'))         return 'Mirae Asset AMC';
  if (n.includes('parag parikh'))  return 'PPFAS AMC';
  if (n.includes('dsp'))           return 'DSP Investment Managers';
  if (n.includes('franklin'))      return 'Franklin Templeton AMC';
  if (n.includes('tata'))          return 'Tata AMC';
  if (n.includes('uti'))           return 'UTI AMC';
  if (n.includes('aditya birla') || n.includes('absl')) return 'Aditya Birla Sun Life AMC';
  if (n.includes('sundaram'))      return 'Sundaram AMC';
  if (n.includes('edelweiss'))     return 'Edelweiss AMC';
  if (n.includes('navi'))          return 'Navi AMC';
  if (n.includes('quant'))         return 'Quant AMC';
  if (n.includes('motilal'))       return 'Motilal Oswal AMC';
  if (n.includes('invesco'))       return 'Invesco AMC';
  if (n.includes('canara'))        return 'Canara Robeco AMC';
  return 'Other AMC';
}

// ── Fund category heuristic ──────────────────────────────────────────
function guessFundCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('etf') || n.includes('bees'))       return 'ETF';
  if (n.includes('index'))                            return 'Index';
  if (n.includes('elss') || n.includes('tax saver')) return 'ELSS';
  if (n.includes('liquid') || n.includes('overnight') || n.includes('money market')) return 'Debt-Liquid';
  if (n.includes('debt') || n.includes('bond') || n.includes('gilt') || n.includes('income')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced') || n.includes('aggressive')) return 'Hybrid';
  if (n.includes('flexi') || n.includes('multi cap') || n.includes('multicap')) return 'Equity-Flexi';
  if (n.includes('large cap') || n.includes('largecap') || n.includes('bluechip')) return 'Equity-LargeCap';
  if (n.includes('mid cap') || n.includes('midcap'))  return 'Equity-MidCap';
  if (n.includes('small cap') || n.includes('smallcap')) return 'Equity-SmallCap';
  if (n.includes('sectoral') || n.includes('thematic')) return 'Sectoral';
  return 'Equity';
}

// ── GET all holdings with summary ───────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('mf_holdings')
    .select('*')
    .eq('user_id', req.user.id)
    .order('current_value', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const holdings = data || [];
  const totalValue     = holdings.reduce((s, h) => s + (h.current_value   || 0), 0);
  const totalInvested  = holdings.reduce((s, h) => s + (h.invested_value  || 0), 0);
  const totalGainLoss  = totalValue - totalInvested;
  const gainLossPct    = totalInvested > 0 ? (totalGainLoss / totalInvested * 100) : 0;

  // By fund house
  const byFundHouse = {};
  for (const h of holdings) {
    const house = h.fund_house || 'Other';
    byFundHouse[house] = (byFundHouse[house] || 0) + (h.current_value || 0);
  }

  // By category
  const byCategory = {};
  for (const h of holdings) {
    const cat = h.fund_category || 'Equity';
    byCategory[cat] = (byCategory[cat] || 0) + (h.current_value || 0);
  }

  res.json({
    holdings,
    summary: {
      totalValue:    parseFloat(totalValue.toFixed(2)),
      totalInvested: parseFloat(totalInvested.toFixed(2)),
      totalGainLoss: parseFloat(totalGainLoss.toFixed(2)),
      gainLossPct:   parseFloat(gainLossPct.toFixed(2)),
      count:         holdings.length,
      byFundHouse:   Object.entries(byFundHouse).map(([name, value]) => ({ name, value: Math.round(value) }))
                           .sort((a, b) => b.value - a.value),
      byCategory:    Object.entries(byCategory).map(([name, value]) => ({ name, value: Math.round(value) }))
                           .sort((a, b) => b.value - a.value),
    }
  });
});

// ── POST /request-cas — email CAMS + KFintech for latest statement ────
router.post('/request-cas', requireAuth, async (req, res) => {
  try {
    // Get Gmail connection
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token')
      .eq('user_id', req.user.id).eq('provider', 'gmail').single();

    if (!conn) return res.status(400).json({ error: 'Gmail not connected. Please connect Gmail first.' });

    const { google } = require('googleapis');
    const oauth2Client = new (require('googleapis').google.auth.OAuth2)(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token:  conn.access_token,
      refresh_token: conn.refresh_token,
    });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get user email address
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;

    const results = [];

    // ── Send to CAMS ───────────────────────────────────────────
    // Sending a blank email to mfportfolio@camsonline.com triggers CAMS
    // to reply with the consolidated MF statement PDF
    try {
      const camsMsg = [
        `From: ${userEmail}`,
        `To: mfportfolio@camsonline.com`,
        `Subject: CAMS MF Statement Request`,
        ``,
        `Please send my latest mutual fund portfolio statement.`,
      ].join('\r\n');
      const encodedCams = Buffer.from(camsMsg).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedCams } });
      results.push({ rta: 'CAMS', status: 'sent', email: 'mfportfolio@camsonline.com' });
      console.log(JSON.stringify({ event: 'CAMS_REQUEST_SENT', user: userEmail }));
    } catch (e) {
      results.push({ rta: 'CAMS', status: 'failed', error: e.message });
    }

    // ── Send to KFintech ────────────────────────────────────────
    try {
      const kfinMsg = [
        `From: ${userEmail}`,
        `To: mfportfolio@kfintech.com`,
        `Subject: KFintech MF Statement Request`,
        ``,
        `Please send my latest mutual fund portfolio statement.`,
      ].join('\r\n');
      const encodedKfin = Buffer.from(kfinMsg).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedKfin } });
      results.push({ rta: 'KFintech', status: 'sent', email: 'mfportfolio@kfintech.com' });
      console.log(JSON.stringify({ event: 'KFINTECH_REQUEST_SENT', user: userEmail }));
    } catch (e) {
      results.push({ rta: 'KFintech', status: 'failed', error: e.message });
    }

    const allSent = results.every(r => r.status === 'sent');
    res.json({
      success: allSent,
      results,
      message: allSent
        ? 'Statement requests sent to CAMS and KFintech. Statements arrive in 5–30 minutes. Click "Sync MF Statements" after receiving.'
        : `Partial: ${results.filter(r=>r.status==='sent').map(r=>r.rta).join(', ')} sent.`,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sync-statements — scan Gmail for CAMS/KFintech reply PDFs ──
router.post('/sync-statements', requireAuth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token')
      .eq('user_id', req.user.id).eq('provider', 'gmail').single();
    if (!conn) return res.status(400).json({ error: 'Gmail not connected' });

    const { data: userProfile } = await supabase.from('users')
      .select('pan, dob, name').eq('id', req.user.id).single();

    const { fetchEmails } = require('../services/gmail');
    const { parseMFStatement } = require('../services/mfParser');

    // Search for CAMS and KFintech statement reply emails
    const query = 'from:(camsonline.com OR kfintech.com OR karvy.com) has:attachment';
    const emails = await fetchEmails(conn.access_token, conn.refresh_token, query, userProfile || {});

    if (!emails || emails.length === 0) {
      return res.json({ success: false, message: 'No MF statement emails found. Request statements first.' });
    }

    // Sort latest first, take most recent per RTA
    emails.sort((a, b) => new Date(b.date) - new Date(a.date));

    let totalSaved = 0;
    const seen = new Set();

    for (const email of emails.slice(0, 4)) {
      const rta = email.from?.toLowerCase().includes('cams') ? 'CAMS' : 'KFINTECH';
      if (seen.has(rta)) continue;
      seen.add(rta);

      const pdfMarker = '--- PDF ATTACHMENT ---';
      const pdfIdx = email.body?.indexOf(pdfMarker) ?? -1;
      const text = pdfIdx !== -1 ? email.body.slice(pdfIdx + pdfMarker.length).trim() : (email.body || '');

      if (text.length < 100) continue;

      const mfHoldings = parseMFStatement(text, rta);
      for (const h of mfHoldings) {
        const saved = await saveMFHolding(req.user.id, h, email.date, rta);
        if (saved) totalSaved++;
      }
    }

    res.json({
      success: totalSaved > 0,
      savedCount: totalSaved,
      message: totalSaved > 0
        ? `Synced ${totalSaved} mutual fund holdings from CAMS/KFintech`
        : 'No MF holdings parsed. Check Sync Logs for details.',
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ──────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('mf_holdings')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Helper: save/upsert one MF holding ──────────────────────────────
async function saveMFHolding(userId, h, emailDate, source) {
  const statDate = emailDate ? new Date(emailDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const record = {
    user_id:        userId,
    isin:           h.isin           || null,
    folio_number:   h.folio_number   || null,
    fund_name:      h.fund_name      || h.company || 'Unknown Fund',
    fund_house:     h.fund_house     || guessFundHouse(h.fund_name || h.company || ''),
    fund_category:  h.fund_category  || guessFundCategory(h.fund_name || h.company || ''),
    units:          h.units          || h.quantity || 0,
    nav:            h.nav            || h.market_price || null,
    current_value:  h.current_value  || h.market_value || (h.units || h.quantity || 0) * (h.nav || h.market_price || 0),
    invested_value: h.invested_value || null,
    source:         source           || h.source || 'CDSL',
    statement_date: statDate,
    cas_updated_at: new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  };

  // Upsert by ISIN (demat) or folio (SOA)
  const conflictCol = record.isin ? 'user_id,isin' : null;

  let error;
  if (conflictCol) {
    ({ error } = await supabase.from('mf_holdings')
      .upsert(record, { onConflict: conflictCol }));
  } else {
    // No unique key fallback — try update then insert
    const { data: existing } = await supabase.from('mf_holdings')
      .select('id').eq('user_id', userId).eq('folio_number', record.folio_number).maybeSingle();
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

// Export saveMFHolding for use from email.js (CDSL CAS sync)
module.exports = router;
module.exports.saveMFHolding = saveMFHolding;
