import { useEffect, useMemo, useRef, useState } from 'react';
import { mastersAPI } from '../lib/api';
import { kindOf, KindIcon, inrShort } from './kinds';
import './MoneyCalendar.css';

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const LV_RANK = { very_high: 0, high: 1, medium: 2, low: 3, undefined: 0 };
const STATUS = { overdue: 'Overdue', due_soon: 'Due soon', expected: 'Expected', past: 'Not seen' };
// Compact amount for a 36px column: 950, 18K, 1.2L, 2Cr
const tiny = (v) => {
  const x = Math.abs(+v || 0);
  if (x >= 1e7) return (Math.round(x / 1e6) / 10) + 'Cr';
  if (x >= 1e5) return (Math.round(x / 1e4) / 10) + 'L';
  if (x >= 1e3) return Math.round(x / 1e3) + 'K';
  return String(Math.round(x));
};

/**
 * One month on a single line. Each day column shows what actually moved (green in, red out,
 * with a colour bar by kind) and what's expected (chips). Below: the next things coming up.
 * An expected item disappears once its actual money arrives.
 */
export default function MoneyCalendar({ hideValues, onOpenMasters, onOpenEvents, hideDividends }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(null);
  const scroller = useRef(null);
  const month = monthKey(cursor);
  const isNow = month === monthKey(new Date());

  useEffect(() => {
    let live = true;
    setData(null); setErr(''); setPick(null);
    mastersAPI.month(month, hideDividends ? { dividends: 0 } : {}).then(r => { if (live) setData(r.data); })
      .catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load this month'); });
    return () => { live = false; };
  }, [month, hideDividends]);

  const byDay = useMemo(() => {
    const out = {};
    if (!data) return out;
    for (let d = 1; d <= data.days; d++) out[d] = { inn: 0, out: 0, flow: [], events: [] };
    for (const f of data.flow) {
      const d = +f.date.slice(8, 10);
      if (!out[d]) continue;
      out[d].flow.push(f);
      if (f.dir === 'in') out[d].inn += f.amount || 0; else out[d].out += f.amount || 0;
    }
    for (const e of data.events) { const d = +e.date.slice(8, 10); if (out[d]) out[d].events.push(e); }
    return out;
  }, [data]);

  const todayD = data && isNow ? +data.today.slice(8, 10) : null;

  // Keep today in view on narrow screens
  useEffect(() => {
    const el = scroller.current;
    if (!el || !todayD) return;
    const cell = el.querySelector('.mc-d.today');
    if (cell && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, cell.offsetLeft - el.clientWidth / 3);
  }, [todayD, data]);

  const money = (v) => (hideValues ? '••' : inrShort(v));
  const small = (v) => (hideValues ? '••' : tiny(v));
  const isHot = (e) => e.blink || e.urgent || e.status === 'overdue';
  const urgent = data ? data.events.filter(isHot) : [];
  const sel = pick && byDay[pick];

  const upcoming = useMemo(() => {
    if (!data) return [];
    const rank = { overdue: 0, due_soon: 1, expected: 2, past: 3 };
    return data.events
      .filter(e => (isNow ? e.status !== 'past' : true))
      .slice()
      .sort((a, b) => (rank[a.status] - rank[b.status]) || a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [data, isNow]);

  const dueText = (e) => {
    if (e.status === 'overdue') return 'Overdue';
    if (!isNow || !todayD) return '';
    const n = +e.date.slice(8, 10) - todayD;
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 0 ? `In ${n} days` : '';
  };

  // Share of each kind in a day's flow, for the thin colour bar
  const split = (list) => {
    const g = {}; let t = 0;
    for (const f of list) { g[f.kind] = (g[f.kind] || 0) + (f.amount || 0); t += f.amount || 0; }
    return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, t ? (v / t) * 100 : 0]);
  };

  const net = data ? (data.totals.income || 0) - (data.totals.expense || 0) : 0;

  // Month grid: weeks as rows (blank cells before the 1st)
  const lead = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
  const cells = data ? [...Array(lead).fill(null), ...Object.keys(byDay).map(Number)] : [];
  const monthName = cursor.toLocaleDateString('en-IN', { month: 'long' });

  const dayCell = (dn, i) => {
    if (dn == null) return <span key={'b' + i} className="mc2-blank" />;
    const x = byDay[dn];
    const dt = new Date(cursor.getFullYear(), cursor.getMonth(), dn);
    const hotEv = x.events.filter(isHot).sort((a, b) => LV_RANK[a.level] - LV_RANK[b.level])[0];
    const cls = ['mc2-d', dt.getDay() === 0 && 'sun', dn === todayD && 'today', todayD && dn < todayD && 'past', dn === pick && 'on', hotEv && 'hot',
      (x.inn || x.out || x.events.length) && 'has'].filter(Boolean).join(' ');
    return (
      <button key={dn} type="button" className={cls} style={{ '--i': i }} onClick={() => setPick(p => (p === dn ? null : dn))}
        aria-label={`${dt.toDateString()}${x.inn ? ', in ' + inrShort(x.inn) : ''}${x.out ? ', out ' + inrShort(x.out) : ''}${x.events.length ? ', ' + x.events.length + ' expected' : ''}`}>
        <span className="mc2-n">{dn}</span>
        {(x.inn > 0 || x.out > 0) && <span className="mc2-amts">
          {x.inn > 0 && <span className="in">+{small(x.inn)}</span>}
          {x.out > 0 && <span className="out">−{small(x.out)}</span>}
        </span>}
        {x.events.length > 0 && <span className="mc2-dots">
          {x.events.slice(0, 3).map((e, j) => <i key={j} className={isHot(e) ? 'hot' : e.status} style={{ '--c': kindOf(e.kind).c }} title={e.title} />)}
          {x.events.length > 3 && <em>+{x.events.length - 3}</em>}
        </span>}
      </button>
    );
  };

  return (
    <section className="mc mc2" aria-label="Money calendar">
      <header className="mc2-head">
        <div className="mc2-title">
          <h3><span>{monthName}</span> <em>{cursor.getFullYear()}</em></h3>
          <div className="mc2-navs">
            <button type="button" className="mc-nav" aria-label="Previous month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
            {!isNow && <button type="button" className="mc-today" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</button>}
            <button type="button" className="mc-nav" aria-label="Next month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          </div>
        </div>
        {data && <div className="mc2-totals">
          <div className="mc2-tot"><small>Came in</small><b className="in">{money(data.totals.income)}</b></div>
          <div className="mc2-tot"><small>Went out</small><b className="out">{money(data.totals.expense)}</b></div>
          <div className="mc2-tot"><small>Net</small><b className={net >= 0 ? 'in' : 'out'}>{net < 0 ? '−' : '+'}{money(net)}</b></div>
          {urgent.length > 0 && <button type="button" className="mc2-due" onClick={() => setPick(+urgent[0].date.slice(8, 10))}><i className="k-pulse" />{urgent.length} due now</button>}
        </div>}
      </header>

      {err && <div className="mc-empty">{err}</div>}
      {!data && !err && <div className="mc2-skel"><div className="k-skel" /><div className="k-skel" /></div>}
      {data && (
        <div className="mc2-body" key={month}>
          <div className="mc2-grid-wrap">
            <div className="mc2-wd">{WD.map(w => <span key={w}>{w}</span>)}</div>
            <div className="mc2-grid">{cells.map(dayCell)}</div>
            <div className="mc2-legend">
              <span><i className="lg in" />Came in</span><span><i className="lg out" />Went out</span>
              <span><i className="lg ev" />Expected</span><span><i className="lg hot" />Due now</span>
            </div>
          </div>

          <aside className="mc2-side">
            {sel ? (
              <div className="mc2-detail">
                <div className="mc2-side-h">
                  <span>{new Date(cursor.getFullYear(), cursor.getMonth(), pick).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  <button type="button" className="mc-x" aria-label="Back to coming up" onClick={() => setPick(null)}>×</button>
                </div>
                {!sel.flow.length && !sel.events.length && <div className="mc-none">Nothing moved and nothing is due.</div>}
                {sel.events.map((e, i) => (
                  <div key={'de' + i} className={`mc2-row ${isHot(e) ? 'hot' : e.status}`} style={{ '--c': kindOf(e.kind).c, '--i': i }}>
                    <span className="mc2-ic"><KindIcon kind={e.kind} size={15} color={isHot(e) ? '#fff' : undefined} /></span>
                    <span className="mc2-t">{e.title}<small>{kindOf(e.kind).label}{e.sub ? ' · ' + e.sub : ''} · {e.declared ? 'Declared' : STATUS[e.status] || ''}</small></span>
                    <span className="mc2-amt">{e.amount ? money(e.amount) : ''}</span>
                  </div>
                ))}
                {sel.flow.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).map((f, i) => (
                  <div key={f.id} className={`mc2-row done ${f.dir}`} style={{ '--c': kindOf(f.kind).c, '--i': i }}>
                    <span className="mc2-ic"><KindIcon kind={f.kind} size={15} /></span>
                    <span className="mc2-t">{f.master_title || f.title}<small>{kindOf(f.kind).label}{f.master_title ? ' · ' + f.title : ''}</small></span>
                    <span className={`mc2-amt ${f.dir}`}>{f.dir === 'in' ? '+' : '−'}{money(f.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="mc2-side-h"><span>{isNow ? 'Coming up' : 'Expected this month'}</span></div>
                {upcoming.length === 0
                  ? <div className="mc-none">Nothing else expected. Add loans, cards, SIPs or rent in Masters to see them here.</div>
                  : <div className="mc2-up">
                      {upcoming.map((e, i) => {
                        const k = kindOf(e.kind); const hot = isHot(e);
                        return (
                          <button key={i} type="button" className={`mc2-up-i${hot ? ' hot' : ''}`} style={{ '--c': k.c, '--i': i }} onClick={() => setPick(+e.date.slice(8, 10))}>
                            <span className="mc2-date"><b>{+e.date.slice(8, 10)}</b><small>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</small></span>
                            <span className="mc2-t">{e.title}<small>{k.label}{dueText(e) ? ' · ' + dueText(e) : ''}</small></span>
                            {e.amount ? <span className={`mc2-amt${e.dir === 'in' ? ' in' : ''}`}>{money(e.amount)}</span> : <span />}
                          </button>
                        );
                      })}
                    </div>}
              </>
            )}
            <div className="mc2-links">
              <a className="mc-link" href="/dashboard?tab=cashflow">Income & expense ›</a>
              {onOpenEvents && <button type="button" className="mc-link" onClick={onOpenEvents}>Events ›</button>}
              {onOpenMasters && <button type="button" className="mc-link" onClick={onOpenMasters}>Masters ›</button>}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
