import { useState, useEffect, useCallback, useMemo } from 'react';
import { mastersAPI } from '../lib/api';
import { Modal, Field, Empty, errMsg } from './shared';
import { kindOf, KindIcon, inrShort } from '../money/kinds';

// Every expected payment or receipt lives here: EMIs (loan), card bills (card), SIPs (fund folio),
// premiums (insurance), RD instalments (RD) and events you add yourself (rent, school fee, reminders).
export const LEVELS = [
  ['very_high', 'Very high', 'Blinks red from 5 days before'],
  ['high', 'High', 'Blinks amber from 7 days before'],
  ['medium', 'Medium', 'Blinks 2 days before'],
  ['low', 'Low', 'Shows, never blinks'],
];
const LEVEL_NAME = Object.fromEntries(LEVELS.map(l => [l[0], l[1]]));
const LINK_LABEL = { loan: 'Loan account', card: 'Credit card', sip: 'SIP · fund folio', income: 'Income', expense: 'Regular expense',
  subscription: 'Subscription', rd: 'Recurring deposit', insurance: 'Insurance policy', bank_account: 'Bank account' };
const EVENT_KINDS = [['rent', 'Rent'], ['school_fee', 'School fee'], ['bill', 'Bill'], ['subscription', 'Subscription'], ['emi', 'EMI'],
  ['card_due', 'Card bill'], ['premium', 'Premium'], ['sip', 'SIP'], ['income', 'Money in'], ['other', 'Reminder']];
