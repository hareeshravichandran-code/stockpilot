/**
 * Events and the payments that settle them — one set of rules used everywhere (phone, web, alerts).
 *
 *  Event        a recurring thing the user has to do (EMI, subscription, SIP, RD, premium, property tax...).
 *               Has a type (kind), a category, a schedule, an expected amount and a buffer (± days).
 *  Occurrence   one due date of an event ("5 Dec"). Done when a payment is tied to it, or marked by hand.
 *  SMS rule     sender + words in the message (+ amount range) -> category, optionally -> an event.
 *               A rule that points to an event always carries a category.
 *
 *  A payment is tied to an event through an SMS rule of that event (most specific rule wins), because the user
 *  picked it (which also saves a rule), or - for premiums, school fees and property tax only - because its
 *  category can only mean that event (a "Health insurance" debit near the health policy's renewal). Every link
 *  shows how it was made ("by SMS rule", "by its category", "picked by you") and "Not this payment" undoes it.
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

const EARLY = { quarterly: 20, half_yearly: 30, yearly: 45 };
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
  // Renewals are often paid weeks ahead (insurers remind 30-45 days before): a wider early window for long cycles
  const early = EARLY[ev.frequency] ?? Math.min(10, Math.round(iv * 0.35));
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

/** Account / card last digits in a payment: the parsed last4, masked numbers in the text ("XX6007", "a/c ...756"), or x: signals. */
function hasAccountRef(t, ref) {
  ref = String(ref || '').replace(/\D/g, '');
  if (ref.length < 2) return false;
  if (String(t.account_last4 || '').replace(/\D/g, '').endsWith(ref)) return true;
  const sig = Array.isArray(t.signals) ? t.signals : [];
  if (sig.some(s => typeof s === 'string' && s.startsWith('x:') && s.endsWith(ref))) return true;
  const text = [t.sms_body, t.description].filter(x => typeof x === 'string' && !isEnc(x)).join(' ');
  return text.replace(/\D+/g, ' ').split(' ').some(d => d.length >= ref.length && d.length <= 20 && d.endsWith(ref));
}
// A rule on account digits alone must also see the right kind of SMS (a card-bill payment, an EMI)
const REF_WORDS = {
  card: [/credit\s*card|\bcard\b|\bcc\b/i, /payment|paid|received|towards|credited|bill/i],
  loan: [/\bemi\b|loan|instal(l)?ment|nach|repay/i],
};
function refKindOk(kind, t) {
  const words = REF_WORDS[kind]; if (!words) return true;
  const text = [t.sms_body, t.description, t.merchant].filter(x => typeof x === 'string' && !isEnc(x)).join(' ');
  const sig = (Array.isArray(t.signals) ? t.signals : []).join(' ');
  return words.every(rx => rx.test(text) || rx.test(sig));
}

/** Does an SMS rule catch this payment? Returns a specificity score, or 0. */
/** Day of month (IST) inside the rule's window. Windows can wrap the month end (28 to 5); a window past the
 *  month's last day (29-31 in February) takes the last day. No window: any day. */
function dayOk(rule, t) {
  const from = rule.day_from == null ? null : Number(rule.day_from), to = rule.day_to == null ? null : Number(rule.day_to);
  if (!from || !to) return true;
  const d = new Date(Number(t.date_time) + 330 * 60000);
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const inWin = (x) => from <= to ? (x >= from && x <= to) : (x >= from || x <= to);
  if (inWin(day)) return true;
  // the window asks for days this month does not have: its last day stands in for them
  return day === last && ((from <= to && to > last && from <= last + 3) || (from > to && from > last));
}

