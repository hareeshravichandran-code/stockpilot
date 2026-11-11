import { useState, useEffect, useCallback, useMemo } from 'react';
import { householdAPI } from '../lib/api';
import LogoLoader from '../components/LogoLoader';
import {
  Modal, Field, Empty, Faces, Avatar, MemberPicker, Seg, POLICY_KINDS, policyKind, FREQS, inr, inrFull,
  fmtDate, daysUntil, whenLabel, urgency, shortName, errMsg,
} from './shared';

const KIND_COLOR = { health: 'var(--fo-teal)', term: 'var(--fo-prussian)', life: 'var(--fo-aubergine)', vehicle: 'var(--fo-terracotta)', home: 'var(--fo-moss)', accident: 'var(--fo-mulberry)', travel: 'var(--fo-marigold)', other: 'var(--fo-ink-3)' };
// Lighter tints for the donut, which sits on the dark blue block
const DONUT_COLOR = { health: '#7fc4c4', term: '#EFE9DC', life: '#cfadea', vehicle: '#f2a46f', home: '#bcd67f', accident: '#eaa3c0', travel: '#D9541E', other: '#B5B0A6' };
const perYear = (p) => (+p.premium || 0) * (FREQS.find(f => f[0] === p.premium_frequency)?.[2] ?? 1);

