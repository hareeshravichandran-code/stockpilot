/**
 * Events and SMS rules — the management API behind the web "Events" page.
 * The model and the matching rules are described in services/eventMatch.js.
 *
 *   GET    /api/events                          every event with its current due date and state
 *   GET    /api/events/senders                  bank senders seen in SMS (for building rules)
 *   GET    /api/events/rules                    every SMS rule (category, and the event it settles if any)
 *   POST   /api/events/rules                    { category_id, event_id?, merchant_pattern?, pattern_tok?, sender_key?, amount_min?, amount_max?, label? }
 *   POST   /api/events/rules/preview            same body: which recent SMS it would catch
 *   PUT    /api/events/rules/:id                edit
 *   DELETE /api/events/rules/:id                remove (soft, so phones drop it on their next sync)
 *   GET    /api/events/:id                      one event: details, rules, due dates with their payments, other payments
 *   POST   /api/events                          create
 *   PUT    /api/events/:id                      edit
 *   POST   /api/events/:id/status               { status: active | paused | closed }
 *   DELETE /api/events/:id                      delete (own events only; master events are closed instead)
 *   GET    /api/events/inbox                    due / overdue dates with the payment that most likely settles each
 *   GET    /api/events/:id/candidates?period=&q=  every payment near a due date (any amount), to pick one by hand
 *   POST   /api/events/:id/occurrences/:period  { action: match (txn_id) | done | skip }   match also creates the SMS rule
 *   DELETE /api/events/:id/occurrences/:period  open that due date again; its payment won't be tied to this event again
 */
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const EM = require('../services/eventMatch');
const { levelOf, LEVELS, WINDOW } = require('../services/alerts');
const { lockRow } = require('../services/privacy');
const { allRows } = require('../services/allRows');

const KINDS = ['emi', 'subscription', 'sip', 'rd_instalment', 'premium', 'card_due', 'bill', 'rent', 'school_fee', 'property_tax', 'salary', 'income', 'dividend', 'maturity', 'other'];
const FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'once'];
const IN_KINDS = ['salary', 'income', 'dividend', 'maturity'];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
const str = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const nowIso = () => new Date().toISOString();
const TXN_COLS = 'id, amount, type, merchant, description, sms_body, sms_sender, bank_name, account_last4, date_time, category_id, master_id, event_id, event_skip, merchant_tok, signals';
const txnOut = (t) => t && ({ cat_match: false, id: t.id, amount: num(t.amount), date: EM.istDay(t.date_time), dir: t.type === 'CREDIT' ? 'in' : 'out',
  payee: t.merchant || t.description || null, body: t.sms_body || null, sender: t.sms_sender || null, sender_key: EM.senderKey(t.sms_sender),
  bank: t.bank_name || null, account: t.account_last4 || null, category_id: t.category_id || null, event_id: t.event_id || null });

async function ownEvent(uid, id) {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from('recurring_events').select('*').eq('id', id).eq('owner_id', uid).maybeSingle();
  return data;
}
const schedule = (e) => ({ frequency: e.frequency, due_day: e.due_day, due_month: e.due_month, start_date: e.start_date, end_date: e.end_date });

/** Where an event stands today: the due date that matters now, and its state. */
function currentOf(e, payOf, today) {
  const iv = EM.intervalDays(e);
  const ps = EM.periods(e, EM.addDays(today, -Math.min(iv * 2, 800)), EM.addDays(today, Math.min(iv * 2, 800)));
  const rows = ps.map(p => ({ period: p, ...EM.stateOf(e, p, payOf[e.id + '|' + p] || null, today), pay: payOf[e.id + '|' + p] || null }));
  const owed = rows.filter(r => r.state === 'overdue' || r.state === 'due');
  const next = rows.find(r => r.period >= today && r.state !== 'done' && r.state !== 'skipped') || rows.find(r => r.period >= today);
  const last = [...rows].reverse().find(r => r.state === 'done');
  const lastDue = [...rows].reverse().find(r => r.period <= today);
  return { cycle_done: !!(lastDue && !owed.length && (lastDue.state === 'done' || lastDue.state === 'skipped')), now: owed[0] || null, next: next || null, last_done: last ? { period: last.period, paid_on: last.pay?.paid_on || null, amount: num(last.pay?.amount), timing: last.timing } : null };
}

/** Categories that settle an event by themselves (premiums, school fees, property tax), from its policy if any. */
async function familiesFor(evs) {
  const ids = [...new Set((evs || []).filter(e => e.master_table === 'insurance_policies' && e.master_id).map(e => String(e.master_id)))];
  const { data: pols } = ids.length ? await supabase.from('insurance_policies').select('id, kind').in('id', ids) : { data: [] };
  const P = Object.fromEntries((pols || []).map(p => [String(p.id), p]));
  const out = {};
  for (const e of evs || []) { const f = EM.catFamily(e, e.master_table === 'insurance_policies' ? P[String(e.master_id)] : null); if (f) out[e.id] = f; }
  return out;
}

/**
 * Payments that could settle a due date, best first. Long cycles (premiums, yearly fees) change amount and are
 * paid weeks early, so their window and amount band are wider; a payment in the event's own category ranks first.
 */
function suggestFor(e, period, recent, used, fam) {
  const amt = num(e.amount), dir = e.direction === 'in' ? 'in' : 'out';
  const long = ['quarterly', 'half_yearly', 'yearly'].includes(e.frequency);
  const win = long ? 50 : Math.max(20, EM.bufferOf(e) + 10);
  const [lo, hi] = long ? [0.5, 2] : [0.7, 1.3];
  return recent.filter(t => !used.has(t.id) && (t.type === 'CREDIT' ? 'in' : 'out') === dir && Math.abs(EM.diffDays(EM.istDay(t.date_time), period)) <= win
      && !(Array.isArray(t.event_skip) && t.event_skip.includes(e.id)) && !(t.event_id && t.event_id !== e.id)
      && (fam?.has(t.category_id) || !amt || (num(t.amount) >= amt * lo - 5 && num(t.amount) <= amt * hi + 5)))
    .map(t => ({ t, cat: !!fam?.has(t.category_id) }))
    .sort((a, b) => (b.cat - a.cat) || Math.abs(num(a.t.amount) - amt) - Math.abs(num(b.t.amount) - amt)
      || Math.abs(EM.diffDays(EM.istDay(a.t.date_time), period)) - Math.abs(EM.diffDays(EM.istDay(b.t.date_time), period)))
    .slice(0, 5).map(({ t, cat }) => ({ ...txnOut(t), cat_match: cat }));
}

