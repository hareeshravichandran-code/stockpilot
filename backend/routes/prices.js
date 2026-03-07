const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { getPrice, getPrices } = require('../services/prices');

// ── Single symbol price ──
router.get('/:symbol', requireAuth, async (req, res) => {
  const data = await getPrice(req.params.symbol.toUpperCase());
  if (!data) return res.status(404).json({ error: 'Price not found' });
  res.json(data);
});

// ── Multiple symbols ──
router.post('/bulk', requireAuth, async (req, res) => {
  const { symbols } = req.body;
  if (!symbols || !Array.isArray(symbols)) {
    return res.status(400).json({ error: 'symbols array required' });
  }
  const prices = await getPrices(symbols.map(s => s.toUpperCase()));
  res.json(prices);
});

module.exports = router;
