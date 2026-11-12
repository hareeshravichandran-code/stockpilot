/**
 * Overview: money day by day. A strip you can scroll into the past and the future; every day shows what came in
 * and went out (from bank SMS), days with something due blink, and the picked day (today at first) is opened below
 * with each payment, its SMS and category, and any event due.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { mastersAPI, expenseAPI } from '../lib/api';
import { kindOf, KindIcon } from '../money/kinds';
import { inr } from './DashboardOverview';

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mkey = (d) => ymd(d).slice(0, 7);
const addMonths = (k, m) => { const [y, mo] = k.split('-').map(Number); const d = new Date(y, mo - 1 + m, 1); return mkey(d); };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const hot = (e) => e.blink || e.urgent || e.status === 'overdue';
const STATUS = { overdue: 'Overdue', due_soon: 'Due now', expected: 'Expected', past: 'Not seen' };

export default function MoneyStrip({ hidden, onOpenCalendar, onOpenEvents }) {
  const todayK = ymd(new Date());
  const [months, setMonths] = useState({});           // 'YYYY-MM' -> { flow, events } | 'loading'
  const [range, setRange] = useState(() => [addMonths(todayK.slice(0, 7), -1), addMonths(todayK.slice(0, 7), 1)]);
  const [pick, setPick] = useState(todayK);
  const [cats, setCats] = useState([]);
  const strip = useRef(null);
  const first = useRef(true);

  const load = useCallback((k) => {
    setMonths(m => (m[k] ? m : { ...m, [k]: 'loading' }));
    mastersAPI.month(k, { dividends: '0' }).then(r => setMonths(m => ({ ...m, [k]: { flow: r.data.flow || [], events: r.data.events || [] } })))
      .catch(() => setMonths(m => ({ ...m, [k]: { flow: [], events: [] } })));
  }, []);
  useEffect(() => {
    for (let k = range[0]; k <= range[1]; k = addMonths(k, 1)) if (!months[k]) load(k);
  }, [range, months, load]);
  useEffect(() => { expenseAPI.categories().then(r => setCats(r.data || [])).catch(() => {}); }, []);

  // Days of the loaded range, with in / out and events per day
  const days = useMemo(() => {
    const out = [];
    const [y0, m0] = range[0].split('-').map(Number); const [y1, m1] = range[1].split('-').map(Number);
    const end = new Date(y1, m1, 0);
    for (let d = new Date(y0, m0 - 1, 1); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    const by = {};
    for (const [k, v] of Object.entries(months)) {
      if (!v || v === 'loading') continue;
      for (const f of v.flow) { const o = by[f.date] = by[f.date] || { inn: 0, out: 0, flow: [], events: [] }; o.flow.push(f); if (f.dir === 'in') o.inn += n(f.amount); else o.out += n(f.amount); }
      for (const e of v.events) {
        // Something still owed from an earlier day sits on today
        const at = e.status === 'overdue' && e.date < todayK ? todayK : e.date;
        const o = by[at] = by[at] || { inn: 0, out: 0, flow: [], events: [] }; o.events.push(e);
      }
      void k;
    }
    return out.map(d => ({ d, k: ymd(d), ...(by[ymd(d)] || { inn: 0, out: 0, flow: [], events: [] }) }));
  }, [months, range, todayK]);
  const peak = useMemo(() => Math.max(1, ...days.map(x => x.out)), [days]);

  // Start with today near the left; keep the view steady when earlier months are added in front
  useEffect(() => {
    const el = strip.current; if (!el || !first.current) return;
    const t = el.querySelector('[data-today="1"]');
    if (t) { el.scrollLeft = Math.max(0, t.offsetLeft - el.clientWidth * 0.18); first.current = false; }
  }, [days]);
  const prepend = useRef(null);
  useLayoutEffect(() => {                                   // earlier days were added in front: keep the same days in view
    const el = strip.current;
    if (el && prepend.current != null) { el.scrollLeft += el.scrollWidth - prepend.current; prepend.current = null; }
  }, [days.length]);
  const onScroll = () => {
    const el = strip.current; if (!el || first.current || prepend.current != null) return;
    if (el.scrollLeft < 120 && range[0] > addMonths(todayK.slice(0, 7), -24)) {
      prepend.current = el.scrollWidth;
      setRange(r => [addMonths(r[0], -1), r[1]]);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - 120 && range[1] < addMonths(todayK.slice(0, 7), 12)) setRange(r => [r[0], addMonths(r[1], 1)]);
  };
  const nudge = (dir) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' });
  const toToday = () => { const t = strip.current?.querySelector('[data-today="1"]'); if (t) strip.current.scrollTo({ left: t.offsetLeft - strip.current.clientWidth * 0.18, behavior: 'smooth' }); setPick(todayK); };

  const money = (v) => (hidden ? '••' : inr(v));
  const sel = days.find(x => x.k === pick);
  const next14 = days.filter(x => x.k >= todayK && (new Date(x.k) - new Date(todayK)) / 864e5 < 14);
  const goingOut = next14.reduce((s, x) => s + x.events.filter(e => e.dir !== 'in').reduce((a, e) => a + n(e.amount), 0), 0);
  const catOf = (id) => cats.find(c => c.id === id);
  const loading = Object.values(months).some(v => v === 'loading');

  return (
    <section className="o3-card ms" aria-label="Money by day">
      <header className="o3-head">
        <div><h3>Money by day</h3><p>{`${money(goingOut)} due in the next 14 days · tap a day to see it`}</p></div>
        <div className="o3-links">
          <button type="button" onClick={() => nudge(-1)} aria-label="Earlier days">‹</button>
          <button type="button" onClick={toToday}>Today</button>
          <button type="button" onClick={() => nudge(1)} aria-label="Later days">›</button>
          <button type="button" onClick={onOpenEvents}>Events</button>
          <button type="button" onClick={onOpenCalendar}>Calendar ›</button>
        </div>
      </header>
      <div className="ms-strip" ref={strip} onScroll={onScroll} role="listbox" aria-label="Days">
        {days.map((x, i) => {
          const isToday = x.k === todayK; const past = x.k < todayK;
          const isHot = x.events.some(hot);
          const newMonth = x.d.getDate() === 1;
          return (
            <button key={x.k} type="button" role="option" aria-selected={pick === x.k} data-today={isToday ? '1' : undefined}
              className={`ms-day${isToday ? ' today' : ''}${past ? ' past' : ''}${isHot ? ' hot' : ''}${x.events.length ? ' has' : ''}${pick === x.k ? ' on' : ''}${newMonth ? ' m1' : ''}`}
              onClick={() => setPick(x.k)}
              title={[...x.events.map(e => `${e.title}${e.amount ? ' ' + inr(e.amount) : ''} · ${STATUS[e.status] || ''}`)].join('\n') || undefined}>
              {newMonth && <span className="ms-mon">{x.d.toLocaleDateString('en-IN', { month: 'short' })}</span>}
              <small>{isToday ? 'Today' : x.d.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
              <b>{x.d.getDate()}</b>
              <span className="ms-in">{x.inn ? `+${money(x.inn)}` : ''}</span>
              <span className="ms-out">{x.out ? `−${money(x.out)}` : ''}</span>
              <span className={`ms-bar${x.out ? '' : ' none'}`}><i style={{ height: `${x.out ? Math.max(10, (x.out / peak) * 100) : 0}%` }} /></span>
              <span className="ms-dots">{x.events.slice(0, 3).map((e, j) => <i key={j} style={{ '--c': kindOf(e.kind).c }} className={hot(e) ? 'hot' : e.dir === 'in' ? 'in' : ''} />)}</span>
            </button>
          );
        })}
        {loading && <span className="ms-more" aria-hidden="true">…</span>}
      </div>
      {sel && (
        <div className="ms-detail" key={sel.k}>
          <div className="ms-detail-head">
            <b>{sel.d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <span>{sel.inn ? <em className="in">+{money(sel.inn)}</em> : null}{sel.out ? <em className="out">−{money(sel.out)}</em> : null}</span>
          </div>
          {!sel.flow.length && !sel.events.length && <p className="o3-none">Nothing moved and nothing was due.</p>}
          <ul>
            {sel.events.map((e, i) => (
              <li key={'e' + i} className={`ms-ev${hot(e) ? ' hot' : ''}`} style={{ '--c': kindOf(e.kind).c }}>
                <span className="ms-ic"><KindIcon kind={e.kind} size={15} color="#FAF7F0" /></span>
                <span className="ms-t"><b>{clean(e.title)}</b><small>{kindOf(e.kind).label} · {STATUS[e.status] || 'Expected'}{e.sub ? ` · ${e.sub}` : ''}</small></span>
                {e.amount ? <span className="ms-a">{money(e.amount)}</span> : null}
              </li>
            ))}
            {sel.flow.slice().sort((a, b) => n(b.amount) - n(a.amount)).map((f, i) => {
              const c = catOf(f.category_id);
              const body = clean(f.body); const title = f.master_title || clean(f.title) || body.slice(0, 50) || 'Bank payment';
              return (
                <li key={'f' + i} className="ms-fl">
                  <span className="ms-ic flow" style={{ '--c': kindOf(f.kind).c }}><KindIcon kind={f.kind} size={15} /></span>
                  <span className="ms-t"><b>{title}</b><small className={!c && f.dir !== 'in' ? 'unsorted' : ''}>{c ? `${c.icon || ''} ${c.name}` : f.dir === 'in' ? kindOf(f.kind).label : 'Not sorted'}{f.master_title ? ' · matched' : ''}</small>
                    {body && body !== title && <span className="ms-sms">{body}</span>}</span>
                  <span className={`ms-a ${f.dir === 'in' ? 'in' : ''}`}>{f.dir === 'in' ? '+' : '−'}{money(f.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
