/**
 * Kanalyst — Portfolio History Routes
 *
 * GET  /api/portfolio/history                 — monthly snapshots for chart (default 5y)
 * GET  /api/portfolio/history/detail/:date    — full holdings on a specific date
 * POST /api/portfolio/history/snapshot        — save current state as snapshot (called by sync)
 * POST /api/portfolio/history/backfill        — scan old CAS emails and build history
 * GET  /api/portfolio/history/backfill/status — poll last-run status from sync_sessions
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const SyncLogger  = require('../services/logger');
const { decrypt } = require('../services/tokenCrypto');

// ── Shared helper: save a snapshot ────────────────────────────────
async function saveSnapshot(userId, { source = 'auto_sync', casType = 'UNKNOWN', snapshotDate } = {}) {
  try {
    const { data: holdings } = await supabase
      .from('holdings')
      .select('isin, symbol, company, quantity, last_price, market_value, avg_cost, cas_statement_date')
      .eq('user_id', userId);

    const { data: mfHoldings } = await supabase
      .from('mf_holdings')
      .select('isin, folio_number, fund_name, units, nav, current_value, invested_value, statement_date')
      .eq('user_id', userId);

    const h  = holdings   || [];
    const mf = mfHoldings || [];

    const equityVal   = h.reduce((s, x) => s + parseFloat(x.market_value || (x.quantity * x.last_price) || 0), 0);
    const mfVal       = mf.reduce((s, x) => s + parseFloat(x.current_value || 0), 0);
    const totalVal    = equityVal + mfVal;
    const totalInvest = h.reduce((s, x) => s + parseFloat((x.quantity || 0) * (x.avg_cost || 0)), 0)
                      + mf.reduce((s, x) => s + parseFloat(x.invested_value || 0), 0);

    const date = snapshotDate || new Date().toISOString().split('T')[0];

    const holdingsJson = h.map(x => ({
      isin: x.isin, symbol: x.symbol, company: x.company,
      qty: x.quantity, mv: parseFloat(x.market_value || 0), lp: parseFloat(x.last_price || 0)
    }));
    const mfJson = mf.map(x => ({
      isin: x.isin || x.folio_number, name: x.fund_name,
      units: parseFloat(x.units || 0), nav: parseFloat(x.nav || 0), cv: parseFloat(x.current_value || 0)
    }));

    const { error } = await supabase.from('portfolio_snapshots').upsert({
      user_id:            userId,
      snapshot_date:      date,
      total_value:        parseFloat(totalVal.toFixed(2)),
      total_equity_value: parseFloat(equityVal.toFixed(2)),
      total_mf_value:     parseFloat(mfVal.toFixed(2)),
      total_invested:     parseFloat(totalInvest.toFixed(2)),
      total_gain_loss:    parseFloat((totalVal - totalInvest).toFixed(2)),
      holding_count:      h.length,
      mf_count:           mf.length,
      source,
      cas_type:           casType,
      holdings_json:      holdingsJson,
      mf_json:            mfJson,
      created_at:         new Date().toISOString(),
    }, { onConflict: 'user_id,snapshot_date' });

    if (error) console.error(JSON.stringify({ event: 'SNAPSHOT_SAVE_ERROR', error: error.message }));
    else       console.log(JSON.stringify({ event: 'SNAPSHOT_SAVED', date, totalVal, equityVal, mfVal, source }));

    return { date, totalVal, equityVal, mfVal, error };
  } catch (e) {
    console.error(JSON.stringify({ event: 'SNAPSHOT_EXCEPTION', error: e.message }));
    return { error: e.message };
  }
}

// ── GET / — return chart-ready monthly snapshots ──────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const years  = parseInt(req.query.years || '5');
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value, total_equity_value, total_mf_value, total_invested, total_gain_loss, holding_count, mf_count, source, cas_type')
    .eq('user_id', userId)
    .gte('snapshot_date', cutoff.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const byMonth = {};
  for (const row of (data || [])) {
    const month = row.snapshot_date.slice(0, 7);
    byMonth[month] = row;
  }
  const monthly  = Object.values(byMonth).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest   = monthly[monthly.length - 1] || null;
  const oldest   = monthly[0] || null;
  const growthPct = oldest && oldest.total_value > 0
    ? (((latest.total_value - oldest.total_value) / oldest.total_value) * 100).toFixed(2)
    : null;

  res.json({
    snapshots: monthly,
    summary: {
      count:       monthly.length,
      dateRange:   oldest ? { from: oldest.snapshot_date, to: latest?.snapshot_date } : null,
      latestValue: latest?.total_value || 0,
      oldestValue: oldest?.total_value || 0,
      growthPct,
      growthAbs:   latest && oldest ? parseFloat((latest.total_value - oldest.total_value).toFixed(2)) : 0,
    }
  });
});

// ── GET /detail/:date — full holdings on a date ───────────────────
router.get('/detail/:date', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('snapshot_date', req.params.date)
    .single();

  if (error) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(data);
});

// ── POST /snapshot — save current holdings as snapshot ────────────
router.post('/snapshot', requireAuth, async (req, res) => {
  const { source = 'manual', casType = 'UNKNOWN', snapshotDate } = req.body;
  const result = await saveSnapshot(req.user.id, { source, casType, snapshotDate });
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ success: true, ...result });
});

// ── GET /backfill/status — last backfill run status ───────────────
// Fetches the most recent backfill sync_session for this user and its logs.
// The frontend polls this while a run is in progress.
router.get('/backfill/status', requireAuth, async (req, res) => {
  try {
    // Most recent backfill session
    const { data: session } = await supabase
      .from('sync_sessions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('sync_type', 'backfill')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) return res.json({ session: null, logs: [] });

    // All log rows for this session
    const { data: logs } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('session_id', session.id)
      .eq('user_id', req.user.id)
      .order('logged_at', { ascending: true });

    res.json({ session, logs: logs || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /nps/status — last NPS sync status ────────────────────────
router.get('/nps/status', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sync_sessions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('sync_type', 'nps_backfill')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) return res.json({ session: null, logs: [] });

    const { data: logs } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('session_id', session.id)
      .eq('user_id', req.user.id)
      .order('logged_at', { ascending: true });

    res.json({ session, logs: logs || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /backfill — scan ALL old CAS emails and build history ─────
router.post('/backfill', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { fromDate, toDate } = req.body; // YYYY-MM-DD strings

  const { data: conn } = await supabase
    .from('email_connections').select('*')
    .eq('user_id', userId).eq('provider', 'gmail').single();
  if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

  const { data: userProfile } = await supabase
    .from('users').select('pan, dob').eq('id', userId).single();

  const { fetchEmails } = require('../services/gmail');
  const casParser       = require('../services/casParser');
  const { saveCASHoldings } = require('./email');

  // ── FIX: decrypt tokens before passing to fetchEmails (was a bug — raw encrypted token was sent)
  const accessToken  = decrypt(conn.access_token);
  const refreshToken = decrypt(conn.refresh_token);

  let queryParts = ['from:(cdslstatement.com OR nsdl.co.in OR nsdlindia.com OR cvlindia.com)'];
  if (fromDate) queryParts.push(`after:${fromDate.replace(/-/g, '/')}`);
  if (toDate)   queryParts.push(`before:${toDate.replace(/-/g, '/')}`);
  queryParts.push('has:attachment');
  const query = queryParts.join(' ');

  console.log(JSON.stringify({ event: 'BACKFILL_START', query, userId, fromDate, toDate }));

  // Respond immediately — backfill runs async in the background
  res.json({
    success: true,
    message: 'Backfill started — scanning all CAS emails. Watch the status panel for live results.',
    query,
  });

  // ── Async background processing with full SyncLogger tracking ────
  (async () => {
    const logger = new SyncLogger(userId);
    logger.syncType = 'backfill'; // used by startSession below

    try {
      // Start a tracked session — writes a row to sync_sessions
      await supabase.from('sync_sessions').insert({
        user_id:    userId,
        started_at: new Date().toISOString(),
        status:     'running',
        sync_type:  'backfill',
        summary:    { query, fromDate, toDate },
      }).select('id').single().then(({ data }) => {
        if (data) logger.sessionId = data.id;
      });

      console.log(JSON.stringify({ event: 'BACKFILL_SESSION_STARTED', sessionId: logger.sessionId }));

      // Fetch emails — now with decrypted token
      const emails = await fetchEmails(accessToken, refreshToken, query, userProfile || {}, { maxResults: 100 });

      console.log(JSON.stringify({ event: 'BACKFILL_EMAILS_FOUND', count: emails.length, query }));

      if (emails.length === 0) {
        await logger.logFailure({
          phase: 'search', errorType: 'NO_EMAILS',
          errorMessage: `Gmail query returned 0 emails: ${query}`,
        });
        await logger.finishSession({ query, reason: 'no_emails_found' });
        return;
      }

      let processed = 0, snapshots = 0;

      for (const email of emails) {
        const emailMeta = {
          emailId:    email.id,
          subject:    email.subject,
          from:       email.from,
          date:       email.date,
          hasPdf:     !!email.pdfBuffer || email.hasPdf,
          pdfFailed:  email.pdfFailed,
        };

        try {
          const textToParse = email.text || email.body || '';

          // Skip if no content and no PDF buffer
          if (!textToParse && !email.pdfBuffer) {
            await logger.logSkipped({
              ...emailMeta, phase: 'cas',
              reason: 'NO_CONTENT',
              detail: 'Email has neither text body nor PDF buffer',
            });
            continue;
          }

          // Log PDF status explicitly
          if (email.pdfFailed) {
            console.log(JSON.stringify({
              event: 'BACKFILL_PDF_FAILED',
              subject: email.subject,
              date: email.date,
              pdfFilename: email.pdfFilename,
              reason: 'PDF password could not be resolved or PDF was unreadable',
            }));
          }

          const parseResult = casParser.parse(textToParse, email.pdfBuffer) || {};
          const { holdings = [], mfHoldings = [], summary = {} } = parseResult;

          if (!holdings.length && !mfHoldings.length) {
            await logger.logFailure({
              ...emailMeta, phase: 'cas',
              errorType: 'NO_ISIN',
              errorMessage: `CAS parsed but 0 equity and 0 MF holdings found. PDF failed: ${email.pdfFailed}. Text length: ${textToParse.length}`,
              rawText: textToParse.slice(0, 500),
            });
            continue;
          }

          const casDate = summary?.statementDate || email.date?.split('T')[0] || null;
          if (!casDate) {
            await logger.logFailure({
              ...emailMeta, phase: 'cas',
              errorType: 'NO_DATE',
              errorMessage: 'Could not determine CAS statement date from email or parsed content',
            });
            continue;
          }

          // Save holdings to main tables
          await saveCASHoldings(userId, holdings, mfHoldings, casDate);

          // Save snapshot for this date
          await saveSnapshot(userId, {
            source:       'backfill',
            casType:      summary?.casType || 'UNKNOWN',
            snapshotDate: casDate,
          });

          await logger.logSuccess({
            ...emailMeta, phase: 'cas',
            itemsFound:  holdings.length + mfHoldings.length,
            parsedData:  [{ casDate, equityCount: holdings.length, mfCount: mfHoldings.length, casType: summary?.casType }],
            rawText:     textToParse.slice(0, 200),
          });

          processed++;
          snapshots++;
          console.log(JSON.stringify({
            event: 'BACKFILL_DATE_DONE', casDate,
            equityCount: holdings.length, mfCount: mfHoldings.length,
            casType: summary?.casType,
          }));

        } catch (e) {
          console.error(JSON.stringify({ event: 'BACKFILL_EMAIL_ERROR', subject: email.subject, error: e.message, stack: e.stack?.slice(0, 300) }));
          await logger.logFailure({
            ...emailMeta, phase: 'cas',
            errorType:    'PARSE_FAILED',
            errorMessage: e.message,
            errorStack:   e.stack?.slice(0, 300),
          });
        }
      }

      console.log(JSON.stringify({ event: 'BACKFILL_COMPLETE', processed, snapshots, totalEmails: emails.length }));

      await logger.finishSession({ processed, snapshots, totalEmails: emails.length, query });

      await supabase.from('email_connections')
        .update({ backfill_done: true, backfill_at: new Date().toISOString() })
        .eq('id', conn.id);

    } catch (e) {
      console.error(JSON.stringify({ event: 'BACKFILL_FATAL', error: e.message, stack: e.stack?.slice(0, 300) }));
      await logger.logFailure({
        phase: 'backfill_fatal', errorType: 'FATAL',
        errorMessage: e.message, errorStack: e.stack?.slice(0, 300),
      });
      await logger.finishSession({ error: e.message });
    }
  })();
});

module.exports = router;
module.exports.saveSnapshot = saveSnapshot;
