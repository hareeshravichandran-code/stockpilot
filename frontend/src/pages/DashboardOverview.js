/**
 * Kanalyst — Dashboard overview (net worth hero, monthly money, goals snapshot)
 * Pure presentation: all figures come from the Dashboard page's existing state.
 * Hooks live only in these child components (never inside JSX conditionals).
 */
import { useEffect, useRef, useState } from 'react';
import { blueprintAPI } from '../lib/api';
import { dueDate, daysUntil, relTime, attention } from '../blueprint/geom';
import './DashboardOverview.css';

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

export function inr(v, { full = false } = {}) {
  const x = n(v), a = Math.abs(x), sign = x < 0 ? '−' : '';
  if (full) return sign + '₹' + Math.round(a).toLocaleString('en-IN');
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(a)}`;
}

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};

// Counts up to a value once, then follows changes smoothly
function CountUp({ value, format = inr, hidden }) {
  const [shown, setShown] = useState(reduceMotion() ? value : 0);
  const from = useRef(reduceMotion() ? value : 0);
  useEffect(() => {
    if (reduceMotion()) { setShown(value); return undefined; }
    const start = performance.now(), a = from.current, b = n(value), dur = 900;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (hidden) return <span className="ov-masked">₹ ••••</span>;
  return <span>{format(shown)}</span>;
}

// ── Net worth hero ────────────────────────────────────────────────
export function NetWorthHero({ parts, liabilities, hideValues, asOf, onUpdateBalances }) {
  const total = parts.reduce((s, p) => s + n(p.value), 0);
  const owed = n(liabilities);
  const shown = parts.filter(p => n(p.value) > 0).sort((a, b) => n(b.value) - n(a.value));
  const [hover, setHover] = useState(null);

  return (
    <section className="ov-hero" aria-label="Net worth">
      <div className="ov-hero-top">
        <div className="ov-hero-main">
          <div className="ov-label">Net worth</div>
          <div className="ov-hero-value"><CountUp value={total} hidden={hideValues} /></div>
          <div className="ov-hero-sub">
            {shown.length} asset types{asOf ? <> · stocks as per CAS of {asOf}</> : null}
          </div>
        </div>
        <div className="ov-hero-side">
          <div className="ov-side-row">
            <span>You owe</span>
            <b className={owed > 0 ? 'neg' : ''}>{hideValues ? '₹ ••••' : inr(owed)}</b>
          </div>
          <div className="ov-side-row strong">
            <span>After loans</span>
            <b>{hideValues ? '₹ ••••' : inr(total - owed)}</b>
          </div>
          <button className="ov-link-btn" onClick={onUpdateBalances}>Update PPF, EPF, NPS, FD balances</button>
        </div>
      </div>

      {total > 0 && (
        <>
          <div className="ov-alloc" role="img" aria-label="Asset allocation">
            {shown.map((p, i) => (
              <span key={p.name} className={`ov-alloc-seg ${hover && hover !== p.name ? 'dim' : ''}`}
                style={{ flexGrow: n(p.value), background: p.color, animationDelay: `${i * 70}ms` }}
                onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}
                title={`${p.name}: ${inr(p.value)} (${Math.round(n(p.value) / total * 100)}%)`} />
            ))}
          </div>
          <ul className="ov-alloc-legend">
            {shown.map(p => (
              <li key={p.name} className={hover === p.name ? 'on' : ''}
                onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}>
                <i style={{ background: p.color }} />
                <span className="nm">{p.name}</span>
                <span className="pc">{Math.round(n(p.value) / total * 100)}%</span>
                <span className="vl">{hideValues ? '••••' : inr(p.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ── Monthly money tiles ───────────────────────────────────────────
function Meter({ value, max, tone }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="ov-meter"><span className={`tone-${tone}`} style={{ width: `${pct}%` }} /></span>;
}

export function MoneyTiles({ income, spent, dividends, yieldPct, hideValues }) {
  const saved = n(income) - n(spent);
  const rate = n(income) > 0 ? Math.round((saved / n(income)) * 100) : null;
  const spendShare = n(income) > 0 ? Math.round((n(spent) / n(income)) * 100) : null;
  const spendTone = spendShare === null ? 'muted' : spendShare > 90 ? 'coral' : spendShare > 70 ? 'gold' : 'mint';

  const tiles = [
    {
      key: 'income', label: 'Income this month', value: income, tone: 'teal',
      sub: n(income) > 0 ? 'Salary and other credits' : 'Add an income rule to track salary',
    },
    {
      key: 'spent', label: 'Spent this month', value: spent, tone: spendTone,
      sub: spendShare !== null ? `${spendShare}% of income` : 'From your transactions',
      meter: spendShare !== null ? <Meter value={n(spent)} max={n(income)} tone={spendTone} /> : null,
    },
    {
      key: 'saved', label: 'Saved this month', value: saved, tone: saved >= 0 ? 'mint' : 'coral',
      sub: rate !== null ? (rate >= 0 ? `Savings rate ${rate}%` : 'Spent more than you earned') : 'Needs income and spending',
      meter: rate !== null && rate > 0 ? <Meter value={rate} max={100} tone={rate >= 30 ? 'mint' : rate >= 15 ? 'gold' : 'coral'} /> : null,
    },
    {
      key: 'div', label: 'Dividends this FY', value: dividends, tone: 'gold',
      sub: n(dividends) > 0 ? `${yieldPct || 0}% yield on market value` : 'Sync dividends to update',
    },
  ];

  return (
    <section className="ov-tiles" aria-label="This month">
      {tiles.map((t, i) => (
        <article key={t.key} className={`ov-tile tone-${t.tone}`} style={{ animationDelay: `${120 + i * 60}ms` }}>
          <div className="ov-label">{t.label}</div>
          <div className="ov-tile-value"><CountUp value={t.value} hidden={hideValues} /></div>
          {t.meter}
          <div className="ov-tile-sub">{t.sub}</div>
        </article>
      ))}
    </section>
  );
}

// ── Goals snapshot from Blueprint ─────────────────────────────────
const RING_R = 15, RING_C = 2 * Math.PI * RING_R;
export function GoalsSnapshot({ hideValues, onOpen }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    blueprintAPI.get()
      .then(r => { if (alive) setState({ status: 'ready', data: r.data }); })
      .catch(() => { if (alive) setState({ status: 'none' }); });
    return () => { alive = false; };
  }, []);

  if (state.status === 'loading') return <section className="ov-card ov-goals"><div className="ov-empty">Loading goals…</div></section>;

  const goals = (state.data?.buckets || []).filter(b => b.kind === 'goal' && b.status !== 'completed' && n(b.target_amount) > 0);
  if (state.status === 'none' || goals.length === 0) {
    return (
      <section className="ov-card ov-goals">
        <header className="ov-card-head"><div><div className="ov-card-title">Goals</div><div className="ov-card-sub">Plan in Blueprint to see progress here</div></div></header>
        <div className="ov-empty">
          <p>Set targets for school fees, insurance, a car or retirement, and map the funds that pay for them.</p>
          <button className="ov-primary" onClick={onOpen}>Open Blueprint</button>
        </div>
      </section>
    );
  }

  const need = goals.reduce((s, g) => s + n(g.target_amount), 0);
  const funded = goals.reduce((s, g) => s + Math.min(n(g.current_value), n(g.target_amount)), 0);
  const pct = need > 0 ? Math.round(funded / need * 100) : 0;
  const upcoming = goals
    .map(g => ({ g, d: dueDate(g) }))
    .filter(x => x.d)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  const flagged = goals.filter(g => attention(g) === 'overdue').length;

  return (
    <section className="ov-card ov-goals">
      <header className="ov-card-head">
        <div>
          <div className="ov-card-title">Goals</div>
          <div className="ov-card-sub">{goals.length} open{flagged ? <> · <em>{flagged} overdue</em></> : null}</div>
        </div>
        <button className="ov-card-action" onClick={onOpen}>Open Blueprint</button>
      </header>
      <div className="ov-goals-sum">
        <div>
          <div className="ov-label">Funded</div>
          <div className="ov-goals-big">{hideValues ? '₹ ••••' : inr(funded)}<span> of {hideValues ? '••••' : inr(need)}</span></div>
        </div>
        <div className="ov-goals-pct">{pct}%</div>
      </div>
      <span className="ov-meter big"><span className="tone-lime" style={{ width: `${Math.min(100, pct)}%` }} /></span>
      <ul className="ov-goal-list">
        {upcoming.map(({ g, d }) => {
          const p = Math.min(100, n(g.target_amount) > 0 ? (n(g.current_value) / n(g.target_amount)) * 100 : 0);
          const days = daysUntil(d);
          const att = attention(g);
          return (
            <li key={g.id} className={att ? `att-${att}` : ''}>
              <svg className="ov-ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r={RING_R} className="trk" />
                <circle cx="18" cy="18" r={RING_R} className="fil" strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - p / 100)} transform="rotate(-90 18 18)" />
              </svg>
              <div className="ov-goal-main">
                <span className="nm">{g.name}</span>
                <span className="dt">{d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {relTime(days)}</span>
              </div>
              <div className="ov-goal-amt">{hideValues ? '••••' : inr(g.target_amount)}<span>{Math.round(p)}%</span></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
