/**
 * Events and the payments that settle them — one set of rules used everywhere (phone, web, alerts).
 *
 *  Event        a recurring thing the user has to do (EMI, subscription, SIP, RD, premium, property tax...).
 *               Has a type (kind), a category, a schedule, an expected amount and a buffer (± days).
 *  Occurrence   one due date of an event ("5 Dec"). Done when a payment is tied to it, or marked by hand.
 *  SMS rule     sender + words in the message (+ amount range) -> category, optionally -> an event.
 *               A rule that points to an event always carries a category.
 *
 *  A payment is tied to an event ONLY through an SMS rule of that event (most specific rule wins), or because
 *  the user picked it (which also saves a rule). No hidden matching: every link can be seen and edited as a rule.
 *  Events that have no rule yet get rules made once (seedRules): from their master's keywords / sender, and from
 *  the payments that already settled them (same sender, same amount range). They are ordinary rules after that.
 *  and then to an occurrence:
 *    inside due ± buffer -> on time; a little before the window -> early (counts for that due date);
 *    after the window, before the next one -> late. Each occurrence takes one payment.
 *
 *  Occurrence state (what alerts show):
 *    done / skipped                         settled — never alerts
 *    upcoming     before the reminder window
 *    due          reminder window .. due + buffer        -> alert
 *    overdue      after due + buffer, before the next due -> alert
 *    missed       the next one is due; kept in history only
 *    untracked    before Kanalyst started tracking this event
 */
const supabase = require('./supabase');
const { ruleMatches, isEnc } = require('./privacy');
const { WINDOW, levelOf } = require('./alerts');
const { allRows } = require('./allRows');

