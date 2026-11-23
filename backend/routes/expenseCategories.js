// routes/expenseCategories.js
// Mount in server.js: app.use('/api/expense', require('./routes/expenseCategories'))

const express = require('express');
const router  = express.Router();
const jwt = require('jsonwebtoken');

const supabase = require('../services/supabase');

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

// ── DELETE /api/expense/categories/:id ────────────────────────────────────────
// The web Manage page called this but the route was missing, so a delete never worked (K-210).
// Removes the user's own category and its subcategories; their payments go back to uncategorised and
// rules that filed into them stop. updated_at (epoch ms) moves so phones take the change on their next pull.
router.delete('/categories/:id', authMiddleware, async (req, res) => {
  try {
    const uid = req.userId, now = Date.now();
    const { data: cat } = await supabase.from('expense_categories').select('id, is_system, user_id')
      .eq('id', req.params.id).maybeSingle();
    if (!cat || cat.user_id !== uid || cat.is_system) return res.status(404).json({ error: 'Not your category' });
    const { data: kids } = await supabase.from('expense_categories').select('id').eq('user_id', uid).eq('parent_id', cat.id);
    const ids = [cat.id, ...(kids || []).map(k => k.id)];
    const r1 = await supabase.from('expense_categories').update({ is_deleted: true, updated_at: now }).eq('user_id', uid).in('id', ids);
    if (r1.error) throw r1.error;
    const r2 = await supabase.from('expense_transactions').update({ category_id: null, updated_at: now }).eq('user_id', uid).in('category_id', ids);
    if (r2.error) throw r2.error;
    const r3 = await supabase.from('user_sms_rules').update({ is_deleted: true, updated_at: now }).eq('user_id', uid).in('category_id', ids);
    if (r3.error) throw r3.error;
    res.json({ deleted: ids.length });
  } catch (err) {
    console.error('[expense/categories DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
