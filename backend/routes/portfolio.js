const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { getPrices } = require('../services/prices');

// ── Get full portfolio with live prices ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: holdings, error } = await supabase
      .from('holdings')
      .select('*')
      .eq('user_id', req.user.id)
      .order('market_value', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Fetch live prices
    const symbols = holdings.map(h => h.symbol);
    const prices = symbols.length > 0 ? await getPrices(symbols) : {};

    // Enrich holdings with live data
    const enriched = holdings.map(h => {
      const liveData = prices[h.symbol];
      const ltp = liveData?.price || h.last_price || h.avg_cost;
      const marketValue = h.quantity * ltp;
      const costValue = h.quantity * h.avg_cost;
      const pnl = marketValue - costValue;
      const pnlPct = costValue > 0 ? (pnl / costValue * 100) : 0;

      return {
        ...h,
        ltp,
        marketValue,
        costValue,
        pnl,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        change: liveData?.change || 0,
        changePct: liveData?.changePct || 0,
        dividendYieldOnCost: h.dividend_per_share > 0
          ? parseFloat((h.dividend_per_share / h.avg_cost * 100).toFixed(2))
          : 0
      };
    });

    // Portfolio summary
    const totalCost = enriched.reduce((s, h) => s + h.costValue, 0);
    const totalMarket = enriched.reduce((s, h) => s + h.marketValue, 0);
    const totalPnl = totalMarket - totalCost;
    const totalDividend = enriched.reduce((s, h) => s + (h.quantity * (h.dividend_per_share || 0)), 0);

    res.json({
      holdings: enriched,
      summary: {
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalMarket: parseFloat(totalMarket.toFixed(2)),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        totalPnlPct: totalCost > 0 ? parseFloat((totalPnl / totalCost * 100).toFixed(2)) : 0,
        totalDividend: parseFloat(totalDividend.toFixed(2)),
        yieldOnCost: totalCost > 0 ? parseFloat((totalDividend / totalCost * 100).toFixed(2)) : 0,
        yieldOnMarket: totalMarket > 0 ? parseFloat((totalDividend / totalMarket * 100).toFixed(2)) : 0,
        holdingsCount: enriched.length,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Add holding manually ──
router.post('/holding', requireAuth, async (req, res) => {
  const { symbol, company, quantity, avgCost, sector, dividendPerShare } = req.body;
  if (!symbol || !quantity || !avgCost) {
    return res.status(400).json({ error: 'symbol, quantity and avgCost are required' });
  }
  const { data, error } = await supabase.from('holdings').upsert({
    user_id: req.user.id,
    symbol: symbol.toUpperCase(),
    company: company || symbol,
    quantity: parseInt(quantity),
    avg_cost: parseFloat(avgCost),
    sector: sector || 'Other',
    dividend_per_share: parseFloat(dividendPerShare || 0),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,symbol' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Get transactions ──
router.get('/transactions', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('trade_date', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Get dividends ──
router.get('/dividends', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('dividends')
    .select('*')
    .eq('user_id', req.user.id)
    .order('credit_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const totalIncome = data.reduce((s, d) => s + (d.total_amount || 0), 0);
  res.json({ dividends: data, totalIncome: parseFloat(totalIncome.toFixed(2)) });
});

// ── Tax summary ──
router.get('/tax', requireAuth, async (req, res) => {
  const { data: txns } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('type', 'SELL');

  let stcg = 0, ltcg = 0;
  for (const tx of (txns || [])) {
    const { data: buyTx } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('symbol', tx.symbol)
      .eq('type', 'BUY')
      .order('trade_date', { ascending: true })
      .limit(1)
      .single();

    if (buyTx) {
      const holdingDays = Math.floor(
        (new Date(tx.trade_date) - new Date(buyTx.trade_date)) / (1000 * 60 * 60 * 24)
      );
      const gain = (tx.price - buyTx.price) * tx.quantity;
      if (holdingDays < 365) stcg += gain;
      else ltcg += gain;
    }
  }

  const { data: divs } = await supabase
    .from('dividends')
    .select('total_amount')
    .eq('user_id', req.user.id);
  const totalDividend = (divs || []).reduce((s, d) => s + (d.total_amount || 0), 0);
  const tdsDeducted = totalDividend * 0.10; // estimate

  res.json({
    stcg: parseFloat(stcg.toFixed(2)),
    ltcg: parseFloat(ltcg.toFixed(2)),
    stcgTax: parseFloat((Math.max(0, stcg) * 0.20).toFixed(2)),
    ltcgExempt: 125000,
    ltcgTaxable: parseFloat(Math.max(0, ltcg - 125000).toFixed(2)),
    ltcgTax: parseFloat((Math.max(0, ltcg - 125000) * 0.125).toFixed(2)),
    dividendIncome: parseFloat(totalDividend.toFixed(2)),
    tdsDeducted: parseFloat(tdsDeducted.toFixed(2))
  });
});

module.exports = router;