const DAY = 86400000;
const STEP = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const parse = (s) => new Date(s + 'T00:00:00Z');
const ymd = (d) => d.toISOString().slice(0, 10);
const istDay = (ms) => ymd(new Date(Number(ms) + 330 * 60000));
const todayStr = () => istDay(Date.now());
const addDays = (s, n) => ymd(new Date(parse(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / DAY);
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Bank sender without the operator prefix / type suffix: "JX-ICICIT-S" -> "ICICIT". */
function senderKey(s) {
  if (!s || isEnc(s)) return null;
  const parts = String(s).toUpperCase().replace(/[^A-Z0-9-]/g, '').split('-').filter(Boolean);
  if (!parts.length) return null;
  const core = parts.length >= 2 && parts[0].length === 2 ? parts[1] : parts[0];
  return core.length >= 3 ? core : null;
}

const intervalDays = (ev) => (ev.frequency === 'once' ? 3650 : (STEP[ev.frequency] || 1) * 30);
const bufferOf = (ev) => Math.max(0, Math.min(15, ev.buffer_days == null ? 2 : Number(ev.buffer_days)));

/** Due dates of an event between from and to (inclusive). */
function periods(ev, from, to) {
  if (ev.frequency === 'once') { const d = ev.end_date || ev.start_date; return d && d >= from && d <= to ? [d] : []; }
  const step = STEP[ev.frequency] || 1;
  const dueDay = ev.due_day || (ev.start_date ? parseInt(ev.start_date.slice(8, 10), 10) : 1) || 1;
  const anchorMonth = step === 1 ? null : (ev.due_month || (ev.start_date ? parseInt(ev.start_date.slice(5, 7), 10) : 1)) - 1;
  const f = parse(from); const out = [];
  let y = f.getUTCFullYear(), m = f.getUTCMonth() - step;
  if (anchorMonth != null) { y = f.getUTCFullYear() - 1; m = anchorMonth; }
  for (let i = 0; i < 400; i++) {
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    const d = ymd(new Date(Date.UTC(yy, mm, Math.min(dueDay, lastDay(yy, mm)))));
    if (d > to) break;
    if (d >= from) out.push(d);
    m += step;
  }
  return out.filter(d => (!ev.start_date || d >= ev.start_date) && (!ev.end_date || d <= ev.end_date));
}

/** State of one occurrence. pay: its event_payments row (or null). */
function stateOf(ev, period, pay, today = todayStr()) {
  if (pay && pay.status === 'paid') return { state: 'done', alert: false, timing: pay.timing || null, paid_on: pay.paid_on || null };
  if (pay && pay.status === 'skipped') return { state: 'skipped', alert: false };
  const created = ev.created_at ? istDay(Date.parse(ev.created_at)) : '2000-01-01';
  const buffer = bufferOf(ev);
  if (period < addDays(created, -7)) return { state: 'untracked', alert: false };
  const level = levelOf(ev.kind, ev.alert_level);
  const remind = ev.remind_days != null ? Number(ev.remind_days) : Math.max(0, WINDOW[level] ?? 2);
  if (today < addDays(period, -remind)) return { state: 'upcoming', alert: false };
  if (today <= addDays(period, buffer)) return { state: 'due', alert: level !== 'low' || today >= period };
  const nextDue = addDays(period, intervalDays(ev));
  if (today < addDays(nextDue, -buffer)) return { state: 'overdue', alert: true };
  return { state: 'missed', alert: false };
}

/** The occurrence a payment on `date` settles, given the ones already settled. */
function pickPeriod(ev, date, settled) {
  const iv = intervalDays(ev), buffer = bufferOf(ev);
  const around = periods(ev, addDays(date, -iv - 10), addDays(date, iv + 10)).filter(p => !settled.has(p));
  if (!around.length) return null;
  // 1. inside the window
  const inWin = around.filter(p => Math.abs(diffDays(date, p)) <= buffer).sort((a, b) => Math.abs(diffDays(date, a)) - Math.abs(diffDays(date, b)))[0];
  if (inWin) return { period: inWin, timing: 'on_time' };
  const early = Math.min(10, Math.round(iv * 0.35));
  const next = around.filter(p => p > date).sort()[0];
  const prev = around.filter(p => p < date).sort().reverse()[0];
  // 2. a still-open due date not long ago: paid late
  if (prev && diffDays(date, prev) <= iv / 2) return { period: prev, timing: 'late' };
  // 3. paid a little early for the next one
  if (next && diffDays(next, date) <= early + buffer) return { period: next, timing: 'early' };
  // 4. paid late, before the next window opens
  if (prev && diffDays(date, prev) < iv - buffer) return { period: prev, timing: 'late' };
  return null;
}

/** Does an SMS rule catch this payment? Returns a specificity score, or 0. */
function ruleScore(rule, t) {
  if (rule.is_deleted) return 0;
  const hasPattern = !!rule.merchant_pattern || (Array.isArray(rule.pattern_tok) && rule.pattern_tok.length);
  if (!rule.sender_key && !hasPattern) return 0;
  if (rule.sender_key && senderKey(t.sms_sender) !== rule.sender_key) return 0;
  const a = num(t.amount);
  if (rule.amount_min != null && a < num(rule.amount_min) - 0.5) return 0;
  if (rule.amount_max != null && a > num(rule.amount_max) + 0.5) return 0;
  if (hasPattern && !ruleMatches(rule, t)) return 0;
  return (rule.sender_key ? 1 : 0) + (hasPattern ? 2 : 0) + (rule.amount_min != null || rule.amount_max != null ? 1 : 0);
}

/** Category an event's payments go to when the user hasn't picked one (ids from the app's category list). */
const DEFAULT_CAT = { card_due: 'cc_bill', emi: 'p_loans', subscription: 'p_membership', sip: 'mf_sip', rd_instalment: 'rd', premium: 'p_insurance',
  salary: 'salary', income: 'p_salary', bill: 'utilities', rent: 'rent_house', school_fee: 'school_fees', property_tax: 'p_home' };

/**
 * Rules for events that have none, made once per event (rules_seeded):
 *   - from the master: its keywords (or their fingerprints) and its sender
 *   - from payments already tied to the event: sender + amount range (+ payee words when every payment shares them)
 * Each becomes a normal rule (source 'from_master' / 'from_payments') the user can see, edit or delete.
 */
async function seedRules(uid, events, rules, txns, pays) {
  const has = new Set((rules || []).map(r => r.event_id));
  const todo = events.filter(e => !e.rules_seeded && !has.has(e.id));
  if (!todo.length) return [];
  const masterIds = todo.filter(e => e.master_table === 'money_masters' && e.master_id).map(e => e.master_id);
  const { data: masters } = masterIds.length ? await supabase.from('money_masters').select('id, amount, match').in('id', masterIds) : { data: [] };
  const masterOf = Object.fromEntries((masters || []).map(m => [m.id, m]));
  const byId = Object.fromEntries((txns || []).map(t => [t.id, t]));
  const made = [];
  for (const e of todo) {
    const category_id = e.category_id || DEFAULT_CAT[e.kind] || null;
    if (category_id && !e.category_id) await supabase.from('recurring_events').update({ category_id }).eq('id', e.id);
    const rows = [];
    if (category_id) {
      // From the master: payee keywords / fingerprints and sender
      const m = masterOf[e.master_id];
      const kw = (m?.match?.keywords || []).filter(k => typeof k === 'string' && k.length >= 3 && !isEnc(k));
      const tok = Array.isArray(m?.match?.keyword_tok) ? m.match.keyword_tok.filter(x => typeof x === 'string') : [];
      const amt = num(m?.amount || e.amount);
      const range = !m?.match?.any_amount && amt ? [Math.floor(amt * 0.85), Math.ceil(amt * 1.15)] : null;
      const sender = m?.match?.sender ? senderKey(m.match.sender) || m.match.sender : null;
      for (const k of kw.slice(0, 3)) rows.push({ merchant_pattern: k.toLowerCase(), pattern_tok: null, sender_key: sender, amount_min: range?.[0] ?? null, amount_max: range?.[1] ?? null, source: 'from_master', label: k });
      if (!kw.length && tok.length) rows.push({ merchant_pattern: null, pattern_tok: tok.slice(0, 6), sender_key: sender, amount_min: range?.[0] ?? null, amount_max: range?.[1] ?? null, source: 'from_master', label: null });
      // From payments already tied to it (or to its master): one rule per sender, amount range from those payments
      const paid = (pays || []).filter(p => p.event_id === e.id && p.txn_ref && byId[p.txn_ref]).map(p => byId[p.txn_ref])
        .concat((txns || []).filter(t => t.event_id === e.id || (e.master_table === 'money_masters' && e.master_id && t.master_id === e.master_id)));
      const bySender = {};
      for (const t of paid) { const k = senderKey(t.sms_sender); if (k) (bySender[k] = bySender[k] || []).push(t); }
      for (const [k, list] of Object.entries(bySender)) {
        const a = list.map(t => num(t.amount));
        const lo = Math.min(...a), hi = Math.max(...a);
        if (e.amount_mode === 'any' || hi > lo * 1.6) continue;      // a sender alone with no steady amount would catch every SMS of that bank
        const names = [...new Set(list.map(t => (t.merchant && !isEnc(t.merchant) ? String(t.merchant).toLowerCase().trim() : '')))];
        const word = names.length === 1 && names[0].length >= 3 ? names[0].slice(0, 60) : null;
        if (rows.some(r => r.sender_key === k && r.amount_min != null && r.amount_min <= lo && r.amount_max >= hi)) continue;
        rows.push({ merchant_pattern: word, pattern_tok: null, sender_key: k, amount_min: Math.floor(lo * 0.95), amount_max: Math.ceil(hi * 1.05), source: 'from_payments', label: null });
      }
    }
    for (const r of rows) {
      const row = { ...r, user_id: uid, event_id: e.id, category_id, user_confirmed: true, is_deleted: false, match_count: 1, updated_at: Date.now(), created_at: Date.now() };
      if (row.merchant_pattern) {
        // A pattern can belong to one rule only: an existing category-only rule for it becomes this event's rule
        const { data: ex } = await supabase.from('user_sms_rules').select('id, event_id').eq('user_id', uid).eq('merchant_pattern', row.merchant_pattern).maybeSingle();
        if (ex) {
          if (ex.event_id && ex.event_id !== e.id) continue;
          const { data } = await supabase.from('user_sms_rules').update({ ...row, created_at: undefined, is_deleted: false }).eq('id', ex.id).select('*').single();
          if (data) made.push(data);
          continue;
        }
      }
      const { data } = await supabase.from('user_sms_rules').insert(row).select('*').single();
      if (data) made.push(data);
    }
    if (!category_id) continue;                                   // made once the user picks a category
    await supabase.from('recurring_events').update({ rules_seeded: true }).eq('id', e.id);
    e.rules_seeded = true;
    if (category_id) e.category_id = category_id;
  }
  return made;
}

const lastRun = new Map();
/**
 * Tie the user's payments to their events and occurrences. Safe to call often (throttled).
 * matchesMaster(master, txn) is the masters module's matcher (injected to avoid a require cycle).
 */
async function runMatching(uid, { force = false, matchesMaster = null } = {}) {
  if (!force && Date.now() - (lastRun.get(uid) || 0) < 90 * 1000) return { skipped: true };
  lastRun.set(uid, Date.now());
  const since = Date.now() - 400 * DAY;
  const [{ data: evs }, { data: rules }, txns] = await Promise.all([
    supabase.from('recurring_events').select('*').eq('owner_id', uid).eq('status', 'active'),
    supabase.from('user_sms_rules').select('*').eq('user_id', uid).eq('is_deleted', false).not('event_id', 'is', null),
    allRows(() => supabase.from('expense_transactions').select('id, amount, type, merchant, description, sms_body, sms_sender, bank_name, account_last4, date_time, category_id, master_id, event_id, event_skip, signals, merchant_tok')
      .eq('user_id', uid).eq('is_deleted', false).gte('date_time', since).order('date_time', { ascending: true }).order('id', { ascending: true })),
  ]);
  const events = (evs || []).filter(e => e.frequency);
  if (!events.length) return { linked: 0 };
  const ids = events.map(e => e.id);
  const { data: pays } = await supabase.from('event_payments').select('event_id, period, status, txn_ref').in('event_id', ids).gte('period', ymd(new Date(since - 40 * DAY)));
  const masterIds = events.filter(e => e.master_table === 'money_masters' && e.master_id).map(e => e.master_id);
  const { data: masters } = masterIds.length ? await supabase.from('money_masters').select('id').in('id', masterIds).eq('status', 'active') : { data: [] };
  const masterOf = Object.fromEntries((masters || []).map(m => [m.id, m]));
  const allRules = (rules || []).concat(await seedRules(uid, events, rules, txns, pays));

  const settled = {}; const used = new Set();
  for (const p of pays || []) { (settled[p.event_id] = settled[p.event_id] || new Set()).add(p.period); if (p.txn_ref) used.add(p.txn_ref); }
  const newPays = []; const txnPatch = [];
  for (const t of txns || []) {
    if (used.has(t.id)) continue;
    if (['p_transfer', 'self_transfer'].includes(t.category_id)) continue;
    const dir = t.type === 'CREDIT' ? 'in' : 'out';
    const skip = new Set(Array.isArray(t.event_skip) ? t.event_skip : []);           // "not this event" said by the user
    const mine = events.filter(e => (e.direction === 'in' ? 'in' : 'out') === dir && !skip.has(e.id));
    if (!mine.length) continue;
    let ev = null, source = null, rule = null;
    if (t.event_id) { ev = mine.find(e => e.id === t.event_id); source = 'manual'; }
    if (!ev) {
      let best = 0;
      for (const r of allRules) { const s = ruleScore(r, t); if (s > best) { const e = mine.find(x => x.id === r.event_id); if (e) { best = s; ev = e; rule = r; } } }
      if (ev) source = 'rule';
    }
    if (!ev) continue;
    const date = istDay(t.date_time);
    const set = settled[ev.id] = settled[ev.id] || new Set();
    const pick = pickPeriod(ev, date, set);
    const patch = {};
    if (t.event_id !== ev.id) patch.event_id = ev.id;
    if (!t.master_id && ev.master_table === 'money_masters' && masterOf[ev.master_id]) patch.master_id = ev.master_id;
    const cat = (rule && rule.category_id) || ev.category_id;
    if (cat && (!t.category_id || ['other', 'uncategorized', 'nach'].includes(t.category_id)) && t.category_id !== cat) patch.category_id = cat;
    if (Object.keys(patch).length) txnPatch.push({ id: t.id, patch });
    if (!pick) continue;
    set.add(pick.period); used.add(t.id);
    newPays.push({ owner_id: uid, event_id: ev.id, period: pick.period, status: 'paid', amount: num(t.amount), paid_on: date, txn_ref: t.id, match_source: source, timing: pick.timing });
  }
  for (let i = 0; i < newPays.length; i += 200) {
    await supabase.from('event_payments').upsert(newPays.slice(i, i + 200), { onConflict: 'event_id,period', ignoreDuplicates: true });
  }
  for (const { id, patch } of txnPatch.slice(0, 600)) await supabase.from('expense_transactions').update(patch).eq('id', id).eq('user_id', uid);
  return { linked: newPays.length, tagged: txnPatch.length };
}

module.exports = { seedRules, DEFAULT_CAT, senderKey, periods, stateOf, pickPeriod, ruleScore, runMatching, intervalDays, bufferOf, todayStr, istDay, addDays, diffDays };