function ruleScore(rule, t) {
  if (rule.is_deleted) return 0;
  // Phone rules for payments without a merchant name are keyed on the account (ref_kind 'acct'): their words are a key, not SMS words
  const acct = rule.ref_kind === 'acct';
  const hasPattern = !acct && (!!rule.merchant_pattern || (Array.isArray(rule.pattern_tok) && rule.pattern_tok.length));
  const ref = rule.account_ref ? String(rule.account_ref).replace(/\D/g, '') : '';
  if (!rule.sender_key && !hasPattern && ref.length < 2) return 0;
  if (rule.sender_key && senderKey(t.sms_sender) !== rule.sender_key) return 0;
  const a = num(t.amount);
  if (rule.amount_min != null && a < num(rule.amount_min) - 0.5) return 0;
  if (rule.amount_max != null && a > num(rule.amount_max) + 0.5) return 0;
  if (!dayOk(rule, t)) return 0;
  if (hasPattern && !ruleMatches(rule, t)) return 0;
  if (ref) {
    if (!hasAccountRef(t, ref)) return 0;
    if (!rule.sender_key && !hasPattern && !refKindOk(rule.ref_kind, t)) return 0;
  }
  return (rule.sender_key ? 1 : 0) + (hasPattern ? 2 : 0) + (rule.amount_min != null || rule.amount_max != null ? 1 : 0) + (ref ? 2 : 0)
    + (rule.day_from != null && rule.day_to != null ? 1 : 0);
}

/**
 * Categories that can only be one kind of payment. A debit filed as "Health insurance" near the health policy's
 * renewal is that premium, whatever the amount (premiums change every year: age band, members, GST).
 * Only for event types whose categories are this specific; never card bills, EMIs or subscriptions.
 */
const INS_ALL = ['p_insurance', 'health_insurance', 'life_insurance', 'term_insurance', 'veh_insurance', 'vehicle_insurance', 'home_insurance', 'travel_insurance'];
const INS_BY_POLICY = { health: ['health_insurance'], life: ['life_insurance', 'term_insurance'], term: ['term_insurance', 'life_insurance'],
  vehicle: ['veh_insurance', 'vehicle_insurance'], motor: ['veh_insurance', 'vehicle_insurance'], home: ['home_insurance'], travel: ['travel_insurance'] };
const KIND_CATS = { premium: INS_ALL, school_fee: ['school_fees', 'p_education'], property_tax: ['property_tax'] };
/** [days early, days late] a payment may be from its due date to count by category. */
const CAT_WINDOW = { monthly: [7, 10], quarterly: [20, 20], half_yearly: [30, 30], yearly: [45, 30], once: [30, 30] };

/** The categories that settle this event by themselves (null: rules only). policy: its insurance_policies row, if any. */
function catFamily(ev, policy) {
  const base = KIND_CATS[ev.kind];
  if (!base) return null;
  if (ev.kind === 'premium' && policy && INS_BY_POLICY[policy.kind]) return new Set([...INS_BY_POLICY[policy.kind], 'p_insurance']);
  return new Set(base);
}

/**
 * The event a payment's category points to, or null. When two events share the category (two health policies),
 * the one whose amount is closest wins; amounts further than 0.4x - 2.5x never count.
 */
function categoryPick(t, events, fam) {
  if (!t.category_id) return null;
  const a = num(t.amount);
  let best = null, bestGap = Infinity;
  for (const e of events) {
    const f = fam[e.id];
    if (!f || !f.has(t.category_id)) continue;
    const amt = num(e.amount);
    if (amt && (a < amt * 0.4 || a > amt * 2.5)) continue;
    const gap = amt && a ? Math.abs(Math.log(a / amt)) : 1;
    if (gap < bestGap) { best = e; bestGap = gap; }
  }
  return best;
}
/** A category match must sit close to its due date (rules may settle late payments; a category alone may not). */
function inCatWindow(ev, date, period) {
  const [early, late] = CAT_WINDOW[ev.frequency] || CAT_WINDOW.monthly;
  const d = diffDays(date, period);
  return d >= -(early + bufferOf(ev)) && d <= late + bufferOf(ev);
}

