import { useState, useEffect, useCallback, useMemo } from 'react';
import { mastersAPI } from '../lib/api';
import { Modal, Field, Empty, errMsg, fmtDate } from './shared';
import { kindOf, KindIcon, inrShort } from '../money/kinds';

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
      {!d && !err && <div className="fo-loading"><span className="fo-spin" /> Loading…</div>}
      {m && <div className="fm-detail">
        <div className="fm-d-top" style={{ '--c': kindOf(vk).c }}>
          <span className="fm-ic big"><KindIcon kind={vk} size={26} color="#faf5e8" /></span>
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

export default function Masters({ notify, go }) {
  const [list, setList] = useState(null);
  const [folios, setFolios] = useState([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [form, setForm] = useState(null);       // { master } | { kind }
  const [detail, setDetail] = useState(null);
  const load = useCallback(async () => {
    try { const r = await mastersAPI.list(); setList(r.data.masters || []); setFolios(r.data.folios || []); setErr(''); }
    catch (e) { setErr(errMsg(e)); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (list || []).filter(m => tab === 'all' || m.kind === tab), [list, tab]);
  const out = (list || []).filter(m => m.kind !== 'income' && m.status !== 'closed').reduce((a, m) => a + perMonth(m), 0);
  const inn = (list || []).filter(m => m.kind === 'income' && m.status !== 'closed').reduce((a, m) => a + perMonth(m), 0);

  return (
    <div className="fo-page">
      <div className="fo-page-head">
        <div><h1>Masters</h1><p>Loans, cards, SIPs, income and regular expenses. Each has a date in the calendar, and bank SMS that match it become its actuals.</p></div>
        <button type="button" className="fo-btn" onClick={() => setForm({ kind: tab === 'all' ? 'loan' : tab })}>+ Add master</button>
      </div>
      {err && <div className="fo-banner">{err}</div>}
      <div className="fm-tiles">
        <div className="fm-tile out"><small>Committed every month</small><b>{inrShort(out)}</b><span>EMIs, SIPs, bills and expenses</span></div>
        <div className="fm-tile in"><small>Expected in every month</small><b>{inrShort(inn)}</b><span>Salary, rent, dividends</span></div>
        <button type="button" className="fm-tile ins" onClick={() => go('insurance')}><small>Insurance</small><b>Policies ›</b><span>Premiums are in the Insurance tab</span></button>
      </div>
      <div className="fo-chips fm-tabs">
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All {list ? list.length : ''}</button>
        {KINDS.map(([v, l, , vk]) => {
          const n = (list || []).filter(m => m.kind === v).length;
          return <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}><KindIcon kind={vk} size={14} /> {l}{n ? ` ${n}` : ''}</button>;
        })}
      </div>
      {list === null ? <div className="fo-loading"><span className="fo-spin" /> Loading masters…</div>
        : !shown.length ? <Empty title={tab === 'all' ? 'No masters yet' : `No ${kindMeta(tab)[1].toLowerCase()} yet`}
            action={<button type="button" className="fo-btn" onClick={() => setForm({ kind: tab === 'all' ? 'loan' : tab })}>Add one</button>}>
            The phone app finds these from your bank SMS (Discover). You can also add them here, such as rent you pay or receive.</Empty>
        : <div className="fm-grid">{shown.map(m => {
            const vk = visualKind(m);
            return (
              <button key={m.id} type="button" className={`fm-card${m.status === 'closed' ? ' closed' : ''}`} style={{ '--c': kindOf(vk).c }} onClick={() => setDetail(m.id)}>
                <span className="fm-ic"><KindIcon kind={vk} size={20} color="#faf5e8" /></span>
                <span className="fm-main"><b>{m.title}</b><small>{kindOf(vk).label}{m.institution && m.institution !== m.title ? ` · ${m.institution}` : ''}{m.ref ? ` ••${m.ref}` : ''}</small><small>{whenText(m)}</small>{m.kind === 'sip' && m.linked_id && <small className="fm-folio">↻ {folios.find(f => f.id === String(m.linked_id))?.fund_name || 'Folio linked'}</small>}</span>
                <span className={`fm-amt${m.kind === 'income' ? ' in' : ''}`}>{m.amount ? inrShort(m.amount) : ''}</span>
                {m.source === 'discover' && <span className="fm-src">from SMS</span>}
              </button>);
          })}</div>}
      {form && <MasterForm master={form.master} kind0={form.kind} folios={folios} onClose={() => setForm(null)} onSaved={load} notify={notify} />}
      {detail && <MasterDetail id={detail} folios={folios} notify={notify} onChanged={load} onClose={() => setDetail(null)}
        onEdit={(m) => { setDetail(null); setForm({ master: m }); }} />}
    </div>
  );
}
