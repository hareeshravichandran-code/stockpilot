/**
 * Kanalyst — Portfolio History Routes
 *
 * GET  /api/portfolio/history          — monthly snapshots for chart (default 5y)
 * GET  /api/portfolio/history/detail/:date — full holdings on a specific date
 * POST /api/portfolio/history/snapshot — save current state as snapshot (called by sync)
 * POST /api/portfolio/history/backfill — scan old CAS emails and build history
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── Shared helper: save a snapshot ────────────────────────────────
async function saveSnapshot(userId, { source = 'auto_sync', casType = 'UNKNOWN', snapshotDate } = {}) {
  try {
    // Load current equity holdings
    const { data: holdings } = await supabase
      .from('holdings')
      .select('isin, symbol, company, quantity, last_price, market_value, avg_cost, cas_statement_date')
      .eq('user_id', userId);

    // Load current MF holdings
    const { data: mfHoldings } = await supabase
      .from('mf_holdings')
      .select('isin, folio_number, fund_name, units, nav, current_value, invested_value, statement_date')
      .eq('user_id', userId);

    const h   = holdings   || [];
    const mf  = mfHoldings || [];

    const equityVal  = h.reduce((s, x) => s + parseFloat(x.market_value || (x.quantity * x.last_price) || 0), 0);
    const mfVal      = mf.reduce((s, x) => s + parseFloat(x.current_value || 0), 0);
    const totalVal   = equityVal + mfVal;
    const totalInvest= h.reduce((s, x) => s + parseFloat((x.quantity || 0) * (x.avg_cost || 0)), 0)
                     + mf.reduce((s, x) => s + parseFloat(x.invested_value || 0), 0);

    const date = snapshotDate || new Date().toISOString().split('T')[0];

    // Compact snapshot — only what we need for chart drill-down
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

  // Deduplicate to one per month (keep latest in that month)
  const byMonth = {};
  for (const row of (data || [])) {
    const month = row.snapshot_date.slice(0, 7); // YYYY-MM
    byMonth[month] = row;
  }

  const monthly = Object.values(byMonth).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  // Summary
  const latest  = monthly[monthly.length - 1] || null;
  const oldest  = monthly[0] || null;
  const growthPct = oldest && oldest.total_value > 0
    ? (((latest.total_value - oldest.total_value) / oldest.total_value) * 100).toFixed(2)
    : null;

  res.json({
    snapshots: monthly,
    summary: {
      count:      monthly.length,
      dateRange:  oldest ? { from: oldest.snapshot_date, to: latest?.snapshot_date } : null,
      latestValue: latest?.total_value || 0,
      oldestValue: oldest?.total_value || 0,
      growthPct,
      growthAbs:  latest && oldest ? parseFloat((latest.total_value - oldest.total_value).toFixed(2)) : 0,
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

// ── POST /backfill — scan ALL old CAS emails and build history ────
router.post('/backfill', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { fromDate, toDate } = req.body; // YYYY-MM-DD strings

  // Load Gmail connection
  const { data: conn } = await supabase
    .from('email_connections').select('*')
    .eq('user_id', userId).eq('provider', 'gmail').single();
  if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

  // Load user profile for PDF passwords
  const { data: userProfile } = await supabase
    .from('users').select('pan, dob').eq('id', userId).single();

  // Build Gmail query with date range
  const { fetchEmails } = require('../services/gmail');
  const casParser       = require('../services/casParser');
  const { saveCASHoldings } = require('./email');

  let queryParts = ['from:(cdslstatement.com OR nsdl.co.in OR nsdlindia.com OR cvlindia.com)'];
  if (fromDate) queryParts.push(`after:${fromDate.replace(/-/g, '/')}`);
  if (toDate)   queryParts.push(`before:${toDate.replace(/-/g, '/')}`);
  queryParts.push('has:attachment');
  const query = queryParts.join(' ');

  console.log(JSON.stringify({ event: 'BACKFILL_START', query, userId }));

  // Send immediate response — backfill runs async
  res.json({
    success: true,
    message: 'Backfill started — this may take a few minutes. Check the history chart when done.',
    query,
  });

  // ── Async processing ─────────────────────────────────────────
  (async () => {
    try {
      // Fetch ALL matching emails (up to 50 for backfill)
      const emails = await fetchEmails(
        conn.access_token, conn.refresh_token,
        query, userProfile || {},
        { maxResults: 50 }  // override default of 5
      );

      console.log(JSON.stringify({ event: 'BACKFILL_EMAILS_FOUND', count: emails.length }));

      let processed = 0, snapshots = 0;

      for (const email of emails) {
        try {
          const textToParse = email.text || email.body || '';
          if (!textToParse && !email.pdfBuffer) continue;

          const { holdings = [], mfHoldings = [], summary = {} } =
            casParser.parse(textToParse, email.pdfBuffer) || {};

          if (!holdings.length && !mfHoldings.length) continue;

          const casDate = summary?.statementDate || email.date?.split('T')[0] || null;
          if (!casDate) continue;

          // Save holdings to main tables
          await saveCASHoldings(userId, holdings, mfHoldings, casDate);

          // Save snapshot for this date
          await saveSnapshot(userId, {
            source:      'backfill',
            casType:     summary?.casType || 'UNKNOWN',
            snapshotDate: casDate,
          });

          processed++;
          snapshots++;
          console.log(JSON.stringify({ event: 'BACKFILL_DATE_DONE', casDate, equityCount: holdings.length, mfCount: mfHoldings.length }));
        } catch (e) {
          console.error(JSON.stringify({ event: 'BACKFILL_EMAIL_ERROR', error: e.message }));
        }
      }

      console.log(JSON.stringify({ event: 'BACKFILL_COMPLETE', processed, snapshots }));

      // Update the user's backfill status in DB
      await supabase.from('email_connections')
        .update({ backfill_done: true, backfill_at: new Date().toISOString() })
        .eq('id', conn.id);

    } catch (e) {
      console.error(JSON.stringify({ event: 'BACKFILL_FATAL', error: e.message }));
    }
  })();
});

module.exports = router;
module.exports.saveSnapshot = saveSnapshot;
