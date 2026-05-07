// routes/expenseManage.js — Bulk categorize, custom fields, sheet config
const express = require('express');
const router  = express.Router();
const jwt = require('jsonwebtoken');

const supabase = require('../services/supabase');

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const d = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    req.userId = d.id || d.userId || d.sub;
    next();
  } catch { res.status(401).json({ error: 'Token expired' }); }
}

// ── Bulk categorize ───────────────────────────────────────────────────────────
router.post('/transactions/bulk-categorize', auth, async (req, res) => {
  try {
    const { txnIds, categoryId } = req.body;
    if (!txnIds?.length || !categoryId) return res.status(400).json({ error: 'txnIds and categoryId required' });
    const { error } = await supabase
      .from('expense_transactions')
      .update({ category_id: categoryId, updated_at: new Date().toISOString() })
      .in('id', txnIds)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ updated: txnIds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Custom fields ─────────────────────────────────────────────────────────────
router.get('/custom-fields', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('display_order');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/custom-fields', auth, async (req, res) => {
  try {
    const { id, name, field_type, options, auto_fill_rules, is_required, display_order } = req.body;
    const { data, error } = await supabase
      .from('custom_fields')
      .upsert({ id: id || undefined, user_id: req.userId, name, field_type: field_type || 'TEXT',
        options: options || [], auto_fill_rules: auto_fill_rules || {}, is_required: is_required || false,
        display_order: display_order || 0, is_deleted: false, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/custom-fields/:id', auth, async (req, res) => {
  try {
    const { name, field_type, options, auto_fill_rules, is_required } = req.body;
    const { data, error } = await supabase
      .from('custom_fields')
      .update({ name, field_type, options, auto_fill_rules, is_required, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/custom-fields/:id', auth, async (req, res) => {
  try {
    const { error } = await supabase.from('custom_fields')
      .update({ is_deleted: true }).eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sheet config (web-side mirror of Android) ─────────────────────────────────
router.get('/sheet-config', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('google_sheets_config')
      .select('*')
      .eq('user_id', req.userId)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sheet-config', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('google_sheets_config')
      .upsert({ ...req.body, user_id: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
