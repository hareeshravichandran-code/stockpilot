/**
 * Kanalyst — Overview (v2). Net worth and this month up top, the next two weeks as a strip (the full month
 * lives in Family calendar), then where the money sits, goals, history and top holdings.
 * Figures come from the Dashboard page; only the strip and goals fetch their own data.
 */
import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { mastersAPI } from '../lib/api';
import { kindOf, KindIcon } from '../money/kinds';
import { inr, GoalsSnapshot, FamilyStrip } from './DashboardOverview';
import useCountUp from '../hooks/useCountUp';
import './OverviewV2.css';

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mkey = (d) => ymd(d).slice(0, 7);

function Money({ v, hidden, full }) {
  const x = useCountUp(n(v));
  if (hidden) return <span className="o3-mask">₹ ••••</span>;
  return <span>{inr(x, { full })}</span>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ── Next 14 days ───────────────────────────────────────────────────
function NextDays({ hidden, onOpenCalendar, onOpenEvents }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let live = true;
    const now = new Date(); const later = new Date(now); later.setDate(now.getDate() + 13);
    const months = [...new Set([mkey(now), mkey(later)])];
    Promise.all(months.map(m => mastersAPI.month(m).then(r => r.data.events || []).catch(() => [])))
      .then(all => { if (live) setEvents(all.flat()); });
    return () => { live = false; };
  }, []);
  const days = useMemo(() => [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }), []);
  const today = ymd(days[0]);
  const by = useMemo(() => {
    const o = {};
    for (const e of events || []) {
      if (e.status === 'past') continue;
      const k = e.status === 'overdue' && e.date < today ? today : e.date;
      (o[k] = o[k] || []).push(e);
    }
    return o;
  }, [events, today]);
  const list = days.flatMap(d => (by[ymd(d)] || []).map(e => ({ ...e, _d: d }))).slice(0, 6);
  const total = days.reduce((a, d) => a + (by[ymd(d)] || []).filter(e => e.dir !== 'in').reduce((s, e) => s + n(e.amount), 0), 0);
  const income = days.reduce((a, d) => a + (by[ymd(d)] || []).filter(e => e.dir === 'in').reduce((s, e) => s + n(e.amount), 0), 0);
  const hot = (e) => e.blink || e.urgent || e.status === 'overdue';
  const peak = Math.max(1, ...days.map(d => (by[ymd(d)] || []).reduce((s, e) => s + n(e.amount), 0)));
  const money = (v) => (hidden ? '••' : inr(v));
  return (
    <section className="o3-card o3-next" aria-label="Next 14 days">
      <header className="o3-head">
        <div><h3>Next 14 days</h3><p>{events === null ? 'Loading…' : `${money(total)} going out${income ? ` · ${money(income)} coming in` : ''}`}</p></div>
        <div className="o3-links">
          <button type="button" onClick={onOpenEvents}>Events</button>
          <button type="button" onClick={onOpenCalendar}>Full calendar ›</button>
        </div>
      </header>
      <div className="o3-strip" role="list">
        {days.map((d, i) => {
          const ev = by[ymd(d)] || []; const sum = ev.reduce((s, e) => s + n(e.amount), 0);
          const isHot = ev.some(hot);
          return (
            <div key={i} role="listitem" className={`o3-day${i === 0 ? ' today' : ''}${d.getDay() === 0 ? ' sun' : ''}${isHot ? ' hot' : ''}${ev.length ? ' has' : ''}`} style={{ '--i': i }}
              title={ev.map(e => `${e.title}${e.amount ? ' ' + inr(e.amount) : ''}`).join('\n') || 'Nothing due'}>
              <small>{i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
              <b>{d.getDate()}</b>
              <span className="o3-bar"><i style={{ height: `${sum ? Math.max(14, (sum / peak) * 100) : 0}%` }} /></span>
              <span className="o3-dots">{ev.slice(0, 3).map((e, j) => <i key={j} style={{ '--c': kindOf(e.kind).c }} className={hot(e) ? 'hot' : e.dir === 'in' ? 'in' : ''} />)}</span>
            </div>
          );
        })}
      </div>
      {events !== null && (list.length ? (
        <div className="o3-due">
          {list.map((e, i) => {
            const dd = Math.round((e._d - days[0]) / 864e5);
            return (
              <div key={i} className={`o3-due-i${hot(e) ? ' hot' : ''}`} style={{ '--c': kindOf(e.kind).c, '--i': i }}>
                <span className="o3-due-ic"><KindIcon kind={e.kind} size={15} color="#FAF7F0" /></span>
                <span className="o3-due-t"><b>{e.title}</b><small>{e.status === 'overdue' ? 'Overdue' : dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : `In ${dd} days`} · {kindOf(e.kind).label}</small></span>
                {e.amount ? <span className={`o3-due-a${e.dir === 'in' ? ' in' : ''}`}>{e.dir === 'in' ? '+' : ''}{money(e.amount)}</span> : null}
              </div>
            );
          })}
        </div>
      ) : <p className="o3-none">Nothing due in the next two weeks.</p>)}
    </section>
  );
}

