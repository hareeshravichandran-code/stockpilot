/**
 * Kanalyst — Retirement planner API
 *
 *   GET    /api/retirement/autofill   everything the planner can fill in by itself, with where it came from
 *   GET    /api/retirement            saved plan
 *   PUT    /api/retirement            save plan; keeps the linked Blueprint goal's target and date in sync
 *   POST   /api/retirement/goal       create a Retirement goal in Blueprint, or link an existing one
 *   DELETE /api/retirement/goal       unlink (the goal stays, it just stops syncing)
 *
 * Spending classifier: bank SMS debits are split into living costs vs money that is
 * not spending (card bill payments, transfers to yourself, investments, EMIs), so the
 * retirement number is built on what you actually live on.
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const { computeFD } = require('./fd');
const { computeRD } = require('./rd');
const loadUniverse = (uid) => require('./blueprint').loadUniverse(uid);   // lazy: avoids a load-order cycle

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = (v) => Math.round(num(v));
const nowIso = () => new Date().toISOString();

// ── Category names (system taxonomy in expense_categories) ─────────────
const CAT = {
  sip:       ['SIP Investment', 'ELSS (Tax Saving)'],
  lumpInv:   ['Lump Sum MF', 'Mutual Funds', 'Stock Purchase', 'IPO Application', 'Stocks / Equity', 'Fixed Deposit', 'Bank / Corporate FD',
              'Gold Investment', 'Digital Gold', 'Sovereign Gold Bond', 'Bonds & P2P', 'Bonds / Debentures', 'P2P Lending'],
  nps:       ['NPS Contribution', 'NPS / PPF / EPFO'],
  epf:       ['EPFO / PF'],
  ppf:       ['PPF / NSC / KVP'],
  rd:        ['Recurring Deposit', 'Bank / Post Office RD'],
  emi:       ['Home Loan EMI', 'Car / Vehicle Loan', 'Education Loan', 'Personal Loan', 'Credit Card EMI', 'Loans'],
  autoDebit: ['NACH / Auto Debit'],
};
const inList = (name, list) => list.some(x => x.toLowerCase() === String(name || '').toLowerCase());
const LOAN_TYPE = { 'Home Loan EMI': 'home', 'Car / Vehicle Loan': 'car', 'Education Loan': 'education', 'Personal Loan': 'personal', 'Credit Card EMI': 'card', 'Loans': 'other' };

// Merchant patterns for transactions without a category
const RX = {
  cardBill:   /\bcred\b|credit\s*card\s*(bill|payment)|card\s*payment|billdesk.*card|amex|card\s*dues|credit bureaus/i,
  invest:     /indstocks|indmoney|groww|zerodha|\bcoin\b|kuvera|paytm\s*money|upstox|angel\s*one|smallcase|et\s*money|\bmf\b|mutual\s*fund|\bbse\b|iccl|nse\s*clearing|nach.*(mf|mutual)/i,
  insurance:  /insur|\blic\b|policy\s*bazaar|premium/i,
  emi:        /\bemi\b|loan|bajaj\s*fin|home\s*first|hdfc\s*ltd|lic\s*housing/i,
};

function monthKey(ms) { const d = new Date(Number(ms)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabel(k) { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); }

async function fetchAll(qb, pageSize = 1000, maxRows = 6000) {
  const out = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await qb().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ── Spending, SIPs, contributions and EMIs from bank SMS ───────────────
async function analyseTransactions(uid, userName) {
  const since = Date.now() - 400 * 864e5;
  const [txns, { data: cats }] = await Promise.all([
    fetchAll(() => supabase.from('expense_transactions')
      .select('amount, type, category_id, merchant, description, payment_type, date_time, signals')
      .eq('user_id', uid).eq('is_deleted', false).eq('type', 'DEBIT').gte('date_time', since)),
    supabase.from('expense_categories').select('id, name, type, parent_id'),
  ]);
  const catById = Object.fromEntries((cats || []).map(c => [c.id, c]));

  // Use the latest 3 complete months that have real data (the phone may not have synced lately)
  const thisMonth = monthKey(Date.now());
  const perMonth = {};
  for (const t of txns) { const k = monthKey(t.date_time); perMonth[k] = (perMonth[k] || 0) + 1; }
  const months = Object.keys(perMonth).filter(k => k !== thisMonth && perMonth[k] >= 20).sort().slice(-3);
  const lastTxn = txns.reduce((m, t) => Math.max(m, Number(t.date_time) || 0), 0);
  const empty = { months: [], monthLabels: [], lastSync: lastTxn ? new Date(lastTxn).toISOString().slice(0, 10) : null, groups: [], sips: [], emis: [], contrib: {} };
  if (!months.length) return empty;
  const inWindow = new Set(months);
  const M = months.length;

  const firstName = String(userName || '').trim().split(/\s+/)[0];
  const selfRx = firstName.length >= 3 ? new RegExp(`\\b${firstName.replace(/[^a-z]/gi, '')}\\b`, 'i') : null;

  const groups = {
    living:      { key: 'living',      label: 'Everyday spending (categorised)', include: true,  amount: 0, count: 0 },
    livingRaw:   { key: 'livingRaw',   label: 'Other payments not yet categorised', include: true, amount: 0, count: 0, note: 'UPI and card spends with a merchant name' },
    insurance:   { key: 'insurance',   label: 'Insurance premiums', include: true, amount: 0, count: 0, note: 'Health cover usually continues after retirement' },
    autoDebit:   { key: 'autoDebit',   label: 'Auto-debits not yet labelled', include: false, amount: 0, count: 0, note: 'Often an EMI or SIP. Label them in Expenses' },
    cardBill:    { key: 'cardBill',    label: 'Credit card bill payments', include: false, amount: 0, count: 0, note: 'Left out: the card spends are already counted' },
    selfTransfer:{ key: 'selfTransfer',label: 'Transfers to your own accounts', include: false, amount: 0, count: 0, note: 'Left out: money moving, not spent' },
    bankTransfer:{ key: 'bankTransfer',label: 'Bank transfers with no name', include: false, amount: 0, count: 0, note: 'Left out by default. Turn on if these are rent or bills' },
    lumpInvest:  { key: 'lumpInvest',  label: 'One-off investments', include: false, amount: 0, count: 0, note: 'Left out: not a living cost' },
  };
  const sips = {}, emis = {}, contrib = { nps: 0, epf: 0, ppf: 0, rd: 0 };
  const addTo = (map, label, amt, month, extra) => {
    const x = map[label] || (map[label] = { label, amount: 0, months: new Set(), count: 0, ...extra });
    x.amount += amt; x.months.add(month); x.count += 1;
  };

  for (const t of txns) {
    const k = monthKey(t.date_time);
    if (!inWindow.has(k)) continue;
    const amt = num(t.amount);
    if (amt <= 0) continue;
    const c = t.category_id ? catById[t.category_id] : null;
    const name = c?.name;
    const parent = c?.parent_id ? catById[c.parent_id]?.name : null;
    const { plain } = require('../services/privacy');
    const merchant = String(plain(t.merchant) || plain(t.description) || '').trim();
    const sg = Array.isArray(t.signals) ? t.signals : [];
    const shown = String(t.merchant || t.description || '').trim();   // encrypted names pass through for the device to show

    if (c) {
      if (inList(name, CAT.sip)) { addTo(sips, name, amt, k, { source: 'category' }); continue; }
      if (inList(name, CAT.nps)) { contrib.nps += amt; continue; }
      if (inList(name, CAT.epf)) { contrib.epf += amt; continue; }
      if (inList(name, CAT.ppf)) { contrib.ppf += amt; continue; }
      if (inList(name, CAT.rd)) { contrib.rd += amt; continue; }
      if (inList(name, CAT.emi) || inList(parent, ['Loans'])) { addTo(emis, name, amt, k, { type: LOAN_TYPE[name] || 'other' }); continue; }
      if (inList(name, CAT.autoDebit)) { groups.autoDebit.amount += amt; groups.autoDebit.count++; continue; }
      if (c.type === 'INVESTMENT' || inList(name, CAT.lumpInv)) { groups.lumpInvest.amount += amt; groups.lumpInvest.count++; continue; }
      if (/insurance/i.test(name)) { groups.insurance.amount += amt; groups.insurance.count++; continue; }
      if (c.type === 'INCOME') continue;
      groups.living.amount += amt; groups.living.count++;
      continue;
    }
    // Not categorised: classify by merchant and payment type
    const pt = String(t.payment_type || '').toUpperCase();
    if (RX.cardBill.test(merchant) || sg.includes('cardbill') || (pt === 'CREDIT_CARD' && !shown)) { groups.cardBill.amount += amt; groups.cardBill.count++; continue; }
    if ((selfRx && selfRx.test(merchant)) || sg.includes('self')) { groups.selfTransfer.amount += amt; groups.selfTransfer.count++; continue; }
    if (RX.invest.test(merchant) || sg.includes('invest')) { addTo(sips, (merchant || shown).replace(/\s+/g, ' ').slice(0, 40), amt, k, { source: 'merchant' }); continue; }
    if (RX.emi.test(merchant) || sg.includes('emi') || sg.includes('loan')) { addTo(emis, (merchant || shown).slice(0, 40), amt, k, { type: 'other' }); continue; }
    if (RX.insurance.test(merchant) || sg.includes('insurance')) { groups.insurance.amount += amt; groups.insurance.count++; continue; }
    if (pt === 'BANK_TRANSFER' && !shown) { groups.bankTransfer.amount += amt; groups.bankTransfer.count++; continue; }
    groups.livingRaw.amount += amt; groups.livingRaw.count++;
  }

  const perMo = (v) => r0(v / M);
  return {
    months, monthLabels: months.map(monthLabel), lastSync: empty.lastSync,
    groups: Object.values(groups).filter(g => g.count > 0).map(g => ({ ...g, monthly: perMo(g.amount), amount: r0(g.amount) })),
    sips: Object.values(sips).map(s => ({ label: s.label, monthly: perMo(s.amount), months: s.months.size, regular: s.months.size >= Math.min(2, M), source: s.source }))
      .sort((a, b) => b.monthly - a.monthly),
    emis: Object.values(emis).map(e => ({ label: e.label, monthly: perMo(e.amount), months: e.months.size, type: e.type }))
      .sort((a, b) => b.monthly - a.monthly),
    contrib: { nps: perMo(contrib.nps), epf: perMo(contrib.epf), ppf: perMo(contrib.ppf), rd: perMo(contrib.rd) },
  };
}

// ── NPS monthly contribution from statement history ───────────────────
function npsMonthly(rows) {
  const s = (rows || []).filter(r => r.statement_to && num(r.total_contributions) > 0)
    .sort((a, b) => String(a.statement_to).localeCompare(String(b.statement_to)));
  if (s.length < 2) return null;
  const last = s[s.length - 1];
  const lastD = new Date(last.statement_to);
  // Compare with the statement closest to 6-12 months earlier
  let base = null;
  for (const r of s) {
    const months = (lastD - new Date(r.statement_to)) / (30.44 * 864e5);
    if (months >= 3) base = { r, months };
  }
  if (!base) return null;
  const delta = num(last.total_contributions) - num(base.r.total_contributions);
  if (delta <= 0) return null;
  return { monthly: r0(delta / base.months), from: base.r.statement_to, to: last.statement_to };
}

// ── Current value of a Blueprint goal (mapped funds + cash set aside) ──
async function bucketValues(uid) {
  const [{ data: buckets }, { data: maps }, hRes, mfRes, npsRes, fdRes, rdRes] = await Promise.all([
    supabase.from('bp_buckets').select('*').eq('user_id', uid),
    supabase.from('bp_bucket_assets').select('bucket_id, asset_type, asset_ref').eq('user_id', uid),
    supabase.from('holdings').select('isin, symbol, quantity, last_price, avg_cost, demat_account').eq('user_id', uid),
    supabase.from('mf_holdings').select('folio_number, isin, current_value').eq('user_id', uid),
    supabase.from('nps_holdings').select('pran, id, total_value, statement_to').eq('user_id', uid).order('statement_to', { ascending: false }),
    supabase.from('fixed_deposits').select('*').eq('user_id', uid),
    supabase.from('recurring_deposits').select('*').eq('user_id', uid),
  ]);
  const val = {};
  const brokers = {};
  for (const h of hRes.data || []) {
    const v = num(h.quantity) * (num(h.last_price) || num(h.avg_cost));
    const demat = h.demat_account || 'UNASSIGNED';
    val[`stock::${h.isin || h.symbol}|${demat}`] = v;
    brokers[demat] = (brokers[demat] || 0) + v;
  }
  for (const [d, v] of Object.entries(brokers)) val[`broker::${d}`] = v;
  for (const m of mfRes.data || []) val[`mf::${m.folio_number || ''}|${m.isin || ''}`] = num(m.current_value);
  const seen = new Set();
  for (const n of npsRes.data || []) { const k = n.pran || n.id; if (seen.has(k)) continue; seen.add(k); val[`nps::${k}`] = num(n.total_value); }
  for (const fd of fdRes.data || []) { try { val[`fd::${fd.fd_id || fd.id}`] = num(computeFD(fd).current_value); } catch (e) { /* skip */ } }
  for (const rd of rdRes.data || []) { try { val[`rd::${rd.rd_id || rd.id}`] = num(computeRD(rd).current_value); } catch (e) { /* skip */ } }

  const byBucket = {};
  for (const m of maps || []) {
    if (String(m.asset_ref).startsWith('fam:')) continue;   // a partner's asset is not yours to count
    byBucket[m.bucket_id] = (byBucket[m.bucket_id] || 0) + (val[`${m.asset_type}::${m.asset_ref}`] || 0);
  }
  return (buckets || []).map(b => ({ ...b, mapped_value: r0(byBucket[b.id] || 0), current_value: r0((byBucket[b.id] || 0) + num(b.manual_value)) }));
}