/** First words of an insurer's name, as a rule's words: "Care Health Insurance Ltd" -> "care health". */
function insurerWords(name) {
  if (!name || isEnc(name)) return null;
  const w = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .filter(x => !['the', 'insurance', 'insu', 'insur', 'co', 'company', 'ltd', 'limited', 'general'].includes(x));
  const out = w.slice(0, 2).join(' ');
  return out.length >= 4 ? out : null;
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
  const { data: masters } = masterIds.length ? await supabase.from('money_masters').select('id, amount, match, ref_key').in('id', masterIds) : { data: [] };
  const masterOf = Object.fromEntries((masters || []).map(m => [m.id, m]));
  const polIds = todo.filter(e => e.master_table === 'insurance_policies' && e.master_id).map(e => e.master_id);
  const { data: pols } = polIds.length ? await supabase.from('insurance_policies').select('id, insurer, kind').in('id', polIds) : { data: [] };
  const polOf = Object.fromEntries((pols || []).map(p => [String(p.id), p]));
  const byId = Object.fromEntries((txns || []).map(t => [t.id, t]));
  // Payments tied only by their category teach no rule (their amount says nothing about next year's)
  const byCategory = new Set((pays || []).filter(p => p.match_source === 'category' && p.txn_ref).map(p => p.txn_ref));
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
      // Card bills and EMIs: the account's last digits (their amount changes every month)
      const refKind = e.kind === 'card_due' ? 'card' : e.kind === 'emi' ? 'loan' : null;
      const mref = String(m?.ref_key || '').replace(/\D/g, '');
      if (refKind && mref.length >= 2) rows.push({ merchant_pattern: null, pattern_tok: null, sender_key: sender, amount_min: null, amount_max: null,
        account_ref: mref.slice(-4), ref_kind: refKind, source: 'from_master', label: (refKind === 'card' ? 'Card ' : 'Loan ') + '\u2022\u2022' + mref.slice(-4) });
      if (!kw.length && tok.length) rows.push({ merchant_pattern: null, pattern_tok: tok.slice(0, 6), sender_key: sender, amount_min: range?.[0] ?? null, amount_max: range?.[1] ?? null, source: 'from_master', label: null });
      // An insurance policy: the insurer's name, any amount (premiums change every year)
      const pol = e.master_table === 'insurance_policies' ? polOf[String(e.master_id)] : null;
      const iw = insurerWords(pol?.insurer);
      if (iw) rows.push({ merchant_pattern: iw, pattern_tok: null, sender_key: null, amount_min: null, amount_max: null, source: 'from_master', label: pol.insurer });
      // From payments already tied to it (or to its master): one rule per sender, amount range from those payments
      let paid = (pays || []).filter(p => p.event_id === e.id && p.txn_ref && byId[p.txn_ref]).map(p => byId[p.txn_ref])
        .concat((txns || []).filter(t => t.event_id === e.id || (e.master_table === 'money_masters' && e.master_id && t.master_id === e.master_id)))
        .filter(t => !byCategory.has(t.id));
      // A loan's EMI (no master keywords): earlier debits of the EMI amount (±2%) that say EMI / loan / NACH
      if (e.kind === 'emi' && e.master_table === 'bp_buckets' && num(e.amount) && !paid.length) {
        const a0 = num(e.amount);
        paid = (txns || []).filter(t => t.type === 'DEBIT' && Math.abs(num(t.amount) - a0) <= a0 * 0.02
          && ((Array.isArray(t.signals) && t.signals.some(s => ['emi', 'loan', 'nach'].includes(s))) || /\b(emi|loan|nach|ach|ecs)\b/i.test(`${isEnc(t.merchant) ? '' : t.merchant || ''} ${isEnc(t.sms_body) ? '' : t.sms_body || ''} ${isEnc(t.description) ? '' : t.description || ''}`)));
      }
      const bySender = {};
      for (const t of paid) { const k = senderKey(t.sms_sender); if (k) (bySender[k] = bySender[k] || []).push(t); }
      for (const [k, list] of Object.entries(bySender)) {
        const a = list.map(t => num(t.amount));
        const lo = Math.min(...a), hi = Math.max(...a);
        if (e.amount_mode === 'any' || hi > lo * 1.6) {
          // No steady amount: only usable with the account digits every payment shares (card bills, EMIs)
          const l4 = [...new Set(list.map(t => String(t.account_last4 || '').replace(/\D/g, '').slice(-4)).filter(x => x.length >= 3))];
          if (l4.length === 1 && !rows.some(r => r.account_ref === l4[0])) rows.push({ merchant_pattern: null, pattern_tok: null, sender_key: k, amount_min: null, amount_max: null,
            account_ref: l4[0], ref_kind: e.kind === 'card_due' ? 'card' : e.kind === 'emi' ? 'loan' : null, source: 'from_payments', label: null });
          continue;                                               // a sender alone with no steady amount would catch every SMS of that bank
        }
        const names = [...new Set(list.map(t => (t.merchant && !isEnc(t.merchant) ? String(t.merchant).toLowerCase().trim() : '')))];
        const word = names.length === 1 && names[0].length >= 3 ? names[0].slice(0, 60) : null;
        // Quarterly / yearly dues: a sender + amount rule with no words would settle a late due date with any
        // payment of that size from the bank, months later. Only with the payee's words.
        if (!word && e.frequency && e.frequency !== 'monthly') continue;
        if (rows.some(r => r.sender_key === k && r.amount_min != null && r.amount_min <= lo && r.amount_max >= hi)) continue;
        rows.push({ merchant_pattern: word, pattern_tok: null, sender_key: k, amount_min: Math.floor(lo * 0.95), amount_max: Math.ceil(hi * 1.05), source: 'from_payments', label: null });
      }
    }
    let failed = 0;
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
      const { data, error } = await supabase.from('user_sms_rules').insert(row).select('*').single();
      if (data) made.push(data);
      if (error) { failed++; console.error('[events] rule not saved for event', e.id, error.message); }
    }
    // Try again next run on a failed save, or when nothing could be made yet (payments tied later teach one)
    if (!category_id || failed || !rows.length) continue;
    await supabase.from('recurring_events').update({ rules_seeded: true }).eq('id', e.id);
    e.rules_seeded = true;
    if (category_id) e.category_id = category_id;
  }
  return made;
}

