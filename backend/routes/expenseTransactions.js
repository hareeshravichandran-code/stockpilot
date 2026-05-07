// routes/expenseTransactions.js
// Plugs into existing StockPilot Express backend
// Mount in server.js: app.use('/api/expense', require('./routes/expenseTransactions'))

const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');

// ── Auth middleware (reuses existing JWT logic) ────────────────────────────────
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id || decoded.userId || decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

// ── GET /api/expense/transactions ─────────────────────────────────────────────
// Query params: page, limit, from, to, type (DEBIT|CREDIT), category_id
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      from, to, type, category_id
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from('expense_transactions')
      .select('*, expense_categories(id, name, type, icon, color)', { count: 'exact' })
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('date_time', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (from) query = query.gte('date_time', parseInt(from));
    if (to)   query = query.lte('date_time', parseInt(to));
    if (type) query = query.eq('type', type);
    if (category_id) query = query.eq('category_id', category_id);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, page: parseInt(page), limit: parseInt(limit), total: count });
  } catch (err) {
    console.error('[expense/transactions GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expense/transactions/summary ─────────────────────────────────────
// Returns total income, expenses, balance for a given month (YYYYMM)
router.get('/transactions/summary', authMiddleware, async (req, res) => {
  try {
    const { month } = req.query; // e.g. 202602

    // Convert YYYYMM to epoch range
    const year  = parseInt(month.toString().substring(0, 4));
    const mon   = parseInt(month.toString().substring(4, 6)) - 1;
    const start = new Date(year, mon, 1).getTime();
    const end   = new Date(year, mon + 1, 0, 23, 59, 59).getTime();

    const { data, error } = await supabase
      .from('expense_transactions')
      .select('amount, type')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .gte('date_time', start)
      .lte('date_time', end);

    if (error) throw error;

    const totalIncome   = data.filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = data.filter(t => t.type === 'DEBIT').reduce((s, t) => s + t.amount, 0);

    res.json({
      total_income:   totalIncome,
      total_expenses: totalExpenses,
      balance:        totalIncome - totalExpenses,
      month:          parseInt(month)
    });
  } catch (err) {
    console.error('[expense/transactions/summary GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/transactions ────────────────────────────────────────────
router.post('/transactions', authMiddleware, async (req, res) => {
  try {
    const { amount, type, category_id, merchant, description, note,
            date_time, source, bank_name, account_last4, reference_no } = req.body;

    if (!amount || !type || !date_time) {
      return res.status(400).json({ error: 'amount, type and date_time are required' });
    }

    const { data, error } = await supabase
      .from('expense_transactions')
      .insert({
        user_id:      req.userId,
        amount:       parseFloat(amount),
        type,
        category_id,
        merchant,
        description,
        note,
        date_time:    parseInt(date_time),
        source:       source || 'MANUAL',
        bank_name,
        account_last4,
        reference_no,
        sms_sender:   req.body.sms_sender   || null,
        payment_type: req.body.payment_type || null,
        is_deleted:   false,
        created_at:   Date.now(),
        updated_at:   Date.now()
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[expense/transactions POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/transactions/bulk ───────────────────────────────────────
// For bulk SMS import
router.post('/transactions/bulk', authMiddleware, async (req, res) => {
  try {
    const transactions = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Body must be a non-empty array' });
    }

    const rows = transactions.map(t => ({
      user_id:      req.userId,
      amount:       parseFloat(t.amount),
      type:         t.type,
      category_id:  t.category_id || null,
      merchant:     t.merchant || null,
      description:  t.description || null,
      note:         t.note || null,
      date_time:    parseInt(t.date_time),
      source:       t.source || 'SMS',
      bank_name:    t.bank_name || null,
      account_last4:t.account_last4 || null,
      reference_no: t.reference_no || null,
      sms_sender:   t.sms_sender   || null,
      payment_type: t.payment_type || null,
      is_deleted:   false,
      created_at:   Date.now(),
      updated_at:   Date.now()
    }));

    const { data, error } = await supabase
      .from('expense_transactions')
      .upsert(rows, {
        onConflict: 'user_id,reference_no',  // skip duplicates gracefully
        ignoreDuplicates: true
      })
      .select();

    if (error) throw error;
    res.status(201).json({ created: data.length, failed: 0 });
  } catch (err) {
    console.error('[expense/transactions/bulk POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/expense/transactions/:id ─────────────────────────────────────────
router.put('/transactions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, category_id, merchant, note, description } = req.body;

    const { data, error } = await supabase
      .from('expense_transactions')
      .update({ amount, type, category_id, merchant, note, description, updated_at: Date.now() })
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found' });
    res.json(data);
  } catch (err) {
    console.error('[expense/transactions PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/expense/transactions/:id ──────────────────────────────────────
router.delete('/transactions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('expense_transactions')
      .update({ is_deleted: true, updated_at: Date.now() })
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('[expense/transactions DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
