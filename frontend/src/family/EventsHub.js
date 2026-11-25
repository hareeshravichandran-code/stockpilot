import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { eventsAPI, expenseAPI } from '../lib/api';
import { Modal, Field, Seg, errMsg } from './shared';
import { kindOf, KindIcon } from '../money/kinds';
import LogoLoader from '../components/LogoLoader';
import Recurring from './Recurring';
import './EventsHub.css';
import { catGlyph } from '../lib/features';

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
const SOURCE = { rule: 'by SMS rule', category: 'by its category', master: 'linked before rules', learned: 'linked before rules', manual: 'picked by you', marked: 'marked by you', auto: 'automatically' };
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
/** "47% more than expected" when a payment's amount differs from the event's by 5% or more. */
const deltaText = (amount, expected) => {
  const a = Number(amount), x = Number(expected);
  if (!a || !x) return null;
  const pc = Math.round((a / x - 1) * 100);
  return Math.abs(pc) < 5 ? null : `${Math.abs(pc)}% ${pc > 0 ? 'more' : 'less'} than ${inr(x)}`;
};
const lastPaidOf = (e) => e.last_done?.paid_on || e.last_done?.period || null;

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
  if (e.status === 'proposed') return ['Proposed · not tracked yet', 'prop'];
  if (e.status !== 'active') return [e.status === 'paused' ? 'Paused' : 'Not tracked', 'mute'];
  const d = e.focus_date;
  if (e.state === 'overdue') return [`Overdue · was due ${fmt(d)}`, 'bad'];
  if (e.state === 'due') { const n = days(d); return [n > 0 ? `Due in ${n} day${n > 1 ? 's' : ''} · ${fmt(d)}` : n === 0 ? 'Due today' : `Due · ${fmt(d)} (in buffer)`, 'warn']; }
  if (e.cycle_done) return [`Done · paid ${fmt(e.last_done?.paid_on || e.last_done?.period)}${e.next_due ? ` · next ${fmt(e.next_due)}` : ''}`, 'ok'];
  if (e.next_due) return [`Next ${fmt(e.next_due)}`, 'calm'];
  return ['No upcoming date', 'mute'];
}
const ordinal = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); };
// A rule matches on the merchant; it can be narrowed to days of the month, and to an amount too
const MATCH_MODES = [['merchant', 'Merchant only'], ['merchant_date', 'Merchant + date'], ['merchant_date_amount', 'Merchant + date + amount']];
const wrapDay = (d) => ((d - 1 + 31) % 31) + 1;
function ruleWhen(r) {
  const parts = [];
  if (r.sender_key) parts.push(['From', r.sender_key]);
  if (r.ref_kind === 'acct') parts.push(['Account', `${r.label ? clean(r.label) + ' ' : ''}••${r.account_ref || ''}`]);
  else if (r.merchant_pattern) parts.push(['Words', `“${r.merchant_pattern}”`]);
  else if (r.has_words) parts.push(['Payee', r.label ? `“${clean(r.label)}”` : 'same payee']);
  if (r.amount_min != null || r.amount_max != null) {
    parts.push(['Amount', r.amount_min != null && r.amount_max != null
      ? (r.amount_min === r.amount_max ? inr(r.amount_min) : `${inr(r.amount_min)} – ${inr(r.amount_max)}`)
      : r.amount_min != null ? `from ${inr(r.amount_min)}` : `up to ${inr(r.amount_max)}`]);
  }
  if (r.account_ref && r.ref_kind !== 'acct') parts.push([r.ref_kind === 'loan' ? 'Loan' : r.ref_kind === 'card' ? 'Card' : 'Account', `••${r.account_ref}`]);
  if (r.day_from && r.day_to) parts.push(['Days', r.day_from === r.day_to ? `${ordinal(r.day_from)} of the month` : `${ordinal(r.day_from)} – ${ordinal(r.day_to)} of the month`]);
  return parts;
}

function Pill({ tone, children }) { return <span className={`eh-pill ${tone}`}>{children}</span>; }
// K-214: each cycle as a mark: filled tick = paid, cross = missed, ! = overdue, ring = due now, hollow = coming up
const TRACK = {
  done: ['Paid', '✓'], skipped: ['Skipped', '–'], missed: ['Missed', '✕'], overdue: ['Overdue', '!'],
  due: ['Due now', ''], upcoming: ['Coming up', ''], untracked: ['Before tracking', ''],
};
function Track({ track, big }) {
  if (!track || track.length < 2) return null;
  const paid = track.filter(t => t.s === 'done').length;
  const counted = track.filter(t => !['upcoming', 'untracked', 'due'].includes(t.s)).length;
  return (
    <span className={`eh-track${big ? ' big' : ''}`} role="img"
      aria-label={`${paid} of ${counted} paid: ${track.map(t => `${fmtY(t.p)} ${TRACK[t.s]?.[0] || t.s}`).join(', ')}`}>
      {track.map(t => (
        <span key={t.p} className={`eh-dot s-${t.s}`} title={`${fmtY(t.p)} · ${TRACK[t.s]?.[0] || t.s}`}>
          {TRACK[t.s]?.[1] || ''}
          {big && <small>{MONTHS[pd(t.p).getMonth()]}</small>}
        </span>
      ))}
    </span>
  );
}

// What an event belongs to (from the server's link): the master you can open from here
const LINK_NAME = { subscription: 'Subscription', card: 'Credit card', loan: 'Loan', sip: 'SIP', rd: 'Recurring deposit', insurance: 'Insurance policy',
  income: 'Income', bank_account: 'Bank account', expense: 'Regular expense' };
const linkName = (l) => LINK_NAME[l?.kind] || 'Master';
const linkTitle = (l) => [clean(l?.title) || '', l?.ref ? `••${l.ref}` : ''].filter(Boolean).join(' ');
// Groups for the list, by what kind of thing the event is
const GROUPS = [['all', 'Everything'], ['loan', 'Loans & EMIs'], ['card', 'Credit cards'], ['subscription', 'Subscriptions'], ['invest', 'SIPs & RDs'],
  ['insurance', 'Insurance'], ['income', 'Money in'], ['bill', 'Bills & other']];
const groupOf = (e) => ({ emi: 'loan', card_due: 'card', subscription: 'subscription', sip: 'invest', rd_instalment: 'invest', premium: 'insurance',
  salary: 'income', income: 'income', dividend: 'income' }[e.kind] || 'bill');

// Categories the phone has that the web list may not
const CAT_NAMES = { cc_bill: 'Credit card bill', p_insurance: 'Insurance', p_transfer: 'Transfer', p_emi: 'EMI', p_education: 'Education', subscriptions: 'Subscriptions' };
export const RULE_SOURCE = { event_map: 'made from a payment you picked', from_master: "made from the master's keywords", from_payments: 'made from earlier payments',
  group: 'made from an SMS group', web: 'added on the web', manual: 'from the phone' };
function CatChip({ id, cats, ignored }) {
  if (ignored) return <span className="eh-cat none">Ignore this SMS</span>;
  if (!id) return <span className="eh-cat none">No category</span>;
  const c = cats.find(x => x.id === id);
  return <span className="eh-cat">{catGlyph(c?.icon) ? <i aria-hidden="true">{catGlyph(c.icon)}</i> : null}{c?.name || CAT_NAMES[id] || id}</span>;
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
        <b>How it works</b><span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ol className="eh-flow">
          <li><span className="eh-step">1</span><div><b>Add what's due</b><p>An EMI, a card bill, a subscription, a SIP, a premium, rent. Most are added for you from your SMS.</p></div></li>
          <li><span className="eh-step">2</span><div><b>Answer once</b><p>When a payment SMS arrives, Kanalyst asks “Is this your Netflix payment?”. Say yes once.</p></div></li>
          <li><span className="eh-step">3</span><div><b>Marked paid by itself</b><p>From then on the reminder stops by itself when the payment SMS arrives, even a few days early or late.</p></div></li>
        </ol>
      )}
    </section>
  );
}

