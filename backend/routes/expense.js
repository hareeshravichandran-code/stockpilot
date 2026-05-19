/**
 * Expense Module — Kanalyst
 *
 * Single source of truth: expense_transactions (Android app table)
 * expense_entries is DEPRECATED — no longer used.
 * No email scan. Data comes from Android SMS sync only.
 *
 * Field mapping (expense_transactions → web):
 *   date_time (epoch ms)  →  expense_date (YYYY-MM-DD)
 *   merchant              →  merchant_name
 *   note / description    →  comments
 *   category_id           →  category (text)
 *   type (DEBIT/CREDIT)   →  source
 */

'use strict';

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── Category id ↔ display text ──────────────────────────────────────
const CAT_ID_TO_TEXT = {
  food_dining:   'Food & Dining',
  groceries:     'Groceries',
  shopping:      'Shopping',
  travel:        'Travel',
  utilities:     'Utilities',
  entertainment: 'Entertainment',
  health:        'Healthcare',
  education:     'Education',
  bills:         'Bills',
  investment:    'Investment',
  fuel:          'Fuel',
  salary:        'Salary',
  freelance:     'Freelance',
  refund:        'Refund',
  cashback:      'Cashback',
  inv_return:    'Returns',
  transfer_in:   'Transfer In',
  other:         'Others',
};

const CAT_TEXT_TO_ID = Object.fromEntries(
  Object.entries(CAT_ID_TO_TEXT).map(([id, txt]) => [txt, id])
);

// ── expense_transactions row → web entry ────────────────────────────
function toWebEntry(t) {
  const dtMs       = typeof t.date_time === 'number' ? t.date_time : parseInt(t.date_time) || 0;
  const dateStr    = dtMs ? new Date(dtMs).toISOString().split('T')[0] : null;
  return {
    id:            t.id,
    user_id:       t.user_id,
    amount:        parseFloat(t.amount) || 0,
    expense_date:  dateStr,
    date_time:     dtMs,
    merchant_name: t.merchant || null,
    category:      CAT_ID_TO_TEXT[t.category_id] || t.category_id || 'Others',
    category_id:   t.category_id || 'other',
    comments:      t.note || t.description || null,
    type:          t.type || 'DEBIT',
    bank_sender:   t.bank_name || null,
    source:        t.source || 'sms',
    is_deleted:    t.is_deleted || false,
  };
}

// ── web body → expense_transactions row ─────────────────────────────
function fromWebEntry(body, userId) {
  const dateStr = body.expense_date || new Date().toISOString().split('T')[0];
  const dtMs    = new Date(dateStr + 'T00:00:00').getTime();
  const now     = Date.now();
  return {
    user_id:     userId,
    amount:      parseFloat(body.amount),
    type:        body.type || 'DEBIT',
    category_id: CAT_TEXT_TO_ID[body.category] || body.category_id || 'other',
    merchant:    body.merchant_name || null,
    description: body.comments || null,
    note:        body.comments || null,
    date_time:   body.date_time || dtMs,
    source:      body.source || 'MANUAL',
    bank_name:   body.bank_sender || null,
    is_deleted:  false,
    created_at:  now,
    updated_at:  now,
  };
}

// ══ ROUTES ══════════════════════════════════════════════════════════

// GET /api/expense/entries
// Returns all non-deleted transactions, DEBITs = expenses, CREDITs available via ?type=CREDIT
router.get('/entries', requireAuth, async (req, res) => {
  const { type, from, to, category, limit = 500 } = req.query;
  let q = supabase
    .from('expense_transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('is_deleted', false)
    .order('date_time', { ascending: false })
    .limit(parseInt(limit));

  if (type)     q = q.eq('type', type.toUpperCase());
  if (category) q = q.eq('category_id', category);
  if (from) {
    const fromMs = new Date(from + 'T00:00:00').getTime();
    q = q.gte('date_time', fromMs);
  }
  if (to) {
    const toMs = new Date(to + 'T23:59:59').getTime();
    q = q.lte('date_time', toMs);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Deduplicate in memory — same amount+date_time+type within 60s window
  // This handles any duplicates that slipped through before the DB constraint was added
  const seen = new Map();
  const deduped = (data || []).filter(row => {
    // Key: reference_no if present, otherwise amount+type+rounded_time(60s)+merchant
    const key = row.reference_no
      ? `ref:${row.reference_no}`
      : `nref:${row.amount}:${row.type}:${Math.floor((row.date_time||0)/60000)}:${(row.merchant||'').toLowerCase().slice(0,20)}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });

  res.json(deduped.map(toWebEntry));
});

// POST /api/expense/entries  — manual add
router.post('/entries', requireAuth, async (req, res) => {
  const row = fromWebEntry(req.body, req.user.id);
  if (!row.amount || isNaN(row.amount)) return res.status(400).json({ error: 'amount required' });
  const { data, error } = await supabase.from('expense_transactions').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toWebEntry(data));
});

// PUT /api/expense/entries/:id  — edit
router.put('/entries/:id', requireAuth, async (req, res) => {
  const updates = {
    category_id:  CAT_TEXT_TO_ID[req.body.category] || req.body.category_id || undefined,
    merchant:     req.body.merchant_name || undefined,
    note:         req.body.comments || undefined,
    description:  req.body.comments || undefined,
    amount:       req.body.amount ? parseFloat(req.body.amount) : undefined,
    updated_at:   Date.now(),
  };
  // Remove undefined keys
  Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);
  const { data, error } = await supabase
    .from('expense_transactions')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toWebEntry(data));
});

// DELETE /api/expense/entries/:id  — soft delete
router.delete('/entries/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('expense_transactions')
    .update({ is_deleted: true, updated_at: Date.now() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/expense/categories  — list categories for dropdowns
router.get('/categories', requireAuth, async (_req, res) => {
  const cats = Object.entries(CAT_ID_TO_TEXT).map(([id, name]) => ({ id, name }));
  res.json(cats);
});

// GET /api/expense/summary  — totals by category for the current month
router.get('/summary', requireAuth, async (req, res) => {
  const { year, month } = req.query;
  const now   = new Date();
  const y     = parseInt(year  || now.getFullYear());
  const m     = parseInt(month || now.getMonth() + 1);
  const from  = new Date(y, m - 1, 1).getTime();
  const to    = new Date(y, m, 0, 23, 59, 59).getTime();

  const { data, error } = await supabase
    .from('expense_transactions')
    .select('amount, category_id, type')
    .eq('user_id', req.user.id)
    .eq('is_deleted', false)
    .gte('date_time', from)
    .lte('date_time', to);

  if (error) return res.status(500).json({ error: error.message });

  const debits  = (data || []).filter(r => r.type === 'DEBIT');
  const credits = (data || []).filter(r => r.type === 'CREDIT');
  const totalSpend  = debits.reduce((s, r)  => s + parseFloat(r.amount || 0), 0);
  const totalIncome = credits.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  const byCategory = {};
  debits.forEach(r => {
    const cat = CAT_ID_TO_TEXT[r.category_id] || r.category_id || 'Others';
    byCategory[cat] = (byCategory[cat] || 0) + parseFloat(r.amount || 0);
  });

  res.json({ totalSpend, totalIncome, byCategory, year: y, month: m });
});

module.exports = router;
