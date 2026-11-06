/**
 * Money flow: what came in, what went out, what was invested — per month and per category,
 * with the expected level (average of the previous 3 months) next to the actual.
 *
 * Cleaning before counting:
 *  - transfers between your own accounts (a debit and a credit of the same amount within a day,
 *    or a payee that is you) are left out of income and spend
 *  - likely duplicates (the same amount and direction from the same bank within ~36 hours, where one
 *    of the SMS is a second notice for the same payment) are counted once
 *  - uncategorised merchants get a category from your SMS rules, then from the shared merchant rules
 *  - a transaction tied to a master takes the master's type (loan → EMIs, SIP/RD → invested, salary → income)
 */
const supabase = require('./supabase');

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const IST = 5.5 * 3600e3;
const dayOf = (ms) => new Date(Number(ms) + IST).toISOString().slice(0, 10);
const monthOf = (ms) => dayOf(ms).slice(0, 7);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthStartMs = (ym) => Date.parse(ym + '-01T00:00:00Z') - IST;
const bankOf = (s) => String(s || '').toUpperCase().split('-').find(p => p.length >= 5) || String(s || '').toUpperCase();

const NON_SPEND = new Set(['p_transfer', 'cc_bill', 'self_transfer']);
const REFUND = new Set(['refund', 'cashback', 'p_refund']);
// Group names for things that don't have a category but are known through a master
const MASTER_GROUP = {
  loan: { section: 'expense', key: 'g_emi', name: 'Loan EMIs', color: '#a82c2c' },
  card: { section: 'transfer', key: 'g_card', name: 'Card bill payments', color: '#8a7d6a' },
  sip: { section: 'investment', key: 'p_mf', name: 'Mutual Funds', color: '#5d3b78' },
  rd: { section: 'investment', key: 'p_rd', name: 'Recurring Deposit', color: '#5d3b78' },
  subscription: { section: 'expense', key: 'g_subs', name: 'Subscriptions', color: '#8a5a2b' },
};
const PALETTE = ['#b8551f', '#2f4577', '#964062', '#2d6b6b', '#c98a12', '#5f7f1f', '#5d3b78', '#a82c2c', '#8a5a2b', '#3f7d6a'];
const colorFor = (id, c) => (c && !/^#?(b9ad97|8a7d6a|999|ccc)/i.test(c) ? c : PALETTE[[...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length]);
const SUB_CATS = new Set(['ott', 'gym', 'gaming', 'club_membership', 'sports_club', 'yoga', 'p_membership', 'broadband', 'dth_cable', 'mobile_postpaid']);

async function loadCategories(uid) {
  const { data } = await supabase.from('expense_categories').select('id, name, type, color, parent_id, user_id, is_deleted')
    .or(`user_id.is.null,user_id.eq.${uid}`);
  const byId = {};
  for (const c of data || []) if (!c.is_deleted) byId[c.id] = c;
  const top = (id) => { let c = byId[id]; let guard = 0; while (c && c.parent_id && byId[c.parent_id] && guard++ < 4) c = byId[c.parent_id]; return c; };
  return { byId, top };
}

async function loadRules(uid) {
  const [u, g] = await Promise.all([
    supabase.from('user_sms_rules').select('merchant_pattern, category_id').eq('user_id', uid),
    supabase.from('universal_merchant_rules').select('merchant_pattern, category_id').gte('confidence_score', 0.6).limit(3000),
  ]);
  const norm = (s) => String(s || '').toLowerCase().trim();
  const own = (u.data || []).filter(r => r.category_id && norm(r.merchant_pattern).length >= 3).map(r => [norm(r.merchant_pattern), r.category_id]);
  const shared = (g.data || []).filter(r => r.category_id && norm(r.merchant_pattern).length >= 4).map(r => [norm(r.merchant_pattern), r.category_id]);
  return (merchant) => {
    const m = norm(merchant);
    if (m.length < 3) return null;
    for (const [p, c] of own) if (m === p || m.includes(p)) return c;
    for (const [p, c] of shared) if (m.includes(p)) return c;
    return null;
  };
}

/** Mark transfers between own accounts and likely duplicate notices. Mutates rows (sets _skip). */
function clean(rows, userName) {
  const me = String(userName || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  const isMe = (m) => { const s = String(m || '').toLowerCase(); return me.length && me.some(w => s.includes(w)) && !/salary|neft cr/i.test(s); };
  rows.sort((a, b) => Number(a.date_time) - Number(b.date_time));
  let dups = 0, transfers = 0;
  for (const t of rows) if (NON_SPEND.has(t.category_id)) { t._skip = 'transfer'; transfers++; }
  // Payee is you → moving money between your own accounts
  for (const t of rows) if (!t._skip && isMe(t.merchant)) { t._skip = 'transfer'; transfers++; }
  // Debit in one account + credit of the same amount in another within a day → transfer
  const credits = rows.filter(t => t.type === 'CREDIT' && !t._skip);
  for (const d of rows) {
    if (d.type !== 'DEBIT' || d._skip || num(d.amount) < 500) continue;
    const c = credits.find(x => !x._skip && num(x.amount) === num(d.amount) && Math.abs(Number(x.date_time) - Number(d.date_time)) <= 864e5
      && (bankOf(x.sms_sender) !== bankOf(d.sms_sender) || (x.account_last4 && d.account_last4 && x.account_last4 !== d.account_last4)));
    if (c) { d._skip = 'transfer'; c._skip = 'transfer'; transfers += 2; }
  }
  // Same amount + direction from the same bank within 36h, one of them without a reference / generic type → duplicate notice
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (a._skip) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (Number(b.date_time) - Number(a.date_time) > 36 * 3600e3) break;
      if (b._skip || b.type !== a.type || num(b.amount) !== num(a.amount) || num(a.amount) < 200) continue;
      if (bankOf(a.sms_sender) !== bankOf(b.sms_sender)) continue;
      if (a.reference_no && b.reference_no && a.reference_no !== b.reference_no) continue;   // two real payments
      const generic = (t) => !t.merchant || t.payment_type === 'OTHER' || !t.reference_no;
      if (generic(a) || generic(b)) { (generic(b) ? b : a)._skip = 'duplicate'; dups++; if (a._skip) break; }
    }
  }
  return { dups, transfers };
}