// ── Event form ───────────────────────────────────────────────────────────────
const TIMING = { early: 'Paid early', on_time: 'On time', late: 'Paid late' };
const HOW = { rule: 'by SMS rule', category: 'by its category', manual: 'picked by you', marked: 'marked paid', auto: 'automatically', master: 'linked', learned: 'linked' };

/** Payments that settled this event before (newest first), with the SMS each came from. */
function PastPayments({ id }) {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; eventsAPI.get(id).then(r => { if (live) setD(r.data); }).catch(() => { if (live) setD({ error: true }); }); return () => { live = false; }; }, [id]);
  if (!d) return <div className="ee-past"><LogoLoader size={26} inline label="Loading payments" /></div>;
  if (d.error) return <div className="ee-past"><p className="eh-dim">Could not load the payments.</p></div>;
  const paid = (d.occurrences || []).filter(o => o.state === 'done' || o.paid_on).map(o => ({ key: o.period, due: o.period, date: o.paid_on || o.txn?.date, amount: o.amount || o.txn?.amount, timing: o.timing, how: o.match_source, sms: o.txn?.body, sender: o.txn?.sender }));
  const extra = (d.other_payments || []).map(t => ({ key: t.id, due: null, date: t.date, amount: t.amount, how: 'linked', sms: t.body || t.payee, sender: t.sender }));
  const list = [...paid, ...extra].sort((x, y) => String(y.date || y.due).localeCompare(String(x.date || x.due)));
  const total = list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return (
    <div className="ee-past">
      <div className="ee-past-head"><h3>Past payments</h3>{list.length > 0 && <span>{list.length} · {inr(total)}</span>}</div>
      {!list.length ? <p className="ee-none">No payment has been tied to this event yet. When its bank SMS arrives, Kanalyst asks once and remembers.</p> : (
        <ol className="ee-plist">
          {list.map(x => (
            <li key={x.key}>
              <div className="ee-p-top"><b>{x.date ? fmtY(x.date) : fmtY(x.due)}</b><span className="ee-p-amt">{inr(x.amount)}</span></div>
              <div className="ee-p-meta">{x.due ? <>For {fmt(x.due)} due · </> : null}{x.timing ? TIMING[x.timing] : 'Tied to this event'}{x.how ? `, ${HOW[x.how] || x.how}` : ''}</div>
              {x.sms && <p className="ee-p-sms">{x.sender ? <small>{x.sender}</small> : null}{clean(x.sms)}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** New / edit event: one clear sheet. Left: the event in plain sections with a live summary; right: its past payments. */
function EventForm({ initial, cats, onClose, onSaved, notify }) {
  const e0 = initial || {};
  const [f, setF] = useState({
    title: clean(e0.title) || '', kind: e0.kind || 'subscription', category_id: e0.category_id || '',
    amount: e0.amount || '', amount_mode: e0.amount_mode || 'about', frequency: e0.frequency || 'monthly',
    due_day: e0.due_day || '', due_month: e0.due_month || '', date: e0.start_date || '',
    buffer_days: e0.buffer_days ?? 2, remind_days: e0.remind_days ?? '', alert_level: e0.alert_level || '',
    pay_mode: e0.pay_mode || 'auto', notes: e0.notes || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF(x => ({ ...x, [k]: v && v.target ? v.target.value : v }));
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; }; }, [onClose]);
  const level = f.alert_level || DEFAULT_LEVEL[f.kind] || 'medium';
  const remindDefault = DEFAULT_REMIND[level];
  const remind = f.remind_days === '' ? remindDefault : Number(f.remind_days) || 0;
  const buf = Number(f.buffer_days) || 0;
  const save = async () => {
    setErr('');
    if (!f.title.trim()) return setErr('Give the event a name.');
    if (!f.category_id) return setErr('Pick a category. Every payment of this event is filed there.');
    if (f.frequency === 'once' ? !f.date : !f.due_day) return setErr(f.frequency === 'once' ? 'Pick the date.' : 'Pick the day it is due.');
    if (!['monthly', 'once'].includes(f.frequency) && !f.due_month) return setErr('Pick the month it is due.');
    const body = {
      title: f.title.trim(), kind: f.kind, category_id: f.category_id, amount: Number(f.amount) || 0, amount_mode: f.amount ? f.amount_mode : 'any',
      frequency: f.frequency, due_day: f.frequency === 'once' ? undefined : Number(f.due_day), due_month: f.frequency === 'monthly' || f.frequency === 'once' ? null : Number(f.due_month),
      start_date: f.frequency === 'once' ? f.date : undefined, buffer_days: buf, remind_days: f.remind_days === '' ? null : Number(f.remind_days),
      alert_level: f.alert_level || null, pay_mode: f.pay_mode, notes: f.notes, direction: IN_TYPES.includes(f.kind) ? 'in' : 'out',
    };
    setBusy(true);
    try {
      const r = initial ? await eventsAPI.update(initial.id, body) : await eventsAPI.create(body);
      notify(initial ? 'Event saved' : 'Event added');
      onSaved(initial ? initial.id : r.data.event?.id);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  // Plain-language summary of what is being saved
  const when = f.frequency === 'once' ? (f.date ? `on ${fmtY(f.date)}` : 'once')
    : !f.due_day ? (FREQS.find(x => x[0] === f.frequency)?.[1] || '').toLowerCase()
    : f.frequency === 'monthly' ? `every month on the ${ord(Number(f.due_day))}`
    : `${{ quarterly: 'every 3 months', half_yearly: 'every 6 months', yearly: 'every year' }[f.frequency]} on ${ord(Number(f.due_day))}${f.due_month ? ` ${MONTHS[f.due_month - 1]}` : ''}`;
  const howMuch = !Number(f.amount) ? 'any amount' : `${f.amount_mode === 'exact' ? '' : 'about '}${inr(f.amount)}`;
  const k = kindOf(f.kind);
  const cat = cats.find(c => c.id === f.category_id);
  return createPortal(
    <div className="ee-back" role="presentation">
      <div className="ee" role="dialog" aria-modal="true" aria-label={initial ? 'Edit event' : 'New event'}>
        <header className="ee-bar">
          <button type="button" className="ee-close" onClick={onClose} aria-label="Close">‹</button>
          <h2>{initial ? 'Edit event' : 'New event'}</h2>
          <span className="ee-grow" />
          <button type="button" className="ee-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ee-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add event'}</button>
        </header>
        <div className={`ee-body${initial ? '' : ' solo'}`}>
          <div className="ee-form">
            <section className="ee-summary" style={{ '--k': k.c }}>
              <span className="ee-sum-ic"><KindIcon kind={f.kind} size={22} color="#FAF7F0" /></span>
              <div>
                <b>{f.title.trim() || 'Untitled event'}</b>
                <p>{TYPE_NAME[f.kind] || k.label}, {when}, {howMuch}. {f.pay_mode === 'auto' ? 'Auto-debited' : 'You pay it'}; reminder {remind ? `${remind} day${remind > 1 ? 's' : ''} before` : 'on the day'}.</p>
                {cat && <small>Filed under {cat.icon ? `${cat.icon} ` : ''}{cat.name}</small>}
              </div>
            </section>

            <section className="ee-sec">
              <h3>What it is</h3>
              <label className="ee-field"><span>Name</span><input value={f.title} onChange={set('title')} placeholder="e.g. Home loan EMI, Netflix, Property tax" maxLength={120} autoFocus={!initial} /></label>
              <div className="ee-field"><span>Type</span>
                <div className="ee-types" role="radiogroup" aria-label="Type">
                  {TYPES.map(([t, l]) => (
                    <button key={t} type="button" role="radio" aria-checked={f.kind === t} className={f.kind === t ? 'on' : ''} onClick={() => set('kind')(t)}>
                      <KindIcon kind={t} size={15} color={f.kind === t ? '#FAF7F0' : undefined} />{l.replace(' (money in)', '')}
                    </button>
                  ))}
                </div>
              </div>
              <label className="ee-field"><span>Category <small>its payments and SMS rules are filed here</small></span><CategorySelect value={f.category_id} onChange={set('category_id')} cats={cats} required /></label>
            </section>

            <section className="ee-sec">
              <h3>When it's due</h3>
              <div className="ee-field"><span>Repeats</span><Seg label="Repeats" options={FREQS} value={f.frequency} onChange={set('frequency')} /></div>
              <div className="ee-row">
                {f.frequency === 'once'
                  ? <label className="ee-field"><span>Date</span><input type="date" value={f.date} onChange={set('date')} /></label>
                  : <label className="ee-field"><span>Day of the month</span><input type="number" min="1" max="31" value={f.due_day} onChange={set('due_day')} placeholder="5" /></label>}
                {!['monthly', 'once'].includes(f.frequency) && (
                  <label className="ee-field"><span>Month</span><select value={f.due_month} onChange={set('due_month')}><option value="">Pick…</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
                )}
                <div className="ee-field"><span>Counts as on time if paid within</span>
                  <div className="eh-stepper">
                    <button type="button" onClick={() => set('buffer_days')(Math.max(0, buf - 1))} aria-label="Fewer days">−</button>
                    <span>±{buf} day{buf === 1 ? '' : 's'}</span>
                    <button type="button" onClick={() => set('buffer_days')(Math.min(15, buf + 1))} aria-label="More days">+</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="ee-sec">
              <h3>How much</h3>
              <div className="ee-row">
                <label className="ee-field ee-money"><span>Usual amount <small>leave empty if it changes (card bills)</small></span><i>₹</i><input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} placeholder="0" /></label>
                {Number(f.amount) > 0 && <div className="ee-field"><span>The payment must be</span><Seg label="Amount matching" options={[['exact', 'Exactly this'], ['about', 'Within 10%'], ['any', 'Any amount']]} value={f.amount_mode} onChange={set('amount_mode')} /></div>}
              </div>
              <div className="ee-field"><span>Paid by</span><Seg label="Paid by" options={[['auto', 'Auto-debit (NACH, standing instruction)'], ['manual', 'Me, by hand']]} value={f.pay_mode} onChange={set('pay_mode')} /></div>
            </section>

            <section className="ee-sec">
              <h3>Reminders</h3>
              <div className="ee-row">
                <label className="ee-field"><span>Importance</span>
                  <select value={f.alert_level} onChange={set('alert_level')}>
                    <option value="">Default for {TYPE_NAME[f.kind] || 'this type'} ({LEVELS.find(l => l[0] === (DEFAULT_LEVEL[f.kind] || 'medium'))[1]})</option>
                    {LEVELS.map(([lk, l]) => <option key={lk} value={lk}>{l}</option>)}
                  </select>
                </label>
                <label className="ee-field"><span>Remind me (days before)</span><input type="number" min="0" max="60" value={f.remind_days} onChange={set('remind_days')} placeholder={`${remindDefault} (default)`} /></label>
              </div>
              <label className="ee-field"><span>Notes</span><input value={f.notes} onChange={set('notes')} placeholder="Optional, e.g. loan account number is on the passbook" maxLength={300} /></label>
            </section>
            {err && <div className="ee-err" role="alert">{err}</div>}
          </div>
          {initial && <aside className="ee-side"><PastPayments id={initial.id} /></aside>}
        </div>
      </div>
    </div>, document.body
  );
}

// ── Rule form ────────────────────────────────────────────────────────────────
function RuleForm({ initial, preset, cats, events, onClose, onSaved, notify }) {
  const r0 = initial || {};
  const [f, setF] = useState({
    event_id: r0.event_id || preset?.event_id || '', category_id: r0.category_id || preset?.category_id || '',
    sender_key: r0.sender_key || preset?.sender_key || '', words: r0.merchant_pattern || '',
    amount_min: r0.amount_min ?? preset?.amount_min ?? '', amount_max: r0.amount_max ?? preset?.amount_max ?? '',
    account_ref: r0.account_ref || preset?.account_ref || '',
    match_mode: r0.match_mode || 'merchant', day_from: r0.day_from ?? '', day_to: r0.day_to ?? '',
  });
  const acctRule = r0.ref_kind === 'acct';
  // Switching the match fills the window from the payment the rule was made from: its day ±3, its amount ±5%
  const setMode = (m) => setF(x => {
    const y = { ...x, match_mode: m };
    const sd = r0.sample_day, sa = r0.sample_amount;
    if (m !== 'merchant' && (x.day_from === '' || x.day_to === '') && sd) { y.day_from = wrapDay(sd - 3); y.day_to = wrapDay(sd + 3); }
    if (m === 'merchant_date_amount' && x.amount_min === '' && x.amount_max === '' && sa) { y.amount_min = Math.floor(sa * 0.95); y.amount_max = Math.ceil(sa * 1.05); }
    if (m === 'merchant') { y.day_from = ''; y.day_to = ''; }
    if (m !== 'merchant_date_amount' && !x.event_id) { y.amount_min = ''; y.amount_max = ''; }
    return y;
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
    ...(acctRule ? {} : f.words.trim() ? { merchant_pattern: f.words.trim().toLowerCase(), pattern_tok: null } : keepPayee ? {} : { merchant_pattern: null, pattern_tok: null }),
    match_mode: f.match_mode, day_from: f.match_mode === 'merchant' || f.day_from === '' ? null : Number(f.day_from),
    day_to: f.match_mode === 'merchant' || f.day_to === '' ? null : Number(f.day_to),
    amount_min: f.amount_min === '' ? null : Number(f.amount_min), amount_max: f.amount_max === '' ? null : Number(f.amount_max),
    account_ref: f.account_ref.replace(/\D/g, '').slice(-4) || null,
    ...(acctRule ? { ref_kind: 'acct' } : {}),
    ...(!acctRule && f.account_ref && ev && (ev.kind === 'card_due' || ev.kind === 'emi') ? { ref_kind: ev.kind === 'card_due' ? 'card' : 'loan' } : {}),
  }), [f, keepPayee, ev]);
  // Live preview: which recent SMS this rule catches
  const t = useRef(null);
  useEffect(() => {
    clearTimeout(t.current);
    if (!body.sender_key && !body.merchant_pattern && !body.account_ref && !keepPayee) { setPrev(null); return undefined; }
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
    if (!body.sender_key && !body.merchant_pattern && !body.account_ref && !keepPayee) return setErr('Give the rule a sender, words from the SMS, or the account\'s last digits.');
    if (f.match_mode !== 'merchant' && (body.day_from == null || body.day_to == null)) return setErr('Pick the days of the month this rule covers.');
    if (f.match_mode === 'merchant_date_amount' && body.amount_min == null && body.amount_max == null) return setErr('Give the amount range for this rule.');
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
          {acctRule ? (
            <Field label="paid from account" hint="Made on the phone for payments whose SMS has no merchant name">
              <input value={`${clean(r0.label) || 'Account'} ••${r0.account_ref || ''}`} readOnly />
            </Field>
          ) : <Field label="has these words" hint={keepPayee ? `Now: same payee as “${clean(initial.label) || 'the payment it was made from'}”. Type words to replace it.` : 'Words from the SMS, e.g. claude or anthropic'}>
            <input value={f.words} onChange={set('words')} placeholder={keepPayee ? 'Same payee (keep)' : 'Any words'} />
          </Field>}
          {!f.event_id && (
            <Field label="match on" hint={r0.sample_day ? `Made from a payment of ${r0.sample_amount != null ? inr(r0.sample_amount) : '—'} on the ${ordinal(r0.sample_day)}.` : 'Narrow the rule to some days of the month, and an amount.'}>
              <div className="eh-seg" role="radiogroup" aria-label="Match on">
                {MATCH_MODES.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={f.match_mode === k} className={f.match_mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>
                ))}
              </div>
            </Field>
          )}
          {!f.event_id && f.match_mode !== 'merchant' && (
            <div className="eh-two">
              <Field label="from day"><input type="number" min="1" max="31" value={f.day_from} onChange={set('day_from')} placeholder="1" /></Field>
              <Field label="to day" hint="28 to 5 wraps the month end"><input type="number" min="1" max="31" value={f.day_to} onChange={set('day_to')} placeholder="31" /></Field>
            </div>
          )}
          {(f.event_id || f.match_mode === 'merchant_date_amount') && (
          <div className="eh-two">
            <Field label="amount from"><input type="number" min="0" value={f.amount_min} onChange={set('amount_min')} placeholder="Any" /></Field>
            <Field label="to"><input type="number" min="0" value={f.amount_max} onChange={set('amount_max')} placeholder="Any" /></Field>
          </div>
          )}
          {!acctRule && <Field label="mentions account / card ending in" hint="Last 2 to 4 digits, e.g. 6007 for Card XX6007. Best for card bills and EMIs, whose amount changes.">
            <input inputMode="numeric" value={f.account_ref} onChange={(e) => set('account_ref')(e.target.value.replace(/[^0-9xX*]/g, '').slice(0, 8))} placeholder="Any account" />
          </Field>}
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
        {prev == null ? <span className="eh-dim">Add a sender, words or account digits to see which SMS this rule catches.</span> : (
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


/** One payment as a pickable row: amount, date, bank, SMS text, and why it is likely. */
function PayLine({ t, expected, period }) {
  const delta = deltaText(t.amount, expected);
  const off = period ? Math.round((pd(t.date) - pd(period)) / 864e5) : null;
  return (
    <div className="eh-payline">
      <div className="eh-payline-top">
        <span className="eh-amt">{inr(t.amount)}</span>
        <span className="eh-dim">{fmtY(t.date)}{off ? ` · ${Math.abs(off)} day${Math.abs(off) === 1 ? '' : 's'} ${off < 0 ? 'before' : 'after'} due` : off === 0 ? ' · on the due date' : ''}</span>
      </div>
      <div className="eh-row-tags">
        {t.cat_match && <span className="eh-tag ok">Same category</span>}
        {delta && <span className="eh-tag">{delta}</span>}
        {(t.sender || t.bank) && <span className="eh-tag">{t.sender || t.bank}{t.account ? ` · ••${String(t.account).slice(-4)}` : ''}</span>}
      </div>
      {clean(t.body || t.payee) && !/^e[vp]1:/.test(String(t.body || t.payee)) && <p className="eh-sms">{clean(t.body || t.payee)}</p>}
    </div>
  );
}

/**
 * Pick the payment for a due date by hand, from every payment near it (any amount). Used when the right
 * payment was not suggested: a premium that went up, a fee paid weeks early, a payment from another bank.
 */
function PaymentPicker({ ev, period, onClose, onPick, busy }) {
  const [q, setQ] = useState('');
  const [wide, setWide] = useState(false);
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      eventsAPI.candidates(ev.id, { period, q: q || undefined, days: wide ? 120 : undefined })
        .then(r => { if (live) setList(r.data.payments || []); }).catch(() => { if (live) setList([]); });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(h); };
  }, [ev.id, period, q, wide]);
  return (
    <Modal title={`Which payment was ${clean(ev.title)} on ${fmt(period)}?`} onClose={onClose} wide
      footer={<><button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="eh-picker">
        <p className="eh-dim">Payments {wide ? 'within 4 months' : 'near'} this due date, any amount. Pick one and Kanalyst saves a rule so the next one is marked paid by itself.</p>
        <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search amount, bank, payee or SMS words" aria-label="Search payments" />
        {list === null ? <LogoLoader size={26} inline label="Finding payments" /> : !list.length ? (
          <div className="eh-empty"><b>No payment found{q ? ' for that search' : ''}.</b><p>{wide ? 'If you paid in cash or from an account Kanalyst does not read, close this and use “I paid it another way”.' : 'Look further back and ahead.'}</p></div>
        ) : (
          <ul className="eh-picklist">
            {list.map((t, i) => (
              <li key={t.id} style={{ '--i': Math.min(i, 10) }}>
                <PayLine t={t} expected={ev.amount} period={period} />
                {t.taken === 'other'
                  ? <span className="eh-dim eh-taken">Already settles another event</span>
                  : <button type="button" className="fo-btn sm" disabled={busy || t.taken === 'this'} onClick={() => onPick(t)}>{t.taken === 'this' ? 'Tied' : 'This one'}</button>}
              </li>
            ))}
          </ul>
        )}
        {!wide && list !== null && <button type="button" className="eh-link" onClick={() => setWide(true)}>Look further back and ahead</button>}
      </div>
    </Modal>
  );
}

// ── Event detail ─────────────────────────────────────────────────────────────
function Occurrence({ o, ev, onAct, onPick, busy, i }) {
  const [no, setNo] = useState(0);           // how many suggestions the user said No to
  const [label, tone] = STATE[o.state] || [o.state, 'mute'];
  const isOpen = ['due', 'overdue', 'missed'].includes(o.state);
  const ask = (o.suggestions || [])[no] || null;
  return (
    <li className={`eh-occ ${o.state}`} style={{ '--i': i }}>
      <div className="eh-occ-date"><b>{fmt(o.period)}</b><small>{pd(o.period).getFullYear()}</small></div>
      <div className="eh-occ-main">
        <div className="eh-occ-top">
          <Pill tone={tone}>{label}{o.state === 'done' && o.timing && o.timing !== 'on_time' ? ` · ${o.timing === 'late' ? 'late' : 'early'}` : ''}</Pill>

        </div>
        {o.state === 'done' && (
          <div className="eh-paid">
            <span className="eh-amt">{inr(o.amount)}</span>
            <span>paid {fmtY(o.paid_on)} · {SOURCE[o.match_source] || 'tied'}</span>
            {o.txn && <p className="eh-sms">{clean(o.txn.body || o.txn.payee) || '—'}<em>{o.txn.sender || o.txn.bank || ''}{o.txn.account ? ` · xx${String(o.txn.account).slice(-4)}` : ''}</em></p>}
          </div>
        )}
        {isOpen && ask && (
          <div className="eh-ask" role="group" aria-label={`Is this your ${clean(ev.title)} payment?`}>
            <p className="eh-ask-q">Is this your <b>{clean(ev.title)}</b> payment?</p>
            <div className="eh-ask-pay"><PayLine t={ask} expected={ev.amount} period={o.period} /></div>
            <div className="eh-occ-acts">
              <button type="button" className="fo-btn sm" disabled={busy} onClick={() => onAct(o.period, { action: 'match', txn_id: ask.id })}>Yes, that's it</button>
              <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => setNo(n => n + 1)}>No</button>
              <button type="button" className="eh-link" disabled={busy} onClick={() => onPick(o.period)}>Choose another…</button>
            </div>
            <p className="eh-dim eh-note">Answer once: the next one is marked paid by itself.</p>
          </div>
        )}
        {isOpen && !ask && (
          <div className="eh-occ-acts">
            <span className="eh-dim">{(o.suggestions || []).length ? 'None of those.' : 'No likely payment found.'}</span>
            <button type="button" className="fo-btn sm" disabled={busy} onClick={() => onPick(o.period)}>Choose the payment…</button>
            <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onAct(o.period, { action: 'done' })}>I paid it another way</button>
            <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onAct(o.period, { action: 'skip' })}>Skip this one</button>
            {no > 0 && <button type="button" className="eh-link" onClick={() => setNo(0)}>Show the payments again</button>}
          </div>
        )}
        {(o.state === 'done' || o.state === 'skipped') && (
          <span className="eh-occ-acts">
            <button type="button" className="eh-link" disabled={busy} onClick={() => onAct(o.period, null)}>{o.state === 'done' && o.txn ? 'Not this payment' : 'Open again'}</button>
            {o.state === 'done' && !o.txn && <button type="button" className="eh-link" disabled={busy} onClick={() => onPick(o.period)}>Tie the payment SMS</button>}
          </span>
        )}
      </div>
    </li>
  );
}

function EventDetail({ id, cats, events, onEdit, onChanged, onClose, notify, full }) {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ruleEdit, setRuleEdit] = useState(null);
  const [pick, setPick] = useState(null);             // the due date whose payment is being chosen
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
  const e0 = d?.event;
  const setStatus = async (s) => {
    try { await eventsAPI.status(id, s); notify(s === 'active' ? (e0?.status === 'proposed' ? 'Activated · Kanalyst now tracks it' : 'Resumed') : s === 'paused' ? 'Paused · no alerts until you resume' : 'Stopped tracking'); await load(); onChanged(); }
    catch (e) { notify(errMsg(e)); }
  };
  const stopTracking = () => {
    if (!window.confirm('Stop tracking this event? No more due dates or alerts. You can resume it any time.')) return;
    setStatus('closed');
  };
  const del = async () => {
    const prop = e0?.status === 'proposed';
    if (!window.confirm(prop ? 'Delete this proposal and its SMS rule? Kanalyst will not propose it again. Payments stay in your expenses.'
      : 'Delete this event, its due dates and its SMS rules? Payments stay in your expenses.')) return;
    try { await eventsAPI.remove(id); notify(prop ? 'Proposal deleted' : 'Event deleted'); onChanged(); onClose(); } catch (e) { notify(errMsg(e)); }
  };
  const delRule = async (r) => {
    try { await eventsAPI.removeRule(r.id); notify('Rule removed'); await load(); onChanged(); } catch (e) { notify(errMsg(e)); }
  };
  if (!d) return <div className="eh-detail"><LogoLoader size={30} inline label="Opening event" /></div>;
  if (d.error) return <div className="eh-detail"><p className="eh-dim">Could not open this event.</p></div>;
  const e = d.event;
  const k = kindOf(e.kind);
  const now = d.occurrences.find(o => o.state === 'overdue' || o.state === 'due');
  const openMaster = () => { const l = e.link; if (!l) return; if (l.to) nav(l.to); else nav(`/dashboard?tab=${l.tab === 'm-subscription' ? 'm-all' : l.tab}`); };
  // Timeline, oldest first: earlier cycles, the one due now, then what's coming (K-214)
  const occ = [...d.occurrences].sort((x, y) => String(x.period).localeCompare(String(y.period)));
  const past = occ.filter(o => ['done', 'missed', 'skipped', 'untracked'].includes(o.state));
  const cur = occ.filter(o => ['due', 'overdue'].includes(o.state));
  const next = occ.filter(o => o.state === 'upcoming');
  const track = occ.map(o => ({ p: o.period, s: o.state }));
  return (
    <div className={`eh-detail eh-v2${full ? ' full' : ''}`}>
      <header className="eh-d-head">
        <span className="eh-ico" style={{ '--k': k.c }}><KindIcon kind={e.kind} size={20} /></span>
        <div className="eh-d-title">
          <h2>{clean(e.title)}</h2>
          <p className="eh-d-tags">
            <span className={`eh-type t-${groupOf(e)}`}>{e.kind === 'subscription' ? '↻ Subscription' : (TYPE_NAME[e.kind] || k.label)}</span>
            {e.status === 'proposed' && <span className="eh-type t-prop">Proposed</span>}
            {!['active', 'proposed'].includes(e.status) && <span className="eh-type t-off">{e.status === 'paused' ? 'Paused' : 'Not tracked'}</span>}
            {e.link && <button type="button" className="eh-link" onClick={openMaster}>Linked to {linkName(e.link).toLowerCase()}{linkTitle(e.link) ? ` · ${linkTitle(e.link)}` : ''} ›</button>}
          </p>
        </div>
        <div className="eh-d-acts">
          {e.status === 'proposed' ? (
            <>
              <button type="button" className="fo-btn sm" onClick={() => setStatus('active')}>Activate</button>
              <button type="button" className="fo-btn sm ghost" onClick={() => onEdit(e)}>Edit</button>
              <button type="button" className="fo-btn sm ghost danger" onClick={del}>Delete proposal</button>
            </>
          ) : <>
          <button type="button" className="fo-btn sm" onClick={() => onEdit(e)}>Edit</button>
          {e.status === 'active'
            ? <button type="button" className="fo-btn sm ghost" onClick={() => setStatus('paused')}>Pause</button>
            : <button type="button" className="fo-btn sm ghost" onClick={() => setStatus('active')}>Resume</button>}
          {e.source === 'manual'
            ? <button type="button" className="fo-btn sm ghost danger" onClick={del}>Delete</button>
            : e.status !== 'closed' && <button type="button" className="fo-btn sm ghost danger" onClick={stopTracking}>Stop tracking</button>}
          </>}
        </div>
      </header>
      {e.status === 'proposed' && (
        <div className="eh-propnote">
          <b>Kanalyst found this in your SMS.</b> It is not tracked yet: no alerts, and payments are not marked against it.
          Check the SMS rule, amount and date below (change anything that is off), then press <b>Activate</b>. Not a real repeating payment? <button type="button" className="eh-link" onClick={del}>Delete the proposal</button>.
        </div>
      )}

      <Spotter e={e} rules={d.rules} cats={cats} notify={notify} onChanged={async () => { await load(); onChanged(); }}
        onAddRule={() => setRuleEdit({ preset: { event_id: e.id, category_id: e.category_id } })}
        onEditRule={(r) => setRuleEdit({ rule: { ...r, event_id: e.id } })} onDelRule={delRule} onEditEvent={() => onEdit(e)} />

      <section className="eh-sec eh-tl-sec">
        <div className="eh-sec-head">
          <h3>Timeline</h3>
          <Track track={track} />
        </div>
        {e.status === 'active' && now && !(now.suggestions || []).length && (
          <div className={`eh-callout ${now.state === 'overdue' ? 'bad' : 'warn'}`}>
            <b>{now.state === 'overdue' ? `${fmt(now.period)} is overdue.` : `${fmt(now.period)} is due.`}</b>{' '}
            No likely payment found. <button type="button" className="eh-link" onClick={() => setPick(now.period)}>Choose the payment</button>
          </div>
        )}
        <ol className="eh-tl">
          {[['Coming up', next, 'next'], ['Now', cur, 'now'], ['Earlier', [...past].reverse(), 'past']].map(([label, list, key]) => (list.length ? (
            <li key={key} className={`eh-tl-group g-${key}`}>
              <h4>{label}</h4>
              <ul className="eh-occs">
                {list.map((o, i) => <Occurrence key={o.period} o={o} ev={e} onAct={act} onPick={setPick} busy={busy} i={i} />)}
              </ul>
            </li>
          ) : null))}
        </ol>
        {!!(d.other_payments || []).length && (
          <details className="eh-extra">
            <summary>Other payments tied to this event ({d.other_payments.length})</summary>
            <ul>{d.other_payments.map(t => <li key={t.id}><PayLine t={t} /></li>)}</ul>
          </details>
        )}
      </section>

      <details className="eh-sec eh-adv">
        <summary>Alerts and payment mode</summary>
        <dl className="eh-dl">
          <div><dt>Paid by</dt><dd>{e.pay_mode === 'manual' ? 'You, by hand' : 'Auto-debit'}</dd></div>
          <div><dt>Remind me</dt><dd>{e.remind_days != null ? `${e.remind_days} days before` : 'Default'}</dd></div>
          <div><dt>Created from</dt><dd>{e.master ? `${clean(e.master.title || e.master.institution || 'Master')} (master)` : 'Added by you'}</dd></div>
        </dl>
        <button type="button" className="eh-link" onClick={() => onEdit(e)}>Change these in Edit</button>
      </details>
      {pick && <PaymentPicker ev={e} period={pick} busy={busy} onClose={() => setPick(null)}
        onPick={async (t) => { await act(pick, { action: 'match', txn_id: t.id }); setPick(null); }} />}
      {ruleEdit && (
        <RuleForm initial={ruleEdit.rule} preset={ruleEdit.preset} cats={cats} events={events}
          onClose={() => setRuleEdit(null)} onSaved={() => { setRuleEdit(null); load(); onChanged(); }} notify={notify} />
      )}
    </div>
  );
}

/**
 * K-214: one card that says how Kanalyst recognises this payment: the SMS rule, the payee, the amount and the
 * date, each with its allowed buffer, which can be changed right here.
 */
function Spotter({ e, rules, cats, notify, onChanged, onAddRule, onEditRule, onDelRule, onEditEvent }) {
  const [sel, setSel] = useState(0);
  const [editAmt, setEditAmt] = useState(null);
  const [editDay, setEditDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const r = rules[Math.min(sel, Math.max(0, rules.length - 1))] || null;
  const amt = Number(e.amount) || 0;
  const hasRange = r && (r.amount_min != null || r.amount_max != null);
  const amtBuf = r && amt && hasRange
    ? Math.round(Math.max(r.amount_max != null ? r.amount_max - amt : 0, r.amount_min != null ? amt - r.amount_min : 0)) : null;
  const who = r ? ruleWhen(r).filter(([key]) => !['Amount', 'Days'].includes(key)) : [];
  const saveAmt = async () => {
    const b = Math.max(0, Math.round(Number(editAmt) || 0));
    setSaving(true);
    try { await eventsAPI.updateRule(r.id, { amount_min: Math.max(0, amt - b), amount_max: amt + b, event_id: e.id }); notify(`Amount buffer saved · ${inr(Math.max(0, amt - b))} to ${inr(amt + b)}`); setEditAmt(null); await onChanged(); }
    catch (er) { notify(errMsg(er)); } finally { setSaving(false); }
  };
  const saveDay = async () => {
    const b = Math.max(0, Math.min(15, parseInt(editDay, 10) || 0));
    setSaving(true);
    try { await eventsAPI.update(e.id, { buffer_days: b }); notify(`Date buffer saved · ± ${b} day${b === 1 ? '' : 's'}`); setEditDay(null); await onChanged(); }
    catch (er) { notify(errMsg(er)); } finally { setSaving(false); }
  };
  return (
    <section className="eh-spot" aria-label="How Kanalyst spots this payment">
      <div className="eh-spot-head">
        <h3>How Kanalyst spots this payment</h3>
        {rules.length > 1 && (
          <div className="eh-seg" role="tablist" aria-label="SMS rules">
            {rules.map((x, i) => <button key={x.id} type="button" role="tab" aria-selected={i === sel} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>Rule {i + 1}</button>)}
          </div>
        )}
      </div>
      {!r ? (
        <div className="eh-spot-none">
          <p><b>No SMS rule yet</b>, so Kanalyst can't mark this paid by itself. Answer “Is this your payment?” on a due date below, or add a rule now.</p>
          <div>
            <button type="button" className="fo-btn sm" onClick={onAddRule} disabled={!e.category_id}>+ Add SMS rule</button>
            {!e.category_id && <button type="button" className="eh-link" onClick={onEditEvent}>Pick a category first</button>}
          </div>
          <dl className="eh-spot-grid">
            <div><dt>Amount</dt><dd>{amountText(e)}</dd></div>
            <div><dt>Date</dt><dd>{scheduleText(e)} <span className="eh-buf">± {e.buffer_days} day{e.buffer_days === 1 ? '' : 's'}</span></dd></div>
          </dl>
        </div>
      ) : (
        <dl className="eh-spot-grid">
          <div className="wide">
            <dt>SMS rule</dt>
            <dd>
              <b>{r.label ? clean(r.label) : who.map(([, v]) => v).join(' · ') || 'Rule'}</b>
              <span className="eh-dim"> · caught {r.caught} SMS in 6 months{RULE_SOURCE[r.source] ? ` · ${RULE_SOURCE[r.source]}` : ''}</span>
              <span className="eh-spot-acts">
                <button type="button" className="eh-link" onClick={() => onEditRule(r)}>Edit rule</button>
                <button type="button" className="eh-link danger" onClick={() => onDelRule(r)}>Remove</button>
                <button type="button" className="eh-link" onClick={onAddRule}>+ Another rule</button>
              </span>
            </dd>
          </div>
          <div>
            <dt>Payee</dt>
            <dd>{who.length ? who.map(([key, v]) => <span key={key} className="eh-kv"><em>{key}</em>{v}</span>) : <span className="eh-dim">Any payee</span>}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd><CatChip id={r.category_id || e.category_id} cats={cats} /></dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              {!amt ? (
                <span>Varies{hasRange ? <span className="eh-dim"> · rule takes {ruleWhen(r).find(([key]) => key === 'Amount')?.[1]}</span> : null}</span>
              ) : editAmt == null ? (
                <span>{inr(amt)} <span className="eh-buf">± {amtBuf != null ? inr(amtBuf) : 'any'}</span>
                  {amtBuf != null && <span className="eh-dim"> ({inr(Math.max(0, amt - amtBuf))} – {inr(amt + amtBuf)})</span>}
                  <button type="button" className="eh-link" onClick={() => setEditAmt(amtBuf ?? Math.round(amt * 0.05))}>Change</button></span>
              ) : (
                <span className="eh-inline">{inr(amt)} ± ₹<input type="number" min="0" value={editAmt} onChange={(ev) => setEditAmt(ev.target.value)} aria-label="Amount buffer in rupees" autoFocus />
                  <button type="button" className="fo-btn sm" disabled={saving} onClick={saveAmt}>Save</button>
                  <button type="button" className="eh-link" onClick={() => setEditAmt(null)}>Cancel</button></span>
              )}
            </dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>
              {editDay == null ? (
                <span>{scheduleText(e)} <span className="eh-buf">± {e.buffer_days} day{e.buffer_days === 1 ? '' : 's'}</span>
                  <button type="button" className="eh-link" onClick={() => setEditDay(e.buffer_days)}>Change</button></span>
              ) : (
                <span className="eh-inline">{scheduleText(e)} ± <input type="number" min="0" max="15" value={editDay} onChange={(ev) => setEditDay(ev.target.value)} aria-label="Date buffer in days" autoFocus /> days
                  <button type="button" className="fo-btn sm" disabled={saving} onClick={saveDay}>Save</button>
                  <button type="button" className="eh-link" onClick={() => setEditDay(null)}>Cancel</button></span>
              )}
            </dd>
          </div>
          {r.sample && (
            <div className="wide">
              <dt>Latest SMS it caught</dt>
              <dd>
                <blockquote className="eh-spot-sms">{clean(r.sample.body) || clean(r.sample.payee) || 'No SMS text saved for this payment.'}</blockquote>
                <span className="eh-dim">{fmtY(r.sample.date)}{r.sample.sender ? ` · from ${r.sample.sender}` : ''}{r.sample.amount ? ` · ${inr(r.sample.amount)}` : ''}</span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

// ── Needs your answer ────────────────────────────────────────────────────────
/** Open due dates across all events, each with its most likely payment: answer them without opening each event. */
function InboxStrip({ events, onOpen, onChanged, notify, version }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [pick, setPick] = useState(null);
  const load = useCallback(() => { eventsAPI.inbox().then(r => setItems(r.data.items || [])).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load, version]);
  const act = async (it, body, msg) => {
    setBusy(it.event.id + it.period);
    try {
      const r = await eventsAPI.occurrence(it.event.id, it.period, body);
      notify(msg || (r.data.rule?.created ? `${clean(it.event.title)} marked paid · rule saved for next time` : `${clean(it.event.title)} marked paid`));
      setItems(xs => (xs || []).filter(x => x !== it));
      onChanged();
    } catch (e) { notify(errMsg(e)); } finally { setBusy(null); }
  };
  const skip = (it) => setItems(xs => (xs || []).map(x => (x === it ? { ...x, suggestion: null, dismissed: true } : x)));
  if (!items || !items.length) return null;
  return (
    <section className="eh-inbox" aria-label="Needs your answer">
      <div className="eh-inbox-head"><h2>Needs your answer</h2><span className="eh-count">{items.length}</span></div>
      <ul>
        {items.map((it, i) => {
          const k = kindOf(it.event.kind); const b = busy === it.event.id + it.period; const s = it.suggestion;
          return (
            <li key={it.event.id + it.period} className={`eh-inbox-card ${it.state}`} style={{ '--i': Math.min(i, 8) }}>
              <button type="button" className="eh-inbox-ev" onClick={() => onOpen(it.event.id)}>
                <span className="eh-ico sm" style={{ '--k': k.c }}><KindIcon kind={it.event.kind} size={15} /></span>
                <span><b>{clean(it.event.title)}</b><small>{it.state === 'overdue' ? `Was due ${fmt(it.period)} · ${it.days} day${it.days === 1 ? '' : 's'} ago` : it.days < 0 ? `Due ${fmt(it.period)} · in ${-it.days} day${it.days === -1 ? '' : 's'}` : `Due ${fmt(it.period)}`}</small></span>
              </button>
              {s ? (
                <div className="eh-inbox-q">
                  <p>Is this the payment?</p>
                  <PayLine t={s} expected={it.event.amount} period={it.period} />
                  <div className="eh-occ-acts">
                    <button type="button" className="fo-btn sm" disabled={b} onClick={() => act(it, { action: 'match', txn_id: s.id })}>Yes</button>
                    <button type="button" className="fo-btn sm ghost" disabled={b} onClick={() => setPick(it)}>Choose another…</button>
                    <button type="button" className="eh-link" disabled={b} onClick={() => skip(it)}>No</button>
                  </div>
                </div>
              ) : (
                <div className="eh-inbox-q">
                  <p className="eh-dim">{it.dismissed ? 'Pick the right payment, or mark it paid.' : 'No likely payment in your SMS yet.'}</p>
                  <div className="eh-occ-acts">
                    <button type="button" className="fo-btn sm" disabled={b} onClick={() => setPick(it)}>Choose the payment…</button>
                    <button type="button" className="fo-btn sm ghost" disabled={b} onClick={() => act(it, { action: 'done' }, `${clean(it.event.title)} marked paid`)}>Paid another way</button>
                    <button type="button" className="eh-link" disabled={b} onClick={() => act(it, { action: 'skip' }, 'Skipped this one')}>Skip</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {pick && <PaymentPicker ev={events.find(e => e.id === pick.event.id) || pick.event} period={pick.period} busy={!!busy} onClose={() => setPick(null)}
        onPick={async (t) => { const it = pick; setPick(null); await act(it, { action: 'match', txn_id: t.id }); }} />}
    </section>
  );
}

// ── Events tab ───────────────────────────────────────────────────────────────
const FREQ_NAME = Object.fromEntries(FREQS);
const typeOf = (e) => (e.link ? linkName(e.link) : e.source === 'manual' || !e.source ? 'Manual' : TYPE_NAME[e.kind] || 'Other');
const dueText = (e) => e.next_due ? fmt(e.next_due) : e.focus_date ? fmt(e.focus_date) : '—';
const COLS = [['title', 'Event'], ['type', 'Type'], ['freq', 'Frequency'], ['due', 'Next due'], ['last', 'Last paid'], ['amount', 'Amount'], ['state', 'Status']];
function EventsTab({ events, cats, reload, notify, selected, setSelected }) {
  // K-215: open on the proposals while nothing is active yet
  const [filter, setFilter] = useState(() => (!events.some(e => e.status === 'active') && events.some(e => e.status === 'proposed') ? 'proposed' : 'all'));
  const [activating, setActivating] = useState(null);
  const activate = async (e) => {
    setActivating(e.id);
    try { await eventsAPI.status(e.id, 'active'); notify(`${clean(e.title)} activated · Kanalyst now tracks it`); await reload(); }
    catch (er) { notify(errMsg(er)); } finally { setActivating(null); }
  };
  // Subscriptions live here now (K-214): the old Subscriptions link opens Events filtered to them
  const [group, setGroup] = useState(() => { try { const g = sessionStorage.getItem('eh-group'); sessionStorage.removeItem('eh-group'); return g || 'all'; } catch { return 'all'; } });
  const [freq, setFreq] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['due', 1]);
  const [focus, setFocus] = useState(null);           // the row picked with one click
  const [form, setForm] = useState(null);             // {} new | event
  const list = useMemo(() => {
    const rows = events.filter(e => {
      if (group !== 'all' && groupOf(e) !== group) return false;
      if (freq && e.frequency !== freq) return false;
      if (q) { const t = `${clean(e.title)} ${typeOf(e)} ${TYPE_NAME[e.kind] || ''} ${linkTitle(e.link)}`.toLowerCase(); if (!t.includes(q.toLowerCase())) return false; }
      const tone = stateLine(e)[1];
      switch (filter) {
        case 'action': return e.status === 'active' && (e.state === 'due' || e.state === 'overdue');
        case 'done': return e.status === 'active' && tone === 'ok';
        case 'upcoming': return e.status === 'active' && tone === 'calm';
        case 'norule': return e.status === 'active' && !e.rules;
        case 'proposed': return e.status === 'proposed';
        case 'inactive': return e.status !== 'active' && e.status !== 'proposed';
        default: return e.status === 'active';
      }
    });
    const [k, dir] = sort;
    const val = (e) => ({ title: clean(e.title).toLowerCase(), type: typeOf(e), freq: e.frequency || '', due: e.next_due || e.focus_date || '9999', last: lastPaidOf(e) || '', amount: Number(e.amount) || 0,
      state: { overdue: 0, due: 1, upcoming: 2, done: 3 }[e.state] ?? 4 }[k]);
    return rows.sort((x, y) => (val(x) > val(y) ? 1 : val(x) < val(y) ? -1 : 0) * dir);
  }, [events, filter, group, freq, q, sort]);
  const counts = {
    all: events.filter(e => e.status === 'active').length,
    action: events.filter(e => e.status === 'active' && (e.state === 'due' || e.state === 'overdue')).length,
    done: events.filter(e => e.status === 'active' && stateLine(e)[1] === 'ok').length,
    upcoming: events.filter(e => e.status === 'active' && stateLine(e)[1] === 'calm').length,
    norule: events.filter(e => e.status === 'active' && !e.rules).length,
    proposed: events.filter(e => e.status === 'proposed').length,
    inactive: events.filter(e => e.status !== 'active' && e.status !== 'proposed').length,
  };
  const open = (id) => { setSelected(id); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  if (selected) {
    return (
      <div className="eh-page">
        <button type="button" className="eh-backall" onClick={() => setSelected(null)}>‹ All events</button>
        <EventDetail key={selected} id={selected} cats={cats} events={events} notify={notify} full
          onEdit={(e) => setForm(e)} onChanged={reload} onClose={() => setSelected(null)} />
        {form && <EventForm initial={form.id ? form : null} cats={cats} notify={notify} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); reload(); if (id) setSelected(id); }} />}
      </div>
    );
  }
  const head = (k, l) => (
    <th key={k} scope="col" aria-sort={sort[0] === k ? (sort[1] > 0 ? 'ascending' : 'descending') : 'none'} className={k === 'amount' ? 'num' : ''}>
      <button type="button" onClick={() => setSort(([s, d]) => [k, s === k ? -d : 1])}>{l}{sort[0] === k && <span aria-hidden="true">{sort[1] > 0 ? ' ↑' : ' ↓'}</span>}</button>
    </th>
  );
  return (
    <div className="eh-tablewrap">
      <InboxStrip events={events} onOpen={open} onChanged={reload} notify={notify} version={events} />
      <div className="eh-tfilters">
        <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" aria-label="Search events" />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Type">
          {GROUPS.map(([k, l]) => <option key={k} value={k}>{k === 'all' ? 'All types' : l}</option>)}
        </select>
        <select value={freq} onChange={(e) => setFreq(e.target.value)} aria-label="Frequency">
          <option value="">Any frequency</option>{FREQS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="eh-filters" role="tablist" aria-label="Status">
          {[['all', 'Active'], ['proposed', 'Proposed'], ['action', 'Needs action'], ['upcoming', 'Upcoming'], ['done', 'Paid'], ['norule', 'No SMS rule'], ['inactive', 'Paused / stopped']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? 'on' : ''} ${k === 'action' && counts.action ? 'hot' : ''} ${k === 'proposed' && counts.proposed ? 'prop' : ''}`} onClick={() => setFilter(k)}>{l}<span>{counts[k]}</span></button>
          ))}
        </div>
        <button type="button" className="fo-btn eh-new" onClick={() => setForm({})}>+ New event</button>
      </div>
      {!list.length ? (
        <div className="eh-empty"><b>{events.length ? 'No events match these filters.' : 'No events yet.'}</b><p>{events.length ? 'Clear a filter to see more.' : 'Add your EMIs, subscriptions, SIPs and bills with “New event”.'}</p></div>
      ) : (
        <>
          <p className="eh-thint">{filter === 'proposed'
            ? `${list.length} proposal${list.length === 1 ? '' : 's'} found in your SMS. Open one to check its SMS rule, amount and date, then Activate it, or delete it. Only active events are tracked.`
            : `${list.length} event${list.length === 1 ? '' : 's'}. Double-click a row (or press Enter) to see and edit it.`}</p>
          <div className="eh-tscroll">
            <table className="eh-evtable">
              <thead><tr>{COLS.map(([k, l]) => head(k, l))}<th scope="col">SMS rules</th></tr></thead>
              <tbody>
                {list.map(e => {
                  const k = kindOf(e.kind); const [line, tone] = stateLine(e);
                  return (
                    <tr key={e.id} tabIndex={0} className={focus === e.id ? 'on' : ''} aria-label={`${clean(e.title)}, ${line}`}
                      onClick={() => { setFocus(e.id); if (window.matchMedia?.('(pointer: coarse)').matches) open(e.id); }}
                      onDoubleClick={() => open(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') open(e.id); }}>
                      <td className="t"><span className="eh-ico sm" style={{ '--k': k.c }}><KindIcon kind={e.kind} size={15} /></span><b>{clean(e.title)}</b></td>
                      <td><span className={`eh-type t-${groupOf(e)}`}>{typeOf(e)}</span>{e.link?.ref && <small className="eh-dim"> ••{e.link.ref}</small>}</td>
                      <td className="eh-freq">
                        <span>{FREQ_NAME[e.frequency] || '—'}{e.due_day && e.frequency === 'monthly' ? <small className="eh-dim"> · day {e.due_day}</small> : null}</span>
                        <Track track={e.track} />
                      </td>
                      <td>{dueText(e)}</td>
                      <td>{lastPaidOf(e) ? fmt(lastPaidOf(e)) : <span className="eh-dim">Not seen</span>}</td>
                      <td className="num">{Number(e.amount) ? inr(e.amount) : <span className="eh-dim">varies</span>}</td>
                      <td>{e.status === 'proposed' ? (
                        <span className="eh-propcell"><Pill tone="prop">Proposed</Pill>
                          <button type="button" className="fo-btn sm" disabled={activating === e.id} onClick={(ev) => { ev.stopPropagation(); activate(e); }}
                            onDoubleClick={(ev) => ev.stopPropagation()}>{activating === e.id ? 'Activating…' : 'Activate'}</button></span>
                      ) : <Pill tone={tone}>{line}</Pill>}</td>
                      <td>{e.rules ? <span className="eh-tag">{e.rules}</span> : <span className="eh-tag warn">None</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {form && <EventForm initial={form.id ? form : null} cats={cats} notify={notify} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); reload(); if (id) open(id); }} />}
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
  const list = rules.filter(r => (filter === 'all' || (filter === 'event' ? !!r.event_id : filter === 'ignore' ? !!r.is_ignored : !r.event_id && !r.is_ignored))
    && (!q || [r.merchant_pattern, r.label, r.sender_key, catName(r.category_id), r.event?.title].some(x => x && clean(x).toLowerCase().includes(q.toLowerCase()))));
  const n = { all: rules.length, event: rules.filter(r => r.event_id).length, cat: rules.filter(r => !r.event_id && !r.is_ignored).length, ignore: rules.filter(r => r.is_ignored).length };
  return (
    <div className="eh-rulestab">
      <div className="eh-tools">
        <input className="eh-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words, sender, category, event" aria-label="Search rules" />
        <button type="button" className="fo-btn" onClick={() => setEdit({})}>+ New rule</button>
      </div>
      <div className="eh-filters" role="tablist" aria-label="Filter rules">
        {[['all', 'All rules'], ['event', 'Settle an event'], ['cat', 'Category only'], ['ignore', 'Ignore']].filter(([k]) => k !== 'ignore' || n.ignore).map(([k, l]) => (
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
                <CatChip id={r.category_id} cats={cats} ignored={r.is_ignored} />
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
            {g.event?.status === 'proposed' && <p className="eh-grp-prop"><span className="eh-type t-prop">Proposed event</span> {clean(g.event.title)} is waiting in Events. “Save rule” drops it (just a category); “Make it an event” activates it.</p>}
            <div className="eh-grp-more">
              <button type="button" className="fo-btn sm ghost" disabled={busy} onClick={() => onEvent(g)}>{g.event?.status === 'proposed' ? 'Make it an event (activate)…' : 'Make it an event…'}</button>
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
  const [tab, setTab] = useState(() => { try { if (new URLSearchParams(window.location.search).get('event')) return 'events'; return sessionStorage.getItem('eh-tab') || 'events'; } catch { return 'events'; } });
  const [events, setEvents] = useState(null);
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(() => { try { return new URLSearchParams(window.location.search).get('event'); } catch { return null; } });
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
          <h1>Events &amp; subscriptions</h1>
          <p>Every EMI, card bill, subscription, SIP and premium, with the master it belongs to and the SMS rules that mark it paid.</p>
        </div>
        {events && (
          <div className="eh-stats" aria-label="Summary">
            <span><b>{events.filter(e => e.status === 'active').length}</b> active</span>
            {events.some(e => e.status === 'proposed') && <span className="prop"><b>{events.filter(e => e.status === 'proposed').length}</b> proposed</span>}
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
