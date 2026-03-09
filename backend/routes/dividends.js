const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { fetchAllDividends } = require('../services/dividendFetcher');

// ── GET /api/dividends — serve from DB, refresh only if stale ──────
router.get('/', requireAuth, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';

    // Check when dividends were last synced
    const { data: userRow } = await supabase
      .from('users').select('dividends_synced_at').eq('id', req.user.id).single();

    const lastSync = userRow?.dividends_synced_at ? new Date(userRow.dividends_synced_at) : null;
    const hoursSinceSync = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : 999;
    const needsRefresh = forceRefresh || hoursSinceSync > 24;

    if (needsRefresh) {
      // Fetch holdings
      const { data: holdings } = await supabase
        .from('holdings').select('*').eq('user_id', req.user.id);

      if (holdings?.length) {
        // Fetch from Yahoo Finance
        const fetched = await fetchAllDividends(holdings);

        // Upsert into DB — UNIQUE(user_id, symbol, ex_date) prevents duplicates
        for (const d of fetched) {
          if (!d.symbol || !d.ex_date) continue;
          await supabase.from('dividend_income').upsert({
            user_id: req.user.id,
            isin: d.isin,
            symbol: d.symbol,
            company: d.company,
            ex_date: d.ex_date,
            dividend_per_share: d.dividend_per_share,
            dividend_type: d.dividend_type || 'Dividend',
            fy: d.fy,
            quantity: d.quantity,
            total_dividend: d.total_dividend,
            source: 'Yahoo Finance',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,symbol,ex_date' });
        }

        // Update sync timestamp
        await supabase.from('users')
          .update({ dividends_synced_at: new Date().toISOString() })
          .eq('id', req.user.id);
      }
    }

    // Always serve from DB
    const { data: income } = await supabase
      .from('dividend_income')
      .select('*')
      .eq('user_id', req.user.id)
      .order('ex_date', { ascending: false });

    if (!income?.length) {
      return res.json({ income: [], summary: { currentFY: 0, byFY: {}, byMonth: {}, totalAllTime: 0 }, fromCache: !needsRefresh });
    }

    // Build summary
    const byFY = {}, byMonth = {};
    for (const d of income) {
      if (d.fy) byFY[d.fy] = (byFY[d.fy] || 0) + d.total_dividend;
      if (d.ex_date) {
        const key = d.ex_date.slice(0, 7);
        byMonth[key] = (byMonth[key] || 0) + d.total_dividend;
      }
    }

    const currentFY = income.filter(d => d.fy === 'FY2026').reduce((s, d) => s + d.total_dividend, 0);

    res.json({
      income,
      fromCache: !needsRefresh,
      lastSynced: userRow?.dividends_synced_at || null,
      summary: {
        currentFY: parseFloat(currentFY.toFixed(2)),
        byFY: Object.fromEntries(Object.entries(byFY).map(([k,v]) => [k, parseFloat(v.toFixed(2))])),
        byMonth: Object.fromEntries(Object.entries(byMonth).map(([k,v]) => [k, parseFloat(v.toFixed(2))])),
        totalAllTime: parseFloat(income.reduce((s, d) => s + d.total_dividend, 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('Dividend route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/dividends/refresh — force re-fetch ───────────────────
router.post('/refresh', requireAuth, async (req, res) => {
  // Reset sync time to force refresh on next GET
  await supabase.from('users').update({ dividends_synced_at: null }).eq('id', req.user.id);
  res.json({ success: true, message: 'Dividend refresh queued. Reload the page.' });
});

module.exports = router;