// ═══════════════════════════════════════════════════════════════════
//  GET /autofill
// ═══════════════════════════════════════════════════════════════════
router.get('/autofill', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const [{ data: user }, hRes, mfRes, npsRes, fdRes, rdRes, abRes, planRes] = await Promise.all([
      supabase.from('users').select('name, dob').eq('id', uid).maybeSingle(),
      supabase.from('holdings').select('quantity, last_price, avg_cost').eq('user_id', uid),
      supabase.from('mf_holdings').select('current_value').eq('user_id', uid),
      supabase.from('nps_holdings').select('pran, id, total_value, total_contributions, statement_to').eq('user_id', uid).order('statement_to', { ascending: false }),
      supabase.from('fixed_deposits').select('*').eq('user_id', uid),
      supabase.from('recurring_deposits').select('*').eq('user_id', uid),
      supabase.from('asset_balances').select('asset_type, balance').eq('user_id', uid),
      supabase.from('retirement_plans').select('linked_bucket_id').eq('user_id', uid).maybeSingle(),
    ]);

    const bal = {};
    for (const r of abRes.data || []) bal[String(r.asset_type).toLowerCase()] = num(r.balance);

    // Assets
    const stocks = (hRes.data || []).reduce((s, h) => s + num(h.quantity) * (num(h.last_price) || num(h.avg_cost)), 0);
    const mf = (mfRes.data || []).reduce((s, m) => s + num(m.current_value), 0);
    const seen = new Set(); let nps = 0;
    for (const n of npsRes.data || []) { const k = n.pran || n.id; if (seen.has(k)) continue; seen.add(k); nps += num(n.total_value); }
    let fdModule = 0, rdModule = 0, rdMonthly = 0, fdCount = 0;
    for (const fd of fdRes.data || []) { try { const c = computeFD(fd); if (c.is_active) { fdModule += num(c.current_value); fdCount++; } } catch (e) { /* skip */ } }
    for (const rd of rdRes.data || []) { try { const c = computeRD(rd); if (c.is_active) { rdModule += num(c.current_value); rdMonthly += num(rd.monthly_installment); } } catch (e) { /* skip */ } }
    const deposits = fdModule + rdModule > 0 ? fdModule + rdModule : bal.fd || 0;

    const assets = {
      stocks:   { value: r0(stocks), source: 'Stock holdings' },
      mf:       { value: r0(mf), source: 'Mutual funds' },
      nps:      { value: r0(nps || bal.nps), source: nps ? 'NPS statements' : 'Typed balance' },
      epf:      { value: r0(bal.epf), source: 'Typed balance' },
      ppf:      { value: r0(bal.ppf), source: 'Typed balance' },
      ssy:      { value: r0(bal.ssy), source: 'Typed balance' },
      deposits: { value: r0(deposits), source: fdModule + rdModule > 0 ? `Bank deposits (${fdCount} FD${rdModule ? ' + RD' : ''})` : 'Typed FD balance' },
    };

    // Blueprint: goals, EMI loans, money already set aside for other goals
    const buckets = await bucketValues(uid);
    const linkedId = planRes.data?.linked_bucket_id || null;
    const loans = [];
    for (const emi of buckets.filter(b => b.is_emi && b.emi_loan_id)) {
      const loan = buckets.find(b => b.id === emi.emi_loan_id);
      if (!loan) continue;
      loans.push({
        source: 'blueprint', source_id: emi.id, name: loan.name || emi.name, type: /home/i.test(loan.name + emi.name) ? 'home' : 'other',
        outstanding: r0(Math.max(0, num(loan.target_amount) - num(loan.current_value))),
        emi: emi.recurrence === 'monthly' ? r0(emi.target_amount) : 0,
        note: 'From your Blueprint EMI goal',
      });
    }
    if (bal.home_loan > 0 && !loans.some(l => l.type === 'home')) {
      loans.push({ source: 'balance', source_id: 'home_loan', name: 'Home loan', type: 'home', outstanding: r0(bal.home_loan), emi: 0, note: 'Typed on the dashboard' });
    }
    if (bal.credit_card > 0) {
      loans.push({ source: 'balance', source_id: 'credit_card', name: 'Credit card dues', type: 'card', outstanding: r0(bal.credit_card), emi: 0, note: 'Typed on the dashboard' });
    }

    const otherGoals = buckets.filter(b => b.kind === 'goal' && !b.is_loan && b.status !== 'completed' && b.id !== linkedId && b.special_kind !== 'retirement' && b.mapped_value > 0)
      .map(b => ({ name: b.name, value: b.mapped_value })).sort((a, b) => b.value - a.value);
    const retireGoals = buckets.filter(b => b.kind === 'goal' && !b.is_loan && b.status !== 'completed' && (b.id === linkedId || b.special_kind === 'retirement' || /retire/i.test(b.name)))
      .map(b => ({ id: b.id, name: b.name, target_amount: num(b.target_amount), target_date: b.target_date, current_value: b.current_value, linked: b.id === linkedId }));
    // Every asset mapped to the linked goal, with names (yours and family members')
    const linkedGoal = retireGoals.find(g => g.linked);
    if (linkedGoal) Object.assign(linkedGoal, await mappedAssets(uid, linkedGoal.id, buckets.find(b => b.id === linkedGoal.id)));

    // Bank SMS
    const tx = await analyseTransactions(uid, user?.name);
    // Match SMS EMIs to the loans we know about; the rest become new loan suggestions
    for (const e of tx.emis) {
      const match = loans.find(l => !l.emi && (l.type === e.type || (e.type === 'home' && l.type === 'home')));
      if (match) { match.emi = e.monthly; match.note += ' · EMI from bank SMS'; e.matched = true; }
    }
    for (const e of tx.emis.filter(x => !x.matched)) {
      loans.push({ source: 'sms', source_id: `sms:${e.label}`, name: e.label.replace(/ EMI$/i, '') || 'Loan', type: e.type, outstanding: 0, emi: e.monthly, note: `EMI seen in bank SMS (${tx.monthLabels.join(', ')})` });
    }

    const npsM = npsMonthly(npsRes.data);
    const contributions = {
      nps: npsM ? { value: npsM.monthly, source: `NPS statements ${npsM.from} → ${npsM.to}` } : { value: tx.contrib.nps || 0, source: tx.contrib.nps ? 'Bank SMS' : null },
      epf: { value: tx.contrib.epf || 0, source: tx.contrib.epf ? 'Bank SMS' : null },
      ppf: { value: tx.contrib.ppf || 0, source: tx.contrib.ppf ? 'Bank SMS' : null },
      rd:  { value: r0(rdMonthly || tx.contrib.rd), source: rdMonthly ? 'Bank deposits (active RDs)' : tx.contrib.rd ? 'Bank SMS' : null },
    };

    res.json({
      profile: { name: user?.name || null, dob: user?.dob || null },
      assets, contributions, loans,
      spending: { months: tx.monthLabels, lastSync: tx.lastSync, groups: tx.groups },
      sips: tx.sips,
      otherGoals: { total: otherGoals.reduce((s, g) => s + g.value, 0), goals: otherGoals },
      retireGoals,
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'RETIREMENT_AUTOFILL_ERROR', error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── Assets mapped to one goal, labelled the same way Blueprint shows them ──
async function mappedAssets(uid, bucketId, bucket) {
  const [{ data: maps }, uni] = await Promise.all([
    supabase.from('bp_bucket_assets').select('asset_type, asset_ref').eq('user_id', uid).eq('bucket_id', bucketId),
    loadUniverse(uid).catch(() => ({ byKey: {} })),
  ]);
  const assets = (maps || []).map(m => {
    const it = uni.byKey[`${m.asset_type}::${m.asset_ref}`];
    const mine = !String(m.asset_ref).startsWith('fam:');
    if (!it) return { asset_type: m.asset_type, asset_ref: m.asset_ref, label: 'No longer in your records', sub: m.asset_ref, value: 0, mine, owner_name: null, missing: true };
    return { asset_type: m.asset_type, asset_ref: m.asset_ref, label: it.label, sub: it.sub, value: r0(it.value), mine, owner_name: it.owner_name || null, inactive: !!it.inactive };
  }).sort((a, b) => (b.mine - a.mine) || (b.value - a.value));
  const mineValue = assets.filter(a => a.mine).reduce((s, a) => s + a.value, 0);
  const familyValue = assets.filter(a => !a.mine).reduce((s, a) => s + a.value, 0);
  return { assets, mine_value: r0(mineValue), family_value: r0(familyValue), manual_value: r0(num(bucket?.manual_value)) };
}

// ═══════════════════════════════════════════════════════════════════
//  Plan
// ═══════════════════════════════════════════════════════════════════
async function getPlan(uid) {
  const { data, error } = await supabase.from('retirement_plans').select('*').eq('user_id', uid).maybeSingle();
  if (error && /relation .* does not exist|Could not find the table/i.test(error.message)) {
    const e = new Error('Retirement table missing — run backend/migrations/2026-11-04c_retirement_plans.sql'); e.status = 503; throw e;
  }
  return data || null;
}
async function savePlan(uid, patch) {
  const existing = await getPlan(uid);
  if (existing) {
    const { data, error } = await supabase.from('retirement_plans').update({ ...patch, updated_at: nowIso() }).eq('user_id', uid).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('retirement_plans').insert({ user_id: uid, data: {}, ...patch, updated_at: nowIso() }).select().single();
  if (error) throw error;
  return data;
}
async function syncGoal(uid, bucketId, goal) {
  if (!bucketId || !goal) return null;
  const target = r0(goal.target);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(goal.date || '') ? goal.date : null;
  if (!(target > 0)) return null;
  const { data } = await supabase.from('bp_buckets').update({
    target_amount: target, ...(date ? { target_date: date } : {}), special_kind: 'retirement', updated_at: nowIso(),
  }).eq('id', bucketId).eq('user_id', uid).select('id, name, target_amount, target_date').maybeSingle();
  return data;
}

router.get('/', requireAuth, async (req, res) => {
  try { res.json({ plan: await getPlan(req.user.id) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.put('/', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data, goal } = req.body || {};
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data is required' });
  if (JSON.stringify(data).length > 60000) return res.status(413).json({ error: 'Plan is too large' });
  try {
    const plan = await savePlan(uid, { data: { ...data, lastGoal: goal && goal.target > 0 ? { target: r0(goal.target), date: goal.date || null } : (data.lastGoal || null) } });
    const synced = await syncGoal(uid, plan.linked_bucket_id, goal);
    res.json({ plan, goal: synced });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ── Link to Blueprint ─────────────────────────────────────────────────
router.post('/goal', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { bucket_id, target, date, name } = req.body || {};
  try {
    let bucketId = bucket_id;
    if (bucketId) {
      const { data: b } = await supabase.from('bp_buckets').select('id, kind, is_loan, is_emi').eq('id', bucketId).eq('user_id', uid).maybeSingle();
      if (!b || b.kind !== 'goal' || b.is_loan) return res.status(404).json({ error: 'That goal was not found' });
      if (b.is_emi) return res.status(400).json({ error: 'An EMI goal can’t be your retirement goal' });
    } else {
      // New goal in the furthest-out lane of your first plan box (or outside if you have none)
      const { data: boards } = await supabase.from('bp_boards').select('id').eq('user_id', uid).order('created_at').limit(1);
      const board = boards?.[0];
      let layerId = null, x = 80, y = 80;
      if (board) {
        const { data: layers } = await supabase.from('bp_layers').select('id, sort_order').eq('board_id', board.id).eq('user_id', uid).order('sort_order', { ascending: false }).limit(1);
        layerId = layers?.[0]?.id || null;
        if (layerId) {
          const { count } = await supabase.from('bp_buckets').select('id', { count: 'exact', head: true }).eq('layer_id', layerId).eq('user_id', uid);
          const n = count || 0;
          x = 154 + (n % 5) * 220; y = 16 + Math.floor(n / 5) * 128;
        }
      }
      const { data: created, error } = await supabase.from('bp_buckets').insert({
        user_id: uid, kind: 'goal', name: (name || 'Retirement').slice(0, 80), status: 'open', recurrence: 'none',
        board_id: board ? board.id : null, layer_id: layerId, x, y, w: 240, h: 112, color: 'prussian', special_kind: 'retirement',
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      bucketId = created.id;
    }
    const prev = await getPlan(uid);
    if (prev?.linked_bucket_id && prev.linked_bucket_id !== bucketId) {
      await supabase.from('bp_buckets').update({ special_kind: null }).eq('id', prev.linked_bucket_id).eq('user_id', uid);
    }
    const plan = await savePlan(uid, { linked_bucket_id: bucketId, ...(prev ? {} : { data: {} }) });
    // Mark it as the retirement goal; target comes from the request, else from the last saved plan
    await supabase.from('bp_buckets').update({ special_kind: 'retirement', recurrence: 'none' }).eq('id', bucketId).eq('user_id', uid);
    const g = target > 0 ? { target, date } : prev?.data?.lastGoal;
    const synced = await syncGoal(uid, bucketId, g);
    await supabase.from('bp_comments').insert({ user_id: uid, bucket_id: bucketId, body: 'Linked to the Retirement planner. Target and date now come from your plan.', is_system: true });
    res.status(201).json({ plan, goal: synced });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.delete('/goal', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const prev = await getPlan(uid);
    if (prev?.linked_bucket_id) {
      await supabase.from('bp_buckets').update({ special_kind: null }).eq('id', prev.linked_bucket_id).eq('user_id', uid);
    }
    const plan = prev ? await savePlan(uid, { linked_bucket_id: null }) : null;
    res.json({ plan });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
module.exports.analyseTransactions = analyseTransactions;
