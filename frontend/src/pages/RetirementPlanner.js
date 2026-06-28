import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceDot, ReferenceLine
} from 'recharts';
import api, { portfolioAPI, mfAPI, npsAPI } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers (match house style used elsewhere in Dashboard.js)
// ─────────────────────────────────────────────────────────────────────────
const fmt = (v) => {
  const n = Number(v) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const fmtFull = (v) => '₹' + (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct  = (v) => `${(Number(v) || 0).toFixed(1)}%`;

const CURRENT_YEAR = new Date().getFullYear();

// ─────────────────────────────────────────────────────────────────────────
// Core calculation engine — pure functions, mirrors spec sections 3.1–3.6
// ─────────────────────────────────────────────────────────────────────────

// 3.1 / 3.2 — corpus growth, with and without continued investing
function corpusWithInvesting(start, pmt, r, y) {
  if (r === 0) return start + pmt * y;
  return start * Math.pow(1 + r, y) + pmt * (Math.pow(1 + r, y) - 1) / r;
}
function corpusWithoutInvesting(start, r, y) {
  return start * Math.pow(1 + r, y);
}

// 3.3 — loan amortization, outstanding balance after y years
function loanOutstanding(emi, rMonthly, nTotalMonths, y) {
  const nRemaining = nTotalMonths - y * 12;
  if (nRemaining <= 0) return 0;
  if (rMonthly === 0) return emi * nRemaining; // edge case: 0% interest, linear payoff
  return emi * (1 - Math.pow(1 + rMonthly, -nRemaining)) / rMonthly;
}

// 3.6 — reverse calculation: required PMT to hit a target year
function requiredPMT(magicNumberAtTarget, start, r, yTarget) {
  if (yTarget === 0) return magicNumberAtTarget > start ? Infinity : -1;
  const grown = start * Math.pow(1 + r, yTarget);
  if (r === 0) return (magicNumberAtTarget - grown) / yTarget;
  return (magicNumberAtTarget - grown) * r / (Math.pow(1 + r, yTarget) - 1);
}

// ─────────────────────────────────────────────────────────────────────────
// Small presentational pieces
// ─────────────────────────────────────────────────────────────────────────
function FieldGroup({ title, accent, children }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-xl)', padding: '16px 18px', boxShadow: 'var(--shadow-1)'
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
        letterSpacing: '.1em', textTransform: 'uppercase', color: accent || 'var(--text-3)',
        marginBottom: 12
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function NumField({ label, value, onChange, suffix, prefilled, step = 1000, min = 0 }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{label}</label>
        {prefilled && (
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--mint)',
            background: 'var(--mint-soft)', padding: '1px 5px', borderRadius: 4,
            letterSpacing: '.03em'
          }}>FROM PORTFOLIO</span>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
          style={{
            width: '100%', padding: '8px 36px 8px 10px', borderRadius: 'var(--r-md)',
            border: '1px solid var(--border-2)', background: 'var(--surface-2)',
            color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13,
            boxSizing: 'border-box', outline: 'none'
          }}
        />
        {suffix && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 11, color: 'var(--text-4)'
          }}>{suffix}</span>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, accent, icon }) {
  return (
    <div className="k-tile" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</span>
        {icon && <span style={{ fontSize: 15, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 23, fontWeight: 700, color: accent || 'var(--text)', letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────
export default function RetirementPlanner() {
  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [prefilledFields, setPrefilledFields] = useState({});
  const [inputsOpen, setInputsOpen] = useState(true);
  const [mode, setMode] = useState('forward'); // 'forward' | 'reverse'
  const [scenario, setScenario] = useState('pessimist'); // 'pessimist' | 'optimist'
  const [showFullTable, setShowFullTable] = useState(false);
  const [reverseTargetYear, setReverseTargetYear] = useState(CURRENT_YEAR + 14);

  const [inputs, setInputs] = useState({
    // Assets
    mutual_funds_value: 0,
    stocks_value: 0,
    epf_value: 0,
    nps_value: 0,
    other_assets_value: 0,
    // Liabilities
    loan_principal_outstanding: 0,
    loan_emi: 0,
    loan_interest_rate_annual: 8.5,
    loan_years_remaining: 0,
    include_loan_in_magic_number: true,
    // Contributions
    monthly_sip_total: 0,
    monthly_epf_contribution: 0,
    monthly_nps_contribution: 0,
    // Lifestyle
    monthly_expenses_today: 0,
    inflation_rate_annual: 6,
    safe_withdrawal_rate: 4,
    expected_cagr_pessimist: 10,
    expected_cagr_optimist: 12,
    projection_horizon_years: 30,
  });

  const set = (key) => (val) => setInputs((p) => ({ ...p, [key]: val }));

  // ── Prefill from existing Kanalyst portfolio data ───────────────────────
  useEffect(() => {
    let cancelled = false;
    async function prefill() {
      const filled = {};
      const next = {};

      const [stocksR, mfR, npsR, assetsR, exp0, exp1, exp2] = await Promise.allSettled([
        portfolioAPI.get(),
        mfAPI.get(),
        npsAPI.get(),
        portfolioAPI.assets(),
        fetchMonth(0),
        fetchMonth(1),
        fetchMonth(2),
      ]);

      if (stocksR.status === 'fulfilled') {
        const v = stocksR.value?.data?.summary?.totalMarket;
        if (v != null && v > 0) { next.stocks_value = Math.round(v); filled.stocks_value = true; }
      }
      if (mfR.status === 'fulfilled') {
        const v = mfR.value?.data?.summary?.totalValue;
        if (v != null && v > 0) { next.mutual_funds_value = Math.round(v); filled.mutual_funds_value = true; }
      }
      if (npsR.status === 'fulfilled') {
        const v = npsR.value?.data?.latest?.total_value;
        if (v != null && v > 0) { next.nps_value = Math.round(v); filled.nps_value = true; }
      }
      let assetBalances = null;
      if (assetsR.status === 'fulfilled') {
        assetBalances = assetsR.value?.data;
        if (assetBalances) {
          if (assetBalances.epf > 0) { next.epf_value = Math.round(assetBalances.epf); filled.epf_value = true; }
          const otherSum = (assetBalances.ppf || 0) + (assetBalances.ssy || 0) + (assetBalances.fd || 0);
          if (otherSum > 0) { next.other_assets_value = Math.round(otherSum); filled.other_assets_value = true; }
          if (assetBalances.homeLoan > 0) { next.loan_principal_outstanding = Math.round(assetBalances.homeLoan); filled.loan_principal_outstanding = true; }
          // fall back to generic asset NPS only if the dedicated NPS module had nothing
          if (!filled.nps_value && assetBalances.nps > 0) { next.nps_value = Math.round(assetBalances.nps); filled.nps_value = true; }
        }
      }

      const monthVals = [exp0, exp1, exp2]
        .filter((r) => r.status === 'fulfilled' && r.value?.data?.total_expenses > 0)
        .map((r) => r.value.data.total_expenses);
      if (monthVals.length > 0) {
        const avg = monthVals.reduce((a, b) => a + b, 0) / monthVals.length;
        next.monthly_expenses_today = Math.round(avg);
        filled.monthly_expenses_today = true;
      }

      if (!cancelled) {
        setInputs((p) => ({ ...p, ...next }));
        setPrefilledFields(filled);
        setLoadingPrefill(false);
      }
    }
    function fetchMonth(monthsAgo) {
      const d = new Date();
      d.setMonth(d.getMonth() - monthsAgo);
      const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      return api.get('/api/expense/transactions/summary', { params: { month } });
    }
    prefill().catch(() => setLoadingPrefill(false));
    return () => { cancelled = true; };
  }, []);

  // ── Derived calculation series ──────────────────────────────────────────
  const calc = useMemo(() => {
    const {
      mutual_funds_value, stocks_value, epf_value, nps_value, other_assets_value,
      loan_emi, loan_interest_rate_annual, loan_years_remaining, include_loan_in_magic_number,
      monthly_sip_total, monthly_epf_contribution, monthly_nps_contribution,
      monthly_expenses_today, inflation_rate_annual, safe_withdrawal_rate,
      expected_cagr_pessimist, expected_cagr_optimist, projection_horizon_years,
    } = inputs;

    const start = mutual_funds_value + stocks_value + epf_value + nps_value + other_assets_value;
    const pmtYear1 = (monthly_sip_total + monthly_epf_contribution + monthly_nps_contribution) * 12;
    const r = (scenario === 'optimist' ? expected_cagr_optimist : expected_cagr_pessimist) / 100;
    const swr = Math.max(safe_withdrawal_rate, 2) / 100;
    const inflation = inflation_rate_annual / 100;
    const horizon = Math.min(Math.max(projection_horizon_years, 1), 40);

    const rMonthly = loan_years_remaining > 0
      ? Math.pow(1 + loan_interest_rate_annual / 100, 1 / 12) - 1
      : 0;
    const nTotalMonths = loan_years_remaining * 12;

    const rows = [];
    let crossoverWithSip = null;
    let crossoverNoSip = null;

    for (let y = 0; y <= horizon; y++) {
      const ci = corpusWithInvesting(start, pmtYear1, r, y);
      const cni = corpusWithoutInvesting(start, r, y);
      const annualExpense = monthly_expenses_today * 12 * Math.pow(1 + inflation, y);
      const corpusForExpenses = annualExpense * (1 / swr);
      const loanOut = include_loan_in_magic_number
        ? loanOutstanding(loan_emi, rMonthly, nTotalMonths, y)
        : 0;
      const mn = corpusForExpenses + loanOut;

      const feasibleWithSip = ci >= mn;
      const feasibleNoSip = cni >= mn;
      if (!crossoverWithSip && feasibleWithSip) crossoverWithSip = { year: CURRENT_YEAR + y, yearIndex: y };
      if (!crossoverNoSip && feasibleNoSip) crossoverNoSip = { year: CURRENT_YEAR + y, yearIndex: y };

      rows.push({
        year: CURRENT_YEAR + y, yearIndex: y,
        corpusWithSip: ci, corpusWithoutSip: cni,
        magicNumber: mn, loanOutstanding: loanOut,
        gapWithSip: ci - mn, feasibleWithSip, feasibleNoSip,
      });
    }

    // Reverse mode: required PMT to retire by a chosen target year
    const yTarget = Math.max(0, Math.min(reverseTargetYear - CURRENT_YEAR, horizon));
    const mnAtTarget = rows[yTarget]?.magicNumber ?? 0;
    const reqPmt = requiredPMT(mnAtTarget, start, r, yTarget);
    const reqMonthly = reqPmt > 0 ? reqPmt / 12 : 0;
    const alreadyAchievable = reqPmt <= 0;

    return {
      start, pmtYear1, r, swr, inflation, horizon, rows,
      crossoverWithSip, crossoverNoSip,
      magicNumberToday: rows[0]?.magicNumber ?? 0,
      reverse: { yTarget, mnAtTarget, reqPmt, reqMonthly, alreadyAchievable },
    };
  }, [inputs, scenario, reverseTargetYear]);

  const warnCagrVsInflation = (scenario === 'optimist' ? inputs.expected_cagr_optimist : inputs.expected_cagr_pessimist) <= inputs.inflation_rate_annual;

  // Key years for the collapsed table view
  const keyYearIndices = [0, 5, 10, 15, 20, 25, 30].filter((y) => y <= calc.horizon);
  const tableRows = showFullTable ? calc.rows : calc.rows.filter((r) => keyYearIndices.includes(r.yearIndex));

  const chartData = calc.rows.map((r) => ({
    year: r.year,
    'With investing': Math.round(r.corpusWithSip),
    'Without investing': Math.round(r.corpusWithoutSip),
    'Magic number': Math.round(r.magicNumber),
  }));

  return (
    <div style={{ padding: '24px 28px' }} className="fade-in">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <h2 style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)' }}>
            Retirement Magic Number
          </h2>
          <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 3 }}>
            The corpus you need, the year you'll get there — recalculated the moment you change an assumption
          </div>
        </div>
        <div className="k-seg">
          <button className={mode === 'forward' ? 'on' : ''} onClick={() => setMode('forward')}>When can I retire</button>
          <button className={mode === 'reverse' ? 'on' : ''} onClick={() => setMode('reverse')}>Retire by a target year</button>
        </div>
      </div>

      {!loadingPrefill && Object.keys(prefilledFields).length > 0 && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 18,
          fontSize: 12, color: 'var(--mint)', background: 'var(--mint-soft)',
          border: '1px solid rgba(31,107,74,0.18)', borderRadius: 'var(--r-md)', padding: '6px 12px'
        }}>
          ✓ Pulled {Object.keys(prefilledFields).length} field{Object.keys(prefilledFields).length > 1 ? 's' : ''} straight from your portfolio, NPS and expense history — adjust anything below
        </div>
      )}

      {/* ── Inputs panel ─────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)',
        marginBottom: 22, overflow: 'hidden'
      }}>
        <div
          onClick={() => setInputsOpen((o) => !o)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Your numbers</span>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{inputsOpen ? '⌃ Collapse' : '⌄ Edit assumptions'}</span>
        </div>

        {inputsOpen && (
          <div style={{ padding: '4px 18px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>

            <FieldGroup title="Assets today" accent="var(--lime)">
              <NumField label="Mutual funds" value={inputs.mutual_funds_value} onChange={set('mutual_funds_value')} prefilled={prefilledFields.mutual_funds_value} />
              <NumField label="Direct stocks" value={inputs.stocks_value} onChange={set('stocks_value')} prefilled={prefilledFields.stocks_value} />
              <NumField label="EPF" value={inputs.epf_value} onChange={set('epf_value')} prefilled={prefilledFields.epf_value} />
              <NumField label="NPS" value={inputs.nps_value} onChange={set('nps_value')} prefilled={prefilledFields.nps_value} />
              <NumField label="Other (PPF, SSY, FDs)" value={inputs.other_assets_value} onChange={set('other_assets_value')} prefilled={prefilledFields.other_assets_value} />
            </FieldGroup>

            <FieldGroup title="Loan" accent="var(--coral)">
              <NumField label="Outstanding principal" value={inputs.loan_principal_outstanding} onChange={set('loan_principal_outstanding')} prefilled={prefilledFields.loan_principal_outstanding} />
              <NumField label="Monthly EMI" value={inputs.loan_emi} onChange={set('loan_emi')} step={500} />
              <NumField label="Interest rate" value={inputs.loan_interest_rate_annual} onChange={set('loan_interest_rate_annual')} suffix="% p.a." step={0.1} />
              <NumField label="Years remaining" value={inputs.loan_years_remaining} onChange={set('loan_years_remaining')} suffix="yrs" step={1} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, cursor: 'pointer' }}>
                <span
                  className={`k-toggle ${inputs.include_loan_in_magic_number ? 'on' : ''}`}
                  onClick={() => set('include_loan_in_magic_number')(!inputs.include_loan_in_magic_number)}
                />
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Include payoff in magic number</span>
              </label>
            </FieldGroup>

            <FieldGroup title="Monthly contributions" accent="var(--violet)">
              <NumField label="SIPs (all funds)" value={inputs.monthly_sip_total} onChange={set('monthly_sip_total')} step={500} />
              <NumField label="EPF contribution" value={inputs.monthly_epf_contribution} onChange={set('monthly_epf_contribution')} step={500} />
              <NumField label="NPS contribution" value={inputs.monthly_nps_contribution} onChange={set('monthly_nps_contribution')} step={500} />
              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                Total: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                  {fmtFull(inputs.monthly_sip_total + inputs.monthly_epf_contribution + inputs.monthly_nps_contribution)}/mo
                </span>
              </div>
            </FieldGroup>

            <FieldGroup title="Lifestyle & growth" accent="var(--indigo)">
              <NumField label="Monthly expenses today" value={inputs.monthly_expenses_today} onChange={set('monthly_expenses_today')} prefilled={prefilledFields.monthly_expenses_today} step={1000} />
              <NumField label="Inflation" value={inputs.inflation_rate_annual} onChange={set('inflation_rate_annual')} suffix="% p.a." step={0.5} />
              <NumField label="Safe withdrawal rate" value={inputs.safe_withdrawal_rate} onChange={set('safe_withdrawal_rate')} suffix="%" step={0.5} min={2} />
              <NumField label="Expected CAGR (pessimist)" value={inputs.expected_cagr_pessimist} onChange={set('expected_cagr_pessimist')} suffix="%" step={0.5} />
              <NumField label="Expected CAGR (optimist)" value={inputs.expected_cagr_optimist} onChange={set('expected_cagr_optimist')} suffix="%" step={0.5} />
              <NumField label="Projection horizon" value={inputs.projection_horizon_years} onChange={set('projection_horizon_years')} suffix="yrs" step={1} min={1} />
            </FieldGroup>

          </div>
        )}
      </div>

      {warnCagrVsInflation && (
        <div style={{
          marginBottom: 18, padding: '10px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--gold-soft)', border: '1px solid rgba(168,116,26,0.25)',
          color: 'var(--gold)', fontSize: 12.5
        }}>
          ⚠ Your expected growth rate is at or below inflation — your corpus may never outpace the rising magic number under this scenario.
        </div>
      )}

      {/* ── CAGR sensitivity toggle ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div className="k-seg">
          <button className={scenario === 'pessimist' ? 'on' : ''} onClick={() => setScenario('pessimist')}>Conservative · {inputs.expected_cagr_pessimist}%</button>
          <button className={scenario === 'optimist' ? 'on' : ''} onClick={() => setScenario('optimist')}>Optimistic · {inputs.expected_cagr_optimist}%</button>
        </div>
        {mode === 'reverse' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Target retirement year</span>
            <input
              type="number"
              value={reverseTargetYear}
              onChange={(e) => setReverseTargetYear(parseInt(e.target.value) || CURRENT_YEAR)}
              style={{
                width: 90, padding: '7px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)',
                background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13
              }}
            />
          </div>
        )}
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      {mode === 'forward' ? (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <KPICard label="Current corpus" value={fmt(calc.start)} icon="◈" />
          <KPICard label="Magic number today" value={fmt(calc.magicNumberToday)} icon="🎯" accent="var(--indigo)" />
          <KPICard
            label="Retire by — with SIP"
            value={calc.crossoverWithSip ? calc.crossoverWithSip.year : `Not in ${calc.horizon}yr`}
            sub={calc.crossoverWithSip ? `${calc.crossoverWithSip.yearIndex} years away` : 'Extend horizon or invest more'}
            icon="🚀" accent="var(--mint)"
          />
          <KPICard
            label="Retire by — no further SIP"
            value={calc.crossoverNoSip ? calc.crossoverNoSip.year : `Not in ${calc.horizon}yr`}
            sub={calc.crossoverNoSip ? `${calc.crossoverNoSip.yearIndex} years away` : 'Corpus alone insufficient'}
            icon="⏸" accent="var(--text-3)"
          />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <KPICard label="Target year" value={reverseTargetYear} sub={`${calc.reverse.yTarget} years from now`} icon="🎯" />
          <KPICard label="Corpus needed by then" value={fmt(calc.reverse.mnAtTarget)} icon="◈" accent="var(--indigo)" />
          {calc.reverse.alreadyAchievable ? (
            <KPICard label="Required monthly investment" value="Already achievable" sub="Your existing corpus alone gets there" icon="✅" accent="var(--mint)" />
          ) : (
            <KPICard
              label="Required monthly investment"
              value={fmt(calc.reverse.reqMonthly)}
              sub={calc.reverse.reqMonthly > 150000 ? '⚠ Check this is realistic for your income' : 'Across SIP + EPF + NPS combined'}
              icon="💰" accent={calc.reverse.reqMonthly > 150000 ? 'var(--coral)' : 'var(--mint)'}
            />
          )}
        </div>
      )}

      {/* ── Chart ─────────────────────────────────────────────────────── */}
      <div className="k-card" style={{ padding: '20px 18px 8px', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 14, paddingLeft: 6 }}>
          Corpus vs. magic number — {calc.horizon}-year projection ({scenario === 'optimist' ? 'optimistic' : 'conservative'} growth)
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 11 }} width={70} />
            <Tooltip formatter={(v) => fmtFull(v)} labelFormatter={(y) => `Year ${y}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="With investing" stroke="var(--mint)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Without investing" stroke="var(--text-3)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="Magic number" stroke="var(--coral)" strokeWidth={2} dot={false} />
            {calc.crossoverWithSip && (
              <ReferenceDot x={calc.crossoverWithSip.year} y={chartData[calc.crossoverWithSip.yearIndex]?.['With investing']} r={5} fill="var(--mint)" stroke="var(--surface)" strokeWidth={2} />
            )}
            {calc.crossoverNoSip && (
              <ReferenceDot x={calc.crossoverNoSip.year} y={chartData[calc.crossoverNoSip.yearIndex]?.['Without investing']} r={5} fill="var(--text-3)" stroke="var(--surface)" strokeWidth={2} />
            )}
            {mode === 'reverse' && (
              <ReferenceLine x={reverseTargetYear} stroke="var(--indigo)" strokeDasharray="2 2" label={{ value: 'Target', fontSize: 11, fill: 'var(--indigo)' }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Year-by-year table ────────────────────────────────────────── */}
      <div className="k-card" style={{ padding: '18px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingLeft: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Year-by-year breakdown</span>
          <button className="k-btn-ghost" onClick={() => setShowFullTable((s) => !s)}>
            {showFullTable ? 'Show key years only' : `Show all ${calc.horizon} years`}
          </button>
        </div>
        <table className="k-tbl">
          <thead>
            <tr>
              <th>Year</th>
              <th className="r">With investing</th>
              <th className="r">Without investing</th>
              <th className="r">Magic number</th>
              <th className="r">Gap (with SIP)</th>
              <th className="r">Status</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.yearIndex}>
                <td className="mono">{r.year}</td>
                <td className="r mono">{fmt(r.corpusWithSip)}</td>
                <td className="r mono">{fmt(r.corpusWithoutSip)}</td>
                <td className="r mono">{fmt(r.magicNumber)}</td>
                <td className="r mono" style={{ color: r.gapWithSip >= 0 ? 'var(--mint)' : 'var(--coral)' }}>
                  {r.gapWithSip >= 0 ? '+' : ''}{fmt(r.gapWithSip)}
                </td>
                <td className="r">
                  {r.feasibleWithSip ? (
                    <span className="k-badge k-tinted" style={{ '--c': 'var(--mint)' }}>ON TRACK</span>
                  ) : (
                    <span className="k-badge k-tinted" style={{ '--c': 'var(--text-3)' }}>BUILDING</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
