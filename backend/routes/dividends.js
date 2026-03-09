const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { fetchAllDividends } = require('../services/dividendFetcher');

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: holdings } = await supabase
      .from('holdings').select('*').eq('user_id', req.user.id);

    if (!holdings?.length) return res.json({ income: [], summary: { currentFY: 0, byFY: {}, byMonth: {}, totalAllTime: 0 } });

    // fetchAllDividends takes holdings, returns income with quantity+total already calculated
    const income = await fetchAllDividends(holdings);

    const byFY = {}, byMonth = {};
    for (const d of income) {
      if (d.fy) { byFY[d.fy] = (byFY[d.fy] || 0) + d.total_dividend; }
      if (d.ex_date) {
        const key = d.ex_date.slice(0, 7);
        byMonth[key] = (byMonth[key] || 0) + d.total_dividend;
      }
    }

    const currentFY = income.filter(d => d.fy === 'FY2026').reduce((s, d) => s + d.total_dividend, 0);

    res.json({
      income,
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

module.exports = router;
