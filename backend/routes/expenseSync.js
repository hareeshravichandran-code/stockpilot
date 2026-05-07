// routes/expenseSync.js
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
  } catch { res.status(401).json({ error: 'Token expired or invalid' }); }
}

// ── GET /api/expense/sync/status ─────────────────────────────────────────────
// Returns count + last sync time for all masters — used for sync badge in UI
router.get('/sync/status', auth, async (req, res) => {
  try {
    const uid = req.userId;
    const [txn, cat, budget, rules, fields, sheets] = await Promise.all([
      supabase.from('expense_transactions').select('*',{count:'exact',head:true}).eq('user_id',uid).eq('is_deleted',false),
      supabase.from('expense_categories').select('*',{count:'exact',head:true}).or(`user_id.eq.${uid},is_system.eq.true`).eq('is_deleted',false),
      supabase.from('expense_budgets').select('*',{count:'exact',head:true}).eq('user_id',uid).eq('is_deleted',false),
      supabase.from('user_sms_rules').select('*',{count:'exact',head:true}).eq('user_id',uid).eq('is_deleted',false),
      supabase.from('custom_fields').select('*',{count:'exact',head:true}).eq('user_id',uid).eq('is_deleted',false),
      supabase.from('google_sheets_config').select('*',{count:'exact',head:true}).eq('user_id',uid),
    ]);

    res.json({
      user_id:           uid,
      server_time:       Date.now(),
      counts: {
        transactions:    txn.count   || 0,
        categories:      cat.count   || 0,
        budgets:         budget.count|| 0,
        sms_rules:       rules.count || 0,
        custom_fields:   fields.count|| 0,
        sheet_config:    sheets.count|| 0,
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/expense/sync/pull?last_sync_at=0 ────────────────────────────────
// Android calls this on startup / Sync button press
// Returns ALL masters updated after last_sync_at
router.get('/sync/pull', auth, async (req, res) => {
  try {
    const uid        = req.userId;
    const lastSyncAt = parseInt(req.query.last_sync_at || '0');

    const [txnRes, catRes, budgetRes, rulesRes, fieldsRes, sheetsRes] = await Promise.all([
      supabase.from('expense_transactions').select('*')
        .eq('user_id', uid).gt('updated_at', lastSyncAt),
      supabase.from('expense_categories').select('*')
        .or(`user_id.eq.${uid},is_system.eq.true`)
        .gt('updated_at', lastSyncAt).eq('is_deleted', false),
      supabase.from('expense_budgets').select('*')
        .eq('user_id', uid).gt('updated_at', lastSyncAt).eq('is_deleted', false),
      supabase.from('user_sms_rules').select('*')
        .eq('user_id', uid).gt('updated_at', lastSyncAt).eq('is_deleted', false),
      supabase.from('custom_fields').select('*')
        .eq('user_id', uid).gt('updated_at', lastSyncAt).eq('is_deleted', false),
      supabase.from('google_sheets_config').select('*')
        .eq('user_id', uid),
    ]);

    res.json({
      transactions:  txnRes.data    || [],
      categories:    catRes.data    || [],
      budgets:       budgetRes.data || [],
      sms_rules:     rulesRes.error   ? [] : (rulesRes.data   || []),
      custom_fields: fieldsRes.error  ? [] : (fieldsRes.data  || []),
      sheet_config:  sheetsRes.data?.[0] || null,
      total_count:   (txnRes.data?.length||0) + (catRes.data?.length||0) +
                     (budgetRes.data?.length||0) + (rulesRes.data?.length||0) +
                     (fieldsRes.data?.length||0),
      server_time:   Date.now()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/expense/sync/push ───────────────────────────────────────────────
// Android calls this to push local masters up to Supabase
// Body: { categories, budgets, sms_rules, custom_fields, sheet_config }
router.post('/sync/push', auth, async (req, res) => {
  try {
    const uid = req.userId;
    const { categories=[], budgets=[], sms_rules=[], custom_fields=[], sheet_config=null } = req.body;
    const now = Date.now();
    const results = {};

    // Push user categories (non-system)
    if (categories.length) {
      const rows = categories.filter(c => !c.is_system).map(c => ({
        ...c, user_id: uid, updated_at: now, sync_status: 'SYNCED'
      }));
      if (rows.length) {
        const { error } = await supabase.from('expense_categories')
          .upsert(rows, { onConflict: 'id' });
        results.categories = error ? `error: ${error.message}` : `${rows.length} synced`;
      }
    }

    // Push budgets
    if (budgets.length) {
      const rows = budgets.map(b => ({ ...b, user_id: uid, updated_at: now, sync_status: 'SYNCED' }));
      const { error } = await supabase.from('expense_budgets')
        .upsert(rows, { onConflict: 'user_id,category_id,month' });
      results.budgets = error ? `error: ${error.message}` : `${rows.length} synced`;
    }

    // Push SMS rules
    if (sms_rules.length) {
      const rows = sms_rules.map(r => ({ ...r, user_id: uid, updated_at: now, sync_status: 'SYNCED' }));
      const { error } = await supabase.from('user_sms_rules')
        .upsert(rows, { onConflict: 'user_id,merchant_pattern' });
      results.sms_rules = error ? `error: ${error.message}` : `${rows.length} synced`;
    }

    // Push custom fields
    if (custom_fields.length) {
      const rows = custom_fields.map(f => ({ ...f, user_id: uid, updated_at: new Date().toISOString(), sync_status: 'SYNCED' }));
      const { error } = await supabase.from('custom_fields')
        .upsert(rows, { onConflict: 'id' });
      results.custom_fields = error ? `error: ${error.message}` : `${rows.length} synced`;
    }

    // Push sheet config
    if (sheet_config) {
      const { error } = await supabase.from('google_sheets_config')
        .upsert({ ...sheet_config, user_id: uid, updated_at: new Date().toISOString(), sync_status: 'SYNCED' }, { onConflict: 'user_id' });
      results.sheet_config = error ? `error: ${error.message}` : 'synced';
    }

    res.json({ success: true, results, server_time: Date.now() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
