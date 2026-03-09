const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { fetchAllDividends, calculateUserDividends } = require('../services/dividendFetcher');

// GET /api/dividends — returns all dividend income for user
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get user holdings
    const { data: holdings } = await supabase
      .from('holdings').select('*').eq('user_id', req.user.id);

    if (!holdings?.length) return res.json({ income: [], summary: {} });

    // Fetch dividends from NSE
    const allDividends = await fetchAllDividends();
    const income = calculateUserDividends(allDividends, holdings);

    // Summarize by FY
    const byFY = {};
    for (const d of income) {
      if (!byFY[d.fy]) byFY[d.fy] = 0;
      byFY[d.fy] += d.total_dividend;
    }

    // Summarize by month (for calendar)
    const byMonth = {};
    for (const d of income) {
      if (!d.ex_date) continue;
      const key = d.ex_date.slice(0, 7); // YYYY-MM
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key] += d.total_dividend;
    }

    // Current FY total (Apr 2025 - Mar 2026)
    const currentFY = income
      .filter(d => d.fy === 'FY2026')
      .reduce((s, d) => s + d.total_dividend, 0);

    res.json({
      income,
      summary: {
        currentFY: parseFloat(currentFY.toFixed(2)),
        byFY: Object.fromEntries(
          Object.entries(byFY).map(([k, v]) => [k, parseFloat(v.toFixed(2))])
        ),
        byMonth: Object.fromEntries(
          Object.entries(byMonth).map(([k, v]) => [k, parseFloat(v.toFixed(2))])
        ),
        totalAllTime: parseFloat(income.reduce((s, d) => s + d.total_dividend, 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('Dividend route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
