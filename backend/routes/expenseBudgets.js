/**
 * routes/expenseBudgets.js
 *
 * Budget CRUD + status (budget vs actual spend).
 * Actual spend is now computed from expense_entries (not expense_transactions).
 */

const express    = require('express');
const router     = express.Router();
const supabase   = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

// ── GET /api/expense/budgets?month=202602 ─────────────────────────────────────
router.get('/budgets', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYYMM)' });

    const { data, error } = await supabase
      .from('expense_budgets')
      .select('*, expense_categories(id, name, type, icon, color)')
      .eq('user_id', req.user.id)
      .eq('month', parseInt(month))
      .eq('is_deleted', false);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[expense/budgets GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expense/budgets/status?month=202602 ──────────────────────────────
// Returns budget vs actual spending per category (reads from expense_entries)
router.get('/budgets/status', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYYMM)' });

    const year  = parseInt(month.toString().substring(0, 4));
    const mon   = parseInt(month.toString().substring(4, 6)) - 1;
    const start = new Date(year, mon, 1).getTime();
    const end   = new Date(year, mon + 1, 0, 23, 59, 59).getTime();

    // Fetch budgets + actual spend from expense_entries in parallel
    const [budgetRes, spendRes] = await Promise.all([
      supabase
        .from('expense_budgets')
        .select('*, expense_categories(id, name, type, icon, color)')
        .eq('user_id', req.user.id)
        .eq('month', parseInt(month))
        .eq('is_deleted', false),

      // Read actual DEBIT spend from expense_entries using date_time epoch range
      supabase
        .from('expense_entries')
        .select('category_id, amount')
        .eq('user_id', req.user.id)
        .eq('type', 'DEBIT')
        .eq('is_deleted', false)
        .gte('date_time', start)
        .lte('date_time', end),
    ]);

    if (budgetRes.error) throw budgetRes.error;
    if (spendRes.error)  throw spendRes.error;

    // Group spend by category_id
    const spendMap = {};
    (spendRes.data || []).forEach(t => {
      if (t.category_id) {
        spendMap[t.category_id] = (spendMap[t.category_id] || 0) + t.amount;
      }
    });

    const status = (budgetRes.data || []).map(b => {
      const spent = spendMap[b.category_id] || 0;
      const pct   = b.amount > 0 ? (spent / b.amount * 100) : 0;
      return {
        budget: b,
        spent,
        percentage:  parseFloat(pct.toFixed(1)),
        alert_level: pct >= 100 ? 'EXCEEDED' : pct >= 85 ? 'WARNING' : pct >= 60 ? 'CAUTION' : 'SAFE',
      };
    });

    res.json(status);
  } catch (err) {
    console.error('[expense/budgets/status GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/budgets ─────────────────────────────────────────────────
router.post('/budgets', requireAuth, async (req, res) => {
  try {
    const { category_id, amount, period = 'MONTHLY', month } = req.body;
    if (!category_id || !amount || !month) {
      return res.status(400).json({ error: 'category_id, amount and month required' });
    }

    const { data, error } = await supabase
      .from('expense_budgets')
      .upsert({
        user_id:     req.user.id,
        category_id,
        amount:      parseFloat(amount),
        period,
        month:       parseInt(month),
        is_deleted:  false,
        created_at:  Date.now(),
        updated_at:  Date.now(),
      }, { onConflict: 'user_id,category_id,month' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[expense/budgets POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/expense/budgets/:id ──────────────────────────────────────────────
router.put('/budgets/:id', requireAuth, async (req, res) => {
  try {
    const { amount, period } = req.body;
    const { data, error } = await supabase
      .from('expense_budgets')
      .update({ amount: parseFloat(amount), period, updated_at: Date.now() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[expense/budgets PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/expense/budgets/:id ───────────────────────────────────────────
router.delete('/budgets/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('expense_budgets')
      .update({ is_deleted: true, updated_at: Date.now() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('[expense/budgets DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
