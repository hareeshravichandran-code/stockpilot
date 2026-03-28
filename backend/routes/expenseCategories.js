// routes/expenseCategories.js
// Mount in server.js: app.use('/api/expense', require('./routes/expenseCategories'))

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

// ── Default categories (seeded once per user) ─────────────────────────────────
const DEFAULT_CATEGORIES = [
  // Expenses
  { id: 'food_dining',   name: 'Food & Dining',   type: 'EXPENSE', icon: 'restaurant',            color: '#FF6B35', is_system: true },
  { id: 'travel',        name: 'Travel',           type: 'EXPENSE', icon: 'directions_car',         color: '#4ECDC4', is_system: true },
  { id: 'shopping',      name: 'Shopping',         type: 'EXPENSE', icon: 'shopping_bag',           color: '#45B7D1', is_system: true },
  { id: 'utilities',     name: 'Utilities',        type: 'EXPENSE', icon: 'bolt',                   color: '#96CEB4', is_system: true },
  { id: 'entertainment', name: 'Entertainment',    type: 'EXPENSE', icon: 'movie',                  color: '#FFEAA7', is_system: true },
  { id: 'health',        name: 'Health',           type: 'EXPENSE', icon: 'favorite',               color: '#FF7675', is_system: true },
  { id: 'education',     name: 'Education',        type: 'EXPENSE', icon: 'school',                 color: '#74B9FF', is_system: true },
  { id: 'investment',    name: 'Investment',       type: 'EXPENSE', icon: 'trending_up',            color: '#A29BFE', is_system: true },
  { id: 'bills',         name: 'Bills & Fees',     type: 'EXPENSE', icon: 'receipt',                color: '#FD79A8', is_system: true },
  { id: 'groceries',     name: 'Groceries',        type: 'EXPENSE', icon: 'local_grocery_store',    color: '#55EFC4', is_system: true },
  { id: 'fuel',          name: 'Fuel',             type: 'EXPENSE', icon: 'local_gas_station',      color: '#FDCB6E', is_system: true },
  // Income
  { id: 'salary',        name: 'Salary',           type: 'INCOME',  icon: 'work',                   color: '#00B894', is_system: true },
  { id: 'freelance',     name: 'Freelance',        type: 'INCOME',  icon: 'laptop',                 color: '#0984E3', is_system: true },
  { id: 'refund',        name: 'Refund',           type: 'INCOME',  icon: 'replay',                 color: '#6C5CE7', is_system: true },
  { id: 'cashback',      name: 'Cashback',         type: 'INCOME',  icon: 'loyalty',                color: '#FDCB6E', is_system: true },
  { id: 'inv_return',    name: 'Returns',          type: 'INCOME',  icon: 'account_balance',        color: '#E17055', is_system: true },
  { id: 'transfer_in',   name: 'Transfer In',      type: 'INCOME',  icon: 'call_received',          color: '#00CEC9', is_system: true },
  // Both
  { id: 'other',         name: 'Other',            type: 'BOTH',    icon: 'more_horiz',             color: '#B2BEC3', is_system: true },
];

// ── GET /api/expense/categories ───────────────────────────────────────────────
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    // Get user's custom categories + system ones
    const { data, error } = await supabase
      .from('expense_categories')
      .select('*')
      .or(`user_id.eq.${req.userId},is_system.eq.true`)
      .eq('is_deleted', false)
      .order('is_system', { ascending: false })
      .order('name');

    if (error) throw error;

    // If no categories at all, seed defaults for this user
    if (!data || data.length === 0) {
      const rows = DEFAULT_CATEGORIES.map(c => ({ ...c, user_id: req.userId, is_deleted: false }));
      const { data: seeded, error: seedErr } = await supabase
        .from('expense_categories')
        .upsert(rows, { onConflict: 'id' })
        .select();
      if (seedErr) throw seedErr;
      return res.json(seeded);
    }

    res.json(data);
  } catch (err) {
    console.error('[expense/categories GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/categories ──────────────────────────────────────────────
router.post('/categories', authMiddleware, async (req, res) => {
  try {
    const { name, type, icon, color } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required' });

    const { data, error } = await supabase
      .from('expense_categories')
      .insert({ user_id: req.userId, name, type, icon: icon || 'more_horiz', color: color || '#B2BEC3', is_system: false, is_deleted: false })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[expense/categories POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/expense/categories/:id ───────────────────────────────────────────
router.put('/categories/:id', authMiddleware, async (req, res) => {
  try {
    const { name, icon, color } = req.body;
    const { data, error } = await supabase
      .from('expense_categories')
      .update({ name, icon, color })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[expense/categories PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