const lastRun = new Map();

/**
 * Loans kept in Blueprint (EMI buckets) become events, so their EMI is settled by bank SMS, blinks when due
 * and shows in What's due like a card bill or SIP. One event per bucket (master_table 'bp_buckets').
 */
async function ensureLoanEvents(uid) {
  const { data: bks } = await supabase.from('bp_buckets').select('id, name, target_amount, recurrence, recurrence_day, target_date, status, is_emi')
    .eq('user_id', uid).eq('is_emi', true);
  const live = (bks || []).filter(b => b.status !== 'completed' && b.recurrence === 'monthly' && b.recurrence_day);
  if (!live.length) return 0;
  const { data: have } = await supabase.from('recurring_events').select('id, master_id').eq('owner_id', uid).eq('master_table', 'bp_buckets');
  const known = new Set((have || []).map(e => String(e.master_id)));
  const { lockRow } = require('./privacy');
  let made = 0;
  for (const b of live) {
    if (known.has(String(b.id))) continue;
    const title = isEnc(b.name) ? b.name : `${String(b.name || 'Loan').slice(0, 140)} EMI`;
    const row = await lockRow(uid, { owner_id: uid, master_table: 'bp_buckets', master_id: String(b.id), kind: 'emi', title, amount: num(b.target_amount) || null,
      frequency: 'monthly', due_day: Math.min(31, Math.max(1, Number(b.recurrence_day))), end_date: b.target_date && b.target_date > todayStr() ? b.target_date : null, remind_days: 3, direction: 'out',
      category_id: DEFAULT_CAT.emi, amount_mode: 'about', source: 'loan', status: 'active' }, { texts: ['title', 'notes'] });
    const { error } = await supabase.from('recurring_events').insert(row);
    if (!error) made++;
  }
  return made;
}
/**
 * Paid due dates whose payment row no longer exists (the SMS were read again and the payment got a new id):
 * point them at the same payment (same direction, same amount, same day) so its history and rules still work.
 */