/**
 * What each event belongs to, so the web can link both ways: a subscription / card / SIP master,
 * a loan (Blueprint EMI), an insurance policy or an RD. Manual events have no link.
 */
async function linksFor(uid, evs) {
  const want = (t) => [...new Set((evs || []).filter(e => e.master_table === t).map(e => String(e.master_id)))];
  const mm = want('money_masters').filter(isUuid), bk = want('bp_buckets'), pol = want('insurance_policies'), rd = want('recurring_deposits');
  const none = Promise.resolve({ data: [] });
  const [a, b, c, d] = await Promise.all([
    mm.length ? supabase.from('money_masters').select('id, kind, title, institution, ref_key').in('id', mm) : none,
    bk.length ? supabase.from('bp_buckets').select('id, name').eq('user_id', uid).in('id', bk) : none,
    pol.length ? supabase.from('insurance_policies').select('id, plan_name, insurer').in('id', pol) : none,
    rd.length ? supabase.from('recurring_deposits').select('rd_id, nickname, institution_name').in('rd_id', rd) : none,
  ]);
  const by = (rows, k = 'id') => Object.fromEntries((rows || []).map(r => [String(r[k]), r]));
  const M = by(a.data), B = by(b.data), P = by(c.data), R = by(d.data, 'rd_id');
  const out = {};
  for (const e of evs || []) {
    const id = String(e.master_id);
    if (e.master_table === 'money_masters' && M[id]) { const m = M[id]; out[e.id] = { kind: m.kind, id, title: m.title, institution: m.institution || null, ref: m.ref_key ? String(m.ref_key).replace(/\D/g, '').slice(-4) || null : null, tab: 'm-' + m.kind }; }
    else if (e.master_table === 'bp_buckets') out[e.id] = { kind: 'loan', id, title: B[id]?.name || null, to: '/blueprint' };
    else if (e.master_table === 'insurance_policies') out[e.id] = { kind: 'insurance', id, title: P[id]?.plan_name || P[id]?.insurer || null, tab: 'm-insurance' };
    else if (e.master_table === 'recurring_deposits') out[e.id] = { kind: 'rd', id, title: R[id]?.nickname || R[id]?.institution_name || null, tab: 'rd' };
  }
  return out;
}