function classify(t, cats, ruleCat, masterKind) {
  if (t._skip) return null;
  const mk = masterKind[t.master_id];
  if (mk && MASTER_GROUP[mk.kind]) return MASTER_GROUP[mk.kind];
  if (mk && mk.kind === 'income') return { section: 'income', key: 'inc_' + (mk.subtype || 'income'), name: { salary: 'Salary', dividend: 'Dividends', rental: 'Rent received', interest: 'Interest', freelance: 'Freelance' }[mk.subtype] || 'Income', color: '#5f7f1f' };
  if (mk && mk.kind === 'expense') return { section: 'expense', key: 'exp_' + (mk.subtype || 'other'), name: { rent: 'Rent', school_fee: 'School fees', maid: 'Help / maid', utility: 'Utilities' }[mk.subtype] || 'Regular expenses', color: '#964062' };
  const catId = t.category_id || ruleCat(t.merchant);
  if (catId && REFUND.has(catId) && t.type === 'CREDIT') return { section: 'refund', key: 'p_refund', name: 'Refunds & cashback', color: '#8a7d6a' };
  const c = catId ? cats.byId[catId] : null;
  const top = c ? cats.top(catId) : null;
  if (top) {
    const section = top.type === 'INVESTMENT' ? (t.type === 'CREDIT' ? 'income' : 'investment') : top.type === 'INCOME' ? 'income' : (t.type === 'CREDIT' ? 'income' : 'expense');
    const subs = SUB_CATS.has(catId) || SUB_CATS.has(top.id);
    return { section, key: subs ? 'g_subs' : top.id, name: subs ? 'Subscriptions' : top.name, color: subs ? '#8a5a2b' : colorFor(top.id, top.color), inferred: !t.category_id };
  }
  return t.type === 'CREDIT'
    ? { section: 'income', key: 'u_in', name: 'Other money in', color: '#9aa57a', uncategorised: true }
    : { section: 'expense', key: 'u_out', name: 'Not categorised', color: '#b9ad97', uncategorised: true };
}

