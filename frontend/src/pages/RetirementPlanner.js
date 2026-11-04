/**
 * Kanalyst — Retirement plan
 *
 * Fills itself from Kanalyst (portfolio, NPS, deposits, bank SMS, Blueprint EMIs) and
 * lets you override any number. Handles several loans, step-up SIPs, EMIs freed after
 * payoff, spending in retirement, and money already set aside for other goals.
 * Saves the plan and keeps the Retirement goal in Blueprint in sync.
 *
 * Hooks live only at the top of each component (never inside JSX conditionals).
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import { retirementAPI } from '../lib/api';
import { amortize, outstandingAfter, payoffDate, simulate, requiredExtra, ageFromDob, CURRENT_YEAR } from '../retirement/engine';
import './RetirementPlanner.css';

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const inr = (v) => {
  const x = n(v), a = Math.abs(x), s = x < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${Math.round(a)}`;
};
const inrFull = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
const uid = () => Math.random().toString(36).slice(2, 9);
const LOAN_TYPES = [['home', 'Home'], ['car', 'Car'], ['education', 'Education'], ['personal', 'Personal'], ['gold', 'Gold'], ['card', 'Card'], ['other', 'Other']];
const DEFAULT_RATE = { home: 8.5, car: 9.5, education: 10, personal: 13, gold: 9, card: 36, other: 10 };

const DEFAULT_SETTINGS = {
  other_assets: 0, other_contrib: 0, step_up: 0, retire_spend_pct: 100,
  inflation: 6, swr: 4, cagr_cons: 10, cagr_opt: 12, target_age: 55, current_age: 35,
  include_loans: true, exclude_mapped: true,
};

// ── Small inputs ─────────────────────────────────────────────────────
function Money({ id, label, value, auto, source, onChange, onReset, suffix, step = 1000, hint }) {
  const overridden = auto !== undefined && auto !== null && value !== auto;
  return (
    <div className="rp-field">
      <div className="rp-field-top">
        <label htmlFor={id}>{label}</label>
        {source && !overridden && <span className="rp-src">{source}</span>}
        {overridden && (
          <button type="button" className="rp-src edited" onClick={onReset} title={`Kanalyst has ${inrFull(auto)}${source ? ' from ' + source : ''}`}>
            Edited · use {suffix ? auto : inr(auto)} ↺
          </button>
        )}
      </div>
      <div className="rp-input-wrap">
        {!suffix && <span className="rp-pre">₹</span>}
        <input id={id} type="number" inputMode="decimal" className={`rp-input ${suffix ? 'has-suf' : 'has-pre'}`} value={value || ''}
          placeholder="0" step={step} min={0} onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))} />
        {suffix && <span className="rp-suf">{suffix}</span>}
      </div>
      {hint && <div className="rp-hint">{hint}</div>}
    </div>
  );
}

function Toggle({ id, checked, onChange, label, sub }) {
  return (
    <label className="rp-toggle-row" htmlFor={id}>
      <span><span className="rp-toggle-label">{label}</span>{sub && <span className="rp-toggle-sub">{sub}</span>}</span>
      <span className="rp-switch"><input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><i /></span>
    </label>
  );
}

// ── Loans ────────────────────────────────────────────────────────────
function LoanRow({ loan, onChange, onRemove }) {
  const am = amortize(loan);
  const end = payoffDate(am);
  const set = (k) => (e) => onChange({ ...loan, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value === '' ? '' : (k === 'name' || k === 'type' ? e.target.value : parseFloat(e.target.value)) });
  return (
    <div className={`rp-loan ${loan.include === false ? 'off' : ''}`}>
      <div className="rp-loan-head">
        <input className="rp-loan-name" value={loan.name} onChange={set('name')} aria-label="Loan name" maxLength={40} />
        <select className="rp-loan-type" value={loan.type} onChange={set('type')} aria-label="Loan type">
          {LOAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" className="rp-icon" onClick={onRemove} aria-label={`Remove ${loan.name}`}>✕</button>
      </div>
      <div className="rp-loan-grid">
        <label><span>Outstanding</span><input type="number" min={0} step={10000} value={loan.outstanding} onChange={set('outstanding')} /></label>
        <label><span>EMI / month</span><input type="number" min={0} step={500} value={loan.emi} onChange={set('emi')} placeholder={am.derivedEmi ? Math.round(am.emi) : '0'} /></label>
        <label><span>Rate % p.a.</span><input type="number" min={0} step={0.1} value={loan.rate} onChange={set('rate')} /></label>
        <label><span>Months left</span><input type="number" min={0} step={1} value={loan.emi > 0 ? '' : loan.tenure} onChange={set('tenure')} placeholder={am.months !== Infinity && am.months > 0 ? am.months : '—'} disabled={n(loan.emi) > 0} /></label>
      </div>
      <div className="rp-loan-foot">
        <span className={`rp-loan-end ${am.status}`}>
          {am.status === 'paid' && n(loan.emi) > 0 ? <span className="rp-loan-ask">Add what you still owe to see when it ends</span>
            : am.status === 'paid' ? 'Paid off'
            : am.status === 'never' ? `EMI is below the monthly interest (${inr(am.interest)}) — it never ends`
            : am.status === 'noplan' ? 'Add an EMI or months left to see when it ends'
            : <>Ends <b>{end.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</b>{am.derivedEmi ? <> · EMI {inr(am.emi)}</> : null} · {Math.round(am.months / 12 * 10) / 10} yrs</>}
        </span>
        <span className="rp-loan-flags">
          <label><input type="checkbox" checked={loan.include !== false} onChange={set('include')} /> Clear before retiring</label>
          <label><input type="checkbox" checked={!!loan.redirect} onChange={set('redirect')} disabled={am.months === Infinity || am.status === 'paid'} /> Invest the EMI after it ends</label>
        </span>
      </div>
      {loan.note && <div className="rp-hint">{loan.note}</div>}
    </div>
  );
}

function Section({ id, title, sum, open, onToggle, children }) {
  return (
    <section className={`rp-sec ${open ? 'open' : ''}`}>
      <button type="button" className="rp-sec-head" aria-expanded={!!open} aria-controls={`rp-sec-${id}`} onClick={onToggle}>
        <span className="rp-sec-title">{title}</span>
        <span className="rp-sec-sum">{sum}</span>
        <span className="rp-chev" aria-hidden="true">⌄</span>
      </button>
      <div className="rp-sec-body" id={`rp-sec-${id}`}><div className="rp-sec-inner">{children}</div></div>
    </section>
  );
}

// ── Main ─────────────────────────────────────────────────────────────
export default function RetirementPlanner() {
  const nav = useNavigate();
  const [auto, setAuto] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [plan, setPlan] = useState(null);          // saved row
  const [ready, setReady] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loans, setLoans] = useState([]);
  const [spendSel, setSpendSel] = useState({});
  const [sipSel, setSipSel] = useState({});
  const [dismissed, setDismissed] = useState([]);
  const [scenario, setScenario] = useState('cons');
  const [saveState, setSaveState] = useState('idle');
  const [showAllYears, setShowAllYears] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalMsg, setGoalMsg] = useState('');
  const [open, setOpen] = useState({ assets: true, invest: true, loans: true, spend: true, growth: false });
  const saveTimer = useRef(null);
  const firstLoad = useRef(true);

  // Load auto-fill and saved plan
  const load = useCallback(async () => {
    setLoadErr('');
    const [a, p] = await Promise.allSettled([retirementAPI.autofill(), retirementAPI.get()]);
    if (a.status !== 'fulfilled') { setLoadErr(a.reason?.response?.data?.error || 'Could not read your Kanalyst data'); }
    const af = a.status === 'fulfilled' ? a.value.data : null;
    const saved = p.status === 'fulfilled' ? p.value.data.plan : null;
    setAuto(af);
    setPlan(saved);
    const d = saved?.data || {};
    setOverrides(d.overrides || {});
    setSettings({ ...DEFAULT_SETTINGS, ...(d.settings || {}), ...(d.settings?.current_age ? {} : { current_age: ageFromDob(af?.profile?.dob) || DEFAULT_SETTINGS.current_age }) });
    setSpendSel(d.spend || {});
    setSipSel(d.sips || {});
    setDismissed(d.dismissed || []);
    if (Array.isArray(d.loans)) setLoans(d.loans);
    else setLoans((af?.loans || []).map(l => ({ id: uid(), include: true, redirect: false, rate: DEFAULT_RATE[l.type] || 9, tenure: '', ...l })));
    setReady(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Auto values ────────────────────────────────────────────────────
  const autoVals = useMemo(() => {
    if (!auto) return {};
    const groups = auto.spending?.groups || [];
    const spend = groups.reduce((s, g) => s + ((spendSel[g.key] ?? g.include) ? g.monthly : 0), 0);
    const sips = (auto.sips || []).reduce((s, x) => s + ((sipSel[x.label] ?? x.regular) ? x.monthly : 0), 0);
    return {
      stocks: auto.assets.stocks.value, mf: auto.assets.mf.value, nps: auto.assets.nps.value, epf: auto.assets.epf.value,
      ppf: auto.assets.ppf.value, ssy: auto.assets.ssy.value, deposits: auto.assets.deposits.value,
      sip: sips, nps_c: auto.contributions.nps.value, epf_c: auto.contributions.epf.value, ppf_c: auto.contributions.ppf.value, rd_c: auto.contributions.rd.value,
      expenses: spend,
    };
  }, [auto, spendSel, sipSel]);
  const val = (k) => (overrides[k] !== undefined ? overrides[k] : n(autoVals[k]));
  const setVal = (k) => (v) => setOverrides(o => ({ ...o, [k]: v }));
  const resetVal = (k) => () => setOverrides(o => { const x = { ...o }; delete x[k]; return x; });
  const setS = (k) => (v) => setSettings(s => ({ ...s, [k]: v }));

  // ── Projection ─────────────────────────────────────────────────────
  const model = useMemo(() => {
    const mapped = settings.exclude_mapped ? n(auto?.otherGoals?.total) : 0;
    const assetsTotal = val('stocks') + val('mf') + val('nps') + val('epf') + val('ppf') + val('ssy') + val('deposits') + n(settings.other_assets);
    const start = Math.max(0, assetsTotal - mapped);
    const monthly = val('sip') + val('nps_c') + val('epf_c') + val('ppf_c') + val('rd_c') + n(settings.other_contrib);
    const age = n(settings.current_age) || 35;
    const T = Math.max(1, Math.round(n(settings.target_age) - age));
    const base = {
      start, monthly, stepUp: settings.step_up, loans: loans.map(l => ({ ...l, outstanding: n(l.outstanding), emi: n(l.emi), rate: n(l.rate), tenure: n(l.tenure) })),
      monthlyExpenses: val('expenses'), retireSpendPct: settings.retire_spend_pct, inflation: settings.inflation, swr: settings.swr,
      includeLoans: settings.include_loans, horizon: Math.min(60, Math.max(T + 10, 25)),
    };
    const run = (r) => {
      const p = { ...base, r };
      const s = simulate(p);
      const extra = requiredExtra(p, T);
      return { ...s, extra, T, atT: s.rows[Math.min(T, s.rows.length - 1)] };
    };
    const cons = run(settings.cagr_cons), opt = run(settings.cagr_opt);
    const emiTotal = loans.filter(l => l.include !== false).reduce((s, l) => s + amortize({ ...l, outstanding: n(l.outstanding), emi: n(l.emi), rate: n(l.rate), tenure: n(l.tenure) }).emi, 0);
    return { start, assetsTotal, mapped, monthly, age, T, cons, opt, emiTotal };
    // eslint-disable-next-line
  }, [overrides, autoVals, settings, loans, auto]);
  const cur = scenario === 'opt' ? model.opt : model.cons;

  // ── Save (debounced) and sync the Blueprint goal ───────────────────
  const goalPayload = useCallback(() => {
    const yr = CURRENT_YEAR + model.T;
    const dob = auto?.profile?.dob ? new Date(auto.profile.dob) : null;
    const date = dob ? `${yr}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(Math.min(28, dob.getDate())).padStart(2, '0')}` : `${yr}-12-31`;
    return { target: Math.round(model.cons.atT.magic), date };   // Blueprint uses the conservative number
  }, [model, auto]);

  useEffect(() => {
    if (!ready) return undefined;
    if (firstLoad.current) { firstLoad.current = false; return undefined; }
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const r = await retirementAPI.save({ v: 2, overrides, settings, loans, spend: spendSel, sips: sipSel, dismissed }, goalPayload());
        setPlan(r.data.plan);
        setSaveState('saved');
      } catch (e) { setSaveState('error'); }
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [overrides, settings, loans, spendSel, sipSel, dismissed, ready, goalPayload]);

  // ── Blueprint goal actions ─────────────────────────────────────────
  const linkGoal = async (bucketId) => {
    setGoalBusy(true); setGoalMsg('');
    try {
      await retirementAPI.linkGoal({ bucket_id: bucketId || null, ...goalPayload(), name: 'Retirement' });
      await load();
      setGoalMsg(bucketId ? 'Linked. Blueprint now shows this plan’s target.' : 'Created a Retirement goal in Blueprint and linked it.');
    } catch (e) { setGoalMsg(e?.response?.data?.error || 'Could not link the goal'); }
    finally { setGoalBusy(false); }
  };
  const unlinkGoal = async () => {
    setGoalBusy(true);
    try { await retirementAPI.unlinkGoal(); await load(); setGoalMsg('Unlinked. The goal stays in Blueprint.'); }
    catch (e) { setGoalMsg('Could not unlink'); }
    finally { setGoalBusy(false); }
  };

  if (!ready) return <div className="rp"><div className="rp-loading"><span className="rp-spin" /> Reading your portfolio, deposits, NPS and bank SMS…</div></div>;

  // ── Derived display ────────────────────────────────────────────────
  const age = model.age;
  const crossY = cur.crossWith;
  const retireYear = crossY !== null ? CURRENT_YEAR + crossY : null;
  const targetYear = CURRENT_YEAR + model.T;
  const atT = cur.atT;
  const onTrack = atT.corpus >= atT.magic;
  const linked = (auto?.retireGoals || []).find(g => g.linked);
  const candidates = (auto?.retireGoals || []).filter(g => !g.linked);
  const newLoanSuggestions = (auto?.loans || []).filter(l => !loans.some(x => x.source_id === l.source_id) && !dismissed.includes(l.source_id));
  const spending = auto?.spending || { groups: [], months: [] };
  const staleDays = spending.lastSync ? Math.round((Date.now() - new Date(spending.lastSync)) / 864e5) : null;

  const chart = cur.rows.map(r => ({ year: r.year, age: age + r.y, corpus: Math.round(r.corpus), noSip: Math.round(r.corpusNoSip), magic: Math.round(r.magic), loans: Math.round(r.loansLeft) }));
  const loanEnds = loans.filter(l => l.include !== false).map(l => ({ l, end: payoffDate(amortize({ ...l, outstanding: n(l.outstanding), emi: n(l.emi), rate: n(l.rate), tenure: n(l.tenure) })) })).filter(x => x.end);
  const keyYears = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, model.T, crossY].filter(v => v !== null));
  const tableRows = showAllYears ? cur.rows : cur.rows.filter(r => keyYears.has(r.y));


  return (
    <div className="rp">
      {/* Header */}
      <header className="rp-head">
        <div>
          <h2>Retirement plan</h2>
          <p>Filled in from your Kanalyst data. Change any number; your edits are saved.</p>
        </div>
        <div className="rp-head-right">
          <span className={`rp-save ${saveState}`}>{{ idle: plan ? 'Saved' : 'Not saved yet', pending: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Could not save' }[saveState]}</span>
          <div className="rp-seg" role="radiogroup" aria-label="Growth scenario">
            <button role="radio" aria-checked={scenario === 'cons'} className={scenario === 'cons' ? 'on' : ''} onClick={() => setScenario('cons')}>Conservative {settings.cagr_cons}%</button>
            <button role="radio" aria-checked={scenario === 'opt'} className={scenario === 'opt' ? 'on' : ''} onClick={() => setScenario('opt')}>Optimistic {settings.cagr_opt}%</button>
          </div>
        </div>
      </header>
      {loadErr && <div className="rp-banner warn">{loadErr}. You can still enter numbers by hand.</div>}

      {/* Hero */}
      <div className="rp-hero">
        <div className="rp-hero-main">
          <div className="rp-k">On this plan you can retire</div>
          {retireYear
            ? <div className="rp-big">{retireYear}<span> at age {age + crossY}</span></div>
            : <div className="rp-big none">Not before age {age + cur.H}</div>}
          <div className="rp-sub">
            {retireYear ? `${crossY} years from now` : 'Invest more, lower spending, or raise the growth rate'} · corpus today {inr(model.start)}
            {model.mapped > 0 && <> (after setting aside {inr(model.mapped)} for other goals)</>}
          </div>
        </div>
        <div className={`rp-target ${onTrack ? 'ok' : 'short'}`}>
          <div className="rp-target-top">
            <span className="rp-k">Your target</span>
            <span className="rp-stepper">
              <button type="button" onClick={() => setS('target_age')(Math.max(age + 1, n(settings.target_age) - 1))} aria-label="Retire a year earlier">−</button>
              <b>Age {settings.target_age}</b>
              <button type="button" onClick={() => setS('target_age')(Math.min(80, n(settings.target_age) + 1))} aria-label="Retire a year later">+</button>
            </span>
          </div>
          <div className="rp-target-row"><span>Needed in {targetYear}</span><b>{inr(atT.magic)}</b></div>
          <div className="rp-target-row"><span>You’ll have</span><b>{inr(atT.corpus)}</b></div>
          <div className="rp-verdict">
            {onTrack
              ? <>On track · {inr(atT.corpus - atT.magic)} to spare</>
              : cur.extra === Infinity ? <>Not reachable by {targetYear} at this growth rate</>
              : <>Invest <b>{inrFull(cur.extra)}</b> more a month to retire at {settings.target_age}</>}
          </div>
        </div>
        <div className="rp-goal">
          <div className="rp-k">Retirement goal in Blueprint</div>
          {linked ? (
            <>
              <div className="rp-goal-name">{linked.name}</div>
              <div className="rp-goal-row"><span>Target from this plan</span><b>{inr(linked.target_amount)}</b></div>
              <div className="rp-goal-row"><span>Funds mapped there</span><b>{inr(linked.current_value)}</b></div>
              <div className="rp-goal-actions">
                <button type="button" className="rp-btn" onClick={() => nav('/blueprint')}>Open Blueprint</button>
                <button type="button" className="rp-btn ghost" disabled={goalBusy} onClick={unlinkGoal}>Unlink</button>
              </div>
              <div className="rp-hint">Blueprint uses the conservative number and your target year. It updates when you save here.</div>
            </>
          ) : (
            <>
              <p className="rp-goal-p">Link a goal so Blueprint shows {inr(model.cons.atT.magic)} by {targetYear} and tracks the funds you map to it.</p>
              <div className="rp-goal-actions">
                {candidates.slice(0, 2).map(g => (
                  <button key={g.id} type="button" className="rp-btn" disabled={goalBusy} onClick={() => linkGoal(g.id)}>Link “{g.name}”</button>
                ))}
                <button type="button" className={`rp-btn ${candidates.length ? 'ghost' : 'primary'}`} disabled={goalBusy} onClick={() => linkGoal(null)}>Create Retirement goal</button>
              </div>
            </>
          )}
          {goalMsg && <div className="rp-hint ok">{goalMsg}</div>}
        </div>
      </div>

      {/* Chart */}
      <div className="rp-card">
        <div className="rp-card-head">
          <div><div className="rp-card-title">Corpus vs what you need</div><div className="rp-card-sub">Magic number = yearly spending ÷ {settings.swr}% withdrawal rate{settings.include_loans ? ', plus loans still owed' : ''}</div></div>
          <div className="rp-legend"><span><i className="c" />With investing</span><span><i className="ns" />If you stop investing</span><span><i className="m" />Magic number</span>{loans.length > 0 && settings.include_loans && <span><i className="l" />Loans left</span>}</div>
        </div>
        <ResponsiveContainer width="100%" height={330}>
          <ComposedChart data={chart} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="rpC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--mint)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--mint)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--border-2)' }} />
            <YAxis tickFormatter={inr} tick={{ fontSize: 11, fill: 'var(--text-3)' }} width={66} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v, k) => [inrFull(v), { corpus: 'With investing', noSip: 'If you stop investing', magic: 'Magic number', loans: 'Loans left' }[k] || k]}
              labelFormatter={(y) => `${y} · age ${age + (y - CURRENT_YEAR)}`}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, fontSize: 12 }} />
            {settings.include_loans && <Area type="monotone" dataKey="loans" stroke="var(--coral)" strokeWidth={1} fill="var(--coral-soft)" fillOpacity={1} />}
            <Area type="monotone" dataKey="corpus" stroke="var(--mint)" strokeWidth={2.6} fill="url(#rpC)" />
            <Line type="monotone" dataKey="noSip" stroke="var(--text-3)" strokeWidth={1.6} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="magic" stroke="var(--indigo)" strokeWidth={2.4} dot={false} />
            <ReferenceLine x={targetYear} stroke="var(--gold)" strokeDasharray="3 3" label={{ value: `Target · ${settings.target_age}`, position: 'insideTopRight', fontSize: 11, fill: 'var(--gold)' }} />
            {loanEnds.map(({ l, end }) => (
              <ReferenceLine key={l.id} x={end.getFullYear()} stroke="var(--coral)" strokeOpacity={0.5} strokeDasharray="2 4" />
            ))}
            {crossY !== null && <ReferenceDot x={retireYear} y={chart[crossY]?.corpus} r={6} fill="var(--mint)" stroke="var(--surface)" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
        {loanEnds.length > 0 && (
          <div className="rp-ends">
            <span className="rp-k">Loans end</span>
            {loanEnds.sort((a, b) => a.end - b.end).map(({ l, end }) => (
              <span key={l.id} className="rp-end-chip">{l.name} · {end.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}{l.redirect ? ' · EMI then invested' : ''}</span>
            ))}
          </div>
        )}
      </div>

      {/* Inputs */}
      <div className="rp-grid">
        <Section id="assets" open={open.assets} onToggle={() => setOpen(o => ({ ...o, assets: !o.assets }))} title="What you have today" sum={inr(model.assetsTotal)}>
          <div className="rp-fields">
            <Money id="rp-mf" label="Mutual funds" value={val('mf')} auto={autoVals.mf} source={auto?.assets.mf.source} onChange={setVal('mf')} onReset={resetVal('mf')} />
            <Money id="rp-st" label="Stocks" value={val('stocks')} auto={autoVals.stocks} source={auto?.assets.stocks.source} onChange={setVal('stocks')} onReset={resetVal('stocks')} />
            <Money id="rp-nps" label="NPS" value={val('nps')} auto={autoVals.nps} source={auto?.assets.nps.source} onChange={setVal('nps')} onReset={resetVal('nps')} />
            <Money id="rp-epf" label="EPF" value={val('epf')} auto={autoVals.epf} source={autoVals.epf ? auto?.assets.epf.source : null} onChange={setVal('epf')} onReset={resetVal('epf')} />
            <Money id="rp-ppf" label="PPF" value={val('ppf')} auto={autoVals.ppf} source={autoVals.ppf ? auto?.assets.ppf.source : null} onChange={setVal('ppf')} onReset={resetVal('ppf')} />
            <Money id="rp-ssy" label="SSY" value={val('ssy')} auto={autoVals.ssy} source={autoVals.ssy ? auto?.assets.ssy.source : null} onChange={setVal('ssy')} onReset={resetVal('ssy')} />
            <Money id="rp-dep" label="FDs and RDs" value={val('deposits')} auto={autoVals.deposits} source={autoVals.deposits ? auto?.assets.deposits.source : null} onChange={setVal('deposits')} onReset={resetVal('deposits')} />
            <Money id="rp-oth" label="Anything else for retirement" value={settings.other_assets} onChange={setS('other_assets')} hint="Gold, property you will sell, etc." />
          </div>
          {n(auto?.otherGoals?.total) > 0 && (
            <div className="rp-callout">
              <Toggle id="rp-excl" checked={settings.exclude_mapped} onChange={setS('exclude_mapped')}
                label={`Leave out ${inr(auto.otherGoals.total)} already mapped to other goals`}
                sub={auto.otherGoals.goals.slice(0, 4).map(g => `${g.name} ${inr(g.value)}`).join(' · ')} />
            </div>
          )}
        </Section>

        <Section id="invest" open={open.invest} onToggle={() => setOpen(o => ({ ...o, invest: !o.invest }))} title="What you invest each month" sum={`${inr(model.monthly)}/mo`}>
          {(auto?.sips || []).length > 0 && (
            <div className="rp-list">
              <div className="rp-list-title">SIPs and fund buys found in bank SMS <span>({spending.months.join(', ')})</span></div>
              {auto.sips.map(s => {
                const on = sipSel[s.label] ?? s.regular;
                return (
                  <label key={s.label} className={`rp-li ${on ? '' : 'off'}`}>
                    <input type="checkbox" checked={on} onChange={(e) => setSipSel(x => ({ ...x, [s.label]: e.target.checked }))} />
                    <span className="nm">{s.label}<small>{s.months} of {spending.months.length} months{s.regular ? '' : ' · looks one-off'}</small></span>
                    <b>{inr(s.monthly)}/mo</b>
                  </label>
                );
              })}
            </div>
          )}
          <div className="rp-fields">
            <Money id="rp-sip" label="SIPs, total" value={val('sip')} auto={autoVals.sip} source={autoVals.sip ? 'Bank SMS' : null} onChange={setVal('sip')} onReset={resetVal('sip')} step={500} />
            <Money id="rp-npsc" label="NPS contribution" value={val('nps_c')} auto={autoVals.nps_c} source={auto?.contributions.nps.source} onChange={setVal('nps_c')} onReset={resetVal('nps_c')} step={500} />
            <Money id="rp-epfc" label="EPF (yours + employer)" value={val('epf_c')} auto={autoVals.epf_c} source={auto?.contributions.epf.source} onChange={setVal('epf_c')} onReset={resetVal('epf_c')} step={500} hint={autoVals.epf_c ? null : 'Not in SMS. Check your payslip'} />
            <Money id="rp-ppfc" label="PPF" value={val('ppf_c')} auto={autoVals.ppf_c} source={auto?.contributions.ppf.source} onChange={setVal('ppf_c')} onReset={resetVal('ppf_c')} step={500} />
            <Money id="rp-rdc" label="RD instalments" value={val('rd_c')} auto={autoVals.rd_c} source={auto?.contributions.rd.source} onChange={setVal('rd_c')} onReset={resetVal('rd_c')} step={500} />
            <Money id="rp-othc" label="Other monthly investing" value={settings.other_contrib} onChange={setS('other_contrib')} step={500} />
            <Money id="rp-step" label="Raise investing each year by" value={settings.step_up} onChange={setS('step_up')} suffix="%" step={1} hint="A yearly step-up, e.g. 5% with each salary hike" />
          </div>
        </Section>

        <Section id="loans" open={open.loans} onToggle={() => setOpen(o => ({ ...o, loans: !o.loans }))} title="Loans" sum={loans.length ? `${loans.length} · EMI ${inr(model.emiTotal)}/mo` : 'None'}>
          {newLoanSuggestions.length > 0 && (
            <div className="rp-suggest">
              {newLoanSuggestions.map(l => (
                <div key={l.source_id} className="rp-suggest-row">
                  <span><b>{l.name}</b> found{l.emi ? ` · EMI ${inr(l.emi)}/mo` : ''}{l.outstanding ? ` · ${inr(l.outstanding)} owed` : ''}<small>{l.note}</small></span>
                  <span className="rp-suggest-actions">
                    <button type="button" className="rp-btn sm" onClick={() => setLoans(x => [...x, { id: uid(), include: true, redirect: false, rate: DEFAULT_RATE[l.type] || 9, tenure: '', ...l }])}>Add</button>
                    <button type="button" className="rp-btn sm ghost" onClick={() => setDismissed(d => [...d, l.source_id])}>Ignore</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {loans.length === 0 && <div className="rp-empty">No loans. Add one to see when it ends and how it changes your number.</div>}
          <div className="rp-loans">
            {loans.map(l => (
              <LoanRow key={l.id} loan={l}
                onChange={(nl) => setLoans(x => x.map(y => y.id === l.id ? nl : y))}
                onRemove={() => { setLoans(x => x.filter(y => y.id !== l.id)); if (l.source_id) setDismissed(d => [...d, l.source_id]); }} />
            ))}
          </div>
          <div className="rp-row-between">
            <button type="button" className="rp-btn" onClick={() => setLoans(x => [...x, { id: uid(), name: 'New loan', type: 'home', outstanding: 0, emi: 0, rate: 8.5, tenure: '', include: true, redirect: false, source: 'manual' }])}>+ Add a loan</button>
            <span className="rp-hint">The Loans module will fill these for you once it’s built.</span>
          </div>
          <Toggle id="rp-incl" checked={settings.include_loans} onChange={setS('include_loans')} label="Count loans still owed in the magic number" sub="You need to clear them before you stop earning" />
        </Section>

        <Section id="spend" open={open.spend} onToggle={() => setOpen(o => ({ ...o, spend: !o.spend }))} title="What you spend" sum={`${inr(val('expenses'))}/mo`}>
          {staleDays !== null && staleDays > 30 && (
            <div className="rp-banner warn">Your phone last synced bank SMS on {new Date(spending.lastSync).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. Open the Android app to sync, so this stays current.</div>
          )}
          {spending.groups.length > 0 ? (
            <div className="rp-list">
              <div className="rp-list-title">Monthly average from bank SMS <span>({spending.months.join(', ')})</span></div>
              {spending.groups.map(g => {
                const on = spendSel[g.key] ?? g.include;
                return (
                  <label key={g.key} className={`rp-li ${on ? '' : 'off'}`}>
                    <input type="checkbox" checked={on} onChange={(e) => setSpendSel(x => ({ ...x, [g.key]: e.target.checked }))} />
                    <span className="nm">{g.label}<small>{g.count} payments{g.note ? ` · ${g.note}` : ''}</small></span>
                    <b>{inr(g.monthly)}/mo</b>
                  </label>
                );
              })}
            </div>
          ) : <div className="rp-empty">No bank SMS yet. Enter your monthly spend below.</div>}
          <div className="rp-fields">
            <Money id="rp-exp" label="Monthly spending today" value={val('expenses')} auto={autoVals.expenses} source={autoVals.expenses ? 'Bank SMS' : null} onChange={setVal('expenses')} onReset={resetVal('expenses')} hint="Leave out EMIs and SIPs, they’re counted separately" />
            <Money id="rp-rsp" label="In retirement you’ll spend" value={settings.retire_spend_pct} onChange={setS('retire_spend_pct')} suffix="% of today" step={5} hint="No commute or school fees may lower it; healthcare raises it" />
            <Money id="rp-inf" label="Inflation" value={settings.inflation} onChange={setS('inflation')} suffix="% a year" step={0.5} />
          </div>
        </Section>

        <Section id="growth" open={open.growth} onToggle={() => setOpen(o => ({ ...o, growth: !o.growth }))} title="Growth and safety" sum={`${settings.cagr_cons}–${settings.cagr_opt}% growth · ${settings.swr}% withdrawal`}>
          <div className="rp-fields">
            <Money id="rp-age" label="Your age today" value={settings.current_age} onChange={setS('current_age')} suffix="yrs" step={1} hint={auto?.profile?.dob ? 'From your profile date of birth' : 'Add your date of birth in your profile'} />
            <Money id="rp-tage" label="Retire at" value={settings.target_age} onChange={setS('target_age')} suffix="yrs" step={1} />
            <Money id="rp-cc" label="Growth, conservative" value={settings.cagr_cons} onChange={setS('cagr_cons')} suffix="% a year" step={0.5} />
            <Money id="rp-co" label="Growth, optimistic" value={settings.cagr_opt} onChange={setS('cagr_opt')} suffix="% a year" step={0.5} />
            <Money id="rp-swr" label="Yearly withdrawal in retirement" value={settings.swr} onChange={setS('swr')} suffix="% of corpus" step={0.25} hint="4% is the common rule; 3–3.5% is safer for an early or long retirement" />
          </div>
          {n(settings.cagr_cons) <= n(settings.inflation) && <div className="rp-banner warn">Conservative growth is at or below inflation. Your corpus can’t outgrow your spending in that case.</div>}
        </Section>
      </div>

      {/* Table */}
      <div className="rp-card">
        <div className="rp-card-head">
          <div className="rp-card-title">Year by year</div>
          <button type="button" className="rp-btn ghost sm" onClick={() => setShowAllYears(s => !s)}>{showAllYears ? 'Key years only' : `All ${cur.rows.length} years`}</button>
        </div>
        <div className="rp-tbl-wrap">
          <table className="rp-tbl">
            <thead><tr><th>Year</th><th>Age</th><th className="r">Invested that year</th><th className="r">Corpus</th><th className="r">Loans left</th><th className="r">Magic number</th><th className="r">Gap</th><th></th></tr></thead>
            <tbody>
              {tableRows.map(r => (
                <tr key={r.y} className={r.y === model.T ? 'is-target' : r.y === crossY ? 'is-cross' : ''}>
                  <td>{r.year}</td><td>{age + r.y}</td>
                  <td className="r">{inr(r.invest)}</td><td className="r">{inr(r.corpus)}</td>
                  <td className="r">{r.loansLeft > 0 ? inr(r.loansLeft) : '—'}</td><td className="r">{inr(r.magic)}</td>
                  <td className={`r ${r.gap >= 0 ? 'pos' : 'neg'}`}>{r.gap >= 0 ? '+' : ''}{inr(r.gap)}</td>
                  <td>{r.y === model.T ? <span className="rp-tag gold">Target</span> : r.y === crossY ? <span className="rp-tag mint">Can retire</span> : r.gap >= 0 ? <span className="rp-tag mint">Ahead</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
