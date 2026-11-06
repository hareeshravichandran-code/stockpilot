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

  return (
    <section className="mc" aria-label="Money calendar">
      <header className="mc-head">
        <div className="mc-title">
          <button type="button" className="mc-nav" aria-label="Previous month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <h3>{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" className="mc-nav" aria-label="Next month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          {!isNow && <button type="button" className="mc-today" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</button>}
        </div>
        {data && <div className="mc-totals">
          <span className="mc-tot in"><small>In</small><b>{money(data.totals.income)}</b></span>
          <span className="mc-tot out"><small>Out</small><b>{money(data.totals.expense)}</b></span>
          <span className={`mc-tot net ${net >= 0 ? 'in' : 'out'}`}><small>Net</small><b>{net < 0 ? '−' : '+'}{money(net)}</b></span>
          {urgent.length > 0 && <span className="mc-alert"><i />{urgent.length} due now</span>}
        </div>}
      </header>

      {err && <div className="mc-empty">{err}</div>}
      {!data && !err && <div className="mc-skel" />}
      {data && (
        <div className="mc-scroll" ref={scroller}>
          <div className="mc-strip" style={{ '--n': data.days }}>
            {Object.entries(byDay).map(([d, x]) => {
              const dn = +d;
              const dt = new Date(cursor.getFullYear(), cursor.getMonth(), dn);
              const sun = dt.getDay() === 0;
              const past = todayD && dn < todayD;
              const hotEv = x.events.filter(isHot).sort((a, b) => LV_RANK[a.level] - LV_RANK[b.level])[0];
              const hot = !!hotEv;
              const cls = ['mc-d', sun && 'sun', dn === todayD && 'today', past && 'past', dn === pick && 'on', hot && `hot lv-${hotEv.level || 'very_high'}`].filter(Boolean).join(' ');
              return (
                <button key={d} type="button" className={cls} onClick={() => setPick(p => (p === dn ? null : dn))}
                  aria-label={`${dt.toDateString()}${x.inn ? ', in ' + inrShort(x.inn) : ''}${x.out ? ', out ' + inrShort(x.out) : ''}${x.events.length ? ', ' + x.events.length + ' expected' : ''}`}>
                  <small>{WD[dt.getDay()]}</small>
                  <b>{dn}</b>
                  <span className="mc-amt-in">{x.inn ? '+' + small(x.inn) : ''}</span>
                  <span className="mc-amt-out">{x.out ? '−' + small(x.out) : ''}</span>
                  <span className="mc-kbar">
                    {x.flow.length > 0 && split(x.flow).map(([k, w]) => <i key={k} style={{ width: w + '%', background: kindOf(k).c }} />)}
                  </span>
                  <span className="mc-chips">
                    {x.events.slice(0, 2).map((e, i) => (
                      <span key={i} className={`mc-chip ${e.status}${isHot(e) ? ` blink lv-${e.level || 'very_high'}` : ''}${e.declared ? ' declared' : ''}`} style={{ '--c': kindOf(e.kind).c }} title={`${e.title} · ${e.declared ? 'Declared, not credited yet' : STATUS[e.status] || ''}`}>
                        <KindIcon kind={e.kind} size={12} color={isHot(e) ? '#fff' : undefined} />
                      </span>
                    ))}
                    {x.events.length > 2 && <span className="mc-more">+{x.events.length - 2}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sel && (
        <div className="mc-detail">
          <div className="mc-detail-h">
            {new Date(cursor.getFullYear(), cursor.getMonth(), pick).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            <button type="button" className="mc-x" aria-label="Close" onClick={() => setPick(null)}>×</button>
          </div>
          {!sel.flow.length && !sel.events.length && <div className="mc-none">Nothing moved and nothing is due.</div>}
          {sel.events.map((e, i) => (
            <div key={'de' + i} className={`mc-row ${e.status}${isHot(e) ? ` urgent lv-${e.level || 'very_high'}` : ''}`} style={{ '--c': kindOf(e.kind).c }}>
              <span className="mc-ic"><KindIcon kind={e.kind} size={16} /></span>
              <span className="mc-t">{e.title}<small>{kindOf(e.kind).label}{e.sub ? ' · ' + e.sub : ''}</small></span>
              <span className={`mc-st ${e.declared ? 'declared' : e.status}`}>{e.declared ? 'Declared' : STATUS[e.status] || ''}</span>
              <span className="mc-amt">{e.amount ? money(e.amount) : ''}</span>
            </div>
          ))}
          {sel.flow.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).map(f => (
            <div key={f.id} className={`mc-row ${f.dir}`} style={{ '--c': kindOf(f.kind).c }}>
              <span className="mc-ic"><KindIcon kind={f.kind} size={16} /></span>
              <span className="mc-t">{f.master_title || f.title}<small>{kindOf(f.kind).label}{f.master_title ? ' · ' + f.title : ''}</small></span>
              <span className="mc-st done">{f.master_title ? 'Matched' : ''}</span>
              <span className={`mc-amt ${f.dir}`}>{f.dir === 'in' ? '+' : '−'}{money(f.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="mc-foot">
          <div className="mc-foot-h">
            <span>{isNow ? 'Coming up' : 'Expected this month'}</span>
            <span className="mc-foot-links">
              <a className="mc-link" href="/money-flow">Money flow ›</a>
              {onOpenEvents && <button type="button" className="mc-link" onClick={onOpenEvents}>Events & alerts ›</button>}
              {onOpenMasters && <button type="button" className="mc-link" onClick={onOpenMasters}>Masters ›</button>}
            </span>
          </div>
          {upcoming.length === 0
            ? <div className="mc-none">Nothing else expected this month. Add loans, cards, SIPs or rent in Masters to see them here.</div>
            : <div className="mc-up-list">
                {upcoming.map((e, i) => {
                  const k = kindOf(e.kind);
                  const hot = isHot(e);
                  return (
                    <button key={i} type="button" className={`mc-card${hot ? ` hot lv-${e.level || 'very_high'}` : ''}`} style={{ '--c': k.c }}
                      onClick={() => setPick(+e.date.slice(8, 10))}>
                      <span className="mc-ic"><KindIcon kind={e.kind} size={16} color={hot ? '#fff' : undefined} /></span>
                      <span className="mc-card-t">
                        <b>{e.title}</b>
                        <small>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {k.label}</small>
                      </span>
                      <span className="mc-card-r">
                        {e.amount ? <b className={e.dir === 'in' ? 'in' : ''}>{money(e.amount)}</b> : null}
                        {dueText(e) && <small>{dueText(e)}</small>}
                      </span>
                    </button>
                  );
                })}
              </div>}
        </div>
      )}
    </section>
  );
}
