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

    // ── Gmail search: find CAS email, pick the latest ────────────────
    //
    // Confirmed CDSL sender: eCAS@cdslstatement.com  (NOT cdslindia.com)
    // NSDL sender:           cas@nsdl.co.in  /  nsdlindia.com
    // CVL sender:            cvlindia.com
    // No date filter — we want ALL historical CAS emails so we always find
    // at least one, then sort by date and take the latest.

    const searchAttempts = [
      // Attempt 1: confirmed exact senders (covers CDSL + NSDL + CVL)
      { label: 'EXACT_SENDERS',     q: `from:(cdslstatement.com OR nsdl.co.in OR nsdlindia.com OR cvlindia.com OR cdslindia.com) has:attachment` },
      // Attempt 2: subject fallback — catches any new/unknown sender domain
      { label: 'SUBJECT_EXACT',     q: `subject:"Consolidated Account Statement" has:attachment` },
      // Attempt 3: broadest — any PDF mentioning CAS keywords
      { label: 'SUBJECT_BROAD',     q: `subject:"account statement" (cdsl OR nsdl OR cvl) has:attachment` },
    ];

    let casEmails = [];
    let usedQuery = null;

    for (const attempt of searchAttempts) {
      console.log(JSON.stringify({ event: 'GMAIL_SEARCH', label: attempt.label, q: attempt.q }));
      try {
        const results = await fetchEmails(conn.access_token, conn.refresh_token, attempt.q, userProfile || {});
        console.log(JSON.stringify({ event: 'GMAIL_SEARCH_RESULT', label: attempt.label, count: results?.length || 0 }));
        if (results && results.length > 0) {
          casEmails = results;
          usedQuery = attempt.label;
          break;
        }
      } catch (gmailErr) {
        console.log(JSON.stringify({ event: 'GMAIL_SEARCH_ERROR', label: attempt.label, error: gmailErr.message }));
        await logger.logFailure({ phase: 'cas', errorType: 'GMAIL_SEARCH_ERROR',
          errorMessage: `${attempt.label}: ${gmailErr.message}` });
      }
    }

    if (casEmails.length === 0) {
      await logger.logSkipped({ phase: 'cas', reason: 'NO_EMAILS',
        detail: 'No CAS emails found after 4 search attempts (SENDER+PDF, SUBJECT_EXACT, SUBJECT_BROAD, SENDER_ALLTIME)' });
      await logger.finishSession({ message: 'No CAS emails found' });
      return res.json({
        success: false,
        message: 'No CAS emails found in this Gmail. Please check: (1) Your demat account is registered with this email. (2) You have opted-in for eCAS on cdslindia.com. (3) Check Gmail spam for emails from cdslindia.com or cvlindia.com.',
        tip: 'You can also download CAS manually from cdslindia.com and upload the PDF here.',
        sessionId: logger.sessionId, ...logger.counts
      });
    }

    console.log(JSON.stringify({ event: 'GMAIL_FOUND', count: casEmails.length, via: usedQuery }));

    // Sort emails by date descending — only process the LATEST CAS
    casEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestEmail = casEmails[0];
    console.log(JSON.stringify({ event: 'USING_LATEST_CAS', subject: latestEmail.subject, date: latestEmail.date, from: latestEmail.from, totalFound: casEmails.length }));

    // Process latest email per depository source (CDSL + NSDL can both exist)
    // Group by sender domain → take latest from each → process all
    const bySource = {};
    for (const email of casEmails) {
      const domain = (email.from || '').toLowerCase();
      const key = domain.includes('cdslstatement') || domain.includes('cdslindia') ? 'CDSL'
                : domain.includes('nsdl') ? 'NSDL'
                : domain.includes('cvl')  ? 'CVL'
                : 'OTHER';
      // Keep only latest per source
      if (!bySource[key] || new Date(email.date) > new Date(bySource[key].date)) {
        bySource[key] = email;
      }
    }
    const casEmailsToProcess = Object.values(bySource);
    console.log(JSON.stringify({ event: 'PROCESSING_SOURCES', sources: Object.keys(bySource), count: casEmailsToProcess.length }));


    let bestResult = null, bestDate = null;
    let totalSaved = 0;
    let casTypesSeen = [];

    for (const email of casEmailsToProcess) {
      const meta = { phase: 'cas', emailId: email.id, subject: email.subject, from: email.from, date: email.date };
      console.log(JSON.stringify({ 
        event: 'PROCESSING_EMAIL', 
        subject: email.subject, 
        from: email.from, 
        hasPdf: email.hasPdf,
        pdfFailed: email.pdfFailed,
        bodyLen: email.body?.length,
        hasPdfMarker: email.body?.includes('--- PDF ATTACHMENT ---'),
        bodyPreview: email.body?.slice(0, 100).replace(/\n/g,' ')
      }));

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

      // ── Extract PDF portion only (skip HTML email body) ────────
      const pdfMarker = '--- PDF ATTACHMENT ---';
      const pdfIdx = email.body.indexOf(pdfMarker);
      const textToParse = pdfIdx !== -1
        ? email.body.slice(pdfIdx + pdfMarker.length).trim()
        : email.body;

      // ── Detect and parse CAS ──────────────────────────────────
      const casType = detectCASType(textToParse);
      const isinMatches = [...textToParse.matchAll(/IN[A-Z0-9]{10}/g)];
      // Find where first ISIN appears and save surrounding context
      const diagSnippet = isinMatches.length > 0
        ? 'FOUND_ISINS:' + isinMatches.length + ' SAMPLE:' + textToParse.slice(Math.max(0, isinMatches[0].index - 30), isinMatches[0].index + 100)
        : 'NO_ISINS_IN_TEXT len=' + textToParse.length + ' end=' + textToParse.slice(-200);
      try {
        await supabase.from('sync_logs').insert({
          user_id: req.user.id,
          session_id: 'diag-' + Date.now(),
          phase: 'DIAGNOSTIC',
          email_subject: email.subject,
          error_type: 'DEBUG',
          error_message: diagSnippet,
          raw_text_snippet: textToParse.slice(0, 2000),
          logged_at: new Date().toISOString()
        });
      } catch(diagErr) { /* ignore */ }

      let parseResult;
      try {
        parseResult = parseCAS(textToParse);
      } catch (parseErr) {
        await logger.logFailure({
          ...meta, hasPdf: email.hasPdf || false,
          errorType: 'PARSE_FAILED', errorMessage: parseErr.message,
          errorStack: parseErr.stack, rawText: textToParse.slice(0, 1000)
        });
        continue;
      }

      const { holdings, summary } = parseResult;

      if (!holdings || holdings.length === 0) {
        // Save text from around where ISINs should be (skip nomination page 1)
        const isinSearch = textToParse.match(/IN[A-Z0-9]{10}/);
        const isinPos = isinSearch ? textToParse.indexOf(isinSearch[0]) : -1;
        const rawSnippet = isinPos > 0
          ? 'ISIN_AT:' + isinPos + ' CTX:' + textToParse.slice(Math.max(0, isinPos - 50), isinPos + 200)
          : 'NO_ISIN_FOUND. TEXT_END:' + textToParse.slice(-500);
        await logger.logFailure({
          ...meta, hasPdf: email.hasPdf || false,
          errorType: 'NO_ISIN',
          errorMessage: `Parsed as ${casType} but no ISINs/holdings found`,
          rawText: rawSnippet
        });
        continue;
      }

      // ── Success ───────────────────────────────────────────────
      await logger.logSuccess({
        ...meta, hasPdf: email.hasPdf || false,
        pdfUnlocked: email.hasPdf || false,
        itemsFound: holdings.length,
        parsedData: holdings,
        rawText: textToParse.slice(0, 1000)
      });

      const d = new Date(email.date);
      if (!bestDate || d > bestDate) {
        bestDate   = d;
        bestResult = { email, holdings, summary, casType };
      }

      // Save immediately — accumulate across CDSL + NSDL
      const saved = await saveCASHoldings(req.user.id, holdings, email.date);
      totalSaved += saved;
      casTypesSeen.push(casType);
    }

    // ── Final response ───────────────────────────────────────────
    if (totalSaved === 0 && !bestResult) {
      await logger.finishSession({ message: 'Emails found but none parsed successfully' });
      return res.json({
        success: false,
        message: 'CAS emails found but could not be parsed. Go to ⚙ Sync Logs for details.',
        sessionId: logger.sessionId, ...logger.counts
      });
    }

    await supabase.from('email_connections')
      .update({ last_synced: new Date().toISOString(), emails_parsed: casEmails.length })
      .eq('id', conn.id);

    const casTypesLabel = [...new Set(casTypesSeen)].join(' + ') || 'CAS';

    await logger.finishSession({
      casType: casTypesLabel,
      holdingsSaved: totalSaved,
      statementDate: bestResult?.summary?.statementDate,
      profileComplete
    });

    return res.json({
      success: true,
      message: `✓ Synced ${totalSaved} holdings from ${casTypesLabel}`,
      casType: casTypesLabel,
      holdingsSaved: totalSaved,
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
async function saveCASHoldings(userId, holdings, emailDate) {
  const { saveMFHolding } = require('./mf');
  let saved = 0;
  const casDate = emailDate ? new Date(emailDate).toISOString() : new Date().toISOString();

  for (const h of holdings) {
    if (!h.isin) continue;

    // ── MF / ETF (INF prefix) → mf_holdings table ────────────
    if (h.isin.startsWith('INF')) {
      const ok = await saveMFHolding(userId, {
        isin:          h.isin,
        fund_name:     h.company || h.isin,
        units:         h.quantity,
        nav:           h.market_price || null,
        current_value: h.market_value || (h.quantity * (h.market_price || 0)),
      }, emailDate, 'CDSL');
      if (ok) saved++;
      continue;
    }

    // ── Equity (INE prefix) → holdings table ─────────────────
    const { data: existing } = await supabase
      .from('holdings').select('avg_cost, dividend_per_share, sector')
      .eq('user_id', userId).eq('isin', h.isin).maybeSingle();

    const { error } = await supabase.from('holdings').upsert({
      user_id: userId, isin: h.isin,
      symbol: h.symbol || h.isin, company: h.company || h.isin,
      quantity: h.quantity, market_value: h.marketValue || null,
      avg_cost: existing?.avg_cost || h.market_price || 0,
      dividend_per_share: existing?.dividend_per_share || 0,
      sector: existing?.sector || 'Other',
      last_price: h.market_price || null,
      cas_source: h.cas_source || h.source || 'CAS',
      cas_updated_at: casDate,
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

// ── CDSL Debug — shows exactly what text is extracted from the PDF ────
// Call GET /api/email/debug-cdsl to diagnose CAS issues
router.get('/debug-cdsl', requireAuth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token').eq('user_id', req.user.id)
      .eq('provider', 'gmail').single();
    if (!conn) return res.status(400).json({ error: 'Gmail not connected' });

    const { data: userRow } = await supabase.from('users')
      .select('pan, dob, name, mobile').eq('id', req.user.id).single();

    const { fetchEmails } = require('../services/gmail');
    const { parseCAS, detectCASType } = require('../services/casParser');

    // Broad search — confirmed CDSL sender is eCAS@cdslstatement.com
    const query = 'from:(cdslstatement.com OR nsdl.co.in OR nsdlindia.com OR cvlindia.com OR cdslindia.com) has:attachment';
    const emails = await fetchEmails(conn.access_token, conn.refresh_token, query, userRow || {});

    if (!emails || emails.length === 0) {
      return res.json({
        status: 'NO_EMAILS',
        message: 'No emails found from CDSL/NSDL/CAMS with attachments',
        tip: 'Check your Gmail — search: from:cdsl has:attachment'
      });
    }

    // Sort latest first, take top 3
    emails.sort((a, b) => new Date(b.date) - new Date(a.date));
    const results = [];

    for (const email of emails.slice(0, 3)) {
      const pdfMarker = '--- PDF ATTACHMENT ---';
      const pdfIdx = email.body?.indexOf(pdfMarker) ?? -1;
      const textToParse = pdfIdx !== -1
        ? email.body.slice(pdfIdx + pdfMarker.length).trim()
        : (email.body || '');

      const isinMatches = [...textToParse.matchAll(/IN[A-Z0-9]{10}/g)];
      const parseResult = parseCAS(textToParse);

      results.push({
        subject:      email.subject,
        from:         email.from,
        date:         email.date,
        hasPdf:       email.hasPdf,
        pdfFailed:    email.pdfFailed,
        bodyLength:   email.body?.length || 0,
        textLength:   textToParse.length,
        casType:      detectCASType(textToParse),
        isinsFound:   isinMatches.length,
        holdingsParsed: parseResult.holdings.length,
        // First 2000 chars of extracted text — THIS IS THE KEY DIAGNOSTIC
        rawTextStart: textToParse.slice(0, 2000),
        // 200 chars around the first ISIN
        firstIsinContext: isinMatches.length > 0
          ? textToParse.slice(Math.max(0, isinMatches[0].index - 50), isinMatches[0].index + 200)
          : null,
        parsedHoldings: parseResult.holdings.slice(0, 5),
      });
    }

    res.json({ emailsFound: emails.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) });
  }
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
