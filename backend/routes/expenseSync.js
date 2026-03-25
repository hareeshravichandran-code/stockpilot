/**
 * routes/expenseSync.js
 *
 * Android delta sync — pulls from expense_entries (unified table).
 * Android calls GET /api/expense/sync/pull?last_sync_at=<epoch_ms>
 * on startup to get any changes made on web or other devices.
 */

const express    = require('express');
const router     = express.Router();
const supabase   = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

// ── GET /api/expense/sync/pull?last_sync_at=<epoch_ms> ────────────────────────
// Returns all records updated after last_sync_at
// Responses use the Android field names (via field translation)
router.get('/sync/pull', requireAuth, async (req, res) => {
  try {
    const lastSyncAt = parseInt(req.query.last_sync_at || '0');

    const [txnRes, catRes, budgetRes] = await Promise.all([
      // Transactions: pull from expense_entries filtered by updated_at_epoch
      supabase
        .from('expense_entries')
        .select('*')
        .eq('user_id', req.user.id)
        .gt('updated_at_epoch', lastSyncAt),

      // Categories: pull user + system categories
      supabase
        .from('expense_categories')
        .select('*')
        .or(`user_id.eq.${req.user.id},is_system.eq.true`)
        .gt('updated_at', lastSyncAt)
        .eq('is_deleted', false),

      // Budgets
      supabase
        .from('expense_budgets')
        .select('*')
        .eq('user_id', req.user.id)
        .gt('updated_at', lastSyncAt),
    ]);

    if (txnRes.error)    throw txnRes.error;
    if (catRes.error)    throw catRes.error;
    if (budgetRes.error) throw budgetRes.error;

    // Translate expense_entries rows to Android transaction format
    const transactions = (txnRes.data || []).map(row => ({
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
    }));

    res.json({
      transactions,
      categories:  catRes.data    || [],
      budgets:     budgetRes.data || [],
      total_count: transactions.length + (catRes.data?.length || 0) + (budgetRes.data?.length || 0),
      server_time: Date.now(),
    });
  } catch (err) {
    console.error('[expense/sync/pull GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expense/sync/status ──────────────────────────────────────────────
router.get('/sync/status', requireAuth, async (req, res) => {
  try {
    const { count } = await supabase
      .from('expense_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_deleted', false);

    res.json({
      user_id:           req.user.id,
      transaction_count: count || 0,
      server_time:       Date.now(),
    });
  } catch (err) {
    console.error('[expense/sync/status GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
