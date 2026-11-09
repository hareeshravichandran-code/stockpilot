// Private test account: log in with a secret link, reset masters or everything, reseed dummy MF and stock data.
// Only users with users.is_test = true can use any of this; the link key is stored as a bcrypt hash.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

const makeToken = (u) => jwt.sign({ id: u.id, email: u.email }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Slow down guessing: at most 10 tries a minute per IP
const tries = new Map();
function limited(ip) {
  const now = Date.now();
  const t = (tries.get(ip) || []).filter(x => now - x < 60e3);
  t.push(now); tries.set(ip, t);
  return t.length > 10;
}

// POST /api/auth/test-link { key } -> { token, user }
router.post('/auth/test-link', async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many tries, wait a minute' });
    const key = String(req.body?.key || '');
    if (key.length < 24) return res.status(401).json({ error: 'Invalid link' });
    const { data: users } = await supabase.from('users').select('id, name, email, test_key_hash').eq('is_test', true);
    for (const u of users || []) {
      if (u.test_key_hash && await bcrypt.compare(key, u.test_key_hash))
        return res.json({ token: makeToken(u), user: { id: u.id, name: u.name, email: u.email, is_test: true } });
    }
    res.status(401).json({ error: 'Invalid link' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function testUser(req, res) {
  const { data: u } = await supabase.from('users').select('id, is_test').eq('id', req.user.id).maybeSingle();
  if (!u?.is_test) { res.status(403).json({ error: 'Only for the test account' }); return null; }
  return u;
}

// Dummy portfolio: a few stocks and mutual fund folios with believable numbers
const STOCKS = [
  ['RELIANCE', 'Reliance Industries Ltd', 40, 2410, 2895, 'Energy', 'INE002A01018'],
  ['TCS', 'Tata Consultancy Services Ltd', 15, 3320, 3610, 'IT', 'INE467B01029'],
  ['HDFCBANK', 'HDFC Bank Ltd', 60, 1520, 1748, 'Banking', 'INE040A01034'],
  ['INFY', 'Infosys Ltd', 35, 1405, 1562, 'IT', 'INE009A01021'],
  ['ITC', 'ITC Ltd', 200, 352, 418, 'FMCG', 'INE154A01025'],
  ['LT', 'Larsen & Toubro Ltd', 12, 2890, 3560, 'Infrastructure', 'INE018A01030'],
];
const FUNDS = [
  ['Parag Parikh Flexi Cap Fund - Direct Growth', 'PPFAS Mutual Fund', 'Flexi Cap', 'INF879O01027', '12345678/90', 2150.32, 62.4, 98000],
  ['HDFC Index Fund - Nifty 50 Plan - Direct Growth', 'HDFC Mutual Fund', 'Index', 'INF179K01WA6', '4471029/12', 1820.5, 228.9, 340000],
  ['SBI Small Cap Fund - Direct Growth', 'SBI Mutual Fund', 'Small Cap', 'INF200K01T51', '18872210', 610.12, 182.3, 92000],
  ['ICICI Prudential Liquid Fund - Direct Growth', 'ICICI Prudential Mutual Fund', 'Liquid', 'INF109K01VQ1', '9921034/55', 410.8, 375.6, 150000],
  ['Axis ELSS Tax Saver Fund - Direct Growth', 'Axis Mutual Fund', 'ELSS', 'INF846K01EW2', '91045532871', 1290.4, 98.7, 110000],
];

async function seedPortfolio(uid) {
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('holdings').delete().eq('user_id', uid);
  await supabase.from('mf_holdings').delete().eq('user_id', uid);
  const { error: e1 } = await supabase.from('holdings').insert(STOCKS.map(([symbol, company, quantity, avg_cost, last_price, sector, isin]) => ({
    user_id: uid, symbol, company, quantity, avg_cost, last_price, sector, isin, market_value: quantity * last_price,
    source: 'test', demat_account: 'TEST-DEMAT', updated_at: new Date().toISOString(), price_updated_at: new Date().toISOString() })));
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('mf_holdings').insert(FUNDS.map(([fund_name, fund_house, fund_category, isin, folio_number, units, nav, invested]) => {
    const current = Math.round(units * nav * 100) / 100;
    return { user_id: uid, fund_name, fund_house, fund_category, isin, folio_number, units, nav, nav_date: today, current_value: current,
      invested_value: invested, avg_cost: Math.round((invested / units) * 10000) / 10000, gain_loss: Math.round((current - invested) * 100) / 100,
      gain_loss_pct: Math.round(((current - invested) / invested) * 10000) / 100, source: 'test', statement_date: today };
  }));
  if (e2) throw e2;
}

async function del(table, col, uid) {
  const { error } = await supabase.from(table).delete().eq(col, uid);
  if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`${table}: ${error.message}`);
}

// Masters and everything built from them (events, payments, rules, special Blueprint cards, setup state)
async function resetMasters(uid) {
  const { data: bs } = await supabase.from('bp_buckets').select('id, special_kind, master_id, bp_auto, policy_id').eq('user_id', uid);
  const derived = (bs || []).filter(b => b.master_id || b.bp_auto || b.policy_id || ['salary', 'card_due', 'loan_emi', 'loan', 'emergency'].includes(b.special_kind)).map(b => b.id);
  if (derived.length) {
    await supabase.from('bp_links').delete().eq('user_id', uid).in('from_bucket_id', derived);
    await supabase.from('bp_links').delete().eq('user_id', uid).in('to_bucket_id', derived);
    await supabase.from('bp_bucket_assets').delete().eq('user_id', uid).in('bucket_id', derived);
    await supabase.from('bp_buckets').delete().eq('user_id', uid).in('id', derived);
  }
  await supabase.from('expense_transactions').update({ master_id: null }).eq('user_id', uid).not('master_id', 'is', null);
  await del('event_payments', 'owner_id', uid);
  await del('recurring_events', 'owner_id', uid);
  await del('money_masters', 'owner_id', uid);
  await del('insurance_policies', 'owner_id', uid);
  await del('user_sms_rules', 'user_id', uid);
  await supabase.from('users').update({ bp_special: null, sms_setup_at: null }).eq('id', uid);
}

// Everything the account owns, then a fresh dummy portfolio
async function resetAll(uid) {
  await resetMasters(uid);
  for (const t of ['bp_comments', 'bp_attachments', 'bp_bucket_assets', 'bp_links', 'bp_buckets', 'bp_layers', 'bp_boards'])
    await del(t, 'user_id', uid);
  for (const t of ['expense_transactions', 'expense_budgets', 'income_entries', 'income_rules', 'expense_rules', 'dividends', 'dividend_income',
    'fixed_deposits', 'recurring_deposits', 'nps_holdings', 'goals', 'asset_balances', 'portfolio_snapshots', 'transactions', 'sync_logs',
    'retirement_plans', 'family_members', 'custom_fields'])
    await del(t, 'user_id', uid);
  await del('household_members', 'owner_id', uid);
  await supabase.from('users').update({ bp_expense_goal: null }).eq('id', uid);
  await seedPortfolio(uid);
}

// POST /api/test/reset { scope: 'masters' | 'all' }
router.post('/test/reset', requireAuth, async (req, res) => {
  try {
    if (!(await testUser(req, res))) return;
    const scope = req.body?.scope === 'all' ? 'all' : 'masters';
    if (scope === 'all') await resetAll(req.user.id); else await resetMasters(req.user.id);
    res.json({ ok: true, scope });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/test/seed -> dummy stocks and funds again, without touching anything else
router.post('/test/seed', requireAuth, async (req, res) => {
  try {
    if (!(await testUser(req, res))) return;
    await seedPortfolio(req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