/** The linked master's own facts for the event page (shown by type: loan, card, subscription, policy). */
async function detailsFor(uid, e) {
  const id = String(e.master_id || '');
  if (e.master_table === 'money_masters' && isUuid(id)) {
    const { data: m } = await supabase.from('money_masters').select('*').eq('id', id).eq('owner_id', uid).maybeSingle();
    if (!m) return null;
    const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
    const pick = (k) => (meta[k] == null || meta[k] === '' ? undefined : meta[k]);
    return { type: m.kind, title: m.title, institution: m.institution || null, last4: m.ref_key ? String(m.ref_key).replace(/\D/g, '').slice(-4) || null : null,
      amount: num(m.amount) || null, frequency: m.frequency || null, due_day: m.due_day || null, status: m.status, since: m.created_at || null,
      limit: pick('credit_limit') ?? pick('limit'), balance: pick('balance'), balance_at: pick('balance_at'), plan: pick('plan'), outstanding: pick('outstanding'), rate: pick('rate') };
  }
  if (e.master_table === 'bp_buckets') {
    const { data: b } = await supabase.from('bp_buckets').select('*').eq('id', id).eq('user_id', uid).maybeSingle();
    if (!b) return null;
    return { type: 'loan', title: b.name, emi: num(b.target_amount) || null, due_day: b.recurrence_day || null, ends: b.target_date || null, status: b.status, notes: b.notes || null, since: b.created_at || null };
  }
  if (e.master_table === 'insurance_policies') {
    const { data: p } = await supabase.from('insurance_policies').select('*').eq('id', id).maybeSingle();
    if (!p) return null;
    return { type: 'insurance', title: p.plan_name || p.insurer || null, insurer: p.insurer || null, kind: p.kind || null, premium: num(p.premium) || null,
      sum_assured: num(p.sum_assured) || null, frequency: p.premium_frequency || p.frequency || null, renewal: p.renewal_date || p.next_due || null };
  }
  return null;
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { linkActuals } = require('./masters');
    await linkActuals(uid).catch(() => {});
    const [{ data: evs }, { data: rules }, { data: ms }] = await Promise.all([
      supabase.from('recurring_events').select('*').eq('owner_id', uid).neq('status', 'deleted'),
      supabase.from('user_sms_rules').select('id, event_id').eq('user_id', uid).eq('is_deleted', false).not('event_id', 'is', null),
      supabase.from('money_masters').select('id, kind, title, institution').eq('owner_id', uid),
    ]);
    const ids = (evs || []).map(e => e.id);
    const { data: pays } = ids.length ? await supabase.from('event_payments').select('event_id, period, status, paid_on, amount, timing, match_source')
      .in('event_id', ids).gte('period', EM.addDays(EM.todayStr(), -800)) : { data: [] };
    const payOf = {}; for (const p of pays || []) payOf[p.event_id + '|' + p.period] = p;
    const ruleCount = {}; for (const r of rules || []) ruleCount[r.event_id] = (ruleCount[r.event_id] || 0) + 1;
    const mById = Object.fromEntries((ms || []).map(m => [m.id, m]));
    const today = EM.todayStr();
    const links = await linksFor(uid, evs).catch(() => ({}));
    const out = (evs || []).map(e => {
      const cur = e.status === 'active' ? currentOf(e, payOf, today) : { now: null, next: null, last_done: null };
      const m = e.master_table === 'money_masters' ? mById[e.master_id] : null;
      const focus = cur.now || cur.next;
      return {
        id: e.id, title: e.title, kind: e.kind, direction: e.direction, amount: num(e.amount), amount_mode: e.amount_mode || 'about',
        ...schedule(e), buffer_days: EM.bufferOf(e), remind_days: e.remind_days, alert_level: e.alert_level, level: levelOf(e.kind, e.alert_level),
        pay_mode: e.pay_mode || 'auto', category_id: e.category_id || null, status: e.status, notes: e.notes || null,
        source: e.master_table === 'manual' ? 'manual' : e.master_table, master: m ? { id: m.id, kind: m.kind, title: m.title, institution: m.institution } : null,
        rules: ruleCount[e.id] || 0, link: links[e.id] || null,
        state: cur.now ? cur.now.state : (focus ? focus.state : null), focus_date: focus ? focus.period : null, alert: !!(cur.now && cur.now.alert),
        next_due: cur.next ? cur.next.period : null, last_done: cur.last_done, cycle_done: !!cur.cycle_done,
      };
    });
    const order = { overdue: 0, due: 1, upcoming: 2, done: 3 };
    out.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (order[a.state] ?? 4) - (order[b.state] ?? 4)
      || String(a.focus_date || '9').localeCompare(String(b.focus_date || '9')));
    res.json({ events: out, kinds: KINDS, levels: LEVELS, today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Senders seen in SMS ──────────────────────────────────────────────────────
router.get('/senders', requireAuth, async (req, res) => {
  try {
    const data = await allRows(() => supabase.from('expense_transactions').select('id, sms_sender, bank_name').eq('user_id', req.user.id).eq('is_deleted', false)
      .gte('date_time', Date.now() - 400 * 86400000).order('id'));
    const by = {};
    for (const t of data || []) { const k = EM.senderKey(t.sms_sender); if (!k) continue; const o = by[k] = by[k] || { key: k, bank: t.bank_name || null, count: 0, examples: new Set() }; o.count++; if (o.examples.size < 3) o.examples.add(t.sms_sender); }
    res.json({ senders: Object.values(by).map(o => ({ ...o, examples: [...o.examples] })).sort((a, b) => b.count - a.count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SMS rules ────────────────────────────────────────────────────────────────
function ruleBody(b) {
  const r = {};
  if (b.merchant_pattern !== undefined) r.merchant_pattern = str(b.merchant_pattern, 8000);
  if (b.pattern_tok !== undefined) r.pattern_tok = Array.isArray(b.pattern_tok) ? b.pattern_tok.filter(x => typeof x === 'string').slice(0, 20) : null;
  if (b.sender_key !== undefined) r.sender_key = b.sender_key ? EM.senderKey(String(b.sender_key)) || String(b.sender_key).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || null : null;
  if (b.amount_min !== undefined) r.amount_min = numOrNull(b.amount_min);
  if (b.amount_max !== undefined) r.amount_max = numOrNull(b.amount_max);
  if (b.category_id !== undefined) r.category_id = str(b.category_id, 80);
  if (b.event_id !== undefined) r.event_id = isUuid(b.event_id) ? b.event_id : null;
  if (b.label !== undefined) r.label = str(b.label, 2000);
  // Account / card last digits (2-4): for card bills and EMIs whose amount changes
  if (b.account_ref !== undefined) { const d = String(b.account_ref || '').replace(/\D/g, '').slice(-4); r.account_ref = d.length >= 2 ? d : null; }
  if (b.ref_kind !== undefined) r.ref_kind = ['card', 'loan'].includes(b.ref_kind) ? b.ref_kind : null;
  return r;
}
async function checkRule(uid, r) {
  if (r.event_id) {
    const ev = await ownEvent(uid, r.event_id);
    if (!ev) return 'That event was not found';
    if (!r.category_id) r.category_id = ev.category_id || null;
  }
  if (!r.category_id) return 'Pick a category. Every rule puts its SMS in a category.';
  const words = !!r.merchant_pattern || (Array.isArray(r.pattern_tok) && r.pattern_tok.length);
  const ref = !!r.account_ref;
  if (!words && !r.sender_key && !ref) return 'Give the rule words from the SMS, a sender, the account\'s last digits, or a mix.';
  if (!words && !ref && r.amount_min == null && r.amount_max == null) return 'A rule with only a sender would catch every SMS from that bank. Add words, an amount or the account\'s last digits.';
  if (ref && !words && !r.sender_key && !r.ref_kind) r.ref_kind = 'card';   // digits alone: only on card / loan payment SMS
  if (r.amount_min != null && r.amount_max != null && r.amount_min > r.amount_max) return 'The lowest amount is above the highest.';
  return null;
}
async function recentTxns(uid, days = 200) {
  return allRows(() => supabase.from('expense_transactions').select(TXN_COLS).eq('user_id', uid).eq('is_deleted', false)
    .gte('date_time', Date.now() - days * 86400000).order('date_time', { ascending: false }).order('id', { ascending: true }));
}

router.get('/rules', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: rules }, { data: evs }, txns] = await Promise.all([
      supabase.from('user_sms_rules').select('*').eq('user_id', uid).eq('is_deleted', false).order('updated_at', { ascending: false }),
      supabase.from('recurring_events').select('id, title, kind, status').eq('owner_id', uid),
      recentTxns(uid, 180),
    ]);
    const evById = Object.fromEntries((evs || []).map(e => [e.id, e]));
    const out = (rules || []).map(r => {
      const caught = txns.filter(t => EM.ruleScore(r, t) > 0);
      return { id: r.id, category_id: r.category_id, is_ignored: !!r.is_ignored, event_id: r.event_id || null, event: r.event_id && evById[r.event_id] ? { id: r.event_id, title: evById[r.event_id].title, kind: evById[r.event_id].kind, status: evById[r.event_id].status } : null,
        merchant_pattern: r.merchant_pattern || null, has_words: !!r.merchant_pattern || (Array.isArray(r.pattern_tok) && r.pattern_tok.length > 0),
        label: r.label || null, sender_key: r.sender_key || null, amount_min: r.amount_min == null ? null : num(r.amount_min), amount_max: r.amount_max == null ? null : num(r.amount_max),
        account_ref: r.account_ref || null, ref_kind: r.ref_kind || null,
        source: r.source || 'manual', from_phone: !r.source || r.source === 'manual' ? !r.user_confirmed : false, confirmed: !!r.user_confirmed,
        caught: caught.length, last_caught: caught[0] ? EM.istDay(caught[0].date_time) : null, updated_at: r.updated_at };
    });
    res.json({ rules: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules/preview', requireAuth, async (req, res) => {
  try {
    const r = ruleBody(req.body || {});
    const words = !!r.merchant_pattern || (Array.isArray(r.pattern_tok) && r.pattern_tok.length);
    if (!words && !r.sender_key) return res.json({ count: 0, sample: [] });
    const hits = (await recentTxns(req.user.id, 180)).filter(t => EM.ruleScore(r, t) > 0);
    res.json({ count: hits.length, sample: hits.slice(0, 8).map(txnOut) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const r = ruleBody(req.body || {});
    const bad = await checkRule(uid, r);
    if (bad) return res.status(400).json({ error: bad });
    const row = { ...r, user_id: uid, user_confirmed: true, is_deleted: false, source: str(req.body.source, 20) || 'web', match_count: 1, updated_at: Date.now() };
    const q = row.merchant_pattern
      ? supabase.from('user_sms_rules').upsert(row, { onConflict: 'user_id,merchant_pattern' })
      : supabase.from('user_sms_rules').insert(row);
    const { data, error } = await q.select().single();
    if (error) throw error;
    require('./masters').linkActuals(uid, { force: true }).catch(() => {});
    res.status(201).json({ rule: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rules/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: cur } = await supabase.from('user_sms_rules').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Rule not found' });
    const patch = ruleBody(req.body || {});
    const merged = { ...cur, ...patch };
    const bad = await checkRule(uid, merged);
    if (bad) return res.status(400).json({ error: bad });
    if (patch.event_id === undefined) delete patch.event_id;
    const { data, error } = await supabase.from('user_sms_rules').update({ ...patch, category_id: merged.category_id, ...(merged.category_id ? { is_ignored: false } : {}), user_confirmed: true, updated_at: Date.now() })
      .eq('id', cur.id).eq('user_id', uid).select().single();
    if (error) throw error;
    require('./masters').linkActuals(uid, { force: true }).catch(() => {});
    res.json({ rule: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('user_sms_rules').update({ is_deleted: true, updated_at: Date.now() }).eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SMS groups (found by the phone during setup, sorted here or in the app) ──
// A group is one payee seen in many SMS. The user decides what it is:
//   category  -> an SMS rule (payee words -> category)
//   event     -> an event (EMI, subscription, SIP...) + a rule tied to it; optionally a subscription master too
//   ignore    -> leave it
router.get('/groups', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: gs }, { data: evs }] = await Promise.all([
      supabase.from('sms_groups').select('*').eq('owner_id', uid).order('count', { ascending: false }).range(0, 999),
      supabase.from('recurring_events').select('id, title, kind').eq('owner_id', uid),
    ]);
    const evById = Object.fromEntries((evs || []).map(e => [e.id, e]));
    res.json({ groups: (gs || []).map(g => ({
      id: g.id, name: g.name || g.key, key: g.key, sample: g.sample, sender_key: g.sender_key, count: g.count, total: num(g.total),
      avg_amount: num(g.avg_amount), min_amount: num(g.min_amount), max_amount: num(g.max_amount), first_seen: g.first_seen, last_seen: g.last_seen,
      cadence: g.cadence, due_day: g.due_day, suggested: g.suggested, status: g.status, category_id: g.category_id,
      event: g.event_id && evById[g.event_id] ? { id: g.event_id, title: evById[g.event_id].title, kind: evById[g.event_id].kind } : null, updated_at: g.updated_at,
    })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Rule from a group: its payee words (already sealed by the phone for encrypted accounts). */
async function ruleFromGroup(uid, g, { category_id, event_id = null, amountRange = null }) {
  const { isEnc } = require('../services/privacy');
  const pattern = isEnc(g.key) ? g.key : String(g.key).toLowerCase().trim();
  const row = { user_id: uid, merchant_pattern: pattern, pattern_tok: g.pattern_tok || null, category_id, event_id, source: 'group', label: g.name || null,
    amount_min: amountRange ? amountRange[0] : null, amount_max: amountRange ? amountRange[1] : null, user_confirmed: true, is_deleted: false,
    match_count: g.count || 1, updated_at: Date.now() };
  const { data: ex } = await supabase.from('user_sms_rules').select('id').eq('user_id', uid).eq('merchant_pattern', pattern).maybeSingle();
  if (ex) { await supabase.from('user_sms_rules').update(row).eq('id', ex.id); return ex.id; }
  const { data, error } = await supabase.from('user_sms_rules').insert({ ...row, created_at: Date.now() }).select('id').single();
  if (error) throw error;
  return data.id;
}
async function recategorise(uid, g, category_id) {
  // Uncategorised (or NACH / other) payments from this payee follow the new rule
  let q = supabase.from('expense_transactions').update({ category_id, updated_at: Date.now() }).eq('user_id', uid).or('category_id.is.null,category_id.in.(other,uncategorized,nach)');
  q = Array.isArray(g.pattern_tok) && g.pattern_tok.length ? q.contains('merchant_tok', g.pattern_tok) : q.ilike('merchant', `%${String(g.key).toLowerCase()}%`);
  await q;
}

router.post('/groups/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id; const b = req.body || {};
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { data: g } = await supabase.from('sms_groups').select('*').eq('id', req.params.id).eq('owner_id', uid).maybeSingle();
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const set = (patch) => supabase.from('sms_groups').update({ ...patch, updated_at: nowIso() }).eq('id', g.id);
    if (b.action === 'ignore') { await set({ status: 'ignored' }); return res.json({ ok: true }); }
    if (b.action === 'reopen') { await set({ status: 'open' }); return res.json({ ok: true }); }
    const category_id = str(b.category_id, 80);
    if (!category_id) return res.status(400).json({ error: 'Pick a category' });
    if (b.action === 'category') {
      const rule_id = await ruleFromGroup(uid, g, { category_id });
      await recategorise(uid, g, category_id);
      await set({ status: 'ruled', category_id, rule_id, event_id: null });
      return res.json({ ok: true, rule_id });
    }
    if (b.action !== 'event') return res.status(400).json({ error: 'Unknown action' });
    // Event (+ subscription master when asked)
    const kind = KINDS.includes(b.kind) ? b.kind : 'subscription';
    const freq = FREQS.includes(b.frequency) && b.frequency !== 'once' ? b.frequency : (g.cadence || 'monthly');
    const due_day = (() => { const d = parseInt(b.due_day ?? g.due_day, 10); return d >= 1 && d <= 31 ? d : null; })();
    if (!due_day) return res.status(400).json({ error: 'Pick the day it is due' });
    const due_month = freq === 'monthly' ? null : (() => { const m = parseInt(b.due_month, 10); return m >= 1 && m <= 12 ? m : (g.last_seen ? +g.last_seen.slice(5, 7) : null); })();
    const amount = num(b.amount) || num(g.avg_amount);
    const title = str(b.title, 4000) || g.name || g.key;
    let eventId = null;
    if (b.also_subscription) {
      const M = require('./masters');
      const r = await M.upsertMaster(uid, { kind: 'subscription', title, amount, frequency: freq, due_day, due_month, source: 'sms_group',
        match: { keywords: [g.key], keyword_tok: g.pattern_tok || undefined, any_amount: b.amount_mode === 'any' } });
      if (r.table === 'money_masters') {
        const { data: m } = await supabase.from('money_masters').select('*').eq('id', r.id).maybeSingle();
        if (m) eventId = await M.syncEvent(uid, m);
      }
    }
    const fields = { kind, category_id, amount, amount_mode: ['exact', 'about', 'any'].includes(b.amount_mode) ? b.amount_mode : 'about', frequency: freq, due_day, due_month,
      buffer_days: (() => { const x = parseInt(b.buffer_days, 10); return Number.isFinite(x) ? Math.max(0, Math.min(15, x)) : 2; })(), direction: IN_KINDS.includes(kind) ? 'in' : 'out' };
    if (eventId) await supabase.from('recurring_events').update(fields).eq('id', eventId);
    else {
      const row = { owner_id: uid, master_table: 'manual', master_id: `g-${g.id}`, source: 'manual', status: 'active', title, start_date: null, pay_mode: 'auto',
        remind_days: Math.max(0, WINDOW[levelOf(kind, null)] ?? 2), ...fields };
      const { data, error } = await supabase.from('recurring_events').insert(await lockRow(uid, row, { texts: ['title'] })).select('id').single();
      if (error) throw error;
      eventId = data.id;
    }
    const steady = num(g.min_amount) && num(g.max_amount) && num(g.max_amount) <= num(g.min_amount) * 1.25;
    const rule_id = await ruleFromGroup(uid, g, { category_id, event_id: eventId,
      amountRange: steady && fields.amount_mode !== 'any' ? [Math.floor(num(g.min_amount) * 0.9), Math.ceil(num(g.max_amount) * 1.1)] : null });
    await recategorise(uid, g, category_id);
    await set({ status: 'event', category_id, rule_id, event_id: eventId });
    require('./masters').linkActuals(uid, { force: true }).catch(() => {});
    res.json({ ok: true, event_id: eventId, rule_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Inbox: what needs an answer ──────────────────────────────────────────────
// Every active event whose due date is open now, with the payment that most likely settles it.
router.get('/inbox', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    await require('./masters').linkActuals(uid).catch(() => {});
    const { data: evs } = await supabase.from('recurring_events').select('*').eq('owner_id', uid).eq('status', 'active');
    const ids = (evs || []).map(e => e.id);
    const today = EM.todayStr();
    const { data: pays } = ids.length ? await supabase.from('event_payments').select('event_id, period, status, txn_ref').in('event_id', ids).gte('period', EM.addDays(today, -800)) : { data: [] };
    const payOf = {}; for (const p of pays || []) payOf[p.event_id + '|' + p.period] = p;
    const open = (evs || []).map(e => ({ e, cur: currentOf(e, payOf, today) })).filter(x => x.cur.now);
    if (!open.length) return res.json({ items: [], today });
    const recent = await recentTxns(uid, 120);
    const used = new Set((pays || []).map(p => p.txn_ref).filter(Boolean));
    const fams = await familiesFor(open.map(x => x.e));
    const items = open.map(({ e, cur }) => {
      const s = suggestFor(e, cur.now.period, recent, used, fams[e.id] || null);
      return { event: { id: e.id, title: e.title, kind: e.kind, amount: num(e.amount), frequency: e.frequency, category_id: e.category_id || null },
        period: cur.now.period, state: cur.now.state, days: EM.diffDays(today, cur.now.period), suggestion: s[0] || null, more: Math.max(0, s.length - 1) };
    }).sort((a, b) => (a.state === 'overdue' ? 0 : 1) - (b.state === 'overdue' ? 0 : 1) || a.period.localeCompare(b.period));
    res.json({ items, today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Every payment near a due date, any amount: when the right one was not suggested, pick it by hand.
router.get('/:id/candidates', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const e = await ownEvent(uid, req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const period = isDate(req.query.period) ? req.query.period : EM.todayStr();
    const q = str(req.query.q, 60)?.toLowerCase() || null;
    const span = Math.min(120, Math.max(15, parseInt(req.query.days, 10) || (['quarterly', 'half_yearly', 'yearly'].includes(e.frequency) ? 60 : 25)));
    const from = EM.addDays(period, -span), to = EM.addDays(period, span);
    const dir = e.direction === 'in' ? 'CREDIT' : 'DEBIT';
    const data = await allRows(() => supabase.from('expense_transactions').select(TXN_COLS).eq('user_id', uid).eq('is_deleted', false).eq('type', dir)
      .gte('date_time', Date.parse(from + 'T00:00:00+05:30')).lte('date_time', Date.parse(to + 'T23:59:59+05:30'))
      .order('date_time', { ascending: false }).order('id', { ascending: true }));
    const refs = data.map(t => t.id);
    const { data: tied } = refs.length ? await supabase.from('event_payments').select('txn_ref, event_id').in('txn_ref', refs) : { data: [] };
    const taken = Object.fromEntries((tied || []).map(p => [p.txn_ref, p.event_id]));
    const fam = (await familiesFor([e]))[e.id] || null;
    const amt = num(e.amount);
    const list = data.filter(t => !q || [t.merchant, t.description, t.sms_body, t.sms_sender, t.bank_name, t.category_id, String(Math.round(num(t.amount)))]
        .some(x => typeof x === 'string' && !x.startsWith('ev1:') && !x.startsWith('ep1:') && x.toLowerCase().includes(q)))
      .map(t => ({ ...txnOut(t), cat_match: !!fam?.has(t.category_id), taken: taken[t.id] ? (taken[t.id] === e.id ? 'this' : 'other') : null,
        days: EM.diffDays(EM.istDay(t.date_time), period) }))
      .sort((a, b) => (b.cat_match - a.cat_match) || Math.abs(a.days) - Math.abs(b.days) || Math.abs(a.amount - amt) - Math.abs(b.amount - amt))
      .slice(0, 60);
    res.json({ period, from, to, payments: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── One event ────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const e = await ownEvent(uid, req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const today = EM.todayStr();
    const iv = EM.intervalDays(e);
    const from = EM.addDays(today, -Math.min(iv * 7, 1100)), to = EM.addDays(today, Math.min(Math.round(iv * 1.2), 400));
    const [{ data: pays }, { data: rules }, { data: tied }, { data: master }] = await Promise.all([
      supabase.from('event_payments').select('*').eq('event_id', e.id).order('period', { ascending: false }).range(0, 60),
      supabase.from('user_sms_rules').select('*').eq('user_id', uid).eq('event_id', e.id).eq('is_deleted', false),
      supabase.from('expense_transactions').select(TXN_COLS).eq('user_id', uid).eq('event_id', e.id).eq('is_deleted', false).order('date_time', { ascending: false }).range(0, 60),
      e.master_table === 'money_masters' && isUuid(e.master_id) ? supabase.from('money_masters').select('id, kind, title, institution, ref_key').eq('id', e.master_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const payOf = Object.fromEntries((pays || []).map(p => [p.period, p]));
    const refs = (pays || []).map(p => p.txn_ref).filter(isUuid);
    const { data: payTx } = refs.length ? await supabase.from('expense_transactions').select(TXN_COLS).in('id', refs).eq('user_id', uid) : { data: [] };
    const txById = Object.fromEntries((payTx || []).map(t => [t.id, t]));
    // Payments near open due dates that could be this event
    const recent = await recentTxns(uid, Math.max(60, Math.round(EM.diffDays(today, from)) + 30));
    const used = new Set(refs);
    const amt = num(e.amount);
    const fam = (await familiesFor([e]))[e.id] || null;
    const suggest = (p) => suggestFor(e, p, recent, used, fam);
    const occ = EM.periods(e, from, to).reverse().slice(0, 9).map(p => {
      const pay = payOf[p] || null;
      const st = EM.stateOf(e, p, pay, today);
      const row = { period: p, window: [EM.addDays(p, -EM.bufferOf(e)), EM.addDays(p, EM.bufferOf(e))], ...st };
      if (pay) Object.assign(row, { paid_on: pay.paid_on, amount: num(pay.amount), match_source: pay.match_source || (pay.txn_ref ? 'auto' : 'marked'), txn: txnOut(txById[pay.txn_ref]) || null });
      if (!pay && ['due', 'overdue', 'missed'].includes(st.state)) row.suggestions = suggest(p);
      return row;
    });
    const inPeriods = new Set(refs);
    const extra = (tied || []).filter(t => !inPeriods.has(t.id)).slice(0, 20).map(txnOut);
    const ruleTx = await recentTxns(uid, 180);
    res.json({
      event: { id: e.id, title: e.title, kind: e.kind, direction: e.direction, amount: amt, amount_mode: e.amount_mode || 'about', ...schedule(e),
        buffer_days: EM.bufferOf(e), remind_days: e.remind_days, alert_level: e.alert_level, level: levelOf(e.kind, e.alert_level), pay_mode: e.pay_mode || 'auto',
        category_id: e.category_id || null, status: e.status, notes: e.notes || null, source: e.master_table === 'manual' ? 'manual' : e.master_table,
        master: master || null, link: (await linksFor(uid, [e]).catch(() => ({})))[e.id] || null, details: await detailsFor(uid, e).catch(() => null), created_at: e.created_at },
      rules: (rules || []).map(r => ({ id: r.id, category_id: r.category_id, merchant_pattern: r.merchant_pattern || null, label: r.label || null,
        has_words: !!r.merchant_pattern || (Array.isArray(r.pattern_tok) && r.pattern_tok.length > 0), sender_key: r.sender_key || null,
        amount_min: r.amount_min == null ? null : num(r.amount_min), amount_max: r.amount_max == null ? null : num(r.amount_max), source: r.source || 'manual',
        account_ref: r.account_ref || null, ref_kind: r.ref_kind || null,
        caught: ruleTx.filter(t => EM.ruleScore(r, t) > 0).length,
        // The latest SMS this rule caught: sender and text, so you can see what it reacts to
        sample: (() => { const t = ruleTx.filter(x => EM.ruleScore(r, x) > 0).sort((a, b) => Number(b.date_time) - Number(a.date_time))[0] || (tied || [])[0];
          return t ? { date: EM.istDay(t.date_time), sender: t.sms_sender || null, bank: t.bank_name || null, body: t.sms_body || t.description || null, amount: num(t.amount), payee: t.merchant || null } : null; })() })),
      occurrences: occ, other_payments: extra, today,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function eventFields(b, forCreate) {
  const p = {};
  if (b.title !== undefined) p.title = str(b.title, 4000);
  if (b.kind !== undefined) p.kind = KINDS.includes(b.kind) ? b.kind : 'other';
  if (b.amount !== undefined) p.amount = num(b.amount);
  if (b.amount_mode !== undefined) p.amount_mode = ['exact', 'about', 'any'].includes(b.amount_mode) ? b.amount_mode : 'about';
  if (b.frequency !== undefined) p.frequency = FREQS.includes(b.frequency) ? b.frequency : 'monthly';
  if (b.due_day !== undefined) { const d = parseInt(b.due_day, 10); p.due_day = d >= 1 && d <= 31 ? d : null; }
  if (b.due_month !== undefined) { const m = parseInt(b.due_month, 10); p.due_month = m >= 1 && m <= 12 ? m : null; }
  if (b.start_date !== undefined) p.start_date = isDate(b.start_date) ? b.start_date : null;
  if (b.end_date !== undefined) p.end_date = isDate(b.end_date) ? b.end_date : null;
  if (b.buffer_days !== undefined) { const x = parseInt(b.buffer_days, 10); p.buffer_days = Number.isFinite(x) ? Math.max(0, Math.min(15, x)) : 2; }
  if (b.remind_days !== undefined) {                              // empty = the default for the alert level
    const x = parseInt(b.remind_days, 10);
    const lvl = levelOf(b.kind || 'other', LEVELS.includes(b.alert_level) ? b.alert_level : null);
    p.remind_days = Number.isFinite(x) ? Math.max(0, Math.min(60, x)) : Math.max(0, WINDOW[lvl] ?? 2);
  }
  if (b.alert_level !== undefined) p.alert_level = LEVELS.includes(b.alert_level) ? b.alert_level : null;
  if (b.pay_mode !== undefined) p.pay_mode = b.pay_mode === 'manual' ? 'manual' : 'auto';
  if (b.category_id !== undefined) p.category_id = str(b.category_id, 80);
  if (b.notes !== undefined) p.notes = str(b.notes, 4000);
  if (b.direction !== undefined) p.direction = b.direction === 'in' ? 'in' : 'out';
  else if (forCreate) p.direction = IN_KINDS.includes(p.kind) ? 'in' : 'out';
  return p;
}
function checkEvent(e) {
  if (!e.title) return 'Give the event a name';
  if (!e.category_id) return 'Pick a category: the payments of this event are filed there';
  if (e.frequency === 'once') { if (!e.start_date) return 'Pick the date'; }
  else if (!e.due_day) return 'Pick the day it is due (1–31)';
  if (['quarterly', 'half_yearly', 'yearly'].includes(e.frequency) && !e.due_month) return 'Pick the month it is due';
  return null;
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const p = eventFields(req.body || {}, true);
    if (p.frequency === 'once' && p.start_date) { p.end_date = p.start_date; p.due_day = +p.start_date.slice(8, 10); p.due_month = +p.start_date.slice(5, 7); }
    if (p.frequency === 'monthly') p.due_month = null;
    const bad = checkEvent({ frequency: 'monthly', ...p });
    if (bad) return res.status(400).json({ error: bad });
    const row = { owner_id: uid, master_table: 'manual', master_id: `m-${Date.now()}`, source: 'manual', status: 'active', frequency: 'monthly', kind: 'other',
      start_date: null, buffer_days: 2, pay_mode: 'auto', amount_mode: 'about', ...p };      // no start date: past due dates show, so earlier payments can be tied
    const { data, error } = await supabase.from('recurring_events').insert(await lockRow(uid, row, { texts: ['title', 'notes'] })).select().single();
    if (error) throw error;
    res.status(201).json({ event: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const e = await ownEvent(uid, req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const p = eventFields(req.body || {}, false);
    const merged = { ...e, ...p };
    if (merged.frequency === 'once' && p.start_date) { p.end_date = p.start_date; p.due_day = +p.start_date.slice(8, 10); p.due_month = +p.start_date.slice(5, 7); }
    if (merged.frequency === 'monthly' && p.frequency) p.due_month = null;
    const bad = checkEvent({ ...merged, ...p });
    if (bad) return res.status(400).json({ error: bad });
    const { error } = await supabase.from('recurring_events').update(await lockRow(uid, { ...p, updated_at: nowIso() }, { texts: ['title', 'notes'] })).eq('id', e.id);
    if (error) throw error;
    // A changed category moves the event's rules with it
    if (p.category_id && p.category_id !== e.category_id) await supabase.from('user_sms_rules').update({ category_id: p.category_id, updated_at: Date.now() }).eq('user_id', uid).eq('event_id', e.id);
    require('./masters').linkActuals(uid, { force: true }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/status', requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req.user.id, req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const s = req.body?.status;
    if (!['active', 'paused', 'closed'].includes(s)) return res.status(400).json({ error: 'Unknown status' });
    await supabase.from('recurring_events').update({ status: s, updated_at: nowIso() }).eq('id', e.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const e = await ownEvent(uid, req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    if (e.master_table !== 'manual') return res.status(400).json({ error: 'This event comes from a master (loan, subscription...). Close it instead.' });
    await supabase.from('user_sms_rules').update({ is_deleted: true, updated_at: Date.now() }).eq('user_id', uid).eq('event_id', e.id);
    await supabase.from('expense_transactions').update({ event_id: null }).eq('user_id', uid).eq('event_id', e.id);
    await supabase.from('event_payments').delete().eq('event_id', e.id);
    await supabase.from('recurring_events').delete().eq('id', e.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Due dates: tie a payment, mark done / skipped, or open again ─────────────
/** The rule a payment teaches: same sender, same words (if the SMS has a payee), amount as the event expects. */
function ruleFromTxn(e, t) {
  const a = num(t.amount);
  const mode = e.amount_mode || 'about';
  const tok = Array.isArray(t.merchant_tok) && t.merchant_tok.length ? t.merchant_tok.slice(0, 6) : null;
  let lo = null, hi = null;
  if (mode === 'exact') { lo = a; hi = a; }
  else if (['quarterly', 'half_yearly', 'yearly'].includes(e.frequency) && tok) { lo = Math.floor(a * 0.6); hi = Math.ceil(a * 1.8); }   // premiums / fees change every renewal
  else if (mode === 'about' || !tok) { lo = Math.floor(a * (mode === 'about' ? 0.9 : 0.75)); hi = Math.ceil(a * (mode === 'about' ? 1.1 : 1.25)); }
  // Card bills and EMIs whose amount changes: learn the account's last digits instead of an amount range
  const l4 = String(t.account_last4 || '').replace(/\D/g, '').slice(-4);
  const refKind = e.kind === 'card_due' ? 'card' : e.kind === 'emi' ? 'loan' : null;
  if (refKind && mode !== 'exact' && l4.length >= 3) { lo = null; hi = null; }
  return { event_id: e.id, category_id: e.category_id, sender_key: EM.senderKey(t.sms_sender), pattern_tok: tok, merchant_pattern: null,
    amount_min: lo, amount_max: hi, account_ref: refKind && l4.length >= 3 ? l4 : null, ref_kind: refKind && l4.length >= 3 ? refKind : null,
    label: t.merchant || t.description || null, sample_txn: t.id, source: 'event_map' };
}

router.post('/:id/occurrences/:period', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id; const b = req.body || {};
    const e = await ownEvent(uid, req.params.id);
    const period = req.params.period;
    if (!e || !isDate(period)) return res.status(404).json({ error: 'Not found' });
    if (b.category_id && !e.category_id) { e.category_id = str(b.category_id, 80); await supabase.from('recurring_events').update({ category_id: e.category_id }).eq('id', e.id); }
    const { data: old } = await supabase.from('event_payments').select('txn_ref').eq('event_id', e.id).eq('period', period).maybeSingle();
    if (b.action === 'skip' || b.action === 'done') {
      await supabase.from('event_payments').delete().eq('event_id', e.id).eq('period', period);
      await supabase.from('event_payments').insert({ owner_id: uid, event_id: e.id, period, status: b.action === 'skip' ? 'skipped' : 'paid', amount: b.action === 'done' ? num(b.amount || e.amount) : null,
        paid_on: b.action === 'done' ? (isDate(b.paid_on) ? b.paid_on : EM.todayStr()) : null, match_source: 'marked' });
      if (old?.txn_ref) await supabase.from('expense_transactions').update({ event_id: null }).eq('id', old.txn_ref).eq('user_id', uid);
      return res.json({ ok: true });
    }
    if (b.action !== 'match' || !isUuid(b.txn_id)) return res.status(400).json({ error: 'Pick a payment' });
    if (!e.category_id) return res.status(400).json({ error: 'Pick a category for this event first. The SMS rule made from this payment files it there.', need: 'category' });
    const { data: t } = await supabase.from('expense_transactions').select(TXN_COLS).eq('id', b.txn_id).eq('user_id', uid).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Payment not found' });
    // The payment can settle only one due date
    await supabase.from('event_payments').delete().eq('txn_ref', t.id);
    await supabase.from('event_payments').delete().eq('event_id', e.id).eq('period', period);
    const paidOn = EM.istDay(t.date_time);
    const d = EM.diffDays(paidOn, period), buf = EM.bufferOf(e);
    const { error } = await supabase.from('event_payments').insert({ owner_id: uid, event_id: e.id, period, status: 'paid', amount: num(t.amount), paid_on: paidOn, txn_ref: t.id,
      match_source: 'manual', timing: Math.abs(d) <= buf ? 'on_time' : d < 0 ? 'early' : 'late' });
    if (error) throw error;
    const patch = { event_id: e.id, event_skip: (Array.isArray(t.event_skip) ? t.event_skip : []).filter(x => x !== e.id) };
    if (e.master_table === 'money_masters' && isUuid(e.master_id)) patch.master_id = e.master_id;
    if (!t.category_id || ['other', 'uncategorized', 'nach'].includes(t.category_id)) patch.category_id = e.category_id;
    await supabase.from('expense_transactions').update(patch).eq('id', t.id).eq('user_id', uid);
    if (old?.txn_ref && old.txn_ref !== t.id) await supabase.from('expense_transactions').update({ event_id: null }).eq('id', old.txn_ref).eq('user_id', uid);
    // A payment mapped to an event is always a rule too (unless one of the event's rules already catches it)
    let rule = null;
    if (b.make_rule !== false) {
      const { data: rules } = await supabase.from('user_sms_rules').select('*').eq('user_id', uid).eq('event_id', e.id).eq('is_deleted', false);
      const catching = (rules || []).find(r => EM.ruleScore(r, t) > 0);
      if (catching) rule = { id: catching.id, existing: true };
      else {
        const r = ruleFromTxn(e, t);
        const same = (rules || []).find(x => x.sender_key === r.sender_key && JSON.stringify(x.pattern_tok || null) === JSON.stringify(r.pattern_tok || null));
        if (same) {                                                   // same sender and words: widen its amount range
          const lo = same.amount_min == null || r.amount_min == null ? null : Math.min(num(same.amount_min), r.amount_min);
          const hi = same.amount_max == null || r.amount_max == null ? null : Math.max(num(same.amount_max), r.amount_max);
          await supabase.from('user_sms_rules').update({ amount_min: lo, amount_max: hi, updated_at: Date.now() }).eq('id', same.id);
          rule = { id: same.id, widened: true };
        } else if (r.sender_key || r.pattern_tok) {
          const { data } = await supabase.from('user_sms_rules').insert({ ...r, user_id: uid, user_confirmed: true, is_deleted: false, match_count: 1, updated_at: Date.now() }).select('id').single();
          rule = data ? { id: data.id, created: true } : null;
        }
      }
    }
    require('./masters').linkActuals(uid, { force: true }).catch(() => {});
    res.json({ ok: true, rule });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/occurrences/:period', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const e = await ownEvent(uid, req.params.id);
    if (!e || !isDate(req.params.period)) return res.status(404).json({ error: 'Not found' });
    const { data: p } = await supabase.from('event_payments').select('txn_ref').eq('event_id', e.id).eq('period', req.params.period).maybeSingle();
    await supabase.from('event_payments').delete().eq('event_id', e.id).eq('period', req.params.period);
    if (isUuid(p?.txn_ref)) {
      const { data: t } = await supabase.from('expense_transactions').select('id, event_skip, master_id').eq('id', p.txn_ref).eq('user_id', uid).maybeSingle();
      if (t) {
        const skip = Array.from(new Set([...(Array.isArray(t.event_skip) ? t.event_skip : []), e.id]));
        const patch = { event_id: null, event_skip: skip };
        if (e.master_id && t.master_id === e.master_id) patch.master_id = null;
        await supabase.from('expense_transactions').update(patch).eq('id', t.id).eq('user_id', uid);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
