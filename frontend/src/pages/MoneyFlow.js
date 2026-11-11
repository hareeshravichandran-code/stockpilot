import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { moneyflowAPI, mastersAPI } from '../lib/api';
import { inrShort } from '../money/kinds';
import './MoneyFlow.css';

const SECTIONS = [
  ['income', 'Came in', '#4d6a16'],
  ['expense', 'Spent', '#8C8270'],
  ['investment', 'Invested', '#111111'],
];
const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shortMonth = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function Delta({ actual, expected, goodWhenLow }) {
  if (!expected) return null;
  const pct = Math.round(((actual - expected) / Math.abs(expected)) * 100);
  if (Math.abs(pct) < 3) return <span className="mf-delta flat">on usual</span>;
  const up = pct > 0;
  const good = goodWhenLow ? !up : up;
  return <span className={`mf-delta ${good ? 'good' : 'bad'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

function GroupRows({ groups, color, goodWhenLow, isNow }) {
  const max = Math.max(1, ...groups.map(g => Math.max(g.actual, g.expected)));
  if (!groups.length) return <div className="mf-none">Nothing here this month.</div>;
  return (
    <div className="mf-rows">
      {groups.map(g => (
        <div key={g.key} className={`mf-row${g.uncategorised ? ' unc' : ''}`} title={`${g.count} transaction${g.count === 1 ? '' : 's'}${g.inferred ? ` · ${g.inferred} sorted by your rules` : ''}`}>
          <span className="mf-dot" style={{ background: g.color || color }} />
          <span className="mf-name">{g.name}</span>
          <span className="mf-bar">
            <i style={{ width: `${(g.actual / max) * 100}%`, background: g.color || color }} />
            {g.expected > 0 && <em style={{ left: `${(g.expected / max) * 100}%` }} title={`Usual ${inrShort(g.expected)}`} />}
          </span>
          <span className="mf-amt">{inrShort(g.actual)}</span>
          <span className="mf-exp">{g.expected ? `usual ${inrShort(g.expected)}` : 'new'}</span>
          {!isNow && <Delta actual={g.actual} expected={g.expected} goodWhenLow={goodWhenLow} />}
        </div>
      ))}
    </div>
  );
}

function Trend({ months, current }) {
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense, m.investment]));
  const W = 900, H = 150, pad = 24, bw = 14, gw = (W - pad * 2) / months.length;
  return (
    <svg className="mf-trend" viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="Income, spend and investments over 7 months">
      {[0.5, 1].map(f => <line key={f} x1={pad} x2={W - pad} y1={H - (H - 10) * f} y2={H - (H - 10) * f} className="grid" />)}
      {months.map((m, i) => {
        const x0 = pad + i * gw + gw / 2 - bw * 1.5 - 2;
        const bar = (v, k, c) => <rect key={k} x={x0 + k * (bw + 2)} y={H - (H - 10) * (v / max)} width={bw} height={Math.max(0, (H - 10) * (v / max))} rx="3" fill={c}>
          <title>{`${shortMonth(m.month)} · ${['In', 'Spent', 'Invested'][k]} ${inrShort(v)}`}</title></rect>;
        return (
          <g key={m.month} className={m.month === current ? 'cur' : ''}>
            {bar(m.income, 0, '#2F6B45')}{bar(m.expense, 1, '#8C8270')}{bar(m.investment, 2, '#111111')}
            <text x={pad + i * gw + gw / 2} y={H + 16} textAnchor="middle">{shortMonth(m.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function MoneyFlow({ embedded = false }) {
  const nav = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [made, setMade] = useState({});
  const isNow = month === thisMonth();

  useEffect(() => {
    let live = true;
    setData(null); setErr('');
    moneyflowAPI.get(month).then(r => { if (live) setData(r.data); }).catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load money flow'); });
    return () => { live = false; };
  }, [month]);

  const tiles = useMemo(() => data ? [
    ['income', 'Came in', data.totals.income, false],
    ['expense', 'Spent', data.totals.expense, true],
    ['investment', 'Invested', data.totals.investment, false],
    ['saved', 'Left over', data.totals.saved, false],
  ] : [], [data]);

  const makeSub = async (s) => {
    setMade(m => ({ ...m, [s.merchant]: 'saving' }));
    try {
      await mastersAPI.create({ kind: 'subscription', title: s.merchant, amount: s.amount, frequency: 'monthly', due_day: s.due_day, match: { keywords: s.merchant.toLowerCase() } });
      setMade(m => ({ ...m, [s.merchant]: 'done' }));
    } catch { setMade(m => ({ ...m, [s.merchant]: 'error' })); }
  };

  return (
    <div className={`mf${embedded ? ' mf-embed' : ''}`}>
      <header className="mf-top">
        {!embedded && <button type="button" className="mf-back" onClick={() => nav('/dashboard')} aria-label="Back">‹</button>}
        <div className="mf-brand"><h1>Money flow</h1><small>Income, spending and investments · actual vs your usual month</small></div>
        <div className="mf-month">
          <button type="button" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month">‹</button>
          <b>{monthLabel(month)}</b>
          <button type="button" onClick={() => setMonth(m => addMonths(m, 1))} disabled={isNow} aria-label="Next month">›</button>
        </div>
      </header>

      <main className="mf-main">
        {err && <div className="mf-err">{err}</div>}
        {!data && !err && <div className="mf-skel" />}
        {data && <>
          <section className="mf-tiles">
            {tiles.map(([k, label, t, low]) => (
              <div key={k} className={`mf-tile t-${k}`}>
                <small>{label}{isNow && k !== 'saved' ? ' so far' : ''}</small>
                <b>{k === 'saved' && t.actual < 0 ? '−' : ''}{inrShort(Math.abs(t.actual))}</b>
                <span>Usual {k === 'saved' && t.expected < 0 ? '−' : ''}{inrShort(Math.abs(t.expected))}{!isNow && <Delta actual={t.actual} expected={t.expected} goodWhenLow={low} />}</span>
                {isNow && k === 'expense' && t.expected > 0 && <div className="mf-pace"><i style={{ width: `${Math.min(100, (t.actual / t.expected) * 100)}%` }} className={t.actual > t.expected ? 'over' : ''} /></div>}
              </div>
            ))}
          </section>

          <p className="mf-note">
            “Usual” is the {data.expected_basis.toLowerCase()}.
            {(data.left_out.duplicates > 0 || data.left_out.transfers > 0) && <> Left out: {data.left_out.duplicates > 0 && <><b>{data.left_out.duplicates}</b> repeated SMS for the same payment ({inrShort(data.left_out.duplicate_amount)})</>}
              {data.left_out.duplicates > 0 && data.left_out.transfers > 0 && ' and '}
              {data.left_out.transfers > 0 && <><b>{data.left_out.transfers}</b> transfers between your own accounts ({inrShort(data.left_out.transfer_amount)})</>}.</>}
            {data.uncategorised > 0 && <> <span className="mf-warn">{inrShort(data.uncategorised)} of spending has no category yet</span>: sort it with Manage → Bulk Categorise (here or in the app) and it moves into its group.</>}
          </p>

          <div className="mf-grid">
            <section className="mf-card wide">
              <h2><span style={{ background: '#8C8270' }} />Where it went <small>{inrShort(data.sections.expense.actual)}</small></h2>
              <GroupRows groups={data.sections.expense.groups} color="#8C8270" goodWhenLow isNow={isNow} />
            </section>
            {SECTIONS.filter(s => s[0] !== 'expense').map(([k, title, c]) => (
              <section key={k} className="mf-card">
                <h2><span style={{ background: c }} />{title} <small>{inrShort(data.sections[k].actual)}</small></h2>
                <GroupRows groups={data.sections[k].groups} color={c} isNow={isNow} />
              </section>
            ))}
            <section className="mf-card wide">
              <h2>Last 7 months <small className="mf-legend"><i style={{ background: '#2F6B45' }} />In <i style={{ background: '#8C8270' }} />Spent <i style={{ background: '#111111' }} />Invested</small></h2>
              <Trend months={data.months} current={month} />
            </section>
            {data.subscriptions.length > 0 && (
              <section className="mf-card wide">
                <h2><span style={{ background: '#8a5a2b' }} />Looks like subscriptions <small>Same merchant, similar amount, most months</small></h2>
                <div className="mf-subs">
                  {data.subscriptions.map(s => (
                    <div key={s.merchant} className="mf-sub">
                      <div><b>{s.merchant}</b><small>{inrShort(s.amount)}/mo · seen {s.months} of 6 months · last {new Date(s.last + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></div>
                      {made[s.merchant] === 'done' ? <span className="mf-ok">✓ Added to Masters</span>
                        : <button type="button" disabled={made[s.merchant] === 'saving'} onClick={() => makeSub(s)}>{made[s.merchant] === 'error' ? 'Try again' : 'Make it a subscription'}</button>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>}
      </main>
    </div>
  );
}
