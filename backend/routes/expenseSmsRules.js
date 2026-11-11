// routes/expenseSmsRules.js
// Mount in server.js: app.use('/api/expense', require('./routes/expenseSmsRules'))

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

// GET /api/expense/sms-rules — fetch all user rules
router.get('/sms-rules', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_sms_rules')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('match_count', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[sms-rules GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expense/sms-rules — upsert a rule
router.post('/sms-rules', authMiddleware, async (req, res) => {
  try {
    const { id, merchant_pattern, category_id, match_count, user_confirmed } = req.body;
    const { data, error } = await supabase
      .from('user_sms_rules')
      .upsert({
        id:               id,
        user_id:          req.userId,
        merchant_pattern: merchant_pattern,
        category_id:      category_id,
        match_count:      match_count || 1,
        user_confirmed:   user_confirmed || false,
        ...(Array.isArray(req.body.pattern_tok) ? { pattern_tok: req.body.pattern_tok.slice(0, 20) } : {}),
        updated_at:       Date.now()
      }, { onConflict: 'user_id,merchant_pattern' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[sms-rules POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/expense/sms-rules/:id — edit a rule (pattern and/or category)
router.put('/sms-rules/:id', authMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const patch = { updated_at: Date.now(), user_confirmed: true };
    if (typeof b.merchant_pattern === 'string' && b.merchant_pattern.trim()) patch.merchant_pattern = b.merchant_pattern.trim().slice(0, 8000);
    if (typeof b.category_id === 'string' && b.category_id) patch.category_id = b.category_id.slice(0, 80);
    if (Array.isArray(b.pattern_tok)) patch.pattern_tok = b.pattern_tok.filter(x => typeof x === 'string').slice(0, 20);
    const { data, error } = await supabase.from('user_sms_rules').update(patch).eq('id', req.params.id).eq('user_id', req.userId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Rule not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/expense/sms-rules/:id — soft delete, so the phone removes it on its next sync
router.delete('/sms-rules/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase.from('user_sms_rules').update({ is_deleted: true, updated_at: Date.now() }).eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/expense/transactions/refs — return all reference_nos for deduplication
router.get('/transactions/refs', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('expense_transactions')
      .select('reference_no')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .not('reference_no', 'is', null);
    if (error) throw error;
    const refs = (data || []).map(r => r.reference_no).filter(Boolean);
    res.json(refs);
  } catch (err) {
    console.error('[transactions/refs GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