/**
 * month: 'YYYY-MM'. Returns sections with groups { key, name, color, actual, expected, count }, totals, trend (6 months),
 * subscriptions found, and what was left out.
 */
async function monthFlow(uid, month, opts = {}) {
  const months = Array.from({ length: 7 }, (_, i) => addMonths(month, i - 6));       // 6 before + this month
  const from = monthStartMs(months[0]);
  const to = monthStartMs(addMonths(month, 1));
  const [{ data: txns }, cats, ruleCat, { data: ms }, { data: me }] = await Promise.all([
    supabase.from('expense_transactions').select('id, amount, type, category_id, merchant, date_time, sms_sender, payment_type, reference_no, account_last4, master_id')
      .eq('user_id', uid).eq('is_deleted', false).gte('date_time', from - 2 * 864e5).lt('date_time', to + 2 * 864e5).limit(20000),
    loadCategories(uid),
    loadRules(uid),
    supabase.from('money_masters').select('id, kind, subtype, title, amount, frequency, due_day, status').eq('owner_id', uid),
    supabase.from('users').select('name').eq('id', uid).maybeSingle(),
  ]);
  const rows = (txns || []).map(t => ({ ...t }));
  const cleaned = clean(rows, me?.name);
  const masterKind = Object.fromEntries((ms || []).map(m => [m.id, m]));
  // Salary credits (no category on them): the detected month-end salary stream
  const hasSalaryMaster = (ms || []).some(m => m.kind === 'income' && m.subtype === 'salary' && m.status !== 'closed');
  const salaryIds = new Set(hasSalaryMaster ? [] : require('./salary').detectSalaryRows(rows.filter(t => !t._skip && t.type === 'CREDIT' && !t.category_id && !t.master_id)).map(t => t.id));

  const per = {};   // month -> section -> key -> {actual,count,name,color}
  const left = { duplicates: 0, transfers: 0, duplicate_amount: 0, transfer_amount: 0 };
  for (const t of rows) {
    const mo = monthOf(t.date_time);
    if (mo < months[0] || mo > month) continue;
    if (t._skip) {
      if (mo === month) { if (t._skip === 'duplicate') { left.duplicates++; left.duplicate_amount += num(t.amount); } else { left.transfers++; left.transfer_amount += num(t.amount); } }
      continue;
    }
    const g = salaryIds.has(t.id) ? { section: 'income', key: 'inc_salary', name: 'Salary', color: '#5f7f1f', inferred: true } : classify(t, cats, ruleCat, masterKind);
    if (!g || g.section === 'transfer') continue;
    const S = ((per[mo] = per[mo] || {})[g.section] = per[mo][g.section] || {});
    const G = (S[g.key] = S[g.key] || { key: g.key, name: g.name, color: g.color, actual: 0, count: 0, uncategorised: !!g.uncategorised, inferred: 0 });
    G.actual += num(t.amount); G.count++; if (g.inferred) G.inferred++;
  }

  const prev = months.slice(3, 6);                                                 // the 3 months before this one
  // Average only over months that have any data (a new user's first months are not "zero spend")
  const active = prev.filter(mo => per[mo] && Object.values(per[mo]).some(sec => Object.keys(sec).length));
  const denom = Math.max(1, active.length);
  const sections = {};
  for (const sec of ['income', 'expense', 'investment', 'refund']) {
    const keys = new Set([...(Object.keys(per[month]?.[sec] || {})), ...prev.flatMap(mo => Object.keys(per[mo]?.[sec] || {}))]);
    const groups = [...keys].map(k => {
      const cur = per[month]?.[sec]?.[k];
      const meta = cur || prev.map(mo => per[mo]?.[sec]?.[k]).find(Boolean);
      const hist = prev.map(mo => per[mo]?.[sec]?.[k]?.actual || 0);
      const seen = hist.filter(v => v > 0).length;
      return { key: k, name: meta.name, color: meta.color, actual: Math.round(cur?.actual || 0), count: cur?.count || 0,
        expected: Math.round(hist.reduce((a, b) => a + b, 0) / denom), months_seen: seen, uncategorised: meta.uncategorised, inferred: cur?.inferred || 0 };
    }).sort((a, b) => (b.actual - a.actual) || (b.expected - a.expected));
    sections[sec] = { groups, actual: groups.reduce((s, g) => s + g.actual, 0), expected: groups.reduce((s, g) => s + g.expected, 0) };
  }
  const trend = months.map(mo => {
    const sum = (sec) => Math.round(Object.values(per[mo]?.[sec] || {}).reduce((s, g) => s + g.actual, 0));
    return { month: mo, income: sum('income'), expense: sum('expense'), investment: sum('investment') };
  });

  // Subscriptions: small debits to the same merchant in 3+ of the last 6 months, not yet a master
  let subscriptions = [];
  if (!opts.light) {
    const subMasters = (ms || []).filter(m => m.kind === 'subscription' && m.status !== 'closed');
    const byMerchant = {};
    for (const t of rows) {
      if (t._skip || t.type !== 'DEBIT' || !t.merchant || num(t.amount) > 5000 || t.master_id) continue;
      const k = t.merchant.trim().toLowerCase();
      if (k.length < 3 || /^\?|unknown|upi|neft|imps|transfer/.test(k)) continue;
      (byMerchant[k] = byMerchant[k] || []).push(t);
    }
    for (const list of Object.values(byMerchant)) {
      const ms6 = new Set(list.map(t => monthOf(t.date_time)).filter(mo => mo >= months[1]));
      if (ms6.size < 3) continue;
      const amts = list.map(t => num(t.amount)).sort((a, b) => a - b);
      const median = amts[Math.floor(amts.length / 2)];
      const steady = list.filter(t => Math.abs(num(t.amount) - median) <= Math.max(10, median * 0.1)).length >= ms6.size;
      const isSubCat = list.some(t => SUB_CATS.has(t.category_id));
      const recent = list.filter(t => monthOf(t.date_time) >= months[1]);
      const perMonth = recent.length / ms6.size;
      const everyday = list.some(t => /^(p_food|food_|grocery|p_grocery|p_fuel|petrol|cab|auto|p_travel)/.test(t.category_id || '') || /swiggy|zomato|blinkit|zepto|bigbasket|instamart|uber|ola|rapido|petrol|fuel/i.test(t.merchant));
      if (!isSubCat && (!steady || perMonth > 1.4 || everyday)) continue;
      const last = list[list.length - 1];
      const name = last.merchant.trim();
      if (subMasters.some(m => (m.title || '').toLowerCase().includes(name.toLowerCase().split(/\s+/)[0]))) continue;
      subscriptions.push({ merchant: name, amount: Math.round(median), months: ms6.size, last: dayOf(last.date_time), due_day: +dayOf(last.date_time).slice(8, 10) });
    }
    subscriptions.sort((a, b) => b.months - a.months || b.amount - a.amount);
    subscriptions = subscriptions.slice(0, 12);
  }

  const inc = sections.income, exp = sections.expense, inv = sections.investment;
  return {
    month, months: trend, sections,
    totals: {
      income: { actual: inc.actual, expected: inc.expected },
      expense: { actual: exp.actual, expected: exp.expected },
      investment: { actual: inv.actual, expected: inv.expected },
      saved: { actual: inc.actual - exp.actual - inv.actual, expected: inc.expected - exp.expected - inv.expected },
    },
    left_out: { ...left, duplicate_amount: Math.round(left.duplicate_amount), transfer_amount: Math.round(left.transfer_amount) },
    uncategorised: (exp.groups.find(g => g.key === 'u_out') || {}).actual || 0,
    subscriptions,
    expected_basis: active.length ? `Average of ${active.length === 1 ? active[0] : `${active[0]} to ${active[active.length - 1]}`}` : 'No earlier months yet',
  };
}

module.exports = { monthFlow, clean, classify };