async function repairRefs(uid, events, pays, txns, since) {
  const ids = new Set(txns.map(t => t.id));
  const taken = new Set(pays.map(p => p.txn_ref).filter(Boolean));
  const evOf = Object.fromEntries(events.map(e => [e.id, e]));
  const sinceDay = istDay(since);
  let n = 0;
  for (const p of pays) {
    if (p.status !== 'paid' || !p.txn_ref || ids.has(p.txn_ref) || !p.paid_on || p.paid_on < sinceDay || !num(p.amount)) continue;
    const ev = evOf[p.event_id]; if (!ev) continue;
    const type = ev.direction === 'in' ? 'CREDIT' : 'DEBIT';
    const hits = txns.filter(t => !taken.has(t.id) && t.type === type && Math.abs(num(t.amount) - num(p.amount)) <= 1 && Math.abs(diffDays(istDay(t.date_time), p.paid_on)) <= 1);
    if (hits.length !== 1) continue;                                // only when it can only be that one
    const t = hits[0];
    const { error } = await supabase.from('event_payments').update({ txn_ref: t.id }).eq('event_id', p.event_id).eq('period', p.period);
    if (error) continue;
    taken.add(t.id); p.txn_ref = t.id;
    if (!t.event_id) { await supabase.from('expense_transactions').update({ event_id: ev.id }).eq('id', t.id).eq('user_id', uid); t.event_id = ev.id; }
    n++;
  }
  return n;
}

/**
 * Insurance policies become premium events, so their renewal reminds you and the premium SMS settles it.
 * Policies saved by SMS setup or on the Insurance page had none (only Discover made them). One per policy;
 * a policy from the same insurer due within 10 days of an existing premium event is taken as the same policy.
 */
