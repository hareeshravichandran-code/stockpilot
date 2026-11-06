import { useEffect, useMemo, useState } from 'react';
import { mastersAPI } from '../lib/api';
import { KIND, kindOf, KindIcon, inrShort } from './kinds';
import './MoneyCalendar.css';

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const STATUS = { overdue: 'Overdue', due_soon: 'Due soon', expected: 'Expected', past: 'Not seen' };

/**
 * One month on a single line: money that actually moved (top, income up / spend down)
 * and what's expected (bottom). An expected item disappears once its actual arrives.
 */
export default function MoneyCalendar({ hideValues, onOpenMasters }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(null);
  const month = monthKey(cursor);
  const isNow = month === monthKey(new Date());

  useEffect(() => {
    let live = true;
    setData(null); setErr(''); setPick(null);
    mastersAPI.month(month).then(r => { if (live) setData(r.data); })
      .catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load this month'); });
    return () => { live = false; };
  }, [month]);

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

  const max = useMemo(() => Math.max(1, ...Object.values(byDay).map(x => Math.max(x.inn, x.out))), [byDay]);
  const h = (v) => (v > 0 ? Math.max(4, Math.round(Math.sqrt(v / max) * 46)) : 0);
  const todayD = data && isNow ? +data.today.slice(8, 10) : null;
  const money = (v) => (hideValues ? '••' : inrShort(v));
  const legendKinds = useMemo(() => {
    if (!data) return [];
    const ks = new Set([...data.flow.map(f => f.kind), ...data.events.map(e => e.kind)]);
    return Object.keys(KIND).filter(k => ks.has(k)).slice(0, 9);
  }, [data]);
  const urgent = data ? data.events.filter(e => e.urgent) : [];
  const sel = pick && byDay[pick];

  // Stack each day's spend bar by kind so EMIs, SIPs and rent read at a glance
  const stack = (list) => {
    const g = {};
    for (const f of list) g[f.kind] = (g[f.kind] || 0) + (f.amount || 0);
    return Object.entries(g).sort((a, b) => b[1] - a[1]);
  };

  return (
    <section className="mc" aria-label="Money calendar">
      <header className="mc-head">
        <div className="mc-title">
          <button type="button" className="mc-nav" aria-label="Previous month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <h3>{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" className="mc-nav" aria-label="Next month" onClick={() => setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          {!isNow && <button type="button" className="mc-today" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>This month</button>}
        </div>
        {data && <div className="mc-totals">
          <span className="in">In <b>{money(data.totals.income)}</b></span>
          <span className="out">Out <b>{money(data.totals.expense)}</b></span>
          {urgent.length > 0 && <span className="mc-alert"><i />{urgent.length} due now</span>}
        </div>}
      </header>

      {err && <div className="mc-empty">{err}</div>}
      {!data && !err && <div className="mc-skel" />}
      {data && (
        <div className="mc-scroll">
          <div className="mc-grid" style={{ '--n': data.days }}>
            <div className="mc-lab" />
            {Object.keys(byDay).map(d => {
              const dt = new Date(cursor.getFullYear(), cursor.getMonth(), +d);
              const sun = dt.getDay() === 0;
              return (
                <button key={'h' + d} type="button" className={`mc-day${sun ? ' sun' : ''}${+d === todayD ? ' today' : ''}${+d === pick ? ' on' : ''}`}
                  onClick={() => setPick(p => (p === +d ? null : +d))} aria-label={`Day ${d}`}>
                  <small>{WD[dt.getDay()]}</small><b>{d}</b>
                </button>
              );
            })}

            <div className="mc-lab">Money<br />flow</div>
            {Object.entries(byDay).map(([d, x]) => (
              <button key={'f' + d} type="button" className={`mc-flow${+d === pick ? ' on' : ''}`} onClick={() => setPick(+d)}
                title={`${x.inn ? 'In ' + inrShort(x.inn) : ''}${x.inn && x.out ? ' · ' : ''}${x.out ? 'Out ' + inrShort(x.out) : ''}`}>
                <span className="mc-up">{stack(x.flow.filter(f => f.dir === 'in')).map(([k, v]) => (
                  <i key={k} style={{ height: h(v), background: kindOf(k).c }} />))}</span>
                <span className="mc-base" />
                <span className="mc-down">{stack(x.flow.filter(f => f.dir === 'out')).map(([k, v]) => (
                  <i key={k} style={{ height: h(v), background: kindOf(k).c }} />))}</span>
              </button>
            ))}

            <div className="mc-lab">Events</div>
            {Object.entries(byDay).map(([d, x]) => (
              <button key={'e' + d} type="button" className={`mc-ev${+d === pick ? ' on' : ''}`} onClick={() => setPick(+d)}>
                {x.events.slice(0, 3).map((e, i) => (
                  <span key={i} className={`mc-chip ${e.status}${e.urgent ? ' urgent' : ''}`} style={{ '--c': kindOf(e.kind).c }} title={`${e.title} · ${STATUS[e.status] || ''}`}>
                    <KindIcon kind={e.kind} size={13} color={e.urgent ? '#fff' : undefined} />
                  </span>
                ))}
                {x.events.length > 3 && <span className="mc-more">+{x.events.length - 3}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="mc-legend">
          {legendKinds.map(k => <span key={k}><KindIcon kind={k} size={13} />{KIND[k].label}</span>)}
          <span className="mc-hint">Expected dates clear once the money actually moves.</span>
          {onOpenMasters && <button type="button" className="mc-link" onClick={onOpenMasters}>Manage masters ›</button>}
        </div>
      )}

      {sel && (
        <div className="mc-detail">
          <div className="mc-detail-h">{new Date(cursor.getFullYear(), cursor.getMonth(), pick).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {!sel.flow.length && !sel.events.length && <div className="mc-none">Nothing moved and nothing is due.</div>}
          {sel.events.map((e, i) => (
            <div key={'de' + i} className={`mc-row ev ${e.status}${e.urgent ? ' urgent' : ''}`} style={{ '--c': kindOf(e.kind).c }}>
              <span className="mc-ic"><KindIcon kind={e.kind} size={16} /></span>
              <span className="mc-t">{e.title}<small>{kindOf(e.kind).label}{e.sub ? ' · ' + e.sub : ''}</small></span>
              <span className={`mc-st ${e.status}`}>{STATUS[e.status] || ''}</span>
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
    </section>
  );
}
