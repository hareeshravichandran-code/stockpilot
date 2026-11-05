import { useState, useEffect, useCallback, useMemo } from 'react';
import { householdAPI } from '../lib/api';
import { Modal, Field, Avatar, Faces, MemberPicker, Seg, MODULE, inr, fmtDate, todayStr, ymd, parseDate, shortName, errMsg } from './shared';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function EventForm({ ev, date, members, onClose, onSaved, notify }) {
  const [d, setD] = useState({ title: ev?.title || '', date: ev?.date || date || todayStr(), repeat: ev?.repeat || 'none', kind: ev?.kind || 'event', member_id: ev?.member_id || null, amount: ev?.amount ?? '', notes: ev?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const save = async () => {
    if (!d.title.trim()) { setErr('Give it a name'); return; }
    setBusy(true); setErr('');
    const body = { ...d, amount: d.amount === '' ? null : +d.amount };
    try { if (ev) await householdAPI.events.update(ev.id, body); else await householdAPI.events.create(body); notify(ev ? 'Saved' : 'Added to the calendar'); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await householdAPI.events.remove(ev.id); notify('Removed'); await onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={ev ? 'Edit date' : 'Add a date'} onClose={onClose}
      footer={<>{ev && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={remove}>Delete</button>}<span className="fo-grow" /><button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button><button type="button" className="fo-btn" disabled={busy} onClick={save}>{ev ? 'Save' : 'Add'}</button></>}>
      <div className="fo-form">
        <Field label="What" wide><input className="fo-in" value={d.title} onChange={set('title')} placeholder="e.g. Wedding anniversary, Diya's annual day" maxLength={100} /></Field>
        <Field label="Type" wide><Seg value={d.kind} onChange={set('kind')} options={[['event', 'Event'], ['anniversary', 'Anniversary'], ['payment', 'Payment'], ['reminder', 'Reminder']]} label="Type" /></Field>
        <Field label="Date"><input className="fo-in" type="date" value={d.date} onChange={set('date')} /></Field>
        <Field label="Repeats"><Seg value={d.repeat} onChange={set('repeat')} options={[['none', 'Once'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]} label="Repeats" /></Field>
        {d.kind === 'payment' && <Field label="Amount"><input className="fo-in" type="number" min={0} value={d.amount} onChange={set('amount')} placeholder="₹" /></Field>}
        <Field label="For" wide><MemberPicker members={members} value={d.member_id} onChange={set('member_id')} multi={false} allowNone /></Field>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

export default function CalendarView({ members, notify }) {
  const [month, setMonth] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [items, setItems] = useState(null);
  const [sel, setSel] = useState(todayStr());
  const [who, setWho] = useState('all');
  const [mods, setMods] = useState(() => Object.keys(MODULE));
  const [form, setForm] = useState(null);
  const [events, setEvents] = useState([]);

  // Grid: Monday-first weeks covering the month
  const grid = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = new Date(last); end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(ymd(d));
    return { days, from: days[0], to: days[days.length - 1] };
  }, [month]);

  const load = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([householdAPI.calendar(grid.from, grid.to), householdAPI.events.list()]);
      setItems(c.data.items); setEvents(e.data.items);
    } catch (e) { setItems([]); notify(errMsg(e), 'error'); }
  }, [grid.from, grid.to, notify]);
  useEffect(() => { load(); }, [load]);

  const shown = (items || []).filter(i => mods.includes(i.module) && (who === 'all' || (i.member_ids || []).includes(who)));
  const byDay = shown.reduce((m, i) => { (m[i.date] = m[i.date] || []).push(i); return m; }, {});
  const t = todayStr();
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const selItems = byDay[sel] || [];
  const monthItems = shown.filter(i => i.date.startsWith(monthKey));
  const outflow = monthItems.reduce((s, i) => s + (['premium', 'emi', 'due', 'instalment', 'payment', 'goal_due'].includes(i.kind) ? (+i.amount || 0) : 0), 0);
  const shift = (k) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + k, 1));
  const openItem = (i) => {
    if (i.custom) { const ev = events.find(e => e.id === i.ref); if (ev && ev.mine) setForm({ ev }); else notify('Added by someone else in your family'); }
  };

  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div>
          <h1>Family calendar</h1>
          <p>Birthdays, premiums, renewals, fees, EMIs, RD instalments, FD maturities and goal dates from every part of Kanalyst.</p>
        </div>
        <button type="button" className="fo-btn" onClick={() => setForm({ date: sel })}>Add a date</button>
      </div>

      <div className="fo-cal-tools">
        <div className="fo-cal-nav">
          <button type="button" className="fo-icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <h2>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          <button type="button" className="fo-icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
          <button type="button" className="fo-btn sm ghost" onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); setSel(t); }}>Today</button>
        </div>
        <div className="fo-cal-sum"><b>{monthItems.length}</b> dates{outflow > 0 && <>, <b>{inr(outflow)}</b> going out</>}</div>
      </div>
      <div className="fo-filter">
        <button type="button" className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone</button>
        {members.map(m => <button key={m.id} type="button" className={who === m.id ? 'on' : ''} onClick={() => setWho(m.id)}><Avatar m={m} size={20} /> {shortName(m)}</button>)}
        <span className="fo-filter-gap" />
        {Object.entries(MODULE).map(([k, v]) => (
          <button key={k} type="button" className={`mod ${mods.includes(k) ? 'on' : ''}`} style={{ '--c': v.color }} aria-pressed={mods.includes(k)}
            onClick={() => setMods(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k])}><i />{v.name}</button>
        ))}
      </div>

      <div className="fo-cal">
        <div className="fo-cal-grid" role="grid" aria-label="Month">
          {WEEK.map(w => <div key={w} className="fo-cal-wd" role="columnheader">{w}</div>)}
          {grid.days.map(day => {
            const list = byDay[day] || [];
            const inMonth = day.startsWith(monthKey);
            return (
              <button key={day} type="button" role="gridcell" aria-selected={sel === day}
                className={`fo-cal-day ${inMonth ? '' : 'out'} ${day === t ? 'today' : ''} ${sel === day ? 'sel' : ''}`}
                onClick={() => setSel(day)} aria-label={`${fmtDate(day)}, ${list.length} items`}>
                <span className="fo-cal-n">{parseDate(day).getDate()}</span>
                <span className="fo-cal-chips">
                  {list.slice(0, 3).map(i => <span key={i.id} className={`fo-cal-chip ${i.overdue ? 'over' : ''}`} style={{ '--c': MODULE[i.module]?.color }}>{i.title}</span>)}
                  {list.length > 3 && <span className="fo-cal-more">+{list.length - 3} more</span>}
                </span>
                <span className="fo-cal-dots" aria-hidden="true">{list.slice(0, 5).map(i => <i key={i.id} style={{ background: MODULE[i.module]?.color }} />)}</span>
              </button>
            );
          })}
        </div>
        <aside className="fo-cal-side">
          <div className="fo-cal-side-head">
            <h3>{sel === t ? 'Today' : fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <button type="button" className="fo-btn sm ghost" onClick={() => setForm({ date: sel })}>Add</button>
          </div>
          {items === null ? <p className="fo-hint">Loading…</p> : selItems.length === 0 ? <p className="fo-hint">Nothing on this day.</p> : (
            <ul className="fo-agenda">
              {selItems.map(i => (
                <li key={i.id} style={{ '--c': MODULE[i.module]?.color }}>
                  <button type="button" onClick={() => openItem(i)} className={i.custom ? 'editable' : ''}>
                    <span className="fo-ag-mod">{MODULE[i.module]?.name}</span>
                    <span className="fo-ag-title">{i.title}{i.overdue && <em> was due {fmtDate(i.due_date, { day: 'numeric', month: 'short' })}</em>}</span>
                    {i.sub && <span className="fo-ag-sub">{i.sub}</span>}
                    <span className="fo-ag-foot">{i.amount ? <b>{inr(i.amount)}</b> : <span />}<Faces ids={i.member_ids} members={members} size={22} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="fo-cal-next">Next in {month.toLocaleDateString('en-IN', { month: 'long' })}</h3>
          <ul className="fo-agenda compact">
            {monthItems.filter(i => i.date >= (monthKey === t.slice(0, 7) ? t : '')).slice(0, 8).map(i => (
              <li key={i.id} style={{ '--c': MODULE[i.module]?.color }}><button type="button" onClick={() => setSel(i.date)}><span className="fo-ag-date">{parseDate(i.date).getDate()}</span><span className="fo-ag-title">{i.title}</span>{i.amount ? <b>{inr(i.amount)}</b> : null}</button></li>
            ))}
          </ul>
        </aside>
      </div>
      {form && <EventForm ev={form.ev} date={form.date} members={members} onClose={() => setForm(null)} onSaved={load} notify={notify} />}
    </div>
  );
}
