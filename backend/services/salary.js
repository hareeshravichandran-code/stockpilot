/**
 * Salary for a user, best source first:
 *   1. credits linked to an income master with subtype 'salary' (Masters / Discover)
 *   2. credits categorised 'salary'
 *   3. auto-detected: a large NEFT/IMPS/RTGS credit that lands around month-end (24th–3rd) in most of
 *      the last months, from the same bank. Amount may vary (bonus months, tax changes).
 * Returns { last: {amount, date, title}, monthly (avg of last 3 paid months), months: [...], source, master_id }.
 */
const supabase = require('./supabase');

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const ist = (ms) => new Date(Number(ms) + 5.5 * 3600e3).toISOString().slice(0, 10);
const bankOf = (s) => String(s || '').toUpperCase().split('-').find(p => p.length >= 5) || '';

function summarise(rows, source, masterId = null) {
  if (!rows.length) return null;
  rows.sort((a, b) => Number(b.date_time) - Number(a.date_time));
  const byMonth = {};
  for (const r of rows) { const m = ist(r.date_time).slice(0, 7); byMonth[m] = (byMonth[m] || 0) + num(r.amount); }
  const months = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([month, amount]) => ({ month, amount }));
  const recent = months.slice(0, 3);
  const last = rows[0];
  return {
    source, master_id: masterId,
    last: { amount: num(last.amount), date: ist(last.date_time), title: last.merchant || null },
    monthly: Math.round(recent.reduce((t, m) => t + m.amount, 0) / recent.length),
    months: months.slice(0, 12),
  };
}

async function salaryOf(uid) {
  const since = Date.now() - 400 * 864e5;
  const { data: ms } = await supabase.from('money_masters').select('id').eq('owner_id', uid).eq('kind', 'income').eq('subtype', 'salary').eq('status', 'active');
  if (ms && ms.length) {
    const { data } = await supabase.from('expense_transactions').select('amount, date_time, merchant')
      .eq('user_id', uid).eq('is_deleted', false).eq('type', 'CREDIT').in('master_id', ms.map(m => m.id)).gte('date_time', since);
    const s = summarise(data || [], 'master', ms[0].id);
    if (s) return s;
  }
  const { data: cat } = await supabase.from('expense_transactions').select('amount, date_time, merchant')
    .eq('user_id', uid).eq('is_deleted', false).eq('type', 'CREDIT').eq('category_id', 'salary').gte('date_time', since);
  const c = summarise(cat || [], 'category');
  if (c) return c;

  const { data: credits } = await supabase.from('expense_transactions').select('id, amount, date_time, merchant, sms_sender, payment_type, type')
    .eq('user_id', uid).eq('is_deleted', false).eq('type', 'CREDIT').gte('amount', 15000).gte('date_time', since);
  const rows = detectSalaryRows(credits || []);
  return rows.length ? summarise(rows, 'detected') : null;
}

/** The month-end salary stream among credit rows (needs id, amount, date_time, sms_sender, payment_type). */
function detectSalaryRows(credits) {
  const cand = credits.filter(t => {
    if (t.type && t.type !== 'CREDIT') return false;
    if (num(t.amount) < 15000) return false;
    const day = +ist(t.date_time).slice(8, 10);
    return /NEFT|RTGS|IMPS|BANK_TRANSFER/.test(t.payment_type || '') && (day >= 24 || day <= 3);
  });
  // Group by bank sender; the salary stream is the one present in the most months with the largest median
  const groups = {};
  for (const t of cand) (groups[bankOf(t.sms_sender)] = groups[bankOf(t.sms_sender)] || []).push(t);
  let best = null;
  for (const rows of Object.values(groups)) {
    // keep the biggest credit per salary-month (a month-end credit on the 1st–3rd belongs to the previous month)
    const per = {};
    for (const t of rows) {
      const d = ist(t.date_time);
      const shifted = +d.slice(8, 10) <= 3 ? new Date(Date.parse(d) - 5 * 864e5).toISOString().slice(0, 7) : d.slice(0, 7);
      if (!per[shifted] || num(t.amount) > num(per[shifted].amount)) per[shifted] = t;
    }
    const picks = Object.values(per);
    if (picks.length < 3) continue;
    const amts = picks.map(p => num(p.amount)).sort((a, b) => a - b);
    const median = amts[Math.floor(amts.length / 2)];
    const steady = picks.filter(p => Math.abs(num(p.amount) - median) <= median * 0.45);
    const score = steady.length * Math.log10(median);
    if (steady.length >= 3 && (!best || score > best.score)) best = { score, rows: steady };
  }
  return best ? best.rows : [];
}

module.exports = { salaryOf, detectSalaryRows };
