/**
 * Kanalyst — money masters and the events master (Discover).
 *
 *   GET    /api/masters             your masters, events, and the policy / RD rows Discover can link to
 *   POST   /api/masters/apply       { finds: [...] } create-or-link masters, events and paid periods
 *   POST   /api/masters/events/:id/paid   { period, amount, txn_ref }
 *   DELETE /api/masters/:id         remove a money master (and its events)
 *
 * One find can produce three things: a master, money entries (handled on the phone,
 * which owns the transaction ledger) and a recurring event for the family calendar.
 * Nothing is ever created twice: every master is looked up by its natural key first
 * (kind + institution + last 4 / folio), every event by (master, kind), every paid
 * period by (event, period). Insurance goes to insurance_policies and RDs link to
 * recurring_deposits when the user already has them there.
 */
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');

const KINDS = ['loan', 'card', 'bank_account', 'sip', 'subscription', 'income', 'rd', 'insurance'];
const FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'once', 'irregular'];
const EVENT_FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'once'];
const EVENT_KINDS = ['emi', 'sip', 'card_due', 'premium', 'subscription', 'rd_instalment', 'salary', 'bill', 'maturity'];
const POLICY_KINDS = ['term', 'life', 'health', 'vehicle', 'home', 'accident', 'travel', 'other'];
const STEP = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const str = (v, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const int = (v, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);

/** "HDFC Bank Ltd." -> "hdfc", "ICICI Prudential MF" -> "iciciprudential" */
function instKey(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(bank|ltd|limited|pvt|private|india|co|company|the|mutual fund|mf|amc|insurance|life|general|card|cards)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '').slice(0, 40);
}
/** Last 4 digits of any account, card, folio or policy reference ("XXXX4521" -> "4521", "XX56" -> "56"). */
function refKey(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d ? d.slice(-4) : String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-4);
}
/** Masked refs can be shorter: "56" matches "6756". */
const refMatch = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 2 && (a.endsWith(b) || b.endsWith(a))));

/** Next date on or after today for a monthly/yearly pattern. */
function nextDue(freq, day, month, start) {
  const t = new Date(todayStr() + 'T00:00:00Z');
  const d = Math.min(28, day || (start ? parseInt(start.slice(8, 10), 10) : 1) || 1);
  if (freq === 'monthly' || !STEP[freq]) {
    let x = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), d));
    if (x < t) x = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, d));
    return x.toISOString().slice(0, 10);
  }
  const m0 = (month || (start ? parseInt(start.slice(5, 7), 10) : t.getUTCMonth() + 1)) - 1;
  let x = new Date(Date.UTC(t.getUTCFullYear() - 1, m0, d));
  while (x < t) x = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + STEP[freq], d));
  return x.toISOString().slice(0, 10);
}

