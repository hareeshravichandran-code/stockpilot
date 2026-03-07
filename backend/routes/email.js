/**
 * StockPilot Email Routes — CAS Phase Only
 * gmail.js already extracts PDFs and merges text into email.body
 * Every attempt is logged to Railway console + Supabase sync_logs
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const { getAuthUrl, exchangeCode, fetchEmails } = require('../services/gmail');
const { parseCAS, detectCASType }               = require('../services/casParser');
const SyncLogger                                = require('../services/logger');

// ── Gmail OAuth URL ───────────────────────────────────────────────────
router.get('/gmail/connect', requireAuth, (req, res) => {
  res.json({ url: getAuthUrl(req.user.id) });
});

// ── Gmail OAuth Callback ──────────────────────────────────────────────
router.get('/gmail/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId)
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard?error=oauth_failed`);
  try {
    const tokens = await exchangeCode(code);
    await supabase.from('email_connections').upsert({
      user_id: userId, provider: 'gmail',
      access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      connected_at: new Date().toISOString()
    }, { onConflict: 'user_id,provider' });
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?connected=gmail`);
  } catch (err) {
    console.error(JSON.stringify({ event: 'OAUTH_ERROR', message: err.message }));
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?error=oauth_failed`);
  }
});

// ── CAS Sync ──────────────────────────────────────────────────────────
router.post('/sync/cas', requireAuth, async (req, res) => {
  const logger = new SyncLogger(req.user.id);

  try {
    // Get Gmail connection
    const { data: conn } = await supabase
      .from('email_connections').select('*')
      .eq('user_id', req.user.id).eq('provider', 'gmail').single();

    if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

    // Get user profile (PAN/DOB needed for PDF password)
    const { data: userProfile } = await supabase
      .from('users').select('pan, dob, name, mobile, client_code')
      .eq('id', req.user.id).single();

    const profileComplete = !!(userProfile?.pan && userProfile?.dob);
    if (!profileComplete) {
      console.log(JSON.stringify({ event: 'PROFILE_INCOMPLETE', message: 'PAN or DOB missing — PDF passwords may fail', userId: req.user.id }));
    }

    await logger.startSession();

    // ── Fetch CAS emails (gmail.js extracts PDF text into body) ──────
    const casQuery = 'from:(cdslindia.com OR cvlindia.com OR nsdl.co.in OR nsdlindia.com) subject:(CAS OR "consolidated account statement" OR "account statement" OR "statement of account")';
    console.log(JSON.stringify({ event: 'GMAIL_SEARCH', query: casQuery }));

    let casEmails = [];
    try {
      casEmails = await fetchEmails(conn.access_token, conn.refresh_token, casQuery, userProfile || {});
      console.log(JSON.stringify({ event: 'GMAIL_FOUND', count: casEmails.length }));
    } catch (gmailErr) {
      await logger.logFailure({ phase: 'cas', errorType: 'GMAIL_ERROR', errorMessage: gmailErr.message, errorStack: gmailErr.stack });
      await logger.failSession(gmailErr);
      return res.status(500).json({ error: 'Gmail fetch failed', message: gmailErr.message });
    }

    if (casEmails.length === 0) {
      await logger.logSkipped({ phase: 'cas', reason: 'NO_EMAILS', detail: 'No CAS emails found from CDSL/NSDL senders' });
      await logger.finishSession({ message: 'No CAS emails found' });
      return res.json({
        success: false,
        message: 'No CAS emails found in Gmail. Make sure CDSL/NSDL statements are sent to this account.',
        sessionId: logger.sessionId, ...logger.counts
      });
    }

    let bestResult = null, bestDate = null;

    for (const email of casEmails) {
      const meta = { phase: 'cas', emailId: email.id, subject: email.subject, from: email.from, date: email.date };
      console.log(JSON.stringify({ event: 'PROCESSING_EMAIL', subject: email.subject, from: email.from, hasPdf: email.hasPdf, bodyLen: email.body?.length }));

      // ── Check for PDF failure hint ────────────────────────────
      if (email.pdfFailed && (!email.body || email.body.length < 200)) {
        await logger.logFailure({
          ...meta, hasPdf: true,
          errorType:    'PDF_LOCKED',
          errorMessage: 'PDF found but could not be unlocked. Please set your PAN and Date of Birth in Profile & PAN settings.',
          rawText:      email.body?.slice(0, 500) || ''
        });
        continue;
      }

      // ── Check body has content ────────────────────────────────
      if (!email.body || email.body.trim().length < 100) {
        await logger.logSkipped({ ...meta, hasPdf: email.hasPdf || false, reason: 'NO_CONTENT', detail: 'Email body is empty or too short after extraction' });
        continue;
      }

      // ── Detect and parse CAS ──────────────────────────────────
      const casType = detectCASType(email.body);
      console.log(JSON.stringify({ event: 'CAS_DETECTED', type: casType, bodyLen: email.body.length }));

      let parseResult;
      try {
        parseResult = parseCAS(email.body);
      } catch (parseErr) {
        await logger.logFailure({
          ...meta, hasPdf: email.hasPdf || false,
          errorType: 'PARSE_FAILED', errorMessage: parseErr.message,
          errorStack: parseErr.stack, rawText: email.body
        });
        continue;
      }

      const { holdings, summary } = parseResult;

      if (!holdings || holdings.length === 0) {
        await logger.logFailure({
          ...meta, hasPdf: email.hasPdf || false,
          errorType: 'NO_ISIN',
          errorMessage: `Parsed as ${casType} but no ISINs/holdings found`,
          rawText: email.body
        });
        continue;
      }

      // ── Success ───────────────────────────────────────────────
      await logger.logSuccess({
        ...meta, hasPdf: email.hasPdf || false,
        pdfUnlocked: email.hasPdf || false,
        itemsFound: holdings.length,
        parsedData: holdings,
        rawText: email.body
      });

      const d = new Date(email.date);
      if (!bestDate || d > bestDate) {
        bestDate   = d;
        bestResult = { email, holdings, summary, casType };
      }
    }

    // ── Save best CAS to DB ───────────────────────────────────────
    if (!bestResult) {
      await logger.finishSession({ message: 'Emails found but none parsed successfully' });
      return res.json({
        success: false,
        message: 'CAS emails found but could not be parsed. Go to ⚙ Sync Logs for details.',
        sessionId: logger.sessionId, ...logger.counts
      });
    }

    const savedCount = await saveCASHoldings(req.user.id, bestResult.holdings);

    await supabase.from('email_connections')
      .update({ last_synced: new Date().toISOString(), emails_parsed: casEmails.length })
      .eq('id', conn.id);

    await logger.finishSession({
      casType: bestResult.casType,
      holdingsSaved: savedCount,
      statementDate: bestResult.summary?.statementDate,
      profileComplete
    });

    return res.json({
      success: true,
      message: `✓ Synced ${savedCount} holdings from ${bestResult.casType}`,
      casType: bestResult.casType, holdingsSaved: savedCount,
      sessionId: logger.sessionId, profileComplete,
      scanned: logger.counts.scanned, parsed: logger.counts.parsed, failed: logger.counts.failed,
    });

  } catch (err) {
    console.error(JSON.stringify({ event: 'SYNC_CRASH', message: err.message, stack: err.stack }));
    await logger.failSession(err);
    return res.status(500).json({ error: 'Sync crashed', message: err.message, sessionId: logger.sessionId });
  }
});

// ── Also keep /sync for backward compat (calls CAS sync) ─────────────
router.post('/sync', requireAuth, (req, res, next) => {
  req.url = '/sync/cas';
  next('route');
});

// ── Save holdings (preserve avg_cost) ────────────────────────────────
async function saveCASHoldings(userId, holdings) {
  let saved = 0;
  for (const h of holdings) {
    if (!h.isin) continue;
    const { data: existing } = await supabase
      .from('holdings').select('avg_cost, dividend_per_share, sector')
      .eq('user_id', userId).eq('isin', h.isin).maybeSingle();

    const { error } = await supabase.from('holdings').upsert({
      user_id: userId, isin: h.isin,
      symbol: h.symbol || h.isin, company: h.company || h.isin,
      quantity: h.quantity, market_value: h.marketValue || null,
      avg_cost: existing?.avg_cost || 0,
      dividend_per_share: existing?.dividend_per_share || 0,
      sector: existing?.sector || 'Other',
      cas_source: h.source, cas_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,isin' });

    if (error) console.error(JSON.stringify({ event: 'HOLDING_SAVE_ERROR', isin: h.isin, error: error.message }));
    else saved++;
  }
  console.log(JSON.stringify({ event: 'HOLDINGS_SAVED', saved, total: holdings.length }));
  return saved;
}

// ── Email connection status ───────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const { data } = await supabase.from('email_connections')
    .select('provider, connected_at, last_synced, emails_parsed')
    .eq('user_id', req.user.id);
  res.json({ connections: data || [] });
});

// ── Sync sessions (Admin panel) ───────────────────────────────────────
router.get('/sessions', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sync_sessions')
    .select('*').eq('user_id', req.user.id)
    .order('started_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data || [] });
});

// ── Logs for a session ────────────────────────────────────────────────
router.get('/sessions/:sessionId/logs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sync_logs')
    .select('*').eq('session_id', req.params.sessionId).eq('user_id', req.user.id)
    .order('logged_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [] });
});

// ── All failures ──────────────────────────────────────────────────────
router.get('/failures', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sync_logs')
    .select('*').eq('user_id', req.user.id)
    .in('status', ['failed', 'password_failed', 'skipped'])
    .order('logged_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ failures: data || [] });
});

module.exports = router;
