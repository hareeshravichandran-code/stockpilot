// Kanalyst — retirement engine (pure functions, no React)
// Year-by-year simulation so loans, step-ups and freed EMIs can change over time.

export const CURRENT_YEAR = new Date().getFullYear();
const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

// ── Loans ────────────────────────────────────────────────────────────
// Standard Indian EMI maths: monthly rate = annual / 12.
export function amortize(loan) {
  const P = n(loan.outstanding), i = n(loan.rate) / 1200;
  let E = n(loan.emi);
  const T = Math.round(n(loan.tenure));
  if (P <= 0) return { months: 0, emi: E, status: 'paid' };
  if (E > 0) {
    if (i === 0) return { months: Math.ceil(P / E), emi: E, status: 'ok' };
    if (E <= P * i) return { months: Infinity, emi: E, status: 'never', interest: P * i };
    return { months: Math.ceil(-Math.log(1 - (i * P) / E) / Math.log(1 + i)), emi: E, status: 'ok' };
  }
  if (T > 0) {
    E = i === 0 ? P / T : (P * i) / (1 - Math.pow(1 + i, -T));
    return { months: T, emi: E, status: 'ok', derivedEmi: true };
  }
  return { months: Infinity, emi: 0, status: 'noplan' };   // no EMI and no tenure: owed in full until cleared
}

export function outstandingAfter(loan, months, am = amortize(loan)) {
  const P = n(loan.outstanding), i = n(loan.rate) / 1200, E = am.emi;
  if (P <= 0) return 0;
  if (am.months !== Infinity && months >= am.months) return 0;
  if (am.status === 'noplan' || am.status === 'never') return P;
  if (i === 0) return Math.max(0, P - E * months);
  const g = Math.pow(1 + i, months);
  return Math.max(0, P * g - (E * (g - 1)) / i);
}

export function payoffDate(am, from = new Date()) {
  if (!am || am.months === Infinity || am.months <= 0) return null;
  const d = new Date(from.getFullYear(), from.getMonth() + am.months, 1);
  return d;
}

// ── Projection ───────────────────────────────────────────────────────
// p: { start, monthly, stepUp, loans[], monthlyExpenses, retireSpendPct, inflation, swr, r, horizon, includeLoans }
export function simulate(p, extraMonthly = 0) {
  const r = n(p.r) / 100, inf = n(p.inflation) / 100, swr = Math.max(n(p.swr), 2) / 100, step = n(p.stepUp) / 100;
  const H = Math.max(1, Math.min(60, Math.round(n(p.horizon)) || 40));
  const loans = (p.loans || []).filter(l => l.include !== false).map(l => ({ l, am: amortize(l) }));
  const base = n(p.monthly) + n(extraMonthly);
  const spend = n(p.monthlyExpenses) * (n(p.retireSpendPct || 100) / 100);

  const rows = [];
  let c = n(p.start), c0 = n(p.start);
  let crossWith = null, crossWithout = null;
  for (let y = 0; y <= H; y++) {
    const loansLeft = loans.reduce((s, x) => s + outstandingAfter(x.l, y * 12, x.am), 0);
    const magic = (spend * 12 * Math.pow(1 + inf, y)) / swr + (p.includeLoans !== false ? loansLeft : 0);
    if (crossWith === null && c >= magic && magic > 0) crossWith = y;
    if (crossWithout === null && c0 >= magic && magic > 0) crossWithout = y;
    // money invested during this year
    let freed = 0;
    for (const x of loans) {
      if (!x.l.redirect || x.am.months === Infinity || n(x.l.outstanding) <= 0) continue;
      const afterPayoff = Math.max(0, Math.min(12, (y + 1) * 12 - x.am.months));
      freed += x.am.emi * afterPayoff;
    }
    const invest = base * 12 * Math.pow(1 + step, y) + freed;
    rows.push({ y, year: CURRENT_YEAR + y, corpus: c, corpusNoSip: c0, magic, loansLeft, invest, gap: c - magic });
    c = c * (1 + r) + invest;
    c0 = c0 * (1 + r);
  }
  return { rows, crossWith, crossWithout, H };
}

// Extra monthly investment needed so the corpus meets the magic number at year T
export function requiredExtra(p, T) {
  const ok = (e) => { const s = simulate({ ...p, horizon: Math.max(T, 1) }, e); return s.rows[T].corpus >= s.rows[T].magic; };
  if (ok(0)) return 0;
  let lo = 0, hi = 50000;
  while (!ok(hi) && hi < 1e9) hi *= 2;
  if (hi >= 1e9) return Infinity;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi / 100) * 100;
}

export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
}
