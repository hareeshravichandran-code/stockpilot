import { useState, useEffect, useCallback, useMemo } from 'react';
import { mastersAPI } from '../lib/api';
import { Modal, Field, Empty, errMsg, fmtDate } from './shared';
import { kindOf, KindIcon, inrShort } from '../money/kinds';

import LogoLoader from '../components/LogoLoader';
import Recurring from './Recurring';
// Every master has an event (when it's expected) and actuals (the bank SMS that matched it).
const KINDS = [
  ['loan', 'Loans', 'Loan', 'emi'],
  ['card', 'Cards', 'Credit card', 'card'],
  ['sip', 'SIPs', 'SIP', 'sip'],
  ['income', 'Income', 'Income', 'income'],
  ['expense', 'Expenses', 'Regular expense', 'expense'],
  ['subscription', 'Subscriptions', 'Subscription', 'subscription'],
  ['rd', 'RDs', 'Recurring deposit', 'rd'],
  ['bank_account', 'Accounts', 'Bank account', 'bank'],
];
const SUBTYPES = {
  income: [['salary', 'Salary'], ['dividend', 'Dividend'], ['rental', 'Rent received'], ['interest', 'Interest'], ['freelance', 'Freelance'], ['other', 'Other']],
  expense: [['rent', 'Rent'], ['school_fee', 'School fee'], ['maid', 'Help / maid'], ['utility', 'Utility'], ['other', 'Other']],
};
const FREQ = [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['irregular', 'No fixed date']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const kindMeta = (k) => KINDS.find(x => x[0] === k) || KINDS[0];
const visualKind = (m) => (m.kind === 'income' || m.kind === 'expense' ? (m.subtype && m.subtype !== 'other' ? m.subtype : m.kind) : m.kind === 'card' ? 'card' : m.kind);
const ord = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th');
const perMonth = (m) => (+m.amount || 0) * ({ monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12 }[m.frequency] || 0);
const whenText = (m) => m.frequency === 'irregular' ? 'No fixed date'
  : m.frequency === 'monthly' ? (m.due_day ? `Every month on the ${ord(m.due_day)}` : 'Every month')
  : `${FREQ.find(f => f[0] === m.frequency)?.[1] || ''}${m.due_month ? ` · ${MONTHS[m.due_month - 1]}` : ''}${m.due_day ? ` ${m.due_day}` : ''}`;

/** Next date this master is expected (null for irregular). */
function nextDue(m, today = new Date()) {
  if (!m.due_day || m.frequency === 'irregular') return null;
  const step = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[m.frequency] || 1;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let y = today.getFullYear(), mo = m.frequency === 'monthly' || !m.due_month ? today.getMonth() : m.due_month - 1;
  for (let i = 0; i < 30; i++) {
    const last = new Date(y, mo + 1, 0).getDate();
    const d = new Date(y, mo, Math.min(m.due_day, last));
    if (d >= t0) return d;
    mo += step; if (mo > 11) { y += Math.floor(mo / 12); mo %= 12; }
  }
  return null;
}
const daysTo = (d) => Math.round((d - new Date(new Date().toDateString())) / 864e5);
const initials = (s) => String(s || '?').replace(/bank|ltd|limited|insurance|india/ig, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '•';

/** One master as a card that looks like the thing it is (a card, an account, a loan, a subscription). */
function MasterCard({ m, folios, onOpen, i }) {
  const vk = visualKind(m);
  const due = nextDue(m);
  const dd = due ? daysTo(due) : null;
  const soon = dd != null && dd <= 5;
  const trail = m.actual?.trail || [];
  const peak = Math.max(1, ...trail);
  const dueText = due ? (dd === 0 ? 'Due today' : dd === 1 ? 'Due tomorrow' : `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`) : whenText(m);
  const last = m.actual?.last_date ? `Last ${inrShort(m.actual.last_amount)} · ${fmtDate(m.actual.last_date)}` : 'No payment seen yet';
  const Trail = () => trail.some(v => v > 0) ? (
    <span className="fm2-trail" aria-label="Last six months">{trail.map((v, k) => <i key={k} style={{ height: `${Math.max(6, (v / peak) * 100)}%`, '--k': k }} className={v ? '' : 'none'} />)}</span>) : null;

  if (m.kind === 'card') return (
    <button type="button" className={`fm2-ccard${soon ? ' soon' : ''}`} style={{ '--i': i }} onClick={onOpen}>
      <span className="fm2-cc-top"><b>{m.institution || m.title}</b><span className="fm2-chip" aria-hidden="true" /></span>
      <span className="fm2-cc-num">•••• •••• •••• {m.ref || '••••'}</span>
      <span className="fm2-cc-foot">
        <span><small>Typical bill</small><b>{m.amount ? inrShort(m.amount) : '—'}</b></span>
        <span className={`fm2-due${soon ? ' hot' : ''}`}>{dueText}</span>
      </span>
      <span className="fm2-cc-last">{last}</span>
    </button>
  );
  if (m.kind === 'bank_account') return (
    <button type="button" className="fm2-card bank" style={{ '--i': i }} onClick={onOpen}>
      <span className="fm2-head"><span className="fm2-mono">{initials(m.institution || m.title)}</span><span className="fm2-name"><b>{m.institution || m.title}</b><small>Savings ••{m.ref || '—'}</small></span></span>
      <span className="fm2-big">{m.meta?.balance != null ? inrShort(m.meta.balance) : '—'}</span>
      <span className="fm2-sub">{m.meta?.balance_at ? `Balance on ${fmtDate(m.meta.balance_at)}` : 'Balance appears with the next bank SMS'}</span>
    </button>
  );
  return (
    <button type="button" className={`fm2-card k-${m.kind}${m.status === 'closed' ? ' closed' : ''}${soon ? ' soon' : ''}`} style={{ '--i': i, '--c': kindOf(vk).c }} onClick={onOpen}>
      <span className="fm2-head">
        <span className="fm2-ic"><KindIcon kind={vk} size={18} color="#FAF7F0" /></span>
        <span className="fm2-name"><b>{m.title}</b><small>{kindOf(vk).label}{m.institution && m.institution !== m.title ? ` · ${m.institution}` : ''}{m.ref ? ` ••${m.ref}` : ''}</small></span>
        {m.source === 'discover' && <span className="fm2-src">SMS</span>}
      </span>
      <span className="fm2-row">
        <span className={`fm2-big${m.kind === 'income' ? ' in' : ''}`}>{m.amount ? inrShort(m.amount) : '—'}<small>{m.frequency === 'yearly' ? '/yr' : m.frequency === 'monthly' ? '/mo' : ''}</small></span>
        <Trail />
      </span>
      <span className="fm2-foot"><span className={`fm2-due${soon ? ' hot' : ''}`}>{dueText}</span><span>{last}</span></span>
      {m.kind === 'sip' && m.linked_id && <span className="fm2-sub">↻ {folios.find(f => f.id === String(m.linked_id))?.fund_name || 'Folio linked'}</span>}
    </button>
  );
}

/** Summary tiles for one kind (cards, accounts, loans...). */
function KindTiles({ tab, list }) {
  const label = (KINDS.find(k => k[0] === tab) || [, 'Masters'])[1];
  const soon = list.map(m => ({ m, d: nextDue(m) })).filter(x => x.d).sort((a, b) => a.d - b.d)[0];
  const paid = list.reduce((a, m) => a + (m.actual?.total_12m || 0), 0);
  if (tab === 'bank_account') {
    const bal = list.reduce((a, m) => a + (+m.meta?.balance || 0), 0);
    const at = list.map(m => m.meta?.balance_at).filter(Boolean).sort().pop();
    return (<div className="fm-tiles">
      <div className="fm-tile out"><small>Across {list.length} account{list.length === 1 ? '' : 's'}</small><b>{inrShort(bal)}</b><span>Latest balance from your bank SMS</span></div>
      <div className="fm-tile in"><small>Last updated</small><b>{at ? fmtDate(at) : '—'}</b><span>Updates with each balance SMS</span></div>
      <div className="fm-tile in"><small>Accounts</small><b>{list.length}</b><span>Closed ones are hidden</span></div>
    </div>);
  }
  return (<div className="fm-tiles">
    <div className="fm-tile out"><small>{label} · every month</small><b>{inrShort(list.reduce((a, m) => a + perMonth(m), 0))}</b><span>{list.length} active</span></div>
    <div className="fm-tile in"><small>Paid in the last 12 months</small><b>{inrShort(paid)}</b><span>From the SMS linked to them</span></div>
    <div className="fm-tile in"><small>Next due</small><b>{soon ? soon.d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</b><span>{soon ? soon.m.title : 'Nothing dated'}</span></div>
  </div>);
}

/** A subscription / expense / income as one list row. */
function MasterRow({ m, i, onOpen }) {
  const vk = visualKind(m);
  const due = nextDue(m); const dd = due ? daysTo(due) : null;
  const trail = m.actual?.trail || []; const peak = Math.max(1, ...trail);
  return (
    <button type="button" className={`fm2-row${m.status === 'closed' ? ' closed' : ''}`} style={{ '--i': i, '--c': kindOf(vk).c }} onClick={onOpen}>
      <span className="fm2-ic"><KindIcon kind={vk} size={17} color="#FAF7F0" /></span>
      <span className="fm2-name"><b>{m.title}</b><small>{whenText(m)}{m.actual?.last_date ? ` · last ${fmtDate(m.actual.last_date)}` : ''}</small></span>
      <span className="fm2-trail" aria-hidden="true">{trail.map((v, k) => <i key={k} style={{ height: `${Math.max(6, (v / peak) * 100)}%`, '--k': k }} className={v ? '' : 'none'} />)}</span>
      <span className={`fm2-ramt${m.kind === 'income' ? ' in' : ''}`}>{m.amount ? inrShort(m.amount) : '—'}</span>
      <span className={`fm2-due${dd != null && dd <= 5 ? ' hot' : ''}`}>{due ? (dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : `In ${dd} days`) : '—'}</span>
    </button>
  );
}

function MasterForm({ master, kind0, folios = [], onClose, onSaved, notify }) {
  const [d, setD] = useState({
    kind: master?.kind || kind0 || 'loan', subtype: master?.subtype || '', title: master?.title || '', institution: master?.institution || '',
    ref: master?.ref || '', amount: master?.amount ?? '', frequency: master?.frequency || 'monthly', due_day: master?.due_day ?? '',
    due_month: master?.due_month ?? '', keywords: (master?.match?.keywords || []).join(', '), any_amount: !!master?.match?.any_amount,
    linked_id: master?.linked_table === 'mf_holdings' ? master.linked_id || '' : '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const needsSub = d.kind === 'income' || d.kind === 'expense';
  const save = async () => {
    if (!d.title.trim()) { setErr('Give it a name, e.g. “Rent from Ravi” or “HDFC home loan”'); return; }
    if (needsSub && !d.subtype) { setErr('Choose what kind of ' + (d.kind === 'income' ? 'income' : 'expense') + ' this is'); return; }
    if (d.due_day !== '' && (+d.due_day < 1 || +d.due_day > 31)) { setErr('Due day must be between 1 and 31'); return; }
    setBusy(true); setErr('');
    const body = {
      kind: d.kind, subtype: needsSub ? d.subtype : null, title: d.title.trim(), institution: d.institution.trim() || d.title.trim(),
      ref: d.ref.trim() || null, amount: d.amount === '' ? null : +d.amount, frequency: d.frequency,
      due_day: d.due_day === '' ? null : +d.due_day, due_month: d.due_month === '' ? null : +d.due_month,
      match: { keywords: d.keywords, any_amount: d.any_amount },
      ...(d.kind === 'sip' ? { linked_id: d.linked_id || null } : {}),
    };
    try {
      const r = master ? await mastersAPI.update(master.id, body) : await mastersAPI.create(body);
      const n = r.data?.linked || 0;
      notify(`${master ? 'Saved' : 'Added'}${n ? ` · ${n} past transactions matched` : ''}`);
      await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const close = async () => {
    if (!window.confirm('Delete this master and its calendar event? Its transactions stay in your ledger.')) return;
    setBusy(true);
    try { await mastersAPI.remove(master.id); notify('Master deleted'); await onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const k = kindMeta(d.kind);
  return (
    <Modal title={master ? `Edit ${k[2].toLowerCase()}` : 'Add a master'} onClose={onClose} wide
      footer={<>
        {master && <button type="button" className="fo-btn danger ghost" disabled={busy} onClick={close}>Delete</button>}
        <span className="fo-grow" />
        <button type="button" className="fo-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="fo-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : master ? 'Save' : 'Add'}</button>
      </>}>
      <div className="fo-form two">
        {!master && <Field label="What is it" wide>
          <div className="fo-chips">{KINDS.map(([v, , l, vk]) => (
            <button key={v} type="button" className={d.kind === v ? 'on' : ''} aria-pressed={d.kind === v} onClick={() => setD(x => ({ ...x, kind: v, subtype: '' }))}>
              <KindIcon kind={vk} size={14} /> {l}</button>))}</div>
        </Field>}
        {needsSub && <Field label={d.kind === 'income' ? 'Type of income' : 'Type of expense'} wide>
          <div className="fo-chips">{SUBTYPES[d.kind].map(([v, l]) => (
            <button key={v} type="button" className={d.subtype === v ? 'on' : ''} aria-pressed={d.subtype === v} onClick={() => set('subtype')(v)}>
              <KindIcon kind={v === 'other' ? d.kind : v} size={14} /> {l}</button>))}</div>
        </Field>}
        <Field label="Name"><input className="fo-in" value={d.title} onChange={set('title')} maxLength={80}
          placeholder={{ loan: 'HDFC home loan', card: 'Axis credit card', sip: 'Parag Parikh Flexi Cap SIP', income: 'Rent from Ravi', expense: 'House rent', subscription: 'Netflix', rd: 'Post office RD', bank_account: 'HDFC savings' }[d.kind]} /></Field>
        <Field label={d.kind === 'income' ? 'Paid by' : d.kind === 'sip' ? 'Fund house' : d.kind === 'expense' || d.kind === 'subscription' ? 'Paid to' : 'Bank / lender'}>
          <input className="fo-in" value={d.institution} onChange={set('institution')} maxLength={80} placeholder="As it appears in SMS" /></Field>
        {['loan', 'card', 'sip', 'rd', 'bank_account'].includes(d.kind) && <Field label={d.kind === 'sip' ? 'Folio (last digits)' : 'Account / card (last 4)'}>
          <input className="fo-in" value={d.ref} onChange={set('ref')} maxLength={20} placeholder="e.g. 4521" /></Field>}
        {d.kind === 'sip' && <Field label="Mutual fund folio" wide hint={folios.length ? 'The SIP\'s money flows into this folio, and into the Blueprint goal that holds it. Left empty, Kanalyst picks it by folio digits or fund name.' : 'Import your CAS in Mutual Funds to pick the folio this SIP buys into.'}>
          <select className="fo-in" value={d.linked_id} onChange={set('linked_id')} disabled={!folios.length}>
            <option value="">{folios.length ? 'Pick automatically' : 'No folios yet'}</option>
            {folios.map(f => <option key={f.id} value={f.id}>{f.fund_name}{f.folio_number ? ` · ${f.folio_number}` : ''}</option>)}
          </select></Field>}
        {d.kind !== 'bank_account' && <Field label={d.kind === 'card' ? 'Typical bill' : 'Amount'}><input className="fo-in" type="number" min={0} value={d.amount} onChange={set('amount')} placeholder="₹" /></Field>}
        {d.kind !== 'bank_account' && <Field label="How often"><select className="fo-in" value={d.frequency} onChange={set('frequency')}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
        {d.kind !== 'bank_account' && d.frequency !== 'irregular' && <Field label={d.kind === 'card' ? 'Bill due day' : d.kind === 'income' ? 'Usually arrives on day' : 'Due day of month'}>
          <input className="fo-in" type="number" min={1} max={31} value={d.due_day} onChange={set('due_day')} placeholder="1–31" /></Field>}
        {['quarterly', 'half_yearly', 'yearly'].includes(d.frequency) && d.kind !== 'bank_account' && <Field label="Month">
          <select className="fo-in" value={d.due_month} onChange={set('due_month')}><option value="">—</option>{MONTHS.map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</select></Field>}
        <Field label="Match bank SMS containing" wide hint="Words from the SMS, comma separated: a name, UPI id or reference. Matching SMS become this master's actuals.">
          <input className="fo-in" value={d.keywords} onChange={set('keywords')} placeholder="e.g. ravi kumar, ravi@okhdfc" maxLength={200} /></Field>
        <label className="fm-check"><input type="checkbox" checked={d.any_amount} onChange={set('any_amount')} /> Amount can vary (match any amount)</label>
        {err && <div className="fo-err" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function MasterDetail({ id, folios = [], onClose, onEdit, notify, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const r = await mastersAPI.detail(id); setD(r.data); } catch (e) { setErr(errMsg(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const unlink = async (t) => {
    try { await mastersAPI.unlink(id, t.id); notify('Unlinked'); await load(); onChanged(); } catch (e) { setErr(errMsg(e)); }
  };
  const m = d?.master;
  const vk = m ? visualKind(m) : 'other';
  const paid = new Set((d?.payments || []).filter(p => p.status === 'paid').map(p => p.period.slice(0, 7)));
  const months = [...Array(12)].map((_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 11 + i); return x; });
  return (
    <Modal title={m ? m.title : 'Loading…'} onClose={onClose} wide
      footer={<><span className="fo-grow" /><button type="button" className="fo-btn ghost" onClick={onClose}>Close</button>
        {m && <button type="button" className="fo-btn" onClick={() => onEdit(m)}>Edit</button>}</>}>
      {err && <div className="fo-err">{err}</div>}
      {!d && !err && <LogoLoader size={36} />}
      {m && <div className="fm-detail">
        <div className="fm-d-top" style={{ '--c': kindOf(vk).c }}>
          <span className="fm-ic big"><KindIcon kind={vk} size={26} color="#FAF7F0" /></span>
          <div><div className="fm-d-amt">{m.amount ? inrShort(m.amount) : '—'}</div><div className="fm-d-sub">{whenText(m)}{m.institution ? ` · ${m.institution}` : ''}{m.ref ? ` ••${m.ref}` : ''}</div></div>
          {d.next_due && <div className="fm-d-next"><small>Next expected</small><b>{fmtDate(d.next_due)}</b></div>}
        </div>
        {m.kind === 'sip' && <div className="fm-none">{m.linked_id ? <>Buys into <b>{folios.find(f => f.id === String(m.linked_id))?.fund_name || 'a linked folio'}</b>. Its monthly amount shows on the Blueprint goal that holds this folio.</> : 'Not tied to a folio yet. Edit to pick one.'}</div>}
        <div className="fm-sec">Event · last 12 months</div>
        <div className="fm-months">{months.map(x => {
          const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
          return <span key={key} className={paid.has(key) ? 'paid' : ''} title={paid.has(key) ? 'Seen' : 'Not seen'}>{MONTHS[x.getMonth()][0]}</span>;
        })}</div>
        <div className="fm-sec">Actuals · bank SMS matched to this master</div>
        {!d.actuals.length ? <div className="fm-none">Nothing matched yet. Add words from the SMS under Edit → “Match bank SMS containing”.</div>
          : d.actuals.map(t => (
            <div key={t.id} className="fm-act">
              <span>{fmtDate(new Date(+t.date_time).toISOString().slice(0, 10))}</span>
              <span className="fm-act-t">{t.merchant || t.description}</span>
              <b className={t.type === 'CREDIT' ? 'in' : ''}>{t.type === 'CREDIT' ? '+' : '−'}{inrShort(t.amount)}</b>
              <button type="button" className="fm-x" onClick={() => unlink(t)} aria-label="Unlink this transaction">×</button>
            </div>))}
      </div>}
    </Modal>
  );
}

export default function Masters({ notify, go, kind = 'all' }) {
  const [list, setList] = useState(null);
  const [folios, setFolios] = useState([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState(kind || 'all');
  useEffect(() => { setTab(kind || 'all'); }, [kind]);
  const [form, setForm] = useState(null);       // { master } | { kind }
  const [detail, setDetail] = useState(null);
  const load = useCallback(async () => {
    try { const r = await mastersAPI.list(); setList(r.data.masters || []); setFolios(r.data.folios || []); setErr(''); }
    catch (e) { setErr(errMsg(e)); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const [showClosed, setShowClosed] = useState(false);
  const closedN = (list || []).filter(m => (tab === 'all' || m.kind === tab) && m.status === 'closed').length;
  const shown = useMemo(() => (list || []).filter(m => (tab === 'all' || m.kind === tab) && (showClosed || m.status !== 'closed')), [list, tab, showClosed]);
  const out = (list || []).filter(m => m.kind !== 'income' && m.status !== 'closed').reduce((a, m) => a + perMonth(m), 0);
  const inn = (list || []).filter(m => m.kind === 'income' && m.status !== 'closed').reduce((a, m) => a + perMonth(m), 0);

  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div><h1>{tab === 'all' ? 'Masters' : (KINDS.find(k => k[0] === tab) || [, 'Masters'])[1].replace('Accounts', 'Bank accounts').replace('Cards', 'Credit cards')}</h1><p>Loans, cards, SIPs, income and regular expenses. Each has a date in the calendar, and bank SMS that match it become its actuals.</p></div>
        <button type="button" className="fo-btn" onClick={() => setForm({ kind: tab === 'all' ? 'loan' : tab })}>+ Add master</button>
      </div>
      {err && <div className="fo-banner">{err}</div>}
      {tab !== 'all' && kind !== 'all' ? <KindTiles tab={tab} list={(list || []).filter(m => m.kind === tab && m.status !== 'closed')} /> : <div className="fm-tiles">
        <div className="fm-tile out"><small>Committed every month</small><b>{inrShort(out)}</b><span>EMIs, SIPs, bills and expenses</span></div>
        <div className="fm-tile in"><small>Expected in every month</small><b>{inrShort(inn)}</b><span>Salary, rent, dividends</span></div>
        <button type="button" className="fm-tile ins" onClick={() => go('insurance')}><small>Insurance</small><b>Policies ›</b><span>Premiums are in the Insurance tab</span></button>
      </div>}
      {tab === 'subscription' && <Recurring notify={notify} prefer="subscription" onChanged={load} />}
      {kind === 'all' && <div className="fo-chips fm-tabs">
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All {list ? list.length : ''}</button>
        {KINDS.map(([v, l, , vk]) => {
          const n = (list || []).filter(m => m.kind === v).length;
          return <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}><KindIcon kind={vk} size={14} /> {l}{n ? ` ${n}` : ''}</button>;
        })}
      </div>}
      {list === null ? <LogoLoader label="Loading masters…" />
        : !shown.length ? <Empty title={tab === 'all' ? 'No masters yet' : `No ${kindMeta(tab)[1].toLowerCase()} yet`}
            action={<button type="button" className="fo-btn" onClick={() => setForm({ kind: tab === 'all' ? 'loan' : tab })}>Add one</button>}>
            The phone app finds these from your bank SMS (Discover). You can also add them here, such as rent you pay or receive.</Empty>
        : ['subscription', 'expense', 'income'].includes(tab)
          ? <div className="fm2-list">{shown.map((m, i) => <MasterRow key={m.id} m={m} i={i} onOpen={() => setDetail(m.id)} />)}</div>
          : <div className="fm2-grid">{shown.map((m, i) => <MasterCard key={m.id} m={m} i={i} folios={folios} onOpen={() => setDetail(m.id)} />)}</div>}
      {closedN > 0 && <button type="button" className="fm2-closed" onClick={() => setShowClosed(v => !v)}>{showClosed ? 'Hide' : 'Show'} {closedN} closed</button>}
      {form && <MasterForm master={form.master} kind0={form.kind} folios={folios} onClose={() => setForm(null)} onSaved={load} notify={notify} />}
      {detail && <MasterDetail id={detail} folios={folios} notify={notify} onChanged={load} onClose={() => setDetail(null)}
        onEdit={(m) => { setDetail(null); setForm({ master: m }); }} />}
    </div>
  );
}