function PolicyForm({ policy, members, onClose, onSaved, notify }) {
  const me = members.find(m => m.is_me);
  const [d, setD] = useState({
    kind: policy?.kind || 'health', insurer: policy?.insurer || '', plan_name: policy?.plan_name || '',
    member_ids: policy?.member_ids || (me ? [me.id] : []), sum_assured: policy?.sum_assured ?? '', premium: policy?.premium ?? '',
    premium_frequency: policy?.premium_frequency || 'yearly', renewal_date: policy?.renewal_date || '', end_date: policy?.end_date || '',
    start_date: policy?.start_date || '', nominee: policy?.nominee || '', policy_ref: policy?.policy_ref || '', notes: policy?.notes || '',
    status: policy?.status || 'active',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const save = async () => {
    if (!d.member_ids.length) { setErr('Choose who this policy covers'); return; }
    setBusy(true); setErr('');
    const body = { ...d };
    for (const k of ['sum_assured', 'premium']) body[k] = body[k] === '' ? null : +body[k];
    for (const k of ['renewal_date', 'end_date', 'start_date']) body[k] = body[k] || null;
    try {
      if (policy) await householdAPI.policies.update(policy.id, body); else await householdAPI.policies.create(body);
      notify(policy ? 'Policy saved' : 'Policy added'); await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this policy?')) return;
    setBusy(true);
    try { await householdAPI.policies.remove(policy.id); notify('Policy deleted'); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={policy ? 'Edit policy' : 'Add a policy'} onClose={onClose} wide
      footer={<>
        {policy && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={remove}>Delete</button>}
        <span className="fo-grow" />
        <button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="fo-btn" disabled={busy} onClick={save}>{policy ? 'Save' : 'Add policy'}</button>
      </>}>
      <div className="fo-form two">
        <Field label="Type" wide>
          <div className="fo-chips">{POLICY_KINDS.map(([v, l, i]) => <button key={v} type="button" className={d.kind === v ? 'on' : ''} aria-pressed={d.kind === v} onClick={() => set('kind')(v)}><span aria-hidden="true">{i}</span> {l}</button>)}</div>
        </Field>
        <Field label="Who is covered" wide><MemberPicker members={members} value={d.member_ids} onChange={set('member_ids')} /></Field>
        <Field label="Insurer"><input className="fo-in" value={d.insurer} onChange={set('insurer')} placeholder="e.g. Star Health, LIC, HDFC Life" maxLength={80} /></Field>
        <Field label="Plan name"><input className="fo-in" value={d.plan_name} onChange={set('plan_name')} placeholder="e.g. Family Health Optima" maxLength={120} /></Field>
        <Field label={d.kind === 'vehicle' ? 'Insured value (IDV)' : 'Sum assured'}><input className="fo-in" type="number" min={0} step={10000} value={d.sum_assured} onChange={set('sum_assured')} placeholder="₹" /></Field>
        <Field label="Premium" hint={d.premium ? `${inrFull(perYear(d))} a year` : null}>
          <div className="fo-row"><input className="fo-in" type="number" min={0} step={100} value={d.premium} onChange={set('premium')} placeholder="₹" />
            <select className="fo-in" value={d.premium_frequency} onChange={set('premium_frequency')} aria-label="How often">{FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </Field>
        <Field label="Next premium or renewal" hint="Shows on the calendar and reminds you"><input className="fo-in" type="date" value={d.renewal_date} onChange={set('renewal_date')} /></Field>
        <Field label="Cover ends or matures"><input className="fo-in" type="date" value={d.end_date} onChange={set('end_date')} /></Field>
        <Field label="Nominee"><input className="fo-in" value={d.nominee} onChange={set('nominee')} maxLength={80} /></Field>
        <Field label="Policy number, last 4" hint="Only the last 4 characters are kept"><input className="fo-in" value={d.policy_ref} onChange={set('policy_ref')} maxLength={30} placeholder="e.g. 4821" /></Field>
        <Field label="Status"><Seg value={d.status} onChange={set('status')} options={[['active', 'Active'], ['lapsed', 'Lapsed'], ['ended', 'Ended']]} label="Status" /></Field>
        <Field label="Notes" wide><textarea className="fo-in" rows={2} value={d.notes} onChange={set('notes')} maxLength={1000} placeholder="Agent's number, riders, claim process…" /></Field>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function Donut({ parts }) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" className="fo-donut" aria-hidden="true">
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--fo-line)" strokeWidth="6" />
      {parts.map(p => { const len = (p.v / total) * 100; const el = <circle key={p.k} cx="21" cy="21" r="15.9" fill="none" stroke={p.c} strokeWidth="6" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={25 - acc} />; acc += len; return el; })}
    </svg>
  );
}

export default function Insurance({ members, notify }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(null);
  const [who, setWho] = useState('all');
  const load = useCallback(async () => {
    try { const r = await householdAPI.policies.list(); setItems(r.data.items); } catch (e) { setItems([]); notify(errMsg(e), 'error'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => (items || []).filter(p => p.status === 'active'), [items]);
  const shown = (items || []).filter(p => who === 'all' || (p.member_ids || []).includes(who))
    .sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || (a.renewal_date || '9999').localeCompare(b.renewal_date || '9999'));
  const yearly = active.reduce((s, p) => s + perYear(p), 0);
  const byKind = POLICY_KINDS.map(([k]) => ({ k, v: active.filter(p => p.kind === k).reduce((s, p) => s + perYear(p), 0), c: DONUT_COLOR[k] })).filter(x => x.v > 0);
  const cover = members.map(m => {
    const mine = active.filter(p => (p.member_ids || []).includes(m.id));
    return { m, life: mine.filter(p => ['term', 'life'].includes(p.kind)).reduce((s, p) => s + (+p.sum_assured || 0), 0), health: mine.filter(p => p.kind === 'health').reduce((s, p) => s + (+p.sum_assured || 0), 0) };
  });
  const maxLife = Math.max(1, ...cover.map(c => c.life)), maxHealth = Math.max(1, ...cover.map(c => c.health));

  if (items === null) return <LogoLoader label="Loading policies…" />;
  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div>
          <h1>Insurance</h1>
          <p>Every policy in the family: who it covers, for how much, and when the next premium is due.</p>
        </div>
        <button type="button" className="fo-btn" onClick={() => setForm('new')}>Add a policy</button>
      </div>

      {active.length > 0 && (
        <div className="fo-ins-top">
          <div className="fo-block prussian">
            <div className="fo-block-k">Premiums a year</div>
            <div className="fo-block-v">{inr(yearly)}</div>
            <div className="fo-ins-donut">
              <Donut parts={byKind} />
              <ul>{byKind.map(p => <li key={p.k}><i style={{ background: p.c }} />{policyKind(p.k)[1]} <b>{inr(p.v)}</b></li>)}</ul>
            </div>
          </div>
          <div className="fo-block paper">
            <div className="fo-block-k">Cover by person</div>
            <div className="fo-cover">
              {cover.map(({ m, life, health }) => (
                <div key={m.id} className="fo-cover-row">
                  <Avatar m={m} size={30} />
                  <span className="fo-cover-name">{shortName(m)}</span>
                  <span className="fo-cover-bars">
                    <span className="bar life" style={{ width: `${(life / maxLife) * 100}%` }} title={`Life ${inrFull(life)}`} />
                    <span className="bar health" style={{ width: `${(health / maxHealth) * 100}%` }} title={`Health ${inrFull(health)}`} />
                  </span>
                  <span className="fo-cover-v"><b>{life ? inr(life) : 'No life'}</b><b className="h">{health ? inr(health) : 'No health'}</b></span>
                </div>
              ))}
              <div className="fo-cover-key"><span><i className="life" />Life and term</span><span><i className="health" />Health</span></div>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <Empty title="No policies yet" action={<button type="button" className="fo-btn" onClick={() => setForm('new')}>Add your first policy</button>}>
          Start with health insurance and term cover. Add the family floater once and tick everyone it covers.
        </Empty>
      ) : (
        <>
          <div className="fo-filter">
            <button type="button" className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone</button>
            {members.map(m => <button key={m.id} type="button" className={who === m.id ? 'on' : ''} onClick={() => setWho(m.id)}><Avatar m={m} size={20} /> {shortName(m)}</button>)}
          </div>
          <div className="fo-policies">
            {shown.map(p => {
              const [, label, icon] = policyKind(p.kind);
              const days = p.renewal_date ? daysUntil(p.renewal_date) : null;
              return (
                <button key={p.id} type="button" className={`fo-policy ${p.status !== 'active' ? 'off' : ''}`} style={{ '--c': KIND_COLOR[p.kind] }} onClick={() => p.mine ? setForm(p) : notify(`Added by ${p.added_by}. Only they can edit it.`)}>
                  <span className="fo-policy-icon" aria-hidden="true">{icon}</span>
                  <span className="fo-policy-main">
                    <span className="fo-policy-kind">{label}{p.status !== 'active' ? `, ${p.status}` : ''}</span>
                    <span className="fo-policy-name">{p.plan_name || p.insurer || `${label} insurance`}</span>
                    <span className="fo-policy-ins">{[p.plan_name && p.insurer, p.policy_ref && `ending ${p.policy_ref}`, p.added_by && `added by ${p.added_by}`].filter(Boolean).join(', ')}</span>
                  </span>
                  <span className="fo-policy-nums">
                    <span><b>{p.sum_assured ? inr(p.sum_assured) : '—'}</b>cover</span>
                    <span><b>{p.premium ? inr(p.premium) : '—'}</b>{FREQS.find(f => f[0] === p.premium_frequency)?.[1].toLowerCase() || ''}</span>
                  </span>
                  <span className="fo-policy-foot">
                    <Faces ids={p.member_ids} members={members} size={24} />
                    {days !== null && p.status === 'active' && <span className={`fo-when ${urgency(days)}`}>Premium {whenLabel(days).toLowerCase()}, {fmtDate(p.renewal_date, { day: 'numeric', month: 'short' })}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {form && <PolicyForm policy={form === 'new' ? null : form} members={members} onClose={() => setForm(null)} onSaved={load} notify={notify} />}
    </div>
  );
}
