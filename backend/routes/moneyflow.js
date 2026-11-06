/**
 * Money flow module
 *   GET /api/moneyflow?month=YYYY-MM   income / expenses / investments by category, actual vs expected
 */
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { monthFlow } = require('../services/moneyflow');

router.get('/', requireAuth, async (req, res) => {
  try {
    const now = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : now;
    res.json(await monthFlow(req.user.id, month));
  } catch (err) {
    console.error(JSON.stringify({ event: 'MONEYFLOW_ERROR', error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
