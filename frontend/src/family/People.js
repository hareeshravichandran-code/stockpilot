import { useState, useEffect, useCallback } from 'react';
import { householdAPI } from '../lib/api';
import {
  Avatar, Modal, Field, Empty, MEMBER_COLORS, colorVar, inkOn, RELATIONS, relLabel, shortName,
  ageFrom, nextBirthday, fmtDate, fmtDay, whenLabel, inr, policyKind, docKind, errMsg, todayStr,
} from './shared';

export function PersonForm({ person, onClose, onSaved, notify }) {
  const isSelf = person?.relation === 'self';
  const [d, setD] = useState({
    name: person?.name || '', relation: person?.relation || 'child', dob: person?.dob || '',
    color: person?.color || MEMBER_COLORS[2], notes: person?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target ? e.target.value : e }));
  const save = async () => {
    if (!d.name.trim()) { setErr('Add a name'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...d, dob: d.dob || null };
      if (person) await householdAPI.members.update(person.id, body); else await householdAPI.members.create(body);
      notify(person ? `${d.name} updated` : `${d.name} added to your family`);
      await onSaved();
      onClose();
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${person.name}? Their policies and documents stay, without a person attached.`)) return;
    setBusy(true);
    try { await householdAPI.members.remove(person.id); notify(`${person.name} removed`); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={person ? `Edit ${person.is_me ? 'your details' : person.name}` : 'Add a person'} onClose={onClose}
      footer={<>
        {person && !isSelf && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={remove}>Remove</button>}
        <span className="fo-grow" />
        <button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="fo-btn" disabled={busy} onClick={save}>{person ? 'Save' : 'Add person'}</button>
      </>}>
      <div className="fo-form">
        <div className="fo-preview"><Avatar m={{ name: d.name || '?', color: d.color }} size={64} /></div>
        <Field label="Name" wide><input className="fo-in" value={d.name} onChange={set('name')} maxLength={60} placeholder="e.g. Diya" /></Field>
        {!isSelf && (
          <Field label="Relation to you" wide>
            <div className="fo-chips">{RELATIONS.map(([v, l]) => <button key={v} type="button" className={d.relation === v ? 'on' : ''} aria-pressed={d.relation === v} onClick={() => set('relation')(v)}>{l}</button>)}</div>
          </Field>
        )}
        <Field label="Date of birth" hint="For birthdays on the calendar and age-based plans"><input className="fo-in" type="date" value={d.dob || ''} max={todayStr()} onChange={set('dob')} /></Field>
        <Field label="Colour">
          <div className="fo-swatches">{MEMBER_COLORS.map(c => <button key={c} type="button" className={d.color === c ? 'on' : ''} style={{ background: colorVar(c) }} aria-label={c} aria-pressed={d.color === c} onClick={() => set('color')(c)} />)}</div>
        </Field>
        <Field label="Notes" wide><textarea className="fo-in" rows={2} value={d.notes} onChange={set('notes')} maxLength={500} placeholder="School, blood group, doctor's number…" /></Field>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function PersonDetail({ m, data, onEdit, onClose }) {
  const pol = data.policies.filter(p => (p.member_ids || []).includes(m.id) && p.status === 'active');
  const docs = data.documents.filter(x => x.member_id === m.id);
  const dates = data.calendar.filter(c => (c.member_ids || []).includes(m.id)).slice(0, 8);
  const life = pol.filter(p => ['term', 'life'].includes(p.kind)).reduce((s, p) => s + (+p.sum_assured || 0), 0);
  const health = pol.filter(p => p.kind === 'health').reduce((s, p) => s + (+p.sum_assured || 0), 0);
  const age = ageFrom(m.dob), nb = nextBirthday(m.dob);
  return (
    <Modal title={m.is_me ? 'You' : m.name} onClose={onClose} wide
      footer={<><span className="fo-grow" />{m.mine && <button type="button" className="fo-btn ghost" onClick={onEdit}>Edit details</button>}<button type="button" className="fo-btn" onClick={onClose}>Done</button></>}>
      <div className="fo-pd-head" style={{ '--c': colorVar(m.color) }}>
        <Avatar m={m} size={72} />
        <div>
          <div className="fo-pd-rel">{relLabel(m)}{age !== null ? `, ${age}` : ''}</div>
          {nb && <div className="fo-pd-bday">Birthday {fmtDay(nb.date)}, {whenLabel(nb.days).toLowerCase()}</div>}
          {m.added_by && <div className="fo-hint">Added by {m.added_by}</div>}
        </div>
        <div className="fo-pd-cover">
          <span><b>{life ? inr(life) : '—'}</b>Life cover</span>
          <span><b>{health ? inr(health) : '—'}</b>Health cover</span>
        </div>
      </div>
      {m.notes && <p className="fo-pd-notes">{m.notes}</p>}
      <div className="fo-pd-grid">
        <section>
          <h3>Insurance</h3>
          {pol.length ? <ul className="fo-mini">{pol.map(p => <li key={p.id}><span className="fo-dot" style={{ background: 'var(--fo-prussian)' }} />{p.plan_name || p.insurer || policyKind(p.kind)[1]}<b>{p.sum_assured ? inr(p.sum_assured) : ''}</b></li>)}</ul> : <p className="fo-hint">No policies cover {m.is_me ? 'you' : m.name} yet.</p>}
        </section>
        <section>
          <h3>Documents</h3>
          {docs.length ? <ul className="fo-mini">{docs.map(x => <li key={x.id}><span className="fo-dot" style={{ background: 'var(--fo-mulberry)' }} />{x.title}<b>{x.due_date ? fmtDate(x.due_date, { month: 'short', year: 'numeric' }) : docKind(x.kind)[1]}</b></li>)}</ul> : <p className="fo-hint">No documents yet.</p>}
        </section>
        <section>
          <h3>Coming up</h3>
          {dates.length ? <ul className="fo-mini">{dates.map(c => <li key={c.id}><span className="fo-dot" style={{ background: `var(--fo-${{ money: 'moss', goals: 'aubergine', loans: 'terracotta', insurance: 'prussian', documents: 'mulberry', family: 'marigold' }[c.module]})` }} />{c.title}<b>{fmtDay(c.date)}</b></li>)}</ul> : <p className="fo-hint">Nothing in the next 90 days.</p>}
        </section>
      </div>
    </Modal>
  );
}

export default function People({ members, reloadMembers, notify }) {
  const [form, setForm] = useState(null);       // null | 'new' | member
  const [open, setOpen] = useState(null);       // member id
  const [data, setData] = useState({ policies: [], documents: [], calendar: [] });

  const load = useCallback(async () => {
    const t = todayStr(); const end = new Date(); end.setDate(end.getDate() + 90);
    const [p, d, c] = await Promise.allSettled([householdAPI.policies.list(), householdAPI.documents.list(), householdAPI.calendar(t, end.toISOString().slice(0, 10))]);
    setData({
      policies: p.status === 'fulfilled' ? p.value.data.items : [],
      documents: d.status === 'fulfilled' ? d.value.data.items : [],
      calendar: c.status === 'fulfilled' ? c.value.data.items : [],
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const openM = members.find(m => m.id === open);
  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div>
          <h1>People</h1>
          <p>Everyone in your home, including children and parents who don’t use Kanalyst. Partners with their own account appear here once you share a family.</p>
        </div>
        <button type="button" className="fo-btn" onClick={() => setForm('new')}>Add a person</button>
      </div>
      {members.length <= 1 && (
        <Empty title="Add the rest of your family">Add your spouse, children and parents so policies, documents and birthdays can be tied to each person.</Empty>
      )}
      <div className="fo-people">
        {members.map(m => {
          const age = ageFrom(m.dob), nb = nextBirthday(m.dob);
          const pol = data.policies.filter(p => (p.member_ids || []).includes(m.id) && p.status === 'active');
          const docs = data.documents.filter(x => x.member_id === m.id);
          const next = data.calendar.find(c => (c.member_ids || []).includes(m.id));
          return (
            <button key={m.id} type="button" className="fo-person" style={{ '--c': colorVar(m.color), '--on': inkOn(m.color) }} onClick={() => setOpen(m.id)}>
              <span className="fo-person-band"><Avatar m={m} size={58} ring /></span>
              <span className="fo-person-name">{m.name}</span>
              <span className="fo-person-rel">{relLabel(m)}{age !== null ? `, ${age}` : ''}</span>
              <span className="fo-person-stats">
                <span><b>{pol.length}</b> {pol.length === 1 ? 'policy' : 'policies'}</span>
                <span><b>{docs.length}</b> {docs.length === 1 ? 'document' : 'documents'}</span>
              </span>
              <span className="fo-person-next">
                {next ? <>{next.title}, {fmtDay(next.date)}</> : nb ? <>Birthday in {nb.days} days</> : 'Add a birthday'}
              </span>
            </button>
          );
        })}
        <button type="button" className="fo-person add" onClick={() => setForm('new')}><span className="fo-plus" aria-hidden="true">+</span><span className="fo-person-name">Add a person</span></button>
      </div>
      {openM && <PersonDetail m={openM} data={data} onClose={() => setOpen(null)} onEdit={() => { setOpen(null); setForm(openM); }} />}
      {form && <PersonForm person={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={async () => { await reloadMembers(); await load(); }} notify={notify} />}
    </div>
  );
}
