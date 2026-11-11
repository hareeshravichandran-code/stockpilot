import { useState, useEffect, useCallback } from 'react';
import { householdAPI } from '../lib/api';
import LogoLoader from '../components/LogoLoader';
import {
  Modal, Field, Empty, Avatar, MemberPicker, Seg, DOC_KINDS, docKind, REPEATS, inr, fmtDate, daysUntil, whenLabel,
  urgency, shortName, errMsg, parseDate, ymd,
} from './shared';

const STEP = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
function nextDue(date, repeat) {
  const d = parseDate(date), m = STEP[repeat];
  const x = new Date(d.getFullYear(), d.getMonth() + m, 1);
  x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return ymd(x);
}

function DocForm({ doc, members, onClose, onSaved, notify }) {
  const me = members.find(m => m.is_me);
  const [d, setD] = useState({
    kind: doc?.kind || 'passport', title: doc?.title || '', member_id: doc ? doc.member_id : me?.id || null,
    due_date: doc?.due_date || '', issued_on: doc?.issued_on || '', repeat: doc?.repeat || 'none', amount: doc?.amount ?? '',
    remind_days: doc?.remind_days ?? 30, ref_last4: doc?.ref_last4 || '', kept_at: doc?.kept_at || '', notes: doc?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const kindType = docKind(d.kind)[2];
  const autoTitle = () => {
    const m = members.find(x => x.id === d.member_id);
    const base = docKind(d.kind)[1];
    return m && !m.is_me ? `${m.name}’s ${base.toLowerCase()}` : base;
  };
  const pickKind = (k) => setD(x => ({ ...x, kind: k, repeat: docKind(k)[2] === 'payment' ? (x.repeat === 'none' ? (k === 'subscription' ? 'monthly' : 'yearly') : x.repeat) : 'none', remind_days: docKind(k)[2] === 'payment' ? 10 : (k === 'passport' ? 180 : 30) }));
  const save = async () => {
    setBusy(true); setErr('');
    const body = { ...d, title: d.title.trim() || autoTitle(), amount: d.amount === '' ? null : +d.amount, remind_days: +d.remind_days || 0 };
    for (const k of ['due_date', 'issued_on']) body[k] = body[k] || null;
    try {
      if (doc) await householdAPI.documents.update(doc.id, body); else await householdAPI.documents.create(body);
      notify(doc ? 'Saved' : `${body.title} added`); await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${doc.title}?`)) return;
    setBusy(true);
    try { await householdAPI.documents.remove(doc.id); notify('Deleted'); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={doc ? `Edit ${doc.title}` : 'Add a document or renewal'} onClose={onClose} wide
      footer={<>
        {doc && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={remove}>Delete</button>}
        <span className="fo-grow" />
        <button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="fo-btn" disabled={busy} onClick={save}>{doc ? 'Save' : 'Add'}</button>
      </>}>
      <div className="fo-form two">
        <Field label="What is it" wide>
          <div className="fo-chips">{DOC_KINDS.map(([v, l]) => <button key={v} type="button" className={d.kind === v ? 'on' : ''} aria-pressed={d.kind === v} onClick={() => pickKind(v)}>{l}</button>)}</div>
        </Field>
        <Field label="Whose" wide><MemberPicker members={members} value={d.member_id} onChange={set('member_id')} multi={false} allowNone /></Field>
        <Field label="Name"><input className="fo-in" value={d.title} onChange={set('title')} placeholder={autoTitle()} maxLength={100} /></Field>
        <Field label={kindType === 'payment' ? 'Next due date' : kindType === 'id' ? 'Expiry date, if any' : 'Expiry date'}>
          <input className="fo-in" type="date" value={d.due_date} onChange={set('due_date')} />
        </Field>
        {kindType === 'payment' && <>
          <Field label="Amount"><input className="fo-in" type="number" min={0} step={100} value={d.amount} onChange={set('amount')} placeholder="₹" /></Field>
          <Field label="Repeats"><Seg value={d.repeat} onChange={set('repeat')} options={REPEATS} label="Repeats" /></Field>
        </>}
        <Field label="Remind me" hint="Shows under Needs attention from this many days before">
          <div className="fo-row"><input className="fo-in" type="number" min={0} max={365} value={d.remind_days} onChange={set('remind_days')} /><span className="fo-unit">days before</span></div>
        </Field>
        {kindType !== 'payment' && <Field label="Number, last 4" hint="Only the last 4 characters are kept"><input className="fo-in" value={d.ref_last4} onChange={set('ref_last4')} maxLength={30} /></Field>}
        <Field label="Original kept at"><input className="fo-in" value={d.kept_at} onChange={set('kept_at')} placeholder="e.g. Bank locker, blue file" maxLength={120} /></Field>
        <Field label="Notes" wide><textarea className="fo-in" rows={2} value={d.notes} onChange={set('notes')} maxLength={1000} /></Field>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

export default function Documents({ members, notify }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(null);
  const [who, setWho] = useState('all');
  const load = useCallback(async () => {
    try { const r = await householdAPI.documents.list(); setItems(r.data.items); } catch (e) { setItems([]); notify(errMsg(e), 'error'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const markPaid = async (doc) => {
    try {
      const body = doc.repeat && doc.repeat !== 'none' ? { due_date: nextDue(doc.due_date, doc.repeat) } : { done: true };
      await householdAPI.documents.update(doc.id, body);
      notify(body.due_date ? `Paid. Next due ${fmtDate(body.due_date, { day: 'numeric', month: 'short' })}` : 'Marked done');
      load();
    } catch (e) { notify(errMsg(e), 'error'); }
  };

  if (items === null) return <LogoLoader label="Loading documents…" />;
  const list = items.filter(x => who === 'all' || x.member_id === who);
  const groups = [
    ['over', 'Overdue or expired', list.filter(x => !x.done && x.due_date && daysUntil(x.due_date) < 0)],
    ['soon', 'Next 60 days', list.filter(x => !x.done && x.due_date && daysUntil(x.due_date) >= 0 && daysUntil(x.due_date) <= 60)],
    ['later', 'Later', list.filter(x => !x.done && x.due_date && daysUntil(x.due_date) > 60)],
    ['none', 'No expiry date', list.filter(x => !x.done && !x.due_date)],
    ['done', 'Done', list.filter(x => x.done)],
  ].filter(g => g[2].length);
  groups.forEach(g => g[2].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')));

  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div>
          <h1>Documents and renewals</h1>
          <p>Passports, licences, vehicle papers and the fees and taxes that come back every year. Kanalyst reminds you before anything expires.</p>
        </div>
        <button type="button" className="fo-btn" onClick={() => setForm('new')}>Add</button>
      </div>
      {items.length === 0 ? (
        <Empty title="Nothing here yet" action={<button type="button" className="fo-btn" onClick={() => setForm('new')}>Add a document</button>}>
          Start with passports, driving licences and your car’s RC and PUC. Add school fees and property tax with their due dates.
        </Empty>
      ) : (
        <>
          <div className="fo-filter">
            <button type="button" className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone</button>
            {members.map(m => <button key={m.id} type="button" className={who === m.id ? 'on' : ''} onClick={() => setWho(m.id)}><Avatar m={m} size={20} /> {shortName(m)}</button>)}
          </div>
          {groups.map(([k, title, rows]) => (
            <section key={k} className={`fo-docs ${k}`}>
              <h2>{title} <span>{rows.length}</span></h2>
              <ul>
                {rows.map(x => {
                  const m = members.find(mm => mm.id === x.member_id);
                  const days = x.due_date ? daysUntil(x.due_date) : null;
                  const type = docKind(x.kind)[2];
                  const span = Math.max(30, x.remind_days || 30) * 3;
                  return (
                    <li key={x.id}>
                      <button type="button" className="fo-doc" onClick={() => x.mine ? setForm(x) : notify(`Added by ${x.added_by}. Only they can edit it.`)}>
                        {m ? <Avatar m={m} size={34} /> : <span className="fo-doc-noone" aria-hidden="true">▤</span>}
                        <span className="fo-doc-main">
                          <span className="fo-doc-title">{x.title}</span>
                          <span className="fo-doc-sub">{[docKind(x.kind)[1] !== x.title && docKind(x.kind)[1], x.ref_last4 && `ending ${x.ref_last4}`, x.kept_at && `kept in ${x.kept_at}`, x.amount && inr(x.amount), x.repeat !== 'none' && REPEATS.find(r => r[0] === x.repeat)?.[1].toLowerCase()].filter(Boolean).join(', ')}</span>
                        </span>
                        {days !== null && !x.done && (
                          <span className={`fo-doc-when ${urgency(days)}`}>
                            <b>{whenLabel(days)}</b>
                            <span>{fmtDate(x.due_date)}</span>
                            <i><em style={{ width: `${Math.max(3, Math.min(100, 100 - (days / span) * 100))}%` }} /></i>
                          </span>
                        )}
                      </button>
                      {type === 'payment' && !x.done && x.mine && x.due_date && <button type="button" className="fo-btn sm ghost" onClick={() => markPaid(x)}>Mark paid</button>}
                      {type !== 'payment' && days !== null && days < 0 && !x.done && x.mine && <button type="button" className="fo-btn sm ghost" onClick={() => setForm(x)}>Renewed</button>}
                      {!((type === 'payment' && !x.done && x.mine && x.due_date) || (type !== 'payment' && days !== null && days < 0 && !x.done && x.mine)) && <span className="fo-doc-act" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
      {form && <DocForm doc={form === 'new' ? null : form} members={members} onClose={() => setForm(null)} onSaved={load} notify={notify} />}
    </div>
  );
}
