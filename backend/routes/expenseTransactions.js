/**
 * routes/expenseTransactions.js
 *
 * Android app transaction CRUD — backed by expense_entries table
 * (single source of truth for web + Android)
 *
 * Field translation:
 *   Android field       → expense_entries column
 *   ────────────────────────────────────────────
 *   date_time (epoch)   → date_time + expense_date
 *   type (DEBIT/CREDIT) → type
 *   category_id         → category_id
 *   merchant            → merchant_name
 *   description         → email_subject
 *   note                → comments + note
 *   bank_name           → bank_sender
 *   account_last4       → account_last4
 *   reference_no        → reference_no
 *   is_deleted          → is_deleted
 *   created_at (epoch)  → created_at_epoch
 *   updated_at (epoch)  → updated_at_epoch
 */

const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

// ── Field translators ──────────────────────────────────────────────────────────

// expense_entries row → Android-style transaction response
function toAndroidTx(row) {
  return {
    id:            row.id,
    user_id:       row.user_id,
    amount:        row.amount,
    type:          row.type || 'DEBIT',
    category_id:   row.category_id || null,
    merchant:      row.merchant_name || null,
    description:   row.email_subject || null,
    note:          row.note || row.comments || null,
    date_time:     row.date_time || (row.expense_date
                     ? new Date(row.expense_date + 'T00:00:00').getTime()
                     : Date.now()),
    source:        row.source || 'MANUAL',
    bank_name:     row.bank_sender || null,
    account_last4: row.account_last4 || null,
    reference_no:  row.reference_no || null,
    is_deleted:    row.is_deleted || false,
    created_at:    row.created_at_epoch || Date.now(),
    updated_at:    row.updated_at_epoch || Date.now(),
    // Web-side bonus fields (Android can ignore)
    category:      row.category || null,
    sub_category:  row.sub_category || null,
    category_source: row.category_source || null,
    expense_date:  row.expense_date || null,
  };
}

// Android insert/update body → expense_entries columns
function fromAndroidTx(t, userId) {
  const dtMs        = parseInt(t.date_time) || Date.now();
  const expenseDate = new Date(dtMs).toISOString().split('T')[0];
  const now         = Date.now();
  return {
    user_id:          userId,
    amount:           parseFloat(t.amount),
    type:             t.type || 'DEBIT',
    category_id:      t.category_id || null,
    merchant_name:    t.merchant || null,
    email_subject:    t.description || null,
    comments:         t.note || t.description || null,
    note:             t.note || null,
    expense_date:     expenseDate,
    date_time:        dtMs,
    source:           t.source || 'MANUAL',
    bank_sender:      t.bank_name || null,
    account_last4:    t.account_last4 || null,
    reference_no:     t.reference_no || null,
    is_deleted:       false,
    created_at_epoch: now,
    updated_at_epoch: now,
  };
}

// ── GET /api/expense/transactions ─────────────────────────────────────────────
// Query params: page, limit, from, to, type (DEBIT|CREDIT), category_id
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, from, to, type, category_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from('expense_entries')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('is_deleted', false)
      .order('date_time', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (from)        query = query.gte('date_time', parseInt(from));
    if (to)          query = query.lte('date_time', parseInt(to));
    if (type)        query = query.eq('type', type);
    if (category_id) query = query.eq('category_id', category_id);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      data:  (data || []).map(toAndroidTx),
      page:  parseInt(page),
      limit: parseInt(limit),
      total: count,
    });
  } catch (err) {
    console.error('[expense/transactions GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expense/transactions/summary ─────────────────────────────────────
// Returns total income, expenses, balance for a given month (YYYYMM)
router.get('/transactions/summary', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYYMM)' });

    const year  = parseInt(month.toString().substring(0, 4));
    const mon   = parseInt(month.toString().substring(4, 6)) - 1;
    const start = new Date(year, mon, 1).getTime();
    const end   = new Date(year, mon + 1, 0, 23, 59, 59).getTime();

    const { data, error } = await supabase
      .from('expense_entries')
      .select('amount, type')
      .eq('user_id', req.user.id)
      .eq('is_deleted', false)
      .gte('date_time', start)
      .lte('date_time', end);

    if (error) throw error;

    const totalIncome   = (data || []).filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = (data || []).filter(t => t.type === 'DEBIT').reduce((s, t) => s + t.amount, 0);

    res.json({
      total_income:   totalIncome,
      total_expenses: totalExpenses,
      balance:        totalIncome - totalExpenses,
      month:          parseInt(month),
    });
  } catch (err) {
    console.error('[expense/transactions/summary GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/transactions ────────────────────────────────────────────
router.post('/transactions', requireAuth, async (req, res) => {
  try {
    const { amount, type, date_time } = req.body;
    if (!amount || !type || !date_time) {
      return res.status(400).json({ error: 'amount, type and date_time are required' });
    }

    const row = fromAndroidTx(req.body, req.user.id);

    const { data, error } = await supabase
      .from('expense_entries')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(toAndroidTx(data));
  } catch (err) {
    console.error('[expense/transactions POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/transactions/bulk ───────────────────────────────────────
// Android SMS bulk import
router.post('/transactions/bulk', requireAuth, async (req, res) => {
  try {
    const transactions = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Body must be a non-empty array' });
    }

    const rows = transactions.map(t => fromAndroidTx(t, req.user.id));

    const { data, error } = await supabase
      .from('expense_entries')
      .insert(rows)
      .select();

    if (error) throw error;
    res.status(201).json({ created: data.length, failed: 0 });
  } catch (err) {
    console.error('[expense/transactions/bulk POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/expense/transactions/:id ─────────────────────────────────────────
router.put('/transactions/:id', requireAuth, async (req, res) => {
  try {
    const { amount, type, category_id, merchant, note, description } = req.body;
    const now = Date.now();

    const updates = {};
    if (amount !== undefined)      updates.amount         = parseFloat(amount);
    if (type !== undefined)        updates.type           = type;
    if (category_id !== undefined) updates.category_id    = category_id;
    if (merchant !== undefined)    updates.merchant_name  = merchant;
    if (note !== undefined)        { updates.note = note; updates.comments = note; }
    if (description !== undefined) updates.email_subject  = description;
    updates.updated_at_epoch = now;

    const { data, error } = await supabase
      .from('expense_entries')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found' });
    res.json(toAndroidTx(data));
  } catch (err) {
    console.error('[expense/transactions PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/expense/transactions/:id ──────────────────────────────────────
// Soft delete — matches Android behaviour (is_deleted flag)
router.delete('/transactions/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('expense_entries')
      .update({ is_deleted: true, updated_at_epoch: Date.now() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('[expense/transactions DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
