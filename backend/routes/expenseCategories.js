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
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.userId = decoded.id || decoded.userId || decoded.sub;
    next();
  } catch { res.status(401).json({ error: 'Token expired or invalid' }); }
}

// ── GET /api/expense/categories ───────────────────────────────────────────────
// Returns system categories (all users share them) + user's custom categories
// Includes parent_id so Android can rebuild the hierarchy
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('expense_categories')
      .select('id, name, type, parent_id, icon, color, is_system')
      .or(`user_id.eq.${req.userId},is_system.eq.true`)
      .eq('is_deleted', false)
      .order('is_system', { ascending: false })
      .order('name');

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[expense/categories GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/categories ──────────────────────────────────────────────
// Creates a user-defined category (can optionally have a parent_id)
router.post('/categories', authMiddleware, async (req, res) => {
  try {
    const { id, name, type, parent_id, icon, color } = req.body;
    if (!name || !type)
      return res.status(400).json({ error: 'name and type are required' });

    const { data, error } = await supabase
      .from('expense_categories')
      .upsert({
        id:         id || undefined,
        user_id:    req.userId,
        name,
        type,
        parent_id:  parent_id || null,
        icon:       icon || '💳',
        color:      color || '#B2BEC3',
        is_system:  false,
        is_deleted: false,
        updated_at: Date.now()
      }, { onConflict: 'id' })
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
    const { name, icon, color, parent_id } = req.body;
    const { data, error } = await supabase
      .from('expense_categories')
      .update({ name, icon, color, parent_id: parent_id || null, updated_at: Date.now() })
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
