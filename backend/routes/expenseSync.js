// routes/expenseSync.js
// Mount in server.js: app.use('/api/expense', require('./routes/expenseSync'))

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.userId = decoded.id || decoded.userId || decoded.sub;
    next();
  } catch { res.status(401).json({ error: 'Token expired or invalid' }); }
}

// ── GET /api/expense/sync/pull?last_sync_at=1700000000 ────────────────────────
// Returns all records updated after last_sync_at (epoch millis)
// Android app calls this on startup to get any changes made on web
router.get('/sync/pull', authMiddleware, async (req, res) => {
  try {
    const lastSyncAt = parseInt(req.query.last_sync_at || '0');

    const [txnRes, catRes, budgetRes] = await Promise.all([
      supabase.from('expense_transactions')
        .select('*')
        .eq('user_id', req.userId)
        .gt('updated_at', lastSyncAt),
      supabase.from('expense_categories')
        .select('*')
        .or(`user_id.eq.${req.userId},is_system.eq.true`)
        .gt('updated_at', lastSyncAt)
        .eq('is_deleted', false),
      supabase.from('expense_budgets')
        .select('*')
        .eq('user_id', req.userId)
        .gt('updated_at', lastSyncAt)
    ]);

    if (txnRes.error)    throw txnRes.error;
    if (catRes.error)    throw catRes.error;
    if (budgetRes.error) throw budgetRes.error;

    res.json({
      transactions: txnRes.data || [],
      categories:   catRes.data || [],
      budgets:      budgetRes.data || [],
      total_count:  (txnRes.data?.length || 0) + (catRes.data?.length || 0) + (budgetRes.data?.length || 0),
      server_time:  Date.now()
    });
  } catch (err) {
    console.error('[expense/sync/pull GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expense/sync/status ──────────────────────────────────────────────
router.get('/sync/status', authMiddleware, async (req, res) => {
  try {
    const { count: txnCount } = await supabase
      .from('expense_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .eq('is_deleted', false);

    res.json({
      user_id:           req.userId,
      transaction_count: txnCount || 0,
      server_time:       Date.now()
    });
  } catch (err) {
    console.error('[expense/sync/status GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