const FREQ = [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['once', 'Once']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ord = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th');
const whenText = (e) => e.frequency === 'once' ? 'Once'
  : e.frequency === 'monthly' ? (e.due_day ? `Every month on the ${ord(e.due_day)}` : 'Every month')
  : `${FREQ.find(f => f[0] === e.frequency)?.[1] || ''}${e.due_month ? ` · ${MONTHS[e.due_month - 1]}` : ''}${e.due_day ? ` ${e.due_day}` : ''}`;
const dueText = (e) => e.days == null ? '' : e.days === 0 ? 'Today' : e.days === 1 ? 'Tomorrow' : e.days < 0 ? 'Overdue' : `In ${e.days} days`;
const fmtDue = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

function EventForm({ event, masters, onClose, onSaved, notify }) {
  const manual = !event || event.source === 'manual';
  const [d, setD] = useState({
    title: event?.title || '', kind: event?.kind || 'rent', amount: event?.amount ?? '', direction: event?.direction || 'out',
    frequency: event?.frequency || 'monthly', due_day: event?.due_day ?? '', due_month: event?.due_month ?? '', date: '',
    alert_level: event?.alert_level || '', master_id: event?.linked?.id || '', notes: event?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...d, alert_level: d.alert_level || null, master_id: d.master_id || null,
        direction: d.kind === 'income' ? 'in' : d.direction };
      if (!event) await mastersAPI.createEvent(body);
      else await mastersAPI.updateEvent(event.id, manual ? body : { alert_level: body.alert_level, notes: d.notes });
      notify(event ? 'Event saved' : 'Event added to your calendar');
      await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this event?')) return;
    setBusy(true);
    try { await mastersAPI.removeEvent(event.id); notify('Event deleted'); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const defLevel = event?.default_level;
  return (
    <Modal title={event ? (manual ? 'Edit event' : event.title) : 'New event'} onClose={onClose} wide
      footer={<>
        {event && manual && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={remove}>Delete</button>}
        <span className="fo-grow" />
        <button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="fo-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : event ? 'Save' : 'Add event'}</button>
      </>}>
      <div className="fo-form two">
        {!manual && event?.linked && <div className="ev-linked wide">
          <KindIcon kind={event.kind} size={16} />
          <span>Belongs to <b>{event.linked.title}</b> ({LINK_LABEL[event.linked.type] || event.linked.type}). Its date and amount follow that master.</span>
        </div>}
        {manual && <>
          <Field label="What is it" wide>
            <div className="fo-chips">{EVENT_KINDS.map(([v, l]) => (
              <button key={v} type="button" className={d.kind === v ? 'on' : ''} aria-pressed={d.kind === v} onClick={() => set('kind')(v)}>
                <KindIcon kind={v === 'other' ? 'bill' : v} size={14} /> {l}</button>))}</div>
          </Field>
          <Field label="Name"><input className="fo-in" value={d.title} onChange={set('title')} maxLength={80} placeholder="e.g. House rent" /></Field>
          <Field label="Amount"><input className="fo-in" type="number" min={0} value={d.amount} onChange={set('amount')} placeholder="₹ (optional)" /></Field>
          <Field label="How often">
            <select className="fo-in" value={d.frequency} onChange={set('frequency')}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          {d.frequency === 'once'
            ? <Field label="Date"><input className="fo-in" type="date" value={d.date} onChange={set('date')} /></Field>
            : <Field label="Due day"><input className="fo-in" type="number" min={1} max={31} value={d.due_day} onChange={set('due_day')} placeholder="1–31" /></Field>}
          {d.frequency !== 'once' && d.frequency !== 'monthly' && <Field label="Month">
            <select className="fo-in" value={d.due_month} onChange={set('due_month')}><option value="">—</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </Field>}
          <Field label="Linked master" hint="Optional. Ties the event to a loan, card, SIP or expense you track in Masters.">
            <select className="fo-in" value={d.master_id} onChange={set('master_id')}>
              <option value="">None</option>
              {masters.map(m => <option key={m.id} value={m.id}>{m.title} · {LINK_LABEL[m.kind] || m.kind}</option>)}
            </select>
          </Field>
        </>}
        <Field label="Alert level" wide hint={defLevel ? `Default for this type: ${LEVEL_NAME[defLevel]}` : 'Leave on Auto to use the default for the type'}>
          <div className="ev-levels">
            <button type="button" className={!d.alert_level ? 'on' : ''} onClick={() => set('alert_level')('')}>Auto</button>
            {LEVELS.map(([v, l, h]) => (
              <button key={v} type="button" className={`lv-${v}${d.alert_level === v ? ' on' : ''}`} title={h} onClick={() => set('alert_level')(v)}>
                <i />{l}</button>))}
          </div>
        </Field>
        <Field label="Note" wide><input className="fo-in" value={d.notes} onChange={set('notes')} maxLength={200} placeholder="Optional" /></Field>
        {err && <div className="fo-err wide">{err}</div>}
      </div>
    </Modal>
  );
}

export default function Events({ notify }) {
  const [list, setList] = useState(null);
  const [masters, setMasters] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const [e, m] = await Promise.all([mastersAPI.events(), mastersAPI.list()]);
      setList(e.data.events || []); setMasters((m.data.masters || []).filter(x => x.status !== 'closed')); setErr('');
    } catch (x) { setErr(errMsg(x)); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const src = (list || []).filter(e => filter === 'all' || (filter === 'manual' ? e.source === 'manual' : e.level === filter));
    return LEVELS.map(([v, l, h]) => ({ level: v, label: l, hint: h, items: src.filter(e => e.level === v) })).filter(g => g.items.length);
  }, [list, filter]);
  const blinking = (list || []).filter(e => e.blink).length;

  if (list === null) return <div className="fo-loading"><span className="fo-spin" /> Loading events…</div>;
  return (
    <div className="fo-page ev">
      <div className="fo-page-head">
        <div>
          <h1>Events</h1>
          <p>Every date money is expected to move, and the master it belongs to: EMI → loan, card bill → card, SIP → fund folio,
            premium → insurance, instalment → RD. Add your own (rent, school fee, a reminder) and choose how loudly each one alerts.</p>
        </div>
        <button type="button" className="fo-btn" onClick={() => setForm({})}>+ New event</button>
      </div>
      {err && <div className="fo-banner">{err}</div>}
      <div className="fo-chips ev-filters">
        {[['all', `All ${list.length}`], ...LEVELS.map(([v, l]) => [v, `${l} ${list.filter(e => e.level === v).length}`]), ['manual', `Added by you ${list.filter(e => e.source === 'manual').length}`]].map(([v, l]) => (
          <button key={v} type="button" className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>))}
        {blinking > 0 && <span className="ev-now"><i />{blinking} need attention</span>}
      </div>
      {!list.length && <Empty title="No events yet" action={<button type="button" className="fo-btn" onClick={() => setForm({})}>+ New event</button>}>
        Add loans, cards, SIPs or insurance in Masters and their dates show up here, or add an event yourself.</Empty>}
      {groups.map(g => (
        <section key={g.level} className={`ev-group lv-${g.level}`}>
          <h2><i />{g.label} <small>{g.hint}</small></h2>
          <div className="ev-grid">
            {g.items.map(e => {
              const k = kindOf(e.kind);
              return (
                <button key={e.id} type="button" className={`ev-card${e.blink ? ' blink' : ''}${e.status === 'paused' ? ' paused' : ''}`} style={{ '--c': k.c }} onClick={() => setForm({ event: e })}>
                  <span className="ev-ic"><KindIcon kind={e.kind} size={18} color={e.blink ? '#fff' : undefined} /></span>
                  <span className="ev-body">
                    <b>{e.title}</b>
                    <small>{whenText(e)}{e.amount ? ` · ${inrShort(e.amount)}` : ''}</small>
                    <span className="ev-link">{e.linked ? <>↳ {e.linked.title} · {LINK_LABEL[e.linked.type] || e.linked.type}</> : e.source === 'manual' ? 'Added by you' : 'No master'}</span>
                  </span>
                  <span className="ev-due">
                    <b>{fmtDue(e.next_due)}</b>
                    <small>{e.status === 'paused' ? 'Paused' : dueText(e)}</small>
                    {e.last_paid && <small className="ev-paid">Paid {fmtDue(e.last_paid)}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {form && <EventForm event={form.event} masters={masters} notify={notify} onSaved={load} onClose={() => setForm(null)} />}
    </div>
  );
}
