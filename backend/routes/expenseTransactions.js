// routes/expenseTransactions.js
// Plugs into existing StockPilot Express backend
// Mount in server.js: app.use('/api/expense', require('./routes/expenseTransactions'))

const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { WINDOW_MS, nearestTwin, extraCopies } = require('../services/txnDedup');

/** The saved copy of this payment, if the cloud already has it: by id, then reference, then amount and time. */
async function savedTwin(uid, row, id) {
  if (id && /^[0-9a-f-]{36}$/i.test(String(id))) {
    const { data } = await supabase.from('expense_transactions').select('*').eq('id', id).eq('user_id', uid).eq('is_deleted', false).limit(1);
    if (data && data[0]) return data[0];
  }
  const { data } = await supabase.from('expense_transactions').select('*')
    .eq('user_id', uid).eq('amount', row.amount).eq('type', row.type).eq('is_deleted', false)
    .gte('date_time', row.date_time - WINDOW_MS).lte('date_time', row.date_time + WINDOW_MS).limit(20);
  return nearestTwin(row, data);
}

/** The phone sends a payment again after a change there (category, note): keep those changes on the saved copy. */
async function keepChanges(uid, had, category_id, note) {
  const patch = {};
  if (category_id && category_id !== had.category_id) patch.category_id = category_id;
  if (note != null && note !== '' && note !== had.note) patch.note = note;
  if (!Object.keys(patch).length) return had;
  patch.updated_at = Date.now();
  let r = await supabase.from('expense_transactions').update(patch).eq('id', had.id).eq('user_id', uid).select().single();
  if (r.error && /category_id_fkey/.test(r.error.message || '') && patch.note) {
    delete patch.category_id;
    r = await supabase.from('expense_transactions').update(patch).eq('id', had.id).eq('user_id', uid).select().single();
  }
  return (!r.error && r.data) ? r.data : had;
}

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

    let data, error = null;
    try {
      data = await require('../services/allRows').allRows(() => supabase.from('expense_transactions').select('id, amount, type')
        .eq('user_id', req.userId).eq('is_deleted', false).gte('date_time', start).lte('date_time', end).order('id'));
    } catch (e) { error = e; }

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

    const row = {
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
        ...require('../services/privacy').txnExtras(req.body),
        is_deleted:   false,
        created_at:   Date.now(),
        updated_at:   Date.now()
      };
    // Already in the cloud (same id, or the same payment a minute apart): update it, never add a second copy
    const twin = await savedTwin(req.userId, row, req.body.id);
    if (twin) return res.status(200).json({ ...(await keepChanges(req.userId, twin, category_id, note)), duplicate: true });
    const put = (r) => supabase.from('expense_transactions').insert(r).select().single();
    let { data, error } = await put(row);
    // A category the server does not know yet: keep the payment, leave it unsorted
    if (error && /category_id_fkey/.test(error.message || '')) { console.warn('[expense/transactions POST] unknown category, saved unsorted:', row.category_id); ({ data, error } = await put({ ...row, category_id: null })); }
    // Already uploaded (phone retry): answer with the saved row, not an error
    if (error && /duplicate key/.test(error.message || '')) {
      let q = supabase.from('expense_transactions').select('*').eq('user_id', req.userId);
      q = reference_no ? q.eq('reference_no', reference_no) : q.eq('date_time', row.date_time).eq('amount', row.amount);
      const { data: had } = await q.limit(1);
      if (had && had[0]) {
        // The phone sends a payment again after you change it there (category, note): keep those changes
        const patch = {};
        if (category_id && category_id !== had[0].category_id) patch.category_id = category_id;
        if (note != null && note !== had[0].note) patch.note = note;
        if (Object.keys(patch).length) {
          patch.updated_at = Date.now();
          let r = await supabase.from('expense_transactions').update(patch).eq('id', had[0].id).eq('user_id', req.userId).select().single();
          if (r.error && /category_id_fkey/.test(r.error.message || '')) { delete patch.category_id; r = Object.keys(patch).length > 1 ? await supabase.from('expense_transactions').update(patch).eq('id', had[0].id).eq('user_id', req.userId).select().single() : { data: had[0] }; }
          if (!r.error && r.data) return res.status(200).json({ ...r.data, duplicate: true, updated: true });
        }
        return res.status(200).json({ ...had[0], duplicate: true });
      }
    }
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
      // Full SMS text is kept only end-to-end encrypted (never in readable form)
      sms_body:     require('../services/privacy').isEnc(t.sms_body) ? t.sms_body : null,
      ...require('../services/privacy').txnExtras(t),
      is_deleted:   false,
      created_at:   Date.now(),
      updated_at:   Date.now()
    }));

    // Split rows: those with a reference_no vs those without
    const withRef    = rows.filter(r => r.reference_no);
    const withoutRef = rows.filter(r => !r.reference_no);

    let created = 0;

    // Rows WITH reference_no — upsert on user_id+reference_no (safe, always unique)
    if (withRef.length > 0) {
      const { data: d1, error: e1 } = await supabase
        .from('expense_transactions')
        .upsert(withRef, { onConflict: 'user_id,reference_no', ignoreDuplicates: true })
        .select('id');
      if (e1) console.warn('[bulk] withRef upsert warn:', e1.message);
      else created += (d1||[]).length;
    }

    // Rows WITHOUT reference_no — manually check for duplicates before insert
    // Match on: user_id + amount + date_time + type + merchant (within 60s window)
    for (const row of withoutRef) {
      try {
        if (await savedTwin(row.user_id, row)) continue;   // the same payment is already saved
        const { error: e2 } = await supabase.from('expense_transactions').insert(row);
        if (!e2) created++;
        else if (!e2.message.includes('duplicate')) console.warn('[bulk] insert warn:', e2.message);
      } catch(rowErr) {
        console.warn('[bulk] row error:', rowErr.message);
      }
    }

    res.status(201).json({ created, failed: 0 });
  } catch (err) {
    console.error('[expense/transactions/bulk POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expense/transactions/tidy ───────────────────────────────────────
// Hides extra copies of the same SMS payment (is_deleted, so nothing is lost). The phone calls it after a restore.
router.post('/transactions/tidy', authMiddleware, async (req, res) => {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('expense_transactions')
        .select('id,amount,type,date_time,reference_no,account_last4,category_id,note,source,created_at,is_deleted')
        .eq('user_id', req.userId).eq('is_deleted', false).order('id').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const extra = extraCopies(rows);
    for (let i = 0; i < extra.length; i += 200) {
      const ids = extra.slice(i, i + 200).map(e => e.id);
      const { error } = await supabase.from('expense_transactions').update({ is_deleted: true, updated_at: Date.now() })
        .in('id', ids).eq('user_id', req.userId);
      if (error) throw error;
    }
    res.json({ checked: rows.length, hidden: extra.length, pairs: extra });
  } catch (err) {
    console.error('[expense/transactions/tidy]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/expense/transactions/:id ─────────────────────────────────────────
// One transaction (the phone opens a payment it does not have yet, e.g. from the month view)
router.get('/transactions/:id([0-9a-fA-F-]{36})', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('expense_transactions').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/transactions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, category_id, merchant, note, description } = req.body;

    const { data, error } = await supabase
      .from('expense_transactions')
      .update({ amount, type, category_id, merchant, note, description, ...require('../services/privacy').txnExtras(req.body), updated_at: Date.now() })
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
