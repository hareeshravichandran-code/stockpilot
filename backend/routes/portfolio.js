const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { getPrices, getSectorFromYahoo, getSectorLocal, toNSE } = require('../services/prices');

// ── Get full portfolio with live prices ────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: holdings, error } = await supabase
      .from('holdings')
      .select('*')
      .eq('user_id', req.user.id)
      .order('quantity', { ascending: false }); // market_value is computed — order by quantity instead

    if (error) return res.status(500).json({ error: error.message });

    const symbols = holdings.map(h => h.symbol);
    const prices  = symbols.length > 0 ? await getPrices(symbols, holdings) : {};

    const enriched = await Promise.all(holdings.map(async h => {
      const liveData  = prices[h.symbol];
      const ltp       = liveData?.price || h.last_price || h.avg_cost || 0;
      const marketValue = h.quantity * ltp;
      const costValue   = h.quantity * (h.avg_cost || ltp);
      const pnl         = marketValue - costValue;
      const pnlPct      = costValue > 0 ? (pnl / costValue * 100) : 0;

      let sector = h.sector || 'Other';
      const sectorFromMap = getSectorLocal(h.symbol);
      if (sectorFromMap !== 'Other') sector = sectorFromMap;
      else if (liveData?.sector) sector = liveData.sector;

      // Persist live price to DB in background — never block the response
      if (liveData?.price && liveData.source !== 'DB_cache' && liveData.source !== 'stale_cache') {
        const patch = {
          last_price: liveData.price,
          updated_at: new Date().toISOString(),
        };
        // price_updated_at column — add via Supabase SQL if missing:
        // ALTER TABLE holdings ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ;
        try { patch.price_updated_at = new Date().toISOString(); } catch(e) {}
        if (sector !== 'Other') patch.sector = sector;
        supabase.from('holdings').update(patch)
          .eq('user_id', req.user.id).eq('symbol', h.symbol).catch(() => {});
      }

      return {
        ...h, ltp, marketValue, costValue, pnl,
        pnlPct:    parseFloat(pnlPct.toFixed(2)),
        change:    liveData?.change    || 0,
        changePct: liveData?.changePct || 0,
        sector,
        priceSource: liveData?.source || (h.last_price ? 'cached' : 'cost'),
        dividendYieldOnCost: h.dividend_per_share > 0
          ? parseFloat((h.dividend_per_share / (h.avg_cost || ltp) * 100).toFixed(2)) : 0
      };
    }));

    const totalCost    = enriched.reduce((s, h) => s + h.costValue, 0);
    const totalMarket  = enriched.reduce((s, h) => s + h.marketValue, 0);
    const totalPnl     = totalMarket - totalCost;
    const totalDividend = enriched.reduce((s, h) => s + (h.quantity * (h.dividend_per_share || 0)), 0);

    res.json({
      holdings: enriched,
      summary: {
        totalCost:     parseFloat(totalCost.toFixed(2)),
        totalMarket:   parseFloat(totalMarket.toFixed(2)),
        totalPnl:      parseFloat(totalPnl.toFixed(2)),
        totalPnlPct:   totalCost > 0 ? parseFloat((totalPnl / totalCost * 100).toFixed(2)) : 0,
        totalDividend: parseFloat(totalDividend.toFixed(2)),
        yieldOnCost:   totalCost > 0   ? parseFloat((totalDividend / totalCost   * 100).toFixed(2)) : 0,
        yieldOnMarket: totalMarket > 0 ? parseFloat((totalDividend / totalMarket * 100).toFixed(2)) : 0,
        holdingsCount: enriched.length,
        lastUpdated:   new Date().toISOString(),
        casDate:       enriched[0]?.cas_updated_at || null,
        casSource:     enriched[0]?.cas_source     || null
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sync prices + sectors from Yahoo on demand ─────────────────────
router.post('/sync-prices', requireAuth, async (req, res) => {
  try {
    const { data: holdings } = await supabase
      .from('holdings').select('symbol, last_price').eq('user_id', req.user.id);

    if (!holdings || holdings.length === 0)
      return res.json({ success: true, updated: 0, message: 'No holdings to sync' });

    const symbols = holdings.map(h => h.symbol);
    const prices  = await getPrices(symbols, holdings);

    let updated = 0;
    for (const h of holdings) {
      const live = prices[h.symbol];
      if (!live?.price) continue;

      const sector = live.sector || getSectorLocal(toNSE(h.symbol));
      const patch  = {
        last_price: live.price,
        updated_at: new Date().toISOString(),
      };
      try { patch.price_updated_at = new Date().toISOString(); } catch(e) {}
      if (sector && sector !== 'Other') patch.sector = sector;

      await supabase.from('holdings').update(patch)
        .eq('user_id', req.user.id).eq('symbol', h.symbol);
      updated++;
    }

    res.json({ success: true, updated, total: holdings.length,
      message: `Synced ${updated}/${holdings.length} holdings from Yahoo Finance` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stock search autocomplete ──────────────────────────────────────
router.get('/search', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1)
    return res.json([]);
  const { searchStocks } = require('../services/nseStocks');
  res.json(searchStocks(q));
});

// ── Add holding manually ───────────────────────────────────────────
router.post('/holding', requireAuth, async (req, res) => {
  const { symbol, isin, company, quantity, avgCost, sector } = req.body;
  if (!symbol || !quantity)
    return res.status(400).json({ error: 'symbol and quantity are required' });

  // Enrich from NSE master if not provided
  const { getStockBySymbol } = require('../services/nseStocks');
  const master = getStockBySymbol(symbol);

  const row = {
    user_id:    req.user.id,
    symbol:     symbol.toUpperCase().replace(/\.(NSE|BSE)$/i, ''),
    isin:       isin       || master?.isin    || null,
    company:    company    || master?.company || symbol,
    sector:     sector     || master?.sector  || 'Other',
    quantity:   parseInt(quantity),
    avg_cost:   avgCost ? parseFloat(avgCost) : 0,
    last_price: avgCost ? parseFloat(avgCost) : 0,  // seed with cost until Yahoo syncs
    source:     'manual',   // ← indicator: manually entered
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('holdings')
    .upsert(row, { onConflict: 'user_id,symbol' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ...data, message: 'Holding saved. Prices will sync automatically.' });
});

// ── Transactions ───────────────────────────────────────────────────
router.get('/transactions', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('transactions').select('*').eq('user_id', req.user.id)
    .order('trade_date', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Dividends ──────────────────────────────────────────────────────
router.get('/dividends', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('dividends').select('*').eq('user_id', req.user.id)
    .order('credit_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const totalIncome = data.reduce((s, d) => s + (d.total_amount || 0), 0);
  res.json({ dividends: data, totalIncome: parseFloat(totalIncome.toFixed(2)) });
});

// ── Tax summary ────────────────────────────────────────────────────
router.get('/tax', requireAuth, async (req, res) => {
  const { data: txns } = await supabase
    .from('transactions').select('*').eq('user_id', req.user.id).eq('type', 'SELL');

  let stcg = 0, ltcg = 0;
  for (const tx of (txns || [])) {
    const { data: buyTx } = await supabase
      .from('transactions').select('*').eq('user_id', req.user.id)
      .eq('symbol', tx.symbol).eq('type', 'BUY')
      .order('trade_date', { ascending: true }).limit(1).single();
    if (buyTx) {
      const days = Math.floor((new Date(tx.trade_date) - new Date(buyTx.trade_date)) / 86400000);
      const gain = (tx.price - buyTx.price) * tx.quantity;
      if (days < 365) stcg += gain; else ltcg += gain;
    }
  }

  const { data: divs } = await supabase
    .from('dividends').select('total_amount').eq('user_id', req.user.id);
  const totalDividend = (divs || []).reduce((s, d) => s + (d.total_amount || 0), 0);

  res.json({
    stcg:          parseFloat(stcg.toFixed(2)),
    ltcg:          parseFloat(ltcg.toFixed(2)),
    stcgTax:       parseFloat((Math.max(0, stcg)        * 0.20).toFixed(2)),
    ltcgExempt:    125000,
    ltcgTaxable:   parseFloat(Math.max(0, ltcg - 125000).toFixed(2)),
    ltcgTax:       parseFloat((Math.max(0, ltcg - 125000) * 0.125).toFixed(2)),
    dividendIncome: parseFloat(totalDividend.toFixed(2)),
    tdsDeducted:   parseFloat((totalDividend * 0.10).toFixed(2))
  });
});

// ── Asset Balances (PPF/EPF/NPS/FD/SSY) ───────────────────────────
router.get('/assets', requireAuth, async (req, res) => {
  const { data } = await supabase.from('asset_balances')
    .select('*').eq('user_id', req.user.id);
  const balances = { ppf:0, epf:0, nps:0, fd:0, ssy:0 };
  if (data) data.forEach(r => { balances[r.asset_type.toLowerCase()] = r.balance; });
  res.json(balances);
});

router.post('/assets', requireAuth, async (req, res) => {
  try {
    const { ppf=0, epf=0, nps=0, fd=0, ssy=0, homeLoan=0, creditCard=0, monthlyIncome=0 } = req.body;
    const assets = [
      { asset_type: 'PPF',           balance: ppf          },
      { asset_type: 'EPF',           balance: epf          },
      { asset_type: 'NPS',           balance: nps          },
      { asset_type: 'FD',            balance: fd           },
      { asset_type: 'SSY',           balance: ssy          },
      { asset_type: 'HOME_LOAN',     balance: homeLoan     },
      { asset_type: 'CREDIT_CARD',   balance: creditCard   },
      { asset_type: 'MONTHLY_INCOME',balance: monthlyIncome},
    ];
    for (const a of assets) {
      await supabase.from('asset_balances').upsert(
        { user_id: req.user.id, asset_type: a.asset_type,
          balance: a.balance, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,asset_type' }
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
