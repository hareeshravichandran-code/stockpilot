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

const KINDS = ['loan', 'card', 'bank_account', 'sip', 'subscription', 'income', 'expense', 'rd', 'insurance', 'epf'];
const SUBTYPES = { income: ['salary', 'dividend', 'rental', 'interest', 'freelance', 'other'], expense: ['rent', 'school_fee', 'maid', 'utility', 'other'] };
const FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'once', 'irregular'];
const EVENT_FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'once'];
const EVENT_KINDS = ['emi', 'sip', 'card_due', 'premium', 'subscription', 'rd_instalment', 'salary', 'bill', 'maturity', 'rent', 'income', 'dividend', 'school_fee', 'other'];
const { alertOf, levelOf, LEVELS, RANK } = require('../services/alerts');
const POLICY_KINDS = ['term', 'life', 'health', 'vehicle', 'home', 'accident', 'travel', 'other'];
const STEP = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const str = (v, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const int = (v, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const ymd = (d) => d.toISOString().slice(0, 10);

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

const cleanSubtype = (f) => { const st = f.subtype ?? f.meta?.subtype; return (SUBTYPES[f.kind] || []).includes(st) ? st : null; };
function cleanMatch(m) {
  if (!m || typeof m !== 'object') return {};
  const kw = (Array.isArray(m.keywords) ? m.keywords : String(m.keywords || '').split(','))
    .map(k => String(k).toLowerCase().trim()).filter(k => k.length >= 3).slice(0, 8);
  return { keywords: kw, any_amount: !!m.any_amount, ...(str(m.sender, 20) ? { sender: str(m.sender, 20).toUpperCase() } : {}) };
}

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
// ── SIP ↔ mutual fund folio ─────────────────────────────────────────
const FUND_STOP = new Set(['fund', 'plan', 'direct', 'regular', 'growth', 'option', 'idcw', 'dividend', 'mutual', 'the', 'and', 'india',
  'scheme', 'reinvestment', 'payout', 'sip', 'ltd', 'limited', 'asset', 'management', 'company', 'amc']);
const fundWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !FUND_STOP.has(w));
function folioScore(m, h) {
  const rk = m.ref_key, fol = String(h.folio_number || '').replace(/\D/g, '');
  if (rk && rk.length >= 2 && fol && fol.endsWith(rk)) return 10;
  const want = new Set([...fundWords(m.title), ...fundWords(m.institution)]);
  return [...new Set(fundWords(`${h.fund_name || ''} ${h.fund_house || ''}`))].filter(w => want.has(w)).length;
}
const monthlyOf = (amount, freq) => num(amount) / ({ quarterly: 3, half_yearly: 6, yearly: 12 }[freq] || 1);

/** Tie each SIP master to its folio (by folio digits, else by fund name) when it isn't tied yet. */
async function linkFolios(uid) {
  const [{ data: ms }, { data: hs }] = await Promise.all([
    supabase.from('money_masters').select('id, title, institution, ref_key, linked_id').eq('owner_id', uid).eq('kind', 'sip').eq('status', 'active'),
    supabase.from('mf_holdings').select('id, fund_name, fund_house, folio_number').eq('user_id', uid),
  ]);
  let n = 0;
  for (const m of ms || []) {
    if (m.linked_id || !(hs || []).length) continue;
    const scored = hs.map(h => ({ h, s: folioScore(m, h) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < 2) continue;
    if (best.s < 10 && scored[1] && scored[1].s === best.s) continue;          // two funds look the same: let the user pick
    await supabase.from('money_masters').update({ linked_table: 'mf_holdings', linked_id: String(best.h.id), updated_at: nowIso() }).eq('id', m.id);
    n++;
  }
  return n;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    await linkFolios(uid).catch(() => {});
    const [m, e, p, r, f] = await Promise.all([
      supabase.from('money_masters').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('recurring_events').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('insurance_policies').select('id, kind, insurer, plan_name, policy_ref, premium, premium_frequency, renewal_date, status').eq('owner_id', uid),
      supabase.from('recurring_deposits').select('rd_id, institution_name, nickname, account_reference, monthly_installment, start_date').eq('user_id', uid),
      supabase.from('mf_holdings').select('id, fund_name, folio_number, current_value').eq('user_id', uid),
    ]);
    if (m.error) throw m.error;
    const folios = (f.data || []).map(h => ({ id: String(h.id), fund_name: h.fund_name, folio_number: h.folio_number, current_value: num(h.current_value) }));
    res.json({ masters: m.data || [], events: e.data || [], policies: p.data || [], rds: r.data || [], folios });
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
    if (!ex.subtype && cleanSubtype(f)) patch.subtype = cleanSubtype(f);
    if (Object.keys(patch).length) await supabase.from('money_masters').update({ ...patch, updated_at: nowIso() }).eq('id', ex.id);
    return { status: 'linked', table: 'money_masters', id: ex.id };
  }
  const { data, error } = await supabase.from('money_masters').insert({
    owner_id: uid, kind: f.kind, institution: str(f.institution), inst_key: iKey, ref: rKey || null, ref_key: rKey,
    title: str(f.title, 160) || str(f.institution) || f.kind, amount, frequency: freq, due_day: dueDay, due_month: dueMonth,
    start_date: start, category_id: str(f.category_id, 40), meta: typeof f.meta === 'object' && f.meta ? f.meta : {},
    subtype: cleanSubtype(f), match: cleanMatch(f.match),
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

// Bank balances read on the phone from the latest SMS of each account → the account's master (meta.balance)
router.post('/balances', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const list = (Array.isArray(req.body?.accounts) ? req.body.accounts : []).slice(0, 30);
    const { data: accts } = await supabase.from('money_masters').select('id, institution, inst_key, ref_key, meta').eq('owner_id', uid).eq('kind', 'bank_account');
    let updated = 0, created = 0;
    for (const a of list) {
      const bal = num(a.balance); const rk = refKey(a.last4); const ik = instKey(a.bank);
      if (bal == null || !rk || !isDate(a.as_of)) continue;
      const hit = (accts || []).find(m => refMatch(m.ref_key, rk) && (!ik || !m.inst_key || m.inst_key.startsWith(ik.slice(0, 4)) || ik.startsWith((m.inst_key || '').slice(0, 4))));
      if (hit) {
        if (hit.meta?.balance_at && hit.meta.balance_at > a.as_of) continue;           // keep the newer reading
        await supabase.from('money_masters').update({ meta: { ...(hit.meta || {}), balance: bal, balance_at: a.as_of }, updated_at: nowIso() }).eq('id', hit.id);
        updated++;
      } else {
        const { error } = await supabase.from('money_masters').insert({ owner_id: uid, kind: 'bank_account', institution: str(a.bank), inst_key: ik, ref: rk, ref_key: rk,
          title: `${str(a.bank) || 'Bank'} ••${rk}`, frequency: 'irregular', meta: { balance: bal, balance_at: a.as_of }, source: 'sms_balance', status: 'active' });
        if (!error) created++;
      }
    }
    res.json({ ok: true, updated, created });
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

// ════════════════════════════════════════════════════════════════════
// Manual masters, actuals (transactions linked to a master), month view
// ════════════════════════════════════════════════════════════════════

/** Which calendar event a master gets by default. */
function defaultEvent(m) {
  const k = m.kind, st = m.subtype;
  const kind = { loan: 'emi', card: 'card_due', sip: 'sip', rd: 'rd_instalment', subscription: 'subscription' }[k]
    || (k === 'income' ? (st === 'salary' ? 'salary' : st === 'dividend' ? 'dividend' : 'income') : null)
    || (k === 'expense' ? (st === 'rent' ? 'rent' : 'bill') : null);
  if (!kind) return null;
  return {
    kind, title: m.title, amount: m.amount, frequency: m.frequency === 'irregular' ? 'monthly' : (m.frequency || 'monthly'),
    due_day: m.due_day, due_month: m.due_month, start_date: m.start_date, direction: k === 'income' ? 'in' : 'out',
  };
}

const NON_SPEND = ['p_transfer', 'cc_bill', 'self_transfer'];
const { txnText, has: hasSig } = require('../services/privacy');

/** Does this bank transaction belong to this master? Keywords win; otherwise kind-specific defaults. */
function matches(m, t) {
  const text = txnText(t);
  const wantIn = m.kind === 'income';
  if ((t.type === 'CREDIT') !== wantIn) return false;
  const kw = (m.match && Array.isArray(m.match.keywords)) ? m.match.keywords : [];
  const amtOk = () => m.match?.any_amount || !num(m.amount) || Math.abs(num(t.amount) - num(m.amount)) <= Math.max(2, num(m.amount) * 0.15);
  if (m.match?.sender && t.sms_sender && !String(t.sms_sender).toUpperCase().includes(m.match.sender)) return false;
  const tokSet = new Set(Array.isArray(t.merchant_tok) ? t.merchant_tok : []);
  const kwTok = Array.isArray(m.match?.keyword_tok) ? m.match.keyword_tok : [];   // fingerprints of the keywords (encrypted accounts)
  if (kw.length || kwTok.length) return (kw.some(k => text.includes(k)) || kwTok.some(k => tokSet.has(k))) && amtOk();
  // A fixed payment with no name in its SMS (e.g. an EMI by NACH): same bank, same amount (±1%)
  if (m.meta && (m.meta.fixed === '1' || m.meta.fixed === true)) {
    const bankWords = (m.institution || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !['bank', 'ltd', 'limited', 'your'].includes(w));
    const sameBank = !bankWords.length || bankWords.some(w => String(t.bank_name || '').toLowerCase().includes(w) || String(t.sms_sender || '').toLowerCase().includes(w.slice(0, 4)));
    return sameBank && num(m.amount) > 0 && Math.abs(num(t.amount) - num(m.amount)) <= num(m.amount) * 0.01;
  }
  const inst = (m.institution || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !['bank', 'ltd', 'limited', 'mutual', 'fund', 'india'].includes(w));
  const sig = Array.isArray(t.signals) ? t.signals : [];
  const hasInst = inst.length && inst.some(w => text.includes(w) || sig.includes('org:' + w));
  const ref = m.ref_key && m.ref_key.length >= 2 ? m.ref_key : null;
  const hasRef = ref && (text.replace(/\D/g, ' ').split(/\s+/).some(d => d.endsWith(ref)) || String(t.account_last4 || '').endsWith(ref)
    || sig.some(s => s.startsWith('x:') && s.endsWith(ref)));
  const is = (s, rx) => hasSig(t, s, rx);
  switch (m.kind) {
    case 'loan': return (is('emi', /\bemi\b/) || is('loan', /\bloan\b/)) && !is('card', /credit\s*card/) && (hasRef || hasInst) && amtOk();
    case 'card': return is('card', /credit\s*card|\bcc\b/) && is('bill', /payment|towards|bill/) && !!hasRef;
    case 'sip': return (is('sip', /\bsip\b/) || is('mutual', /mutual|\bmf\b/) || is('nach', /nach/) || is('units', /units/)) && (hasRef || hasInst) && amtOk();
    case 'rd': return is('rd', /\brd\b|recurring/) && (hasRef || hasInst) && amtOk();
    case 'subscription': return !!hasInst && amtOk();
    case 'income':
      if (m.subtype === 'salary') return (is('salary', /salary|\bsal\b|payroll/) || hasInst) && amtOk();
      if (m.subtype === 'dividend') return is('dividend', /div|dividend/) && (hasInst || !inst.length);
      return !!hasInst && amtOk();
    case 'expense': return !!hasInst && amtOk();
    default: return false;
  }
}

/** Nearest expected date of an event to a given day (for marking that period paid). */
function nearestPeriod(e, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = Math.min(28, e.due_day || d.getUTCDate());
  const cands = [];
  if ((e.frequency || 'monthly') === 'monthly') {
    for (const k of [-1, 0, 1]) cands.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, day)));
  } else {
    const m = (e.due_month || d.getUTCMonth() + 1) - 1;
    for (const k of [-1, 0, 1]) cands.push(new Date(Date.UTC(d.getUTCFullYear() + k, m, day)));
  }
  cands.sort((a, b) => Math.abs(a - d) - Math.abs(b - d));
  const best = cands[0];
  const limit = (e.frequency || 'monthly') === 'monthly' ? 15 : 45;
  return Math.abs(best - d) <= limit * 86400000 ? best.toISOString().slice(0, 10) : null;
}

const lastRun = new Map();
/** Links unlinked transactions to masters and marks their event periods paid. Cheap enough to run on demand. */
async function linkActuals(uid, { force = false } = {}) {
  if (!force && Date.now() - (lastRun.get(uid) || 0) < 10 * 60 * 1000) return { skipped: true };
  lastRun.set(uid, Date.now());
  const since = Date.now() - 400 * 86400000;
  const [{ data: masters }, { data: events }, { data: txns }] = await Promise.all([
    supabase.from('money_masters').select('*').eq('owner_id', uid).eq('status', 'active'),
    supabase.from('recurring_events').select('*').eq('owner_id', uid).eq('master_table', 'money_masters'),
    supabase.from('expense_transactions').select('id, amount, type, merchant, description, sms_body, sms_sender, bank_name, account_last4, date_time, category_id, master_id, signals, merchant_tok')
      .eq('user_id', uid).eq('is_deleted', false).gte('date_time', since).order('date_time', { ascending: true }).range(0, 4999),
  ]);
  const ms = (masters || []).filter(m => m.kind !== 'bank_account');
  const byMaster = {};
  let linked = 0, paid = 0;
  for (const t of txns || []) {
    let m = t.master_id ? ms.find(x => x.id === t.master_id) : null;
    if (!t.master_id) {
      m = ms.find(x => matches(x, t));
      if (m) { (byMaster[m.id] = byMaster[m.id] || []).push(t.id); linked++; }
    }
    if (!m) continue;
    const ev = (events || []).find(e => e.master_id === m.id);
    if (!ev) continue;
    const date = new Date(Number(t.date_time)).toISOString().slice(0, 10);
    const period = nearestPeriod(ev, date);
    if (period) {
      const { data } = await supabase.from('event_payments').upsert({ owner_id: uid, event_id: ev.id, period, status: 'paid', amount: num(t.amount), paid_on: date, txn_ref: t.id },
        { onConflict: 'event_id,period', ignoreDuplicates: true }).select('id');
      paid += (data || []).length;
    }
  }
  for (const [mid, ids] of Object.entries(byMaster)) {
    for (let i = 0; i < ids.length; i += 200) await supabase.from('expense_transactions').update({ master_id: mid }).in('id', ids.slice(i, i + 200)).is('master_id', null);
  }
  return { linked, paid };
}

async function syncEvent(uid, m) {
  const ev = defaultEvent(m);
  if (!ev) return null;
  const { data: ex } = await supabase.from('recurring_events').select('id').eq('owner_id', uid).eq('master_table', 'money_masters').eq('master_id', m.id).maybeSingle();
  if (ex) {
    await supabase.from('recurring_events').update({ title: ev.title, amount: num(ev.amount), frequency: EVENT_FREQS.includes(ev.frequency) ? ev.frequency : 'monthly',
      due_day: ev.due_day, due_month: ev.due_month, status: m.status === 'closed' ? 'closed' : 'active', updated_at: nowIso() }).eq('id', ex.id);
    return ex.id;
  }
  const r = await upsertEvent(uid, { table: 'money_masters', id: m.id }, ev);
  return r.id;
}

// Manual create: master + its event, then link past actuals
router.post('/', requireAuth, async (req, res) => {
  try {
    const f = { ...req.body, source: 'manual' };
    if (!KINDS.includes(f.kind) || f.kind === 'insurance') return res.status(400).json({ error: 'Pick a master type (insurance is added under Family)' });
    if (!str(f.title, 160) && !str(f.institution)) return res.status(400).json({ error: 'Give it a name' });
    const r = await upsertMaster(req.user.id, f);
    const { data: m } = await supabase.from('money_masters').select('*').eq('id', r.id).maybeSingle();
    if (m && r.status === 'linked') {
      // Existing master: apply what the user typed
      const patch = {};
      for (const k of ['title', 'amount', 'frequency', 'due_day', 'due_month', 'category_id']) if (f[k] != null && f[k] !== '') patch[k] = k === 'amount' ? num(f[k]) : f[k];
      if (f.match) patch.match = cleanMatch(f.match);
      if (Object.keys(patch).length) await supabase.from('money_masters').update({ ...patch, updated_at: nowIso() }).eq('id', m.id);
    }
    const { data: fresh } = await supabase.from('money_masters').select('*').eq('id', r.id).maybeSingle();
    const eventId = f.event === false ? null : await syncEvent(req.user.id, fresh);
    if (fresh?.kind === 'sip') {
      if (f.linked_id) await supabase.from('mf_holdings').select('id').eq('id', f.linked_id).eq('user_id', req.user.id).maybeSingle()
        .then(({ data: h }) => h && supabase.from('money_masters').update({ linked_table: 'mf_holdings', linked_id: String(h.id) }).eq('id', fresh.id));
      else await linkFolios(req.user.id).catch(() => {});
    }
    const { data: latest } = await supabase.from('money_masters').select('*').eq('id', r.id).maybeSingle();
    const link = await linkActuals(req.user.id, { force: true });
    res.json({ master: latest || fresh, status: r.status, event_id: eventId, ...link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id, b = req.body || {};
    const { data: m } = await supabase.from('money_masters').select('*').eq('id', req.params.id).eq('owner_id', uid).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Not found' });
    const patch = { updated_at: nowIso() };
    if (str(b.title, 160)) patch.title = str(b.title, 160);
    if (b.institution !== undefined) patch.institution = str(b.institution);
    if (b.amount !== undefined) patch.amount = num(b.amount);
    if (FREQS.includes(b.frequency)) patch.frequency = b.frequency;
    if (b.due_day !== undefined) patch.due_day = int(b.due_day, 1, 31);
    if (b.due_month !== undefined) patch.due_month = int(b.due_month, 1, 12);
    if (b.category_id !== undefined) patch.category_id = str(b.category_id, 40);
    if (b.subtype !== undefined) patch.subtype = cleanSubtype({ kind: m.kind, subtype: b.subtype });
    if (b.match !== undefined) patch.match = cleanMatch(b.match);
    if (['active', 'closed'].includes(b.status)) patch.status = b.status;
    if (b.end_date !== undefined) patch.end_date = isDate(b.end_date) ? b.end_date : null;
    if (b.linked_id !== undefined && m.kind === 'sip') {
      if (!b.linked_id) { patch.linked_table = null; patch.linked_id = null; }
      else {
        const { data: h } = await supabase.from('mf_holdings').select('id').eq('id', b.linked_id).eq('user_id', uid).maybeSingle();
        if (!h) return res.status(400).json({ error: 'That folio was not found in your mutual funds' });
        patch.linked_table = 'mf_holdings'; patch.linked_id = String(h.id);
      }
    }
    const { data: fresh, error } = await supabase.from('money_masters').update(patch).eq('id', m.id).select().single();
    if (error) throw error;
    await syncEvent(uid, fresh);
    const link = await linkActuals(uid, { force: true });
    res.json({ master: fresh, ...link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// One master with its event, linked actuals and paid periods
router.get('/:id/detail', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: m } = await supabase.from('money_masters').select('*').eq('id', req.params.id).eq('owner_id', uid).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Not found' });
    const [{ data: ev }, { data: tx }] = await Promise.all([
      supabase.from('recurring_events').select('*').eq('owner_id', uid).eq('master_table', 'money_masters').eq('master_id', m.id).maybeSingle(),
      supabase.from('expense_transactions').select('id, amount, type, merchant, description, date_time, category_id')
        .eq('user_id', uid).eq('master_id', m.id).eq('is_deleted', false).order('date_time', { ascending: false }).range(0, 23),
    ]);
    let payments = [];
    if (ev) ({ data: payments } = await supabase.from('event_payments').select('period, status, amount, paid_on').eq('event_id', ev.id).order('period', { ascending: false }).range(0, 23));
    res.json({ master: m, event: ev || null, actuals: tx || [], payments: payments || [],
      next_due: ev ? nextDue(ev.frequency, ev.due_day, ev.due_month, ev.start_date) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manually tie a transaction (from an SMS) to a master, or untie it
router.post('/:id/link', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: m } = await supabase.from('money_masters').select('id').eq('id', req.params.id).eq('owner_id', uid).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Not found' });
    const ids = (Array.isArray(req.body?.txn_ids) ? req.body.txn_ids : [req.body?.txn_id]).filter(Boolean).slice(0, 200);
    if (!ids.length) return res.status(400).json({ error: 'txn_id required' });
    await supabase.from('expense_transactions').update({ master_id: m.id }).eq('user_id', uid).in('id', ids);
    const link = await linkActuals(uid, { force: true });
    res.json({ ok: true, ...link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/:id/link/:txnId', requireAuth, async (req, res) => {
  try {
    await supabase.from('expense_transactions').update({ master_id: null }).eq('user_id', req.user.id).eq('id', req.params.txnId).eq('master_id', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/link-run', requireAuth, async (req, res) => {
  try { res.json(await linkActuals(req.user.id, { force: true })); } catch (err) { res.status(500).json({ error: err.message }); }
});

// SMS the user wants Kanalyst to learn from (masked on the phone)
router.post('/sms-samples', requireAuth, async (req, res) => {
  try {
    const list = (Array.isArray(req.body?.samples) ? req.body.samples : [req.body]).slice(0, 50);
    const rows = list.filter(s => str(s?.body_masked, 1000)).map(s => ({
      owner_id: req.user.id, sender: str(s.sender, 20), body_masked: str(s.body_masked, 1000),
      parsed: typeof s.parsed === 'object' && s.parsed ? s.parsed : {}, label: str(s.label, 40), note: str(s.note, 300),
    }));
    if (!rows.length) return res.status(400).json({ error: 'Nothing to send' });
    const { error } = await supabase.from('sms_samples').insert(rows);
    if (error) throw error;
    res.json({ ok: true, sent: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Month view: money flow (actuals) + events (expected), expected hidden once actual arrives ──
const FLOW_KIND = (t, m) => {
  if (m) return m.kind === 'income' ? (m.subtype || 'income') : m.kind === 'expense' ? (m.subtype || 'expense') : m.kind;
  const c = t.category_id || '', text = txnText(t);
  if (t.type === 'CREDIT') {
    if (c === 'salary' || /salary|payroll/.test(text)) return 'salary';
    if (/dividend|\bdiv\b/.test(text)) return 'dividend';
    if (c === 'rental_income') return 'rental';
    if (['refund', 'cashback'].includes(c) || /refund|reversal|cashback/.test(text)) return 'refund';
    return 'income';
  }
  if (['mf_sip', 'mf_lumpsum', 'elss', 'p_mf'].includes(c)) return 'sip';
  if (['rd', 'fd', 'equity', 'ipo', 'nps', 'ppf', 'digital_gold', 'sgb', 'bonds', 'p2p'].includes(c)) return 'invest';
  if (['home_loan', 'car_loan', 'personal_loan', 'edu_loan', 'p_loans', 'nach', 'cc_emi'].includes(c)) return 'loan';
  if (/insur/.test(c)) return 'insurance';
  if (['rent_house', 'p_rent'].includes(c)) return 'rent';
  return 'expense';
};
// ── Events master: every expected payment/receipt, its alert level and the master it belongs to ──
const MASTER_FOR_EVENT = { money_masters: 'master', insurance_policies: 'insurance', recurring_deposits: 'rd', manual: 'manual' };
router.get('/events/all', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [ev, ms, pol, rds, pays] = await Promise.all([
      supabase.from('recurring_events').select('*').eq('owner_id', uid).neq('status', 'deleted'),
      supabase.from('money_masters').select('id, kind, subtype, title, institution, ref, linked_table, linked_id').eq('owner_id', uid),
      supabase.from('insurance_policies').select('id, kind, insurer, plan_name, premium, premium_frequency, renewal_date, status, alert_level').eq('owner_id', uid),
      supabase.from('recurring_deposits').select('rd_id, institution_name, nickname, monthly_installment, start_date').eq('user_id', uid),
      supabase.from('event_payments').select('event_id, period, status').eq('owner_id', uid).order('period', { ascending: false }).limit(500),
    ]);
    const mById = Object.fromEntries((ms.data || []).map(m => [m.id, m]));
    const lastPaid = {};
    for (const p of pays.data || []) if (p.status === 'paid' && !lastPaid[p.event_id]) lastPaid[p.event_id] = p.period;
    const today = todayStr();
    const out = [];
    const add = (o) => {
      // Already paid for this period: the next one is due a step later
      if (o.next_due && o.last_paid && Math.abs(Date.parse(o.next_due) - Date.parse(o.last_paid)) <= 6 * 86400000 && o.frequency !== 'once') {
        const d = new Date(o.next_due + 'T00:00:00Z');
        o.next_due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (STEP[o.frequency] || 1), d.getUTCDate())).toISOString().slice(0, 10);
        o.paid_this_period = true;
      }
      const next = o.next_due;
      const days = next ? Math.round((Date.parse(next) - Date.parse(today)) / 86400000) : null;
      const a = alertOf(o.kind, o.alert_level, days ?? 999, false);
      out.push({ ...o, days, level: a.level, default_level: levelOf(o.kind, null), blink: a.blink });
    };
    for (const e of ev.data || []) {
      if (e.master_table === 'insurance_policies' || e.master_table === 'recurring_deposits') continue;  // listed from their own tables below
      const m = e.master_table === 'money_masters' ? mById[e.master_id] : null;
      add({ id: e.id, source: e.master_table === 'manual' ? 'manual' : 'event', kind: e.kind, title: e.title, amount: num(e.amount),
        frequency: e.frequency, due_day: e.due_day, due_month: e.due_month, direction: e.direction, status: e.status,
        alert_level: e.alert_level, notes: e.notes || null, last_paid: lastPaid[e.id] || null,
        next_due: e.status === 'active' ? (e.frequency === 'once' ? (e.end_date || e.start_date) : nextDue(e.frequency, e.due_day, e.due_month, e.start_date)) : null,
        linked: m ? { type: m.kind, subtype: m.subtype, id: m.id, title: m.title, institution: m.institution, ref: m.ref, folio: m.linked_table === 'mf_holdings' ? m.linked_id : null }
          : e.master_table === 'manual' && e.master_id && mById[e.master_id] ? { type: mById[e.master_id].kind, id: e.master_id, title: mById[e.master_id].title } : null });
    }
    for (const p of pol.data || []) {
      if (p.status && p.status !== 'active') continue;
      const freq = { monthly: 'monthly', quarterly: 'quarterly', half_yearly: 'half_yearly', yearly: 'yearly', annual: 'yearly', single: 'once' }[p.premium_frequency] || 'yearly';
      const r = p.renewal_date;
      add({ id: 'policy:' + p.id, policy_id: p.id, source: 'insurance', kind: 'premium', title: `${p.plan_name || p.insurer || p.kind} premium`, amount: num(p.premium),
        frequency: freq, due_day: r ? +r.slice(8, 10) : null, due_month: r ? +r.slice(5, 7) : null, direction: 'out', status: 'active',
        alert_level: p.alert_level, next_due: r ? (r >= today ? r : nextDue(freq, +r.slice(8, 10), +r.slice(5, 7), r)) : null,
        linked: { type: 'insurance', subtype: p.kind, id: p.id, title: p.plan_name || p.insurer, institution: p.insurer } });
    }
    for (const r of rds.data || []) {
      if (!num(r.monthly_installment)) continue;
      add({ id: 'rd:' + r.rd_id, source: 'rd', kind: 'rd_instalment', title: `${r.nickname || r.institution_name || 'RD'} instalment`, amount: num(r.monthly_installment),
        frequency: 'monthly', due_day: r.start_date ? +r.start_date.slice(8, 10) : null, direction: 'out', status: 'active', alert_level: null,
        next_due: nextDue('monthly', null, null, r.start_date), linked: { type: 'rd', id: r.rd_id, title: r.nickname || r.institution_name, institution: r.institution_name } });
    }
    out.sort((a, b) => (RANK[a.level] - RANK[b.level]) || String(a.next_due || '9').localeCompare(String(b.next_due || '9')));
    res.json({ events: out, levels: LEVELS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual event (rent, school fee, a reminder...) with its own alert level; optionally tied to a master
router.post('/events', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = str(b.title, 120);
    if (!title) return res.status(400).json({ error: 'Give the event a name' });
    const freq = EVENT_FREQS.includes(b.frequency) ? b.frequency : 'monthly';
    const kind = EVENT_KINDS.includes(b.kind) ? b.kind : 'other';
    const day = num(b.due_day), mon = num(b.due_month);
    if (freq !== 'once' && !(day >= 1 && day <= 31)) return res.status(400).json({ error: 'Pick the day it is due (1–31)' });
    if (freq === 'once' && !isDate(b.date)) return res.status(400).json({ error: 'Pick the date' });
    let masterId = null;
    if (b.master_id) {
      const { data: m } = await supabase.from('money_masters').select('id').eq('id', b.master_id).eq('owner_id', req.user.id).maybeSingle();
      masterId = m?.id || null;
    }
    const row = {
      owner_id: req.user.id, master_table: 'manual', master_id: masterId || `m-${Date.now()}`, kind, title, amount: num(b.amount),
      frequency: freq, due_day: freq === 'once' ? +b.date.slice(8, 10) : Math.min(31, day), due_month: freq === 'once' ? +b.date.slice(5, 7) : (freq === 'monthly' ? null : mon),
      start_date: freq === 'once' ? b.date : (isDate(b.start_date) ? b.start_date : todayStr()), end_date: freq === 'once' ? b.date : null,
      direction: b.direction === 'in' ? 'in' : 'out', source: 'manual', status: 'active',
      alert_level: LEVELS.includes(b.alert_level) ? b.alert_level : null, notes: str(b.notes, 400),
    };
    const { data, error } = await supabase.from('recurring_events').insert(row).select().single();
    if (error) throw error;
    res.json({ event: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/events/:id', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const id = req.params.id;
    if (id.startsWith('policy:')) {
      const { error } = await supabase.from('insurance_policies').update({ alert_level: LEVELS.includes(b.alert_level) ? b.alert_level : null })
        .eq('id', id.slice(7)).eq('owner_id', req.user.id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    const { data: e } = await supabase.from('recurring_events').select('*').eq('id', id).eq('owner_id', req.user.id).maybeSingle();
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const patch = { updated_at: nowIso() };
    if (b.alert_level !== undefined) patch.alert_level = LEVELS.includes(b.alert_level) ? b.alert_level : null;
    if (b.status && ['active', 'paused'].includes(b.status)) patch.status = b.status;
    if (b.notes !== undefined) patch.notes = str(b.notes, 400);
    if (e.master_table === 'manual') {                             // linked events follow their master; manual ones are edited here
      if (str(b.title)) patch.title = str(b.title, 120);
      if (b.amount !== undefined) patch.amount = num(b.amount);
      if (EVENT_FREQS.includes(b.frequency)) patch.frequency = b.frequency;
      if (num(b.due_day)) patch.due_day = Math.min(31, num(b.due_day));
      if (b.due_month !== undefined) patch.due_month = num(b.due_month);
      if (EVENT_KINDS.includes(b.kind)) patch.kind = b.kind;
    }
    const { error } = await supabase.from('recurring_events').update(patch).eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/events/:id', requireAuth, async (req, res) => {
  try {
    const { data: e } = await supabase.from('recurring_events').select('id, master_table').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
    if (!e) return res.status(404).json({ error: 'Event not found' });
    if (e.master_table !== 'manual') return res.status(400).json({ error: 'This event belongs to a master. Pause it, or close the master.' });
    await supabase.from('recurring_events').delete().eq('id', e.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const MONEY_EVENT_KINDS = ['emi', 'sip', 'card_due', 'premium', 'subscription', 'rd_instalment', 'salary', 'bill', 'maturity', 'instalment', 'rent', 'income', 'dividend', 'school_fee', 'other'];

router.get('/month', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const from = `${m}-01`;
    const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const days = Number(to.slice(8, 10));
    await linkActuals(uid).catch(() => {});
    const startMs = Date.UTC(y, mo - 1, 1) - 330 * 60000, endMs = Date.UTC(y, mo, 1) - 330 * 60000;   // IST month
    const { buildCalendar } = require('./household');
    const [{ data: txns }, { data: masters }, cal, { data: divs }] = await Promise.all([
      supabase.from('expense_transactions').select('id, amount, type, merchant, description, sms_body, date_time, category_id, master_id, signals, merchant_tok')
        .eq('user_id', uid).eq('is_deleted', false).gte('date_time', startMs).lt('date_time', endMs).order('date_time', { ascending: true }).range(0, 2999),
      supabase.from('money_masters').select('id, kind, subtype, title').eq('owner_id', uid),
      buildCalendar(uid, from, to),
      supabase.from('dividend_income').select('id, symbol, company, ex_date, total_dividend').eq('user_id', uid).gte('ex_date', ymd(new Date(Date.UTC(y, mo - 2, 1)))).lte('ex_date', to),
    ]);
    const mById = Object.fromEntries((masters || []).map(x => [x.id, x]));
    const istDate = (ms) => new Date(Number(ms) + 330 * 60000).toISOString().slice(0, 10);
    const flow = (txns || []).filter(t => !NON_SPEND.includes(t.category_id)).map(t => {
      const mm = t.master_id ? mById[t.master_id] : null;
      return { id: t.id, date: istDate(t.date_time), dir: t.type === 'CREDIT' ? 'in' : 'out', amount: num(t.amount),
        title: (t.merchant || t.description || 'Transaction').slice(0, 60), kind: FLOW_KIND(t, mm), category_id: t.category_id,
        master_id: t.master_id || null, master_title: mm?.title || null };
    });
    // Dividends: the announcement (ex/record date) is the event; the credit is the actual
    const credits = (txns || []).filter(t => t.type === 'CREDIT');
    const events = [];
    for (const d of divs || []) {
      const words = [d.symbol, (d.company || '').split(/\s+/)[0]].filter(w => w && w.length > 2).map(w => w.toLowerCase());
      const got = credits.find(t => /div/.test(txnText(t)) && (words.some(w => txnText(t).includes(w)) || (num(d.total_dividend) && Math.abs(num(t.amount) - num(d.total_dividend)) <= num(d.total_dividend) * 0.15)));
      if (got) { const f = flow.find(x => x.id === got.id); if (f) { f.kind = 'dividend'; f.master_title = `${d.symbol} dividend`; } continue; }
      if (req.query.dividends === '0') continue;                   // dashboard: declared dividends stay off the strip
      if (d.ex_date >= from && d.ex_date <= to) events.push({ date: d.ex_date, kind: 'dividend', title: `${d.symbol} dividend`, sub: 'Declared · not credited yet', amount: num(d.total_dividend), status: 'expected', dir: 'in', level: 'low', blink: false, declared: true });
    }
    const today = todayStr();
    for (const it of (cal.items || [])) {
      if (!MONEY_EVENT_KINDS.includes(it.kind)) continue;
      if (it.paid) continue;                                       // actual arrived: expected marker goes away
      const days = Math.round((new Date(it.date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
      const status = it.overdue ? 'overdue' : (days >= 0 && days <= 5 ? 'due_soon' : days < 0 ? 'past' : 'expected');
      const al = alertOf(it.kind, it.alert_level, days, status === 'overdue');
      events.push({ date: it.date, kind: it.kind, title: it.title, sub: it.sub || null, amount: it.amount || null, status,
        level: al.level, blink: al.blink, urgent: al.blink && al.level === 'very_high',
        dir: it.direction === 'in' || ['salary', 'income', 'dividend', 'maturity'].includes(it.kind) ? 'in' : 'out', event_id: it.event_id || null, module: it.module });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    const totals = { income: 0, expense: 0 };
    for (const f of flow) { if (f.dir === 'in') { if (f.kind !== 'refund') totals.income += f.amount || 0; } else totals.expense += f.amount || 0; }
    res.json({ month: m, from, to, days, today, flow, events, totals });
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
module.exports._test = { folioScore, monthlyOf, fundWords, instKey, refKey, refMatch, nextDue, matches, nearestPeriod, defaultEvent, FLOW_KIND };
module.exports.linkActuals = linkActuals;
module.exports.upsertMaster = upsertMaster;
module.exports.syncEvent = syncEvent;
module.exports.linkFolios = linkFolios;
