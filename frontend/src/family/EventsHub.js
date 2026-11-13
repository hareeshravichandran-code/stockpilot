import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { eventsAPI, expenseAPI } from '../lib/api';
import { Modal, Field, Seg, errMsg } from './shared';
import { kindOf, KindIcon } from '../money/kinds';
import LogoLoader from '../components/LogoLoader';
import Recurring from './Recurring';
import './EventsHub.css';

/*
 * Events and SMS rules, managed in one place.
 *
 *   Event      something that repeats and needs doing: EMI, subscription, SIP, RD, premium, property tax...
 *              It has a type, a category, a schedule, an expected amount and a buffer of ± days.
 *   Due date   one occurrence ("9 Dec"). It is done when a payment is tied to it (or you mark it).
 *   SMS rule   sender + words in the SMS (+ amount) -> a category, and optionally -> an event.
 *              A rule tied to an event marks that event's due date done when its SMS arrives.
 */

// ── vocabulary ───────────────────────────────────────────────────────────────
export const TYPES = [
  ['subscription', 'Subscription', 'Netflix, Claude, Spotify'],
  ['emi', 'EMI', 'Loan instalment'],
  ['sip', 'SIP', 'Mutual fund instalment'],
  ['rd_instalment', 'RD', 'Recurring deposit'],
  ['premium', 'Insurance premium', 'Life, health, vehicle'],
  ['card_due', 'Credit card bill', ''],
  ['property_tax', 'Property tax', ''],
  ['bill', 'Bill', 'Electricity, broadband, phone'],
  ['rent', 'Rent', ''],
  ['school_fee', 'School fee', ''],
  ['salary', 'Salary (money in)', ''],
  ['income', 'Other money in', 'Rent received, interest'],
  ['other', 'Other', ''],
];
const TYPE_NAME = Object.fromEntries(TYPES.map(t => [t[0], t[1]]));
const IN_TYPES = ['salary', 'income', 'dividend', 'maturity'];
const FREQS = [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['once', 'Once']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEVELS = [['very_high', 'Very high'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const DEFAULT_REMIND = { very_high: 5, high: 7, medium: 2, low: 0 };
const DEFAULT_LEVEL = { emi: 'very_high', card_due: 'very_high', premium: 'high', salary: 'low', income: 'low', dividend: 'low', maturity: 'low' };
const SOURCE = { rule: 'by SMS rule', master: 'linked before rules', learned: 'linked before rules', manual: 'picked by you', marked: 'marked by you', auto: 'automatically' };
const STATE = {
  done: ['Done', 'ok'], skipped: ['Skipped', 'mute'], due: ['Due', 'warn'], overdue: ['Overdue', 'bad'],
  upcoming: ['Upcoming', 'calm'], missed: ['Missed', 'mute'], untracked: ['Before tracking', 'mute'],
};

const ord = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th');
const pd = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');
const fmt = (s, o = { day: 'numeric', month: 'short' }) => (s ? pd(s).toLocaleDateString('en-IN', o) : '—');
const fmtY = (s) => fmt(s, { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const days = (s) => Math.round((pd(s) - pd(today())) / 864e5);
const inr = (v) => (v == null || v === '' ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN'));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function scheduleText(e) {
  if (!e) return '';
  if (e.frequency === 'once') return `Once on ${fmtY(e.start_date || e.end_date)}`;
  const day = e.due_day ? ord(e.due_day) : '';
  if (e.frequency === 'monthly') return `Every month on the ${day}`;
  const f = { quarterly: 'Every 3 months', half_yearly: 'Every 6 months', yearly: 'Every year' }[e.frequency] || '';
  return `${f} · ${e.due_day || ''} ${e.due_month ? MONTHS[e.due_month - 1] : ''}`.trim();
}
const amountText = (e) => {
  if (!Number(e.amount)) return 'Any amount';
  if (e.amount_mode === 'exact') return `Exactly ${inr(e.amount)}`;
  if (e.amount_mode === 'any') return `${inr(e.amount)} (any amount counts)`;
  return `About ${inr(e.amount)}`;
};
function stateLine(e) {
  if (e.status !== 'active') return [e.status === 'paused' ? 'Paused' : 'Not tracked', 'mute'];
  const d = e.focus_date;
  if (e.state === 'overdue') return [`Overdue · was due ${fmt(d)}`, 'bad'];
  if (e.state === 'due') { const n = days(d); return [n > 0 ? `Due in ${n} day${n > 1 ? 's' : ''} · ${fmt(d)}` : n === 0 ? 'Due today' : `Due · ${fmt(d)} (in buffer)`, 'warn']; }
  if (e.cycle_done) return [`Done · paid ${fmt(e.last_done?.paid_on || e.last_done?.period)}${e.next_due ? ` · next ${fmt(e.next_due)}` : ''}`, 'ok'];
  if (e.next_due) return [`Next ${fmt(e.next_due)}`, 'calm'];
  return ['No upcoming date', 'mute'];
}
function ruleWhen(r) {
  const parts = [];
  if (r.sender_key) parts.push(['From', r.sender_key]);
  if (r.merchant_pattern) parts.push(['Words', `“${r.merchant_pattern}”`]);
  else if (r.has_words) parts.push(['Payee', r.label ? `“${clean(r.label)}”` : 'same payee']);
  if (r.amount_min != null || r.amount_max != null) {
    parts.push(['Amount', r.amount_min != null && r.amount_max != null
      ? (r.amount_min === r.amount_max ? inr(r.amount_min) : `${inr(r.amount_min)} – ${inr(r.amount_max)}`)
      : r.amount_min != null ? `from ${inr(r.amount_min)}` : `up to ${inr(r.amount_max)}`]);
  }
  return parts;
}

function Pill({ tone, children }) { return <span className={`eh-pill ${tone}`}>{children}</span>; }
// Categories the phone has that the web list may not
const CAT_NAMES = { cc_bill: 'Credit card bill', p_insurance: 'Insurance', p_transfer: 'Transfer', p_emi: 'EMI', p_education: 'Education', subscriptions: 'Subscriptions' };
export const RULE_SOURCE = { event_map: 'made from a payment you picked', from_master: "made from the master's keywords", from_payments: 'made from earlier payments',
  group: 'made from an SMS group', web: 'added on the web', manual: 'from the phone' };
function CatChip({ id, cats }) {
  if (!id) return <span className="eh-cat none">No category</span>;
  const c = cats.find(x => x.id === id);
  return <span className="eh-cat">{c?.icon ? <i aria-hidden="true">{c.icon}</i> : null}{c?.name || CAT_NAMES[id] || id}</span>;
}
function CategorySelect({ value, onChange, cats, required }) {
  const list = useMemo(() => [...cats].sort((a, b) => String(a.name).localeCompare(String(b.name))), [cats]);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} required={required}>
      <option value="">{required ? 'Pick a category…' : 'No category'}</option>
      {list.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon}  ` : ''}{c.name}</option>)}
    </select>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem('eh-how'); return v ? v === '1' : window.innerWidth > 700; } catch { return true; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem('eh-how', v ? '1' : '0'); } catch { /* private window */ } };
  return (
    <section className={`eh-how ${open ? 'open' : ''}`}>
      <button type="button" className="eh-how-head" onClick={toggle} aria-expanded={open}>
        <b>How events and SMS rules work</b><span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ol className="eh-flow">
          <li><span className="eh-step">1</span><div><b>Event</b><p>Something that repeats: an EMI, a subscription, a SIP, property tax. It has a type, a category, a due day and a buffer (± days).</p></div></li>
          <li><span className="eh-step">2</span><div><b>SMS rule</b><p>Sender + words in the SMS (+ amount). It files the payment in a category, and when tied to an event, settles that event.</p></div></li>
          <li><span className="eh-step">3</span><div><b>Due date done</b><p>A payment inside the due date ± buffer marks it done and its alert stops. Paying a little early or late still counts.</p></div></li>
        </ol>
      )}
    </section>
  );
}

// ── Event form ───────────────────────────────────────────────────────────────
function EventForm({ initial, cats, onClose, onSaved, notify }) {
  const e0 = initial || {};
  const [f, setF] = useState({
    title: e0.title || '', kind: e0.kind || 'subscription', category_id: e0.category_id || '',
    amount: e0.amount || '', amount_mode: e0.amount_mode || 'about', frequency: e0.frequency || 'monthly',
    due_day: e0.due_day || '', due_month: e0.due_month || '', date: e0.start_date || '',
    buffer_days: e0.buffer_days ?? 2, remind_days: e0.remind_days ?? '', alert_level: e0.alert_level || '',
    pay_mode: e0.pay_mode || 'auto', notes: e0.notes || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF(x => ({ ...x, [k]: v && v.target ? v.target.value : v }));
  const level = f.alert_level || DEFAULT_LEVEL[f.kind] || 'medium';
  const remindDefault = DEFAULT_REMIND[level];
  const save = async () => {
    setErr('');
    if (!f.title.trim()) return setErr('Give the event a name');
    if (!f.category_id) return setErr('Pick a category. Every payment of this event is filed there.');
    if (f.frequency === 'once' ? !f.date : !f.due_day) return setErr(f.frequency === 'once' ? 'Pick the date' : 'Pick the day it is due');
    if (!['monthly', 'once'].includes(f.frequency) && !f.due_month) return setErr('Pick the month it is due');
    const body = {
      title: f.title.trim(), kind: f.kind, category_id: f.category_id, amount: Number(f.amount) || 0, amount_mode: f.amount_mode,
      frequency: f.frequency, due_day: f.frequency === 'once' ? undefined : Number(f.due_day), due_month: f.frequency === 'monthly' || f.frequency === 'once' ? null : Number(f.due_month),
      start_date: f.frequency === 'once' ? f.date : undefined, buffer_days: Number(f.buffer_days), remind_days: f.remind_days === '' ? null : Number(f.remind_days),
      alert_level: f.alert_level || null, pay_mode: f.pay_mode, notes: f.notes, direction: IN_TYPES.includes(f.kind) ? 'in' : 'out',
    };
    setBusy(true);
    try {
      const r = initial ? await eventsAPI.update(initial.id, body) : await eventsAPI.create(body);
      notify(initial ? 'Event saved' : 'Event added');
      onSaved(initial ? initial.id : r.data.event?.id);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const buf = Number(f.buffer_days) || 0;
  return (
    <Modal title={initial ? 'Edit event' : 'New event'} onClose={onClose} wide
      footer={<><button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button><button type="button" className="fo-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : initial ? 'Save' : 'Add event'}</button></>}>
      <div className="eh-form">
        <fieldset>
          <legend>What it is</legend>
          <Field label="Name" wide><input value={f.title} onChange={set('title')} placeholder="Claude subscription, Home loan EMI, Property tax" maxLength={120} /></Field>
          <Field label="Type">
            <select value={f.kind} onChange={set('kind')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Category" hint="Its payments are filed here, and its SMS rules use it">
            <CategorySelect value={f.category_id} onChange={set('category_id')} cats={cats} required />
          </Field>
        </fieldset>
        <fieldset>
          <legend>When</legend>
          <Field label="Repeats" wide><Seg label="Repeats" options={FREQS} value={f.frequency} onChange={set('frequency')} /></Field>
          {f.frequency === 'once'
            ? <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
            : <Field label="Due day"><input type="number" min="1" max="31" value={f.due_day} onChange={set('due_day')} placeholder="5" /></Field>}
          {!['monthly', 'once'].includes(f.frequency) && (
            <Field label="Month"><select value={f.due_month} onChange={set('due_month')}><option value="">Pick…</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          )}
          <Field label="Buffer (± days)" hint={`A payment ${buf ? `up to ${buf} day${buf > 1 ? 's' : ''} before or after` : 'on'} the due date counts as on time`}>
            <div className="eh-stepper">
              <button type="button" onClick={() => set('buffer_days')(Math.max(0, buf - 1))} aria-label="Fewer days">−</button>
              <span>±{buf}</span>
              <button type="button" onClick={() => set('buffer_days')(Math.min(15, buf + 1))} aria-label="More days">+</button>
            </div>
          </Field>
        </fieldset>
        <fieldset>
          <legend>Amount</legend>
          <Field label="Expected amount"><input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} placeholder="1999" /></Field>
          <Field label="Amount matching" hint={f.amount_mode === 'exact' ? 'Only this exact amount counts' : f.amount_mode === 'about' ? 'Within 10% counts (good for USD bills)' : 'Any amount counts'}>
            <Seg label="Amount matching" options={[['exact', 'Exact'], ['about', 'About ±10%'], ['any', 'Any']]} value={f.amount_mode} onChange={set('amount_mode')} />
          </Field>
          <Field label="How it's paid"><Seg label="How it's paid" options={[['auto', 'Auto-debit'], ['manual', 'I pay it']]} value={f.pay_mode} onChange={set('pay_mode')} /></Field>
        </fieldset>
        <fieldset>
          <legend>Alerts</legend>
          <Field label="Alert level">
            <select value={f.alert_level} onChange={set('alert_level')}>
              <option value="">Default for {TYPE_NAME[f.kind] || 'this type'} ({LEVELS.find(l => l[0] === (DEFAULT_LEVEL[f.kind] || 'medium'))[1]})</option>
              {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Remind me (days before)" hint={`Leave empty for the default: ${remindDefault} day${remindDefault === 1 ? '' : 's'}`}>
            <input type="number" min="0" max="60" value={f.remind_days} onChange={set('remind_days')} placeholder={String(remindDefault)} />
          </Field>
          <Field label="Notes" wide><input value={f.notes} onChange={set('notes')} placeholder="Optional" maxLength={300} /></Field>
        </fieldset>
        <p className="eh-explain">
          Alerts start {remindDefault && f.remind_days === '' ? remindDefault : (Number(f.remind_days) || 0)} days before the due date and stop as soon as a payment is tied to it.
          If nothing arrives by the due date + {buf} days, it shows as overdue until the next one.
        </p>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

// ── Rule form ────────────────────────────────────────────────────────────────
function RuleForm({ initial, preset, cats, events, onClose, onSaved, notify }) {
  const r0 = initial || {};
  const [f, setF] = useState({
    event_id: r0.event_id || preset?.event_id || '', category_id: r0.category_id || preset?.category_id || '',
    sender_key: r0.sender_key || preset?.sender_key || '', words: r0.merchant_pattern || '',
    amount_min: r0.amount_min ?? preset?.amount_min ?? '', amount_max: r0.amount_max ?? preset?.amount_max ?? '',
  });
  const keepPayee = !!(initial && !initial.merchant_pattern && initial.has_words);
  const [senders, setSenders] = useState([]);
  const [prev, setPrev] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF(x => ({ ...x, [k]: v && v.target ? v.target.value : v }));
  useEffect(() => { eventsAPI.senders().then(r => setSenders(r.data.senders || [])).catch(() => {}); }, []);
  const ev = events.find(e => e.id === f.event_id);
  useEffect(() => { if (ev && ev.category_id && !f.category_id) setF(x => ({ ...x, category_id: ev.category_id })); }, [ev, f.category_id]);
  const body = useMemo(() => ({
    event_id: f.event_id || null, category_id: f.category_id || null, sender_key: f.sender_key || null,
    ...(f.words.trim() ? { merchant_pattern: f.words.trim().toLowerCase(), pattern_tok: null } : keepPayee ? {} : { merchant_pattern: null, pattern_tok: null }),
    amount_min: f.amount_min === '' ? null : Number(f.amount_min), amount_max: f.amount_max === '' ? null : Number(f.amount_max),
  }), [f, keepPayee]);
  // Live preview: which recent SMS this rule catches
  const t = useRef(null);
  useEffect(() => {
    clearTimeout(t.current);
    if (!body.sender_key && !body.merchant_pattern && !keepPayee) { setPrev(null); return undefined; }
    t.current = setTimeout(() => {
      const q = keepPayee ? null : body;
      if (!q) { setPrev(initial ? { count: initial.caught, sample: [] } : null); return; }
      eventsAPI.previewRule(q).then(r => setPrev(r.data)).catch(() => setPrev(null));
    }, 380);
    return () => clearTimeout(t.current);
  }, [body, keepPayee, initial]);
  const save = async () => {
    setErr('');
    if (!body.category_id) return setErr('Pick a category. Every rule files its SMS in a category.');
    if (!body.sender_key && !body.merchant_pattern && !keepPayee) return setErr('Give the rule a sender, words from the SMS, or both.');
    setBusy(true);
    try {
      if (initial) await eventsAPI.updateRule(initial.id, body); else await eventsAPI.createRule({ ...body, source: 'web' });
      notify(initial ? 'Rule saved' : 'Rule added'); onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial ? 'Edit SMS rule' : 'New SMS rule'} onClose={onClose} wide
      footer={<><button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button><button type="button" className="fo-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : initial ? 'Save rule' : 'Add rule'}</button></>}>
      <div className="eh-rule-form">
        <div className="eh-rf-col">
          <h4>When an SMS…</h4>
          <Field label="comes from (sender)" hint="Bank sender without the prefix, e.g. ICICIT for JX-ICICIT-S">
            <input list="eh-senders" value={f.sender_key} onChange={(e) => set('sender_key')(e.target.value.toUpperCase())} placeholder="Any sender" />
            <datalist id="eh-senders">{senders.map(s => <option key={s.key} value={s.key}>{`${s.bank || ''} · ${s.count} SMS`}</option>)}</datalist>
          </Field>
          <Field label="has these words" hint={keepPayee ? `Now: same payee as “${clean(initial.label) || 'the payment it was made from'}”. Type words to replace it.` : 'Words from the SMS, e.g. claude or anthropic'}>
            <input value={f.words} onChange={set('words')} placeholder={keepPayee ? 'Same payee (keep)' : 'Any words'} />
          </Field>
          <div className="eh-two">
            <Field label="amount from"><input type="number" min="0" value={f.amount_min} onChange={set('amount_min')} placeholder="Any" /></Field>
            <Field label="to"><input type="number" min="0" value={f.amount_max} onChange={set('amount_max')} placeholder="Any" /></Field>
          </div>
        </div>
        <div className="eh-rf-arrow" aria-hidden="true">→</div>
        <div className="eh-rf-col">
          <h4>…then</h4>
          <Field label="file it in category"><CategorySelect value={f.category_id} onChange={set('category_id')} cats={cats} required /></Field>
          <Field label="and settle this event" hint={f.event_id ? 'The due date nearest the SMS is marked done' : 'Optional. Leave empty for a category-only rule.'}>
            <select value={f.event_id} onChange={set('event_id')}>
              <option value="">No event (category only)</option>
              {events.filter(e => e.status !== 'closed').map(e => <option key={e.id} value={e.id}>{clean(e.title)} · {TYPE_NAME[e.kind] || e.kind}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="eh-preview" aria-live="polite">
        {prev == null ? <span className="eh-dim">Add a sender or words to see which SMS this rule catches.</span> : (
          <>
            <b>{prev.count ? `Catches ${prev.count} SMS from the last 6 months` : 'Catches no SMS from the last 6 months'}</b>
            {prev.count > 40 && !f.event_id ? null : null}
            {prev.count > 40 && <span className="eh-warn"> · that is a lot. Add words or an amount to narrow it.</span>}
            {!!(prev.sample || []).length && (
              <ul>{prev.sample.map(s => <li key={s.id}><span className="eh-amt">{inr(s.amount)}</span><span>{fmt(s.date)}</span><span className="eh-body">{clean(s.body || s.payee) || s.sender}</span></li>)}</ul>
            )}
          </>
        )}
      </div>
      {err && <div className="fo-err" role="alert">{err}</div>}
    </Modal>
  );
}

// ── Event detail ─────────────────────────────────────────────────────────────
function Occurrence({ o, ev, onAct, busy, i }) {
  const [open, setOpen] = useState(false);
  const [label, tone] = STATE[o.state] || [o.state, 'mute'];
  const isOpen = ['due', 'overdue', 'missed'].includes(o.state);
  return (
    <li className={`eh-occ ${o.state}`} style={{ '--i': i }}>
      <div className="eh-occ-date"><b>{fmt(o.period)}</b><small>{pd(o.period).getFullYear()}</small></div>
      <div className="eh-occ-main">
        <div className="eh-occ-top">
          <Pill tone={tone}>{label}{o.state === 'done' && o.timing && o.timing !== 'on_time' ? ` · ${o.timing === 'late' ? 'late' : 'early'}` : ''}</Pill>
          <span className="eh-dim">window {fmt(o.window[0])} – {fmt(o.window[1])}</span>
        </div>
        {o.state === 'done' && (
          <div className="eh-paid">
            <span className="eh-amt">{inr(o.amount)}</span>
            <span>paid {fmtY(o.paid_on)} · {SOURCE[o.match_source] || 'tied'}</span>
            {o.txn && <p className="eh-sms">{clean(o.txn.body || o.txn.payee) || '—'}<em>{o.txn.sender || o.txn.bank || ''}{o.txn.account ? ` · xx${String(o.txn.account).slice(-4)}` : ''}</em></p>}
          </div>
        )}
        {isOpen && (
          <div className="eh-occ-acts">
            {!!(o.suggestions || []).length && <button type="button" className="fo-btn sm" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? 'Hide payments' : `Pick the payment (${o.suggestions.length})`}</button>}
            <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onAct(o.period, { action: 'done' })}>Mark done</button>
            <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onAct(o.period, { action: 'skip' })}>Skip this one</button>
          </div>
        )}
        {isOpen && open && (
          <ul className="eh-sugg">
            {o.suggestions.map(s => (
              <li key={s.id}>
                <div><span className="eh-amt">{inr(s.amount)}</span> <span className="eh-dim">{fmt(s.date)} · {s.sender || s.bank || ''}</span><p className="eh-sms">{clean(s.body || s.payee) || '—'}</p></div>
                <button type="button" className="fo-btn sm" disabled={busy} onClick={() => onAct(o.period, { action: 'match', txn_id: s.id })}>This one</button>
              </li>
            ))}
            <li className="eh-dim eh-note">Picking a payment ties it to {fmt(o.period)} and saves an SMS rule, so the next one is matched by itself.</li>
          </ul>
        )}
        {(o.state === 'done' || o.state === 'skipped') && (
          <button type="button" className="eh-link" disabled={busy} onClick={() => onAct(o.period, null)}>{o.state === 'done' && o.txn ? 'Not this payment' : 'Open again'}</button>
        )}
      </div>
    </li>
  );
}

function EventDetail({ id, cats, events, onEdit, onChanged, onClose, notify }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ruleEdit, setRuleEdit] = useState(null);
  const load = useCallback(async () => {
    try { const r = await eventsAPI.get(id); setD(r.data); } catch (e) { notify(errMsg(e)); setD({ error: true }); }
  }, [id, notify]);
  useEffect(() => { setD(null); load(); }, [load]);
  const act = async (period, body) => {
    setBusy(true);
    try {
      if (!body) { await eventsAPI.reopen(id, period); notify(`${fmt(period)} is open again`); }
      else {
        const r = await eventsAPI.occurrence(id, period, body);
        const rule = r.data.rule;
        notify(body.action === 'match' ? (rule?.created ? `Done · SMS rule saved for next time` : rule?.widened ? 'Done · rule widened to this amount' : 'Done') : body.action === 'skip' ? 'Skipped' : 'Marked done');
      }
      await load(); onChanged();
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  const setStatus = async (s) => {
    try { await eventsAPI.status(id, s); notify(s === 'active' ? 'Resumed' : s === 'paused' ? 'Paused · no alerts until you resume' : 'Stopped tracking'); await load(); onChanged(); }
    catch (e) { notify(errMsg(e)); }
  };
  const stopTracking = () => {
    if (!window.confirm('Stop tracking this event? No more due dates or alerts. You can resume it any time.')) return;
    setStatus('closed');
  };
  const del = async () => {
    if (!window.confirm('Delete this event, its due dates and its SMS rules? Payments stay in your expenses.')) return;
    try { await eventsAPI.remove(id); notify('Event deleted'); onChanged(); onClose(); } catch (e) { notify(errMsg(e)); }
  };
  const delRule = async (r) => {
    try { await eventsAPI.removeRule(r.id); notify('Rule removed'); await load(); onChanged(); } catch (e) { notify(errMsg(e)); }
  };
  if (!d) return <div className="eh-detail"><LogoLoader size={30} inline label="Opening event" /></div>;
  if (d.error) return <div className="eh-detail"><p className="eh-dim">Could not open this event.</p></div>;
  const e = d.event;
  const k = kindOf(e.kind);
  const now = d.occurrences.find(o => o.state === 'overdue' || o.state === 'due');
  return (
    <div className="eh-detail">
      <header className="eh-d-head">
        <button type="button" className="eh-back" onClick={onClose} aria-label="Back to events">‹</button>
        <span className="eh-ico" style={{ '--k': k.c }}><KindIcon kind={e.kind} size={20} /></span>
        <div className="eh-d-title">
          <h2>{clean(e.title)}</h2>
          <p>{TYPE_NAME[e.kind] || k.label} · {scheduleText(e)} ±{e.buffer_days}d · {amountText(e)}</p>
        </div>
        <div className="eh-d-acts">
          <button type="button" className="fo-btn sm" onClick={() => onEdit(e)}>Edit</button>
          {e.status === 'active'
            ? <button type="button" className="fo-btn sm ghost" onClick={() => setStatus('paused')}>Pause</button>
            : <button type="button" className="fo-btn sm ghost" onClick={() => setStatus('active')}>Resume</button>}
          {e.source === 'manual'
            ? <button type="button" className="fo-btn sm ghost danger" onClick={del}>Delete</button>
            : e.status !== 'closed' && <button type="button" className="fo-btn sm ghost danger" onClick={stopTracking}>Stop tracking</button>}
          <button type="button" className="eh-x" onClick={onClose} aria-label="Close panel" title="Close panel">×</button>
        </div>
      </header>

      {!e.category_id && (
        <div className="eh-callout warn"><b>Pick a category for this event.</b> Its payments and SMS rules are filed there. <button type="button" className="eh-link" onClick={() => onEdit(e)}>Pick one</button></div>
      )}
      {e.status === 'active' && now && (
        <div className={`eh-callout ${now.state === 'overdue' ? 'bad' : 'warn'}`}>
          <b>{now.state === 'overdue' ? `${fmt(now.period)} is overdue.` : `${fmt(now.period)} is due.`}</b> {' '}
          {(now.suggestions || []).length ? 'Pick the payment below if it went through, or mark it done.' : 'No matching payment yet. Mark it done if you paid it another way.'}
        </div>
      )}

      <section className="eh-sec">
        <h3>Details</h3>
        <dl className="eh-dl">
          <div><dt>Type</dt><dd>{TYPE_NAME[e.kind] || k.label}</dd></div>
          <div><dt>Category</dt><dd><CatChip id={e.category_id} cats={cats} /></dd></div>
          <div><dt>Schedule</dt><dd>{scheduleText(e)}</dd></div>
          <div><dt>Buffer</dt><dd>± {e.buffer_days} day{e.buffer_days === 1 ? '' : 's'}</dd></div>
          <div><dt>Amount</dt><dd>{amountText(e)}</dd></div>
          <div><dt>Paid by</dt><dd>{e.pay_mode === 'manual' ? 'You, by hand' : 'Auto-debit'}</dd></div>
          <div><dt>Alerts</dt><dd>{LEVELS.find(l => l[0] === e.level)?.[1]}{e.remind_days != null ? ` · from ${e.remind_days} days before` : ''}</dd></div>
          <div><dt>Created from</dt><dd>{e.master ? `${e.master.title || e.master.institution || 'Master'} (master)` : 'Added by you'}<small className="eh-dl-note">SMS reach it only through its rules</small></dd></div>
          {e.status !== 'active' && <div><dt>Status</dt><dd>{e.status === 'paused' ? 'Paused' : 'Not tracked (stopped)'}</dd></div>}
        </dl>
      </section>

      <section className="eh-sec">
        <div className="eh-sec-head">
          <h3>SMS rules <span className="eh-count">{d.rules.length}</span></h3>
          <button type="button" className="fo-btn sm ghost" onClick={() => setRuleEdit({ preset: { event_id: e.id, category_id: e.category_id } })}>+ Add rule</button>
        </div>
        {!d.rules.length ? (
          <div className="eh-callout warn"><b>No SMS rule, so no SMS can settle this event.</b> Add a rule, or pick the payment for a due date below (that saves a rule for you).{!e.category_id ? ' Pick a category first: every rule needs one.' : ''}</div>
        ) : (
          <ul className="eh-rules compact">
            {d.rules.map(r => (
              <li key={r.id}>
                <div className="eh-when">{ruleWhen(r).map(([a, b]) => <span key={a}><em>{a}</em>{b}</span>)}</div>
                <div className="eh-then"><CatChip id={r.category_id} cats={cats} /><span className="eh-dim">{r.caught} SMS · {RULE_SOURCE[r.source] || 'rule'}</span></div>
                <div className="eh-r-acts">
                  <button type="button" className="eh-link" onClick={() => setRuleEdit({ rule: { ...r, event_id: e.id } })}>Edit</button>
                  <button type="button" className="eh-link danger" onClick={() => delRule(r)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="eh-sec">
        <h3>Due dates</h3>
        <ul className="eh-occs">
          {d.occurrences.map((o, i) => <Occurrence key={o.period} o={o} ev={e} onAct={act} busy={busy} i={i} />)}
        </ul>
        {!!d.other_payments.length && (
          <details className="eh-extra">
            <summary>Other payments tied to this event ({d.other_payments.length})</summary>
            <ul>{d.other_payments.map(t => <li key={t.id}><span className="eh-amt">{inr(t.amount)}</span><span>{fmtY(t.date)}</span><span className="eh-body">{clean(t.body || t.payee)}</span></li>)}</ul>
          </details>
        )}
      </section>
      {ruleEdit && (
        <RuleForm initial={ruleEdit.rule} preset={ruleEdit.preset} cats={cats} events={events}
          onClose={() => setRuleEdit(null)} onSaved={() => { setRuleEdit(null); load(); onChanged(); }} notify={notify} />
      )}
    </div>
  );
}

// ── Events tab ───────────────────────────────────────────────────────────────
const FILTERS = [['all', 'All'], ['action', 'Needs action'], ['done', 'Done'], ['upcoming', 'Upcoming'], ['nocat', 'No category'], ['inactive', 'Paused / stopped']];
function EventsTab({ events, cats, reload, notify, selected, setSelected }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);           // {} new | event
  const counts = useMemo(() => ({
    all: events.filter(e => e.status === 'active').length,
    action: events.filter(e => e.status === 'active' && (e.state === 'due' || e.state === 'overdue')).length,
    done: events.filter(e => e.status === 'active' && stateLine(e)[1] === 'ok').length,
    upcoming: events.filter(e => e.status === 'active' && stateLine(e)[1] === 'calm').length,
    nocat: events.filter(e => e.status !== 'closed' && !e.category_id).length,
    inactive: events.filter(e => e.status !== 'active').length,
  }), [events]);
  const list = useMemo(() => events.filter(e => {
    if (q && !clean(e.title).toLowerCase().includes(q.toLowerCase()) && !(TYPE_NAME[e.kind] || '').toLowerCase().includes(q.toLowerCase())) return false;
    const tone = stateLine(e)[1];
    switch (filter) {
      case 'action': return e.status === 'active' && (e.state === 'due' || e.state === 'overdue');
      case 'done': return e.status === 'active' && tone === 'ok';
      case 'upcoming': return e.status === 'active' && tone === 'calm';
      case 'nocat': return e.status !== 'closed' && !e.category_id;
      case 'inactive': return e.status !== 'active';
      default: return e.status === 'active';
    }
  }), [events, filter, q]);
  return (
    <div className={`eh-split ${selected ? 'has-detail' : ''}`}>
      <div className="eh-listpane">
        <div className="eh-tools">
          <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" aria-label="Search events" />
          <button type="button" className="fo-btn" onClick={() => setForm({})}>+ New event</button>
        </div>
        <div className="eh-filters" role="tablist" aria-label="Filter events">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? 'on' : ''} ${k === 'action' && counts.action ? 'hot' : ''}`} onClick={() => setFilter(k)}>
              {l}<span>{counts[k]}</span>
            </button>
          ))}
        </div>
        {!list.length ? (
          <div className="eh-empty">
            <b>{filter === 'action' ? 'Nothing needs you right now.' : events.length ? 'No events here.' : 'No events yet.'}</b>
            <p>{events.length ? 'Try another filter.' : 'Add your EMIs, subscriptions, SIPs and taxes, or add them from “Found in SMS”.'}</p>
          </div>
        ) : (
          <ul className="eh-list">
            {list.map((e, i) => {
              const k = kindOf(e.kind);
              const [line, tone] = stateLine(e);
              return (
                <li key={e.id} style={{ '--i': Math.min(i, 12) }}>
                  <button type="button" className={`eh-row ${selected === e.id ? 'on' : ''}`} onClick={() => setSelected(e.id)}>
                    <span className="eh-ico" style={{ '--k': k.c }}><KindIcon kind={e.kind} size={18} /></span>
                    <span className="eh-row-main">
                      <b>{clean(e.title)}</b>
                      <small>{TYPE_NAME[e.kind] || k.label} · {scheduleText(e)} ±{e.buffer_days}d</small>
                      <span className="eh-row-tags"><CatChip id={e.category_id} cats={cats} />{e.rules ? <span className="eh-tag">{e.rules} rule{e.rules > 1 ? 's' : ''}</span> : null}</span>
                    </span>
                    <span className="eh-row-side">
                      <span className="eh-amt">{Number(e.amount) ? inr(e.amount) : ''}</span>
                      <Pill tone={tone}>{line}</Pill>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="eh-detailpane">
        {selected ? (
          <EventDetail key={selected} id={selected} cats={cats} events={events} notify={notify}
            onEdit={(e) => setForm(e)} onChanged={reload} onClose={() => setSelected(null)} />
        ) : (
          <div className="eh-placeholder"><b>Pick an event</b><p>See its due dates, the payment that settled each one, and its SMS rules.</p></div>
        )}
      </div>
      {form && (
        <EventForm initial={form.id ? form : null} cats={cats} notify={notify} onClose={() => setForm(null)}
          onSaved={(id) => { setForm(null); reload(); if (id) setSelected(id); }} />
      )}
    </div>
  );
}

// ── SMS rules tab ────────────────────────────────────────────────────────────
function RulesTab({ cats, events, notify, onChanged }) {
  const [rules, setRules] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const load = useCallback(async () => {
    try { const r = await eventsAPI.rules(); setRules(r.data.rules || []); } catch (e) { notify(errMsg(e)); setRules([]); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  const del = async (r) => {
    if (!window.confirm('Remove this rule? SMS it caught keep their category.')) return;
    try { await eventsAPI.removeRule(r.id); notify('Rule removed'); load(); onChanged(); } catch (e) { notify(errMsg(e)); }
  };
  if (!rules) return <LogoLoader size={30} inline label="Reading rules" />;
  const catName = (id) => cats.find(c => c.id === id)?.name || id || '';
  const list = rules.filter(r => (filter === 'all' || (filter === 'event' ? !!r.event_id : !r.event_id))
    && (!q || [r.merchant_pattern, r.label, r.sender_key, catName(r.category_id), r.event?.title].some(x => x && clean(x).toLowerCase().includes(q.toLowerCase()))));
  const n = { all: rules.length, event: rules.filter(r => r.event_id).length, cat: rules.filter(r => !r.event_id).length };
  return (
    <div className="eh-rulestab">
      <div className="eh-tools">
        <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words, sender, category, event" aria-label="Search rules" />
        <button type="button" className="fo-btn" onClick={() => setEdit({})}>+ New rule</button>
      </div>
      <div className="eh-filters" role="tablist" aria-label="Filter rules">
        {[['all', 'All rules'], ['event', 'Settle an event'], ['cat', 'Category only']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span>{n[k]}</span></button>
        ))}
      </div>
      {!list.length ? (
        <div className="eh-empty"><b>No rules here.</b><p>Rules file SMS into categories. A rule tied to an event also marks its due date done.</p></div>
      ) : (
        <div className="eh-table" role="table" aria-label="SMS rules">
          <div className="eh-tr head" role="row"><span role="columnheader">When an SMS…</span><span role="columnheader">…then</span><span role="columnheader">Caught</span><span role="columnheader" /></div>
          {list.map((r, i) => (
            <div key={r.id} className="eh-tr" role="row" style={{ '--i': Math.min(i, 12) }}>
              <span className="eh-when" role="cell">{ruleWhen(r).map(([a, b]) => <span key={a}><em>{a}</em>{b}</span>)}</span>
              <span className="eh-then" role="cell">
                <CatChip id={r.category_id} cats={cats} />
                {r.event ? <span className="eh-evchip">settles <b>{clean(r.event.title)}</b></span> : null}
              </span>
              <span className="eh-caught" role="cell"><b>{r.caught}</b><small>{r.last_caught ? `last ${fmt(r.last_caught)}` : 'none in 6 months'}</small>
                <small className="eh-src">{RULE_SOURCE[r.source] || 'from the phone'}</small></span>
              <span className="eh-r-acts" role="cell">
                <button type="button" className="eh-link" onClick={() => setEdit({ rule: r })}>Edit</button>
                <button type="button" className="eh-link danger" onClick={() => del(r)}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {edit && <RuleForm initial={edit.rule} cats={cats} events={events} notify={notify} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); onChanged(); }} />}
    </div>
  );
}

// ── SMS groups (found by the phone in setup) ────────────────────────────────
const CADENCE = { monthly: 'every month', quarterly: 'every 3 months', half_yearly: 'every 6 months', yearly: 'every year' };
function GroupEventForm({ g, cats, onClose, onDone, notify }) {
  const [f, setF] = useState({ title: clean(g.name), kind: /netflix|prime|spotify|youtube|google|apple|claude|anthropic|openai|hotstar|jio|airtel/i.test(g.name || '') ? 'subscription' : 'bill',
    category_id: g.suggested && cats.some(c => c.id === g.suggested) ? g.suggested : '', amount: g.avg_amount ? Math.round(g.avg_amount) : '', amount_mode: g.max_amount && g.min_amount && g.max_amount <= g.min_amount * 1.02 ? 'exact' : 'about',
    frequency: g.cadence || 'monthly', due_day: g.due_day || (g.last_seen ? +g.last_seen.slice(8, 10) : ''), due_month: g.last_seen ? +g.last_seen.slice(5, 7) : '',
    buffer_days: 2, also_subscription: true });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF(x => ({ ...x, [k]: v && v.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const save = async () => {
    setErr('');
    if (!f.category_id) return setErr('Pick a category');
    if (!f.due_day) return setErr('Pick the day it is due');
    setBusy(true);
    try {
      await eventsAPI.groupAction(g.id, { action: 'event', ...f, amount: Number(f.amount) || 0, due_day: Number(f.due_day), due_month: f.frequency === 'monthly' ? null : Number(f.due_month) || null,
        buffer_days: Number(f.buffer_days), also_subscription: f.kind === 'subscription' && f.also_subscription });
      notify(`${clean(f.title)} is an event now · its SMS settle it`); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Make it an event" onClose={onClose} wide
      footer={<><button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button><button type="button" className="fo-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create event + rule'}</button></>}>
      <div className="eh-form">
        <p className="eh-explain">{g.count} SMS{g.cadence ? `, about ${CADENCE[g.cadence]}` : ''}. Kanalyst creates the event and an SMS rule for this payee, and marks past due dates done from these SMS.</p>
        <fieldset>
          <legend>Event</legend>
          <Field label="Name" wide><input value={f.title} onChange={set('title')} maxLength={120} /></Field>
          <Field label="Type"><select value={f.kind} onChange={set('kind')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Category"><CategorySelect value={f.category_id} onChange={set('category_id')} cats={cats} required /></Field>
          <Field label="Repeats" wide><Seg label="Repeats" options={FREQS.filter(x => x[0] !== 'once')} value={f.frequency} onChange={set('frequency')} /></Field>
          <Field label="Due day"><input type="number" min="1" max="31" value={f.due_day} onChange={set('due_day')} /></Field>
          {f.frequency !== 'monthly' && <Field label="Month"><select value={f.due_month} onChange={set('due_month')}><option value="">Pick…</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>}
          <Field label="Amount"><input type="number" min="0" value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Amount matching"><Seg label="Amount matching" options={[['exact', 'Exact'], ['about', 'About ±10%'], ['any', 'Any']]} value={f.amount_mode} onChange={set('amount_mode')} /></Field>
          <Field label="Buffer (± days)"><input type="number" min="0" max="15" value={f.buffer_days} onChange={set('buffer_days')} /></Field>
          {f.kind === 'subscription' && (
            <label className="eh-check wide"><input type="checkbox" checked={f.also_subscription} onChange={set('also_subscription')} /> Also add it to Subscriptions (a master)</label>
          )}
        </fieldset>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function GroupRow({ g, cats, i, onAct, busy, onEvent }) {
  const [cat, setCat] = useState(g.category_id || (g.suggested && cats.some(c => c.id === g.suggested) ? g.suggested : ''));
  const sorted = g.status !== 'open';
  return (
    <li className={`eh-grp ${g.status}`} style={{ '--i': Math.min(i, 12) }}>
      <div className="eh-grp-main">
        <div className="eh-grp-top">
          <b>{clean(g.name)}</b>
          <span className="eh-dim">{g.count} SMS · {inr(g.total)} in all{g.avg_amount ? ` · about ${inr(g.avg_amount)} each` : ''}</span>
        </div>
        <div className="eh-row-tags">
          {g.cadence && <span className="eh-tag hot">Repeats {CADENCE[g.cadence]}{g.due_day ? ` · ~${ord(g.due_day)}` : ''}</span>}
          {g.sender_key && <span className="eh-tag">From {g.sender_key}</span>}
          {g.last_seen && <span className="eh-tag">Last {fmt(g.last_seen)}</span>}
        </div>
        {g.sample && <p className="eh-sms">{clean(g.sample)}</p>}
      </div>
      <div className="eh-grp-act">
        {g.status === 'open' && (
          <>
            <div className="eh-grp-cat">
              <CategorySelect value={cat} onChange={setCat} cats={cats} required />
              <button type="button" className="fo-btn sm" disabled={busy || !cat} onClick={() => onAct(g, { action: 'category', category_id: cat })}>Save rule</button>
            </div>
            <div className="eh-grp-more">
              <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onEvent(g)}>Make it an event…</button>
              <button type="button" className="eh-link" disabled={busy} onClick={() => onAct(g, { action: 'ignore' })}>Ignore</button>
            </div>
          </>
        )}
        {sorted && (
          <div className="eh-grp-done">
            {g.status === 'ignored' ? <Pill tone="mute">Ignored</Pill> : (
              <span className="eh-then"><Pill tone="ok">{g.status === 'event' ? 'Event + rule' : 'Rule'}</Pill><CatChip id={g.category_id} cats={cats} />{g.event && <span className="eh-evchip">settles <b>{clean(g.event.title)}</b></span>}</span>
            )}
            <button type="button" className="eh-link" disabled={busy} onClick={() => onAct(g, { action: 'reopen' })}>{g.status === 'ignored' ? 'Sort it' : 'Change'}</button>
          </div>
        )}
      </div>
    </li>
  );
}

function GroupsTab({ cats, notify, onChanged }) {
  const [groups, setGroups] = useState(null);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [ev, setEv] = useState(null);
  const load = useCallback(async () => {
    try { const r = await eventsAPI.groups(); setGroups(r.data.groups || []); } catch (e) { notify(errMsg(e)); setGroups([]); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  const act = async (g, body) => {
    setBusy(true);
    try {
      await eventsAPI.groupAction(g.id, body);
      notify(body.action === 'category' ? `Rule saved · ${clean(g.name)} → ${cats.find(c => c.id === body.category_id)?.name || 'category'}` : body.action === 'ignore' ? 'Ignored' : 'Back in To sort');
      await load(); onChanged();
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  if (!groups) return <LogoLoader size={30} inline label="Reading SMS groups" />;
  const n = { open: groups.filter(g => g.status === 'open').length, done: groups.filter(g => g.status === 'ruled' || g.status === 'event').length, ignored: groups.filter(g => g.status === 'ignored').length };
  const list = groups.filter(g => (filter === 'open' ? g.status === 'open' : filter === 'done' ? (g.status === 'ruled' || g.status === 'event') : g.status === 'ignored')
    && (!q || [g.name, g.sample, g.sender_key].some(x => x && clean(x).toLowerCase().includes(q.toLowerCase()))));
  return (
    <div className="eh-groups">
      <p className="eh-dim eh-lead">Your phone groups SMS by payee. For each group, pick a category (a rule), or make it an event if it repeats. Rules reach the phone on its next sync.</p>
      <div className="eh-tools">
        <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, SMS or sender" aria-label="Search groups" />
      </div>
      <div className="eh-filters" role="tablist" aria-label="Filter groups">
        {[['open', 'To sort'], ['done', 'Sorted'], ['ignored', 'Ignored']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? 'on' : ''} ${k === 'open' && n.open ? 'hot' : ''}`} onClick={() => setFilter(k)}>{l}<span>{n[k]}</span></button>
        ))}
      </div>
      {!groups.length ? (
        <div className="eh-empty"><b>No SMS groups yet.</b><p>They appear after the phone app reads your SMS in setup (Settings › Run setup again).</p></div>
      ) : !list.length ? (
        <div className="eh-empty"><b>{filter === 'open' ? 'All sorted.' : 'Nothing here.'}</b></div>
      ) : (
        <ul className="eh-grps">{list.map((g, i) => <GroupRow key={g.id} g={g} i={i} cats={cats} busy={busy} onAct={act} onEvent={setEv} />)}</ul>
      )}
      {ev && <GroupEventForm g={ev} cats={cats} notify={notify} onClose={() => setEv(null)} onDone={() => { setEv(null); load(); onChanged(); }} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function EventsHub({ notify }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('eh-tab') || 'events'; } catch { return 'events'; } });
  const [events, setEvents] = useState(null);
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [ruleCount, setRuleCount] = useState(null);
  const load = useCallback(async () => {
    try { const r = await eventsAPI.list(); setEvents(r.data.events || []); } catch (e) { notify(errMsg(e)); setEvents([]); }
    eventsAPI.rules().then(r => setRuleCount((r.data.rules || []).length)).catch(() => {});
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { expenseAPI.categories().then(r => setCats((r.data || r || []).filter(c => !c.is_deleted))).catch(() => {}); }, []);
  const go = (t) => { setTab(t); try { sessionStorage.setItem('eh-tab', t); } catch { /* ignore */ } };
  // SMS groups and rules are made for you; they sit under Advanced (K-136: the page is about what's due)
  const [adv, setAdv] = useState(() => tab !== 'events');
  const ADV = [['groups', 'SMS groups'], ['rules', 'SMS rules'], ['found', 'Repeating in SMS']];
  const action = events ? events.filter(e => e.status === 'active' && (e.state === 'due' || e.state === 'overdue')).length : 0;
  return (
    <div className="eh">
      <header className="eh-head">
        <div>
          <h1>What's due</h1>
          <p>EMIs, bills, subscriptions, SIPs and premiums for the family. Each one is marked paid when its bank SMS arrives.</p>
        </div>
        {events && (
          <div className="eh-stats" aria-label="Summary">
            <span><b>{events.filter(e => e.status === 'active').length}</b> active</span>
            <span className={action ? 'hot' : ''}><b>{action}</b> need action</span>
            <span><b>{ruleCount ?? '–'}</b> rules</span>
          </div>
        )}
      </header>
      <HowItWorks />
      <nav className="eh-tabs" role="tablist" aria-label="Sections">
        <button type="button" role="tab" aria-selected={tab === 'events'} className={tab === 'events' ? 'on' : ''} onClick={() => go('events')}>Events</button>
        {adv && ADV.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`adv${tab === k ? ' on' : ''}`} onClick={() => go(k)}>{l}</button>
        ))}
        <button type="button" className="eh-adv" aria-expanded={adv} onClick={() => { if (adv && tab !== 'events') go('events'); setAdv(!adv); }}>
          {adv ? 'Hide advanced' : 'Advanced: SMS groups & rules'}
        </button>
      </nav>
      {events === null ? <LogoLoader label="Reading your events…" /> : (
        <>
          {tab === 'events' && <EventsTab events={events} cats={cats} reload={load} notify={notify} selected={selected} setSelected={setSelected} />}
          {tab === 'groups' && <GroupsTab cats={cats} notify={notify} onChanged={load} />}
          {tab === 'rules' && <RulesTab cats={cats} events={events} notify={notify} onChanged={load} />}
          {tab === 'found' && (
            <div className="eh-found">
              <p className="eh-dim">Payments that repeat in your SMS but belong to no event yet. Add one as an event (or a subscription), put it off, or ignore it.</p>
              <Recurring notify={notify} prefer="event" onChanged={load} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