const POLICY_FREQ = { monthly: 'monthly', quarterly: 'quarterly', half_yearly: 'half_yearly', yearly: 'yearly', single: null };
async function ensurePolicyEvents(uid) {
  const { data: pols } = await supabase.from('insurance_policies').select('id, kind, insurer, plan_name, premium, premium_frequency, renewal_date, status').eq('owner_id', uid).eq('status', 'active');
  const live = (pols || []).filter(p => p.renewal_date && /^\d{4}-\d{2}-\d{2}$/.test(p.renewal_date) && POLICY_FREQ[p.premium_frequency || 'yearly']);
  if (!live.length) return 0;
  const { data: have } = await supabase.from('recurring_events').select('id, master_table, master_id, kind, due_day, due_month, frequency').eq('owner_id', uid).neq('status', 'deleted');
  const known = new Set((have || []).filter(e => e.master_table === 'insurance_policies').map(e => String(e.master_id)));
  const byId = Object.fromEntries((pols || []).map(p => [String(p.id), p]));
  const first = (s) => (isEnc(s) ? '' : String(s || '').toLowerCase().split(/\s+/)[0] || '');
  const { lockRow } = require('./privacy');
  let made = 0;
  for (const p of live) {
    if (known.has(String(p.id))) continue;
    const freq = POLICY_FREQ[p.premium_frequency || 'yearly'];
    const dd = +p.renewal_date.slice(8, 10), mm = +p.renewal_date.slice(5, 7);
    // Same insurer, premium due within 10 days of this one: the same policy saved twice (setup + Discover)
    const twin = (have || []).some(e => e.kind === 'premium' && e.master_table === 'insurance_policies' && byId[String(e.master_id)]
      && first(byId[String(e.master_id)].insurer) && first(byId[String(e.master_id)].insurer) === first(p.insurer)
      && (freq === 'monthly' || e.due_month === mm || (!e.due_month && e.frequency === 'monthly'))
      && Math.abs(diffDays(`2001-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, `2001-${String(e.due_month || mm).padStart(2, '0')}-${String(Math.min(e.due_day || dd, 28)).padStart(2, '0')}`)) <= 10);
    if (twin) continue;
    const name = (isEnc(p.plan_name) ? null : p.plan_name) || (isEnc(p.insurer) ? null : p.insurer) || 'Insurance';
    const title = /premium/i.test(name) ? name : `${String(name).slice(0, 120)} premium`;
    const row = await lockRow(uid, { owner_id: uid, master_table: 'insurance_policies', master_id: String(p.id), kind: 'premium', title, amount: num(p.premium) || null,
      frequency: freq, due_day: dd, due_month: freq === 'monthly' ? null : mm, start_date: null, remind_days: 7, direction: 'out', buffer_days: 2,
      category_id: DEFAULT_CAT.premium, amount_mode: 'about', source: 'policy', status: 'active' }, { texts: ['title', 'notes'] });
    const { error } = await supabase.from('recurring_events').insert(row);
    if (!error) { made++; known.add(String(p.id)); (have || []).push({ ...row, master_id: String(p.id) }); }
    else console.error('[events] policy event not saved', p.id, error.message);
  }
  return made;
}

/**
 * Tie the user's payments to their events and occurrences. Safe to call often (throttled).
 * matchesMaster(master, txn) is the masters module's matcher (injected to avoid a require cycle).
 */
async function runMatching(uid, { force = false, matchesMaster = null } = {}) {
  if (!force && Date.now() - (lastRun.get(uid) || 0) < 90 * 1000) return { skipped: true };
  lastRun.set(uid, Date.now());
  await ensureLoanEvents(uid).catch(() => 0);
  await ensurePolicyEvents(uid).catch(() => 0);
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
  const { data: pays } = await supabase.from('event_payments').select('event_id, period, status, txn_ref, paid_on, amount, match_source').in('event_id', ids).gte('period', ymd(new Date(since - 40 * DAY)));
  await repairRefs(uid, events, pays || [], txns || [], since);
  const polIds = events.filter(e => e.master_table === 'insurance_policies' && e.master_id).map(e => e.master_id);
  const { data: pols } = polIds.length ? await supabase.from('insurance_policies').select('id, kind').in('id', polIds) : { data: [] };
  const polOf = Object.fromEntries((pols || []).map(p => [String(p.id), p]));
  const fam = {}; for (const e of events) { const f = catFamily(e, e.master_table === 'insurance_policies' ? polOf[String(e.master_id)] : null); if (f) fam[e.id] = f; }
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
    const date = istDay(t.date_time);
    let pick = null;
    if (!ev) {
      // Premiums, school fees, property tax: the payment's own category, close to an open due date
      const c = categoryPick(t, mine, fam);
      if (!c) continue;
      pick = pickPeriod(c, date, settled[c.id] || new Set());
      if (!pick || !inCatWindow(c, date, pick.period)) continue;
      ev = c; source = 'category';
    }
    const set = settled[ev.id] = settled[ev.id] || new Set();
    if (!pick) pick = pickPeriod(ev, date, set);
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

module.exports = {
  dayOk,
  ensureLoanEvents, ensurePolicyEvents,
  hasAccountRef, seedRules, DEFAULT_CAT, catFamily, categoryPick, inCatWindow, insurerWords, repairRefs, KIND_CATS, senderKey, periods, stateOf, pickPeriod, ruleScore, runMatching, intervalDays, bufferOf, todayStr, istDay, addDays, diffDays };