export default function OverviewV2({
  name, parts, owed, asOf, hideValues, income, spent, dividends, yieldPct,
  onTab, onNav, onUpdateBalances, emailConnected, onConnect,
  growthData, historyYears, onYears, historySummary, sectorData, holdings,
}) {
  const total = parts.reduce((s, p) => s + n(p.value), 0);
  const shown = parts.filter(p => n(p.value) > 0).sort((a, b) => n(b.value) - n(a.value));
  const [hover, setHover] = useState(null);
  const saved = n(income) - n(spent);
  const rate = n(income) > 0 ? Math.max(0, Math.min(100, Math.round((saved / n(income)) * 100))) : null;
  const R = 34, C = 2 * Math.PI * R;
  const tabOf = { Stocks: 'holdings', 'Mutual funds': 'mutualfunds', NPS: 'nps', 'Bank deposits': 'fd', EPF: 'epfo' };
  const sectors = (sectorData || []).slice().sort((a, b) => b.value - a.value).slice(0, 6);
  const secMax = Math.max(1, ...sectors.map(s => s.value));
  const top = (holdings || []).slice().sort((a, b) => n(b.marketValue) - n(a.marketValue)).slice(0, 6);
  const topMax = Math.max(1, ...top.map(h => n(h.marketValue)));
  const growth = historySummary?.growthPct != null ? parseFloat(historySummary.growthPct) : null;

  return (
    <div className="o3">
      {/* ── Row 1: net worth + this month ── */}
      <div className="o3-row r1">
        <section className="o3-hero" aria-label="Net worth">
          <div className="o3-hi">{greeting()}{name ? `, ${String(name).split(' ')[0]}` : ''}</div>
          <div className="o3-hero-top">
            <div>
              <div className="o3-k">Net worth</div>
              <div className="o3-nw"><Money v={total} hidden={hideValues} /></div>
              <div className="o3-sub">{shown.length} asset types{asOf ? ` · stocks as per CAS of ${asOf}` : ''}</div>
            </div>
            <div className="o3-owe">
              <div><small>You owe</small><b>{hideValues ? '••••' : inr(owed)}</b></div>
              <div><small>After loans</small><b>{hideValues ? '••••' : inr(total - n(owed))}</b></div>
            </div>
          </div>
          {total > 0 && <>
            <div className="o3-alloc" role="img" aria-label="Asset allocation">
              {shown.map((p, i) => (
                <span key={p.name} className={hover && hover !== p.name ? 'dim' : ''} style={{ flexGrow: n(p.value), '--i': i }}
                  onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)} title={`${p.name} ${Math.round(n(p.value) / total * 100)}%`} />
              ))}
            </div>
            <div className="o3-legend">
              {shown.map((p, i) => (
                <button key={p.name} type="button" className={hover === p.name ? 'on' : ''} style={{ '--i': i }} onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}
                  onClick={() => tabOf[p.name] && onTab(tabOf[p.name])}>
                  <i /><span>{p.name}</span><b>{Math.round(n(p.value) / total * 100)}%</b>
                </button>
              ))}
            </div>
          </>}
          <button type="button" className="o3-ghost" onClick={onUpdateBalances}>Update PPF, EPF, NPS, FD balances</button>
        </section>

        <section className="o3-month" aria-label="This month">
          <div className="o3-k">This month</div>
          <div className="o3-month-body">
            <svg viewBox="0 0 80 80" className="o3-ring" aria-hidden="true">
              <circle cx="40" cy="40" r={R} className="trk" />
              <circle cx="40" cy="40" r={R} className="fil" strokeDasharray={C} strokeDashoffset={C * (1 - (rate || 0) / 100)} transform="rotate(-90 40 40)" />
              <text x="40" y="38" textAnchor="middle">{rate == null ? '—' : `${rate}%`}</text>
              <text x="40" y="52" textAnchor="middle" className="s">saved</text>
            </svg>
            <div className="o3-mlist">
              <div><small>Came in</small><b><Money v={income} hidden={hideValues} /></b></div>
              <div><small>Went out</small><b><Money v={spent} hidden={hideValues} /></b></div>
              <div><small>Saved</small><b className={saved < 0 ? 'neg' : ''}><Money v={saved} hidden={hideValues} /></b></div>
            </div>
          </div>
          <div className="o3-div"><small>Dividends this FY</small><b>{hideValues ? '••••' : inr(dividends)}</b>{yieldPct ? <em>{yieldPct}% yield</em> : null}</div>
          <button type="button" className="o3-cta" onClick={() => onTab('cashflow')}>Income &amp; expense ›</button>
        </section>
      </div>

      {/* ── Row 2: next 14 days ── */}
      <NextDays hidden={hideValues} onOpenCalendar={() => onTab('calendar')} onOpenEvents={() => onTab('m-events')} />

      {!emailConnected && (
        <button type="button" className="o3-banner" onClick={onConnect}>
          <b>Connect your email</b><span>We read broker and CAS emails to keep stocks, funds and dividends up to date.</span><em>Connect ›</em>
        </button>
      )}

      {/* ── Row 3: where the money sits + goals ── */}
      <div className="o3-row r3">
        <section className="o3-card" aria-label="Where your money sits">
          <header className="o3-head"><div><h3>Where your money sits</h3><p>Tap one to open it</p></div></header>
          <div className="o3-bento">
            {[...shown, { name: 'Retirement plan', value: null, tab: 'retirement' }].map((p, i) => (
              <button key={p.name} type="button" className={`o3-tile${i === 0 ? ' big' : ''}`} style={{ '--i': i }}
                onClick={() => (p.tab ? onTab(p.tab) : tabOf[p.name] ? onTab(tabOf[p.name]) : onUpdateBalances())}>
                <small>{p.name}</small>
                <b>{p.value == null ? 'Plan ›' : hideValues ? '••••' : inr(p.value)}</b>
                {p.value != null && total > 0 && <span className="o3-share"><i style={{ width: `${(n(p.value) / total) * 100}%` }} /></span>}
                {p.value != null && total > 0 && <em>{Math.round(n(p.value) / total * 100)}% of net worth</em>}
              </button>
            ))}
          </div>
        </section>
        <GoalsSnapshot hideValues={hideValues} onOpen={() => onNav('/blueprint')} />
      </div>

      {/* ── Row 4: history + sectors ── */}
      <div className="o3-row r4">
        <section className="o3-card" aria-label="Portfolio history">
          <header className="o3-head">
            <div><h3>Portfolio history</h3><p>{growth != null ? <span className={growth >= 0 ? 'pos' : 'neg'}>{growth >= 0 ? '+' : ''}{growth}% over {historyYears}Y</span> : 'Sync CAS emails to build history'}</p></div>
            <div className="k-seg">{[1, 3, 5].map(y => <button key={y} type="button" className={historyYears === y ? 'on' : ''} onClick={() => onYears(y)}>{y}Y</button>)}</div>
          </header>
          {growthData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={growthData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="o3g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D9541E" stopOpacity={0.28} /><stop offset="100%" stopColor="#D9541E" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="month" stroke="transparent" tick={{ fontSize: 10, fill: '#85817A' }} interval="preserveStartEnd" />
                <YAxis stroke="transparent" tick={{ fontSize: 10, fill: '#85817A' }} width={54} tickFormatter={(v) => inr(v)} />
                <Tooltip contentStyle={{ background: '#111111', border: 0, borderRadius: 10, color: '#FAF7F0', fontSize: 12 }} itemStyle={{ color: '#FAF7F0' }}
                  formatter={(v, k) => [hideValues ? '••••' : inr(v, { full: true }), k === 'market' ? 'Value' : 'Invested']} />
                <Area type="monotone" dataKey="cost" stroke="#85817A" strokeWidth={1.5} strokeDasharray="4 3" fill="transparent" dot={false} />
                <Area type="monotone" dataKey="market" stroke="#D9541E" strokeWidth={2.5} fill="url(#o3g)" dot={false} activeDot={{ r: 5 }} animationDuration={1100} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="o3-none tall">No history yet. Sync CAS emails or run Historical Sync from Settings.</p>}
        </section>
        <section className="o3-card" aria-label="Sector split">
          <header className="o3-head"><div><h3>Sector split</h3><p>Stocks by sector</p></div></header>
          {sectors.length ? <ul className="o3-bars">{sectors.map((s, i) => (
            <li key={s.name} style={{ '--i': i }}><span>{s.name}</span><b>{hideValues ? '••' : inr(s.value)}</b><i style={{ width: `${(s.value / secMax) * 100}%` }} /></li>
          ))}</ul> : <p className="o3-none">No stocks yet.</p>}
        </section>
      </div>

      {/* ── Row 5: top holdings + family ── */}
      <div className="o3-row r5">
        <section className="o3-card" aria-label="Top holdings">
          <header className="o3-head"><div><h3>Top stock holdings</h3><p>By market value</p></div><div className="o3-links"><button type="button" onClick={() => onTab('holdings')}>View all ›</button></div></header>
          {top.length ? <ul className="o3-hold">{top.map((h, i) => (
            <li key={h.symbol} style={{ '--i': i }}>
              <span className="o3-hold-n"><b>{h.company || h.symbol}</b><small>{h.symbol} · {h.quantity} sh</small></span>
              <span className="o3-hold-bar"><i style={{ width: `${(n(h.marketValue) / topMax) * 100}%` }} /></span>
              <span className="o3-hold-v"><b>{hideValues ? '••••' : inr(h.marketValue)}</b><small className={n(h.pnl) >= 0 ? 'pos' : 'neg'}>{n(h.pnlPct) >= 0 ? '+' : ''}{n(h.pnlPct).toFixed(1)}%</small></span>
            </li>
          ))}</ul> : <p className="o3-none">No stocks yet.</p>}
        </section>
      </div>
      <FamilyStrip onOpen={(t) => onTab(t === 'home' ? 'm-people' : t === 'people' ? 'm-people' : t === 'insurance' ? 'm-insurance' : t === 'documents' ? 'm-documents' : 'calendar')} />
    </div>
  );
}
