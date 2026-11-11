import { useState, useEffect, useCallback } from 'react';
import { mastersAPI } from '../lib/api';
import { errMsg, fmtDate } from './shared';
import { inrShort } from '../money/kinds';

// Payments that repeat in the user's bank SMS but belong to nothing yet. The user says what each one is:
// a subscription (a master, its past debits become its actuals), an event (a calendar date), later (stays
// here and keeps counting new SMS) or ignore.
const FREQ = { monthly: 'Every month', quarterly: 'Every 3 months', half_yearly: 'Every 6 months', yearly: 'Every year' };
const short = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function Row({ c, i, onDone, notify }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(null);           // 'subscription' | 'event'
  const [name, setName] = useState(clean(c.payee) || 'Payment');
  const [cal, setCal] = useState(true);             // a subscription also gets its date on the calendar
  const [busy, setBusy] = useState(false);
  const review = async (status, extra = {}) => {
    setBusy(true);
    try { await mastersAPI.review({ fp: c.fp, status, ...extra }); onDone(); }
    catch (e) { notify(errMsg(e)); setBusy(false); }
  };
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const base = { title: name.trim(), amount: c.amount, frequency: c.frequency, due_day: c.due_day, due_month: c.frequency === 'monthly' ? null : c.due_month };
      let target_id = null;
      if (adding === 'subscription') {
        const r = await mastersAPI.create({ kind: 'subscription', ...base, category_id: c.category_id, event: cal, match: { keywords: [clean(c.payee).toLowerCase()].filter(k => k.length >= 3) } });
        target_id = r.data?.master?.id || null;
      } else {
        const r = await mastersAPI.createEvent({ kind: 'bill', ...base, direction: 'out' });
        target_id = r.data?.event?.id || null;
      }
      await mastersAPI.review({ fp: c.fp, status: 'added', target_kind: adding, target_id, txn_ids: c.txn_ids });
      notify(adding === 'subscription' ? `${name.trim()} added to subscriptions${cal ? ' and the calendar' : ''}` : `${name.trim()} added to events`);
      onDone();
    } catch (e) { notify(errMsg(e)); setBusy(false); }
  };
  return (
    <li className={`rc-row${c.status === 'later' ? ' later' : ''}`} style={{ '--i': i }}>
      <div className="rc-main" onClick={() => setOpen(o => !o)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(o => !o)} aria-expanded={open}>
        <span className="rc-av">{(clean(c.payee)[0] || '•').toUpperCase()}</span>
        <span className="rc-who">
          <b>{clean(c.payee) || 'Unknown payee'}</b>
          <small>{c.sender ? <span className="rc-from">{c.sender}</span> : null}{[c.account ? ` ••${String(c.account).slice(-4)}` : '', `seen ${c.count}× since ${short(c.first_date)}`].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="rc-amt"><b>{inrShort(c.amount)}</b><small>{FREQ[c.frequency]}</small></span>
        <span className="rc-when"><small>Last</small><b>{short(c.last_date)}</b></span>
        <span className="rc-when"><small>Next about</small><b>{short(c.next_date)}</b></span>
        {c.status === 'later'
          ? <span className={`rc-tag later${c.new_since_review ? ' fresh' : ''}`}>{c.new_since_review ? `${c.new_since_review} new SMS` : 'Later'}</span>
          : <span className={`rc-tag ${c.suggest}`}>{c.suggest === 'subscription' ? 'Looks like a subscription' : 'Looks like a bill / event'}</span>}
        <span className={`rc-chev${open ? ' on' : ''}`} aria-hidden="true">›</span>
      </div>
      {open && (
        <div className="rc-more">
          <div className="rc-msg">
            <small>Latest message{c.sender ? ` from ${c.sender}` : ''} · {fmtDate(c.last_date)}</small>
            <p>{clean(c.body) || 'The message text was not kept for this payment.'}</p>
          </div>
          <div className="rc-hist">{c.history.map((h, k) => <span key={k}><small>{short(h.date)}</small>{inrShort(h.amount)}</span>)}</div>
        </div>
      )}
      {adding ? (
        <div className="rc-add">
          <label><small>Name it</small><input className="fo-in" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></label>
          <span className="rc-add-sum">{adding === 'subscription' ? 'Subscription' : 'Event'} · {inrShort(c.amount)} · {FREQ[c.frequency]?.toLowerCase()} on the {c.due_day}</span>
          {adding === 'subscription' && (
            <label className="rc-both"><input type="checkbox" checked={cal} onChange={(e) => setCal(e.target.checked)} />
              <span><b>Also an event</b><small>Date on the calendar with reminders</small></span></label>
          )}
          <span className="fo-grow" />
          <button type="button" className="fo-btn ghost" disabled={busy} onClick={() => setAdding(null)}>Cancel</button>
          <button type="button" className="fo-btn" disabled={busy || !name.trim()} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      ) : (
        <div className="rc-acts">
          <button type="button" className={`rc-b${c.suggest === 'subscription' ? ' pri' : ''}`} disabled={busy} onClick={() => setAdding('subscription')}>Subscription + event</button>
          <button type="button" className={`rc-b${c.suggest === 'event' ? ' pri' : ''}`} disabled={busy} onClick={() => setAdding('event')}>Event only</button>
          <span className="fo-grow" />
          {c.status !== 'later' && <button type="button" className="rc-b ghost" disabled={busy} onClick={() => review('later')}>Later</button>}
          <button type="button" className="rc-b ghost" disabled={busy} onClick={() => review('ignored')}>Ignore</button>
        </div>
      )}
    </li>
  );
}

/** "Found in your SMS" review list. prefer: which kind to list first. */
export default function Recurring({ notify, prefer = 'subscription', onChanged }) {
  const [list, setList] = useState(null);
  const [tab, setTab] = useState('pending');
  const [ignored, setIgnored] = useState(0);
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    try { const r = await mastersAPI.candidates(); setList(r.data.candidates || []); setIgnored(r.data.ignored || 0); }
    catch { setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!list || !list.length) return null;
  const pending = list.filter(c => c.status === 'pending');
  const later = list.filter(c => c.status === 'later');
  const shown = (tab === 'pending' ? pending : later).slice().sort((a, b) => (a.suggest === prefer ? 0 : 1) - (b.suggest === prefer ? 0 : 1));
  const done = () => { load(); onChanged && onChanged(); };
  return (
    <section className="rc">
      <div className="rc-head">
        <div>
          <h2><span className="rc-dot" />Found in your SMS</h2>
          <p>These payments repeat in your bank messages but are not tracked yet. Tell us what each one is.</p>
        </div>
        <div className="k-seg rc-seg">
          <button type="button" className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>To review {pending.length}</button>
          <button type="button" className={tab === 'later' ? 'on' : ''} onClick={() => setTab('later')}>Later {later.length}</button>
        </div>
      </div>
      {shown.length
        ? <ul className="rc-list">{(all ? shown : shown.slice(0, 4)).map((c, i) => <Row key={c.fp} c={c} i={i} notify={notify} onDone={done} />)}</ul>
        : <p className="rc-empty">{tab === 'pending' ? 'All reviewed.' : 'Nothing put off for later.'}</p>}
      {shown.length > 4 && <button type="button" className="rc-more-btn" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${shown.length}`}</button>}
      {ignored > 0 && <p className="rc-foot">{ignored} ignored</p>}
    </section>
  );
}