// ── Read ────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [m, e, p, r] = await Promise.all([
      supabase.from('money_masters').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('recurring_events').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('insurance_policies').select('id, kind, insurer, plan_name, policy_ref, premium, premium_frequency, renewal_date, status').eq('owner_id', uid),
      supabase.from('recurring_deposits').select('rd_id, institution_name, nickname, account_reference, monthly_installment, start_date').eq('user_id', uid),
    ]);
    if (m.error) throw m.error;
    res.json({ masters: m.data || [], events: e.data || [], policies: p.data || [], rds: r.data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create or link ──────────────────────────────────────────────────
async function upsertMaster(uid, f) {
  const amount = num(f.amount);
  const freq = FREQS.includes(f.frequency) ? f.frequency : 'monthly';
  const dueDay = int(f.due_day, 1, 31), dueMonth = int(f.due_month, 1, 12);
  const start = isDate(f.start_date) ? f.start_date : null;
  const iKey = instKey(f.institution), rKey = refKey(f.ref);

  if (f.kind === 'insurance') {
    const { data: pols } = await supabase.from('insurance_policies').select('*').eq('owner_id', uid);
    const hit = (pols || []).find(p => (rKey && refMatch(refKey(p.policy_ref), rKey)) ||
      (!rKey && instKey(p.insurer) === iKey && amount && num(p.premium) && Math.abs(num(p.premium) - amount) <= amount * 0.02));
    if (hit) return { status: 'linked', table: 'insurance_policies', id: hit.id };
    const pfreq = { monthly: 'monthly', quarterly: 'quarterly', half_yearly: 'half_yearly', yearly: 'yearly' }[freq] || 'yearly';
    const { data, error } = await supabase.from('insurance_policies').insert({
      owner_id: uid, kind: POLICY_KINDS.includes(f.meta?.policy_kind) ? f.meta.policy_kind : 'life',
      insurer: str(f.institution), plan_name: str(f.meta?.plan_name), policy_ref: rKey || null,
      premium: amount, premium_frequency: pfreq, renewal_date: nextDue(pfreq, dueDay, dueMonth, start),
      start_date: start, status: 'active', notes: 'Found by Kanalyst from your messages',
    }).select().single();
    if (error) throw error;
    return { status: 'created', table: 'insurance_policies', id: data.id };
  }

  if (f.kind === 'rd') {
    const { data: rds } = await supabase.from('recurring_deposits').select('rd_id, institution_name, account_reference, monthly_installment').eq('user_id', uid);
    const hit = (rds || []).find(r => (rKey && refMatch(refKey(r.account_reference), rKey)) ||
      (instKey(r.institution_name) === iKey && amount && Math.abs(num(r.monthly_installment) - amount) <= amount * 0.01));
    if (hit) return { status: 'linked', table: 'recurring_deposits', id: hit.rd_id || hit.id };
  }

  const { data: same } = await supabase.from('money_masters').select('*')
    .eq('owner_id', uid).eq('kind', f.kind).eq('inst_key', iKey);
  const ex = (same || []).find(x => x.ref_key === rKey) || (rKey ? (same || []).find(x => refMatch(x.ref_key, rKey)) : null);
  if (ex) {
    // Fill gaps only; never overwrite what the user set.
    const patch = {};
    if (ex.amount == null && amount != null) patch.amount = amount;
    if (ex.due_day == null && dueDay) patch.due_day = dueDay;
    if (ex.due_month == null && dueMonth) patch.due_month = dueMonth;
    if (!ex.start_date && start) patch.start_date = start;
    if (!ex.category_id && str(f.category_id, 40)) patch.category_id = str(f.category_id, 40);
    if (Object.keys(patch).length) await supabase.from('money_masters').update({ ...patch, updated_at: nowIso() }).eq('id', ex.id);
    return { status: 'linked', table: 'money_masters', id: ex.id };
  }
  const { data, error } = await supabase.from('money_masters').insert({
    owner_id: uid, kind: f.kind, institution: str(f.institution), inst_key: iKey, ref: rKey || null, ref_key: rKey,
    title: str(f.title, 160) || str(f.institution) || f.kind, amount, frequency: freq, due_day: dueDay, due_month: dueMonth,
    start_date: start, category_id: str(f.category_id, 40), meta: typeof f.meta === 'object' && f.meta ? f.meta : {},
    source: str(f.source, 20) || 'discover', status: 'active',
  }).select().single();
  if (error) throw error;
  return { status: 'created', table: 'money_masters', id: data.id };
}

async function upsertEvent(uid, master, e) {
  const kind = EVENT_KINDS.includes(e.kind) ? e.kind : 'bill';
  const { data: ex } = await supabase.from('recurring_events').select('*')
    .eq('owner_id', uid).eq('master_table', master.table).eq('master_id', String(master.id)).eq('kind', kind).maybeSingle();
  if (ex) return { status: 'linked', id: ex.id };
  const { data, error } = await supabase.from('recurring_events').insert({
    owner_id: uid, master_table: master.table, master_id: String(master.id), kind,
    title: str(e.title, 160) || kind, amount: num(e.amount),
    frequency: EVENT_FREQS.includes(e.frequency) ? e.frequency : 'monthly',
    due_day: int(e.due_day, 1, 31), due_month: int(e.due_month, 1, 12),
    start_date: isDate(e.start_date) ? e.start_date : null, end_date: isDate(e.end_date) ? e.end_date : null,
    remind_days: int(e.remind_days, 0, 30) ?? 3, direction: e.direction === 'in' ? 'in' : 'out', source: 'discover', status: 'active',
  }).select().single();
  if (error) throw error;
  return { status: 'created', id: data.id };
}

async function addPayments(uid, eventId, paid) {
  const rows = (Array.isArray(paid) ? paid : []).slice(0, 36)
    .filter(p => isDate(p.period))
    .map(p => ({ owner_id: uid, event_id: eventId, period: p.period, status: 'paid', amount: num(p.amount), paid_on: isDate(p.paid_on) ? p.paid_on : p.period, txn_ref: str(p.txn_ref, 80) }));
  if (!rows.length) return 0;
  const { data, error } = await supabase.from('event_payments').upsert(rows, { onConflict: 'event_id,period', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  return (data || []).length;
}

router.post('/apply', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const finds = (Array.isArray(req.body?.finds) ? req.body.finds : []).slice(0, 80);
    const results = [];
    for (const f of finds) {
      if (!KINDS.includes(f?.kind)) { results.push({ key: f?.key, error: 'unknown kind' }); continue; }
      try {
        const master = await upsertMaster(uid, f);
        let event = null, payments_added = 0;
        if (f.event && master.id) {
          event = await upsertEvent(uid, master, f.event);
          payments_added = await addPayments(uid, event.id, f.paid);
        }
        results.push({ key: f.key, master, event, payments_added });
      } catch (err) { results.push({ key: f.key, error: err.message }); }
    }
    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/paid', requireAuth, async (req, res) => {
  try {
    const { data: ev } = await supabase.from('recurring_events').select('id').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
    if (!ev) return res.status(404).json({ error: 'Not found' });
    const n = await addPayments(req.user.id, ev.id, [req.body || {}]);
    res.json({ ok: true, added: n });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: m } = await supabase.from('money_masters').select('id').eq('id', req.params.id).eq('owner_id', uid).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Not found' });
    await supabase.from('recurring_events').delete().eq('owner_id', uid).eq('master_table', 'money_masters').eq('master_id', m.id);
    await supabase.from('money_masters').delete().eq('id', m.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports._test = { instKey, refKey, refMatch, nextDue };
