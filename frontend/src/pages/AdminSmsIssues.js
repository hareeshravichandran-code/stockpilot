import { useCallback, useEffect, useState } from 'react';
import { smsIssuesAPI } from '../lib/api';
import { fmtWhen } from './supportChat';

const STATUS = [['pending', 'Pending'], ['included', 'Included in code'], ['ignored', 'Not needed']];

// Highlights the blanks in a template: # (numbers) and <name>, <url>, <mon>
function Template({ text }) {
  const parts = String(text || '').split(/(#|<name>|<url>|<mon>|<id>)/g);
  return <span className="si-tpl">{parts.map((p, i) => /^(#|<name>|<url>|<mon>|<id>)$/.test(p) ? <i key={i}>{p === '#' ? '#' : p.slice(1, -1)}</i> : p)}</span>;
}

export default function AdminSmsIssues() {
  const [status, setStatus] = useState('pending');
  const [sender, setSender] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('hits');
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const load = useCallback(() => smsIssuesAPI.list({ status, sender: sender || undefined, q: q || undefined, sort, page })
    .then(r => { setD(r.data); setErr(''); }).catch(e => setErr(e.response?.data?.error || e.message)), [status, sender, q, sort, page]);
  useEffect(() => { load(); }, [load]);

  const bulk = async (to) => {
    if (!checked.size) return;
    await smsIssuesAPI.update([...checked][0], { ids: [...checked], status: to });
    setChecked(new Set()); load();
  };

  return (
    <div className="si-wrap">
      <section className="si-list">
        <div className="si-filters">
          <div className="si-tabs">{STATUS.map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setPage(0); setChecked(new Set()); }}>
              {l} <b>{d?.counts?.[k] ?? ''}</b></button>))}</div>
          <div className="si-row">
            <input placeholder="Search message text…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
            <select value={sort} onChange={e => setSort(e.target.value)}><option value="hits">Most seen</option><option value="recent">Latest</option></select>
          </div>
          {d?.senders?.length > 0 && (
            <div className="si-senders">
              <button className={!sender ? 'on' : ''} onClick={() => setSender('')}>All senders</button>
              {d.senders.map(([c, n]) => <button key={c} className={sender === c ? 'on' : ''} onClick={() => { setSender(c); setPage(0); }}>{c} <b>{n}</b></button>)}
            </div>
          )}
          {checked.size > 0 && (
            <div className="si-bulk">{checked.size} selected:
              {STATUS.filter(([k]) => k !== status).map(([k, l]) => <button key={k} onClick={() => bulk(k)}>→ {l}</button>)}
            </div>
          )}
        </div>
        {err && <div className="sp-err">{err}</div>}
        {!d ? <div className="sp-empty">Loading…</div> : d.issues.length === 0 ? <div className="sp-empty">Nothing here.</div> : (
          <ul className="si-items">
            {d.issues.map(it => (
              <li key={it.id} className={`${sel === it.id ? 'on' : ''} ${it.reopened ? 'reopened' : ''}`} onClick={() => setSel(it.id)}>
                <input type="checkbox" checked={checked.has(it.id)} onClick={e => e.stopPropagation()}
                  onChange={e => { const n = new Set(checked); e.target.checked ? n.add(it.id) : n.delete(it.id); setChecked(n); }} />
                <div className="si-main">
                  <div className="si-meta"><span className="si-sender">{it.sender_code || '?'}</span><span className={`si-kind k-${it.kind}`}>{it.kind}</span>
                    {it.reopened && <span className="si-re">seen again after fix</span>}</div>
                  <Template text={it.template} />
                </div>
                <div className="si-nums"><b>{it.hits}</b><small>{it.users} {it.users === 1 ? 'user' : 'users'}</small><small>{fmtWhen(it.last_seen)}</small></div>
              </li>))}
          </ul>
        )}
        {d && d.count > 50 && (
          <div className="sp-pager">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
            <span>Page {page + 1} of {Math.ceil(d.count / 50)}</span>
            <button disabled={(page + 1) * 50 >= d.count} onClick={() => setPage(p => p + 1)}>→</button>
          </div>
        )}
      </section>
      <section className="si-detail">{sel ? <IssueDetail id={sel} onChanged={load} /> : <div className="sp-empty">Pick an issue to see its messages.</div>}</section>
    </div>
  );
}

function IssueDetail({ id, onChanged }) {
  const [d, setD] = useState(null);
  const [note, setNote] = useState('');
  const [fixedIn, setFixedIn] = useState('');
  useEffect(() => {
    setD(null);
    smsIssuesAPI.get(id).then(r => { setD(r.data); setNote(r.data.issue.admin_note || ''); setFixedIn(r.data.issue.fixed_in || ''); });
  }, [id]);
  if (!d) return <div className="sp-empty">Loading…</div>;
  const it = d.issue;
  const save = async (status) => {
    await smsIssuesAPI.update(id, { status: status || it.status, admin_note: note, fixed_in: fixedIn });
    setD({ ...d, issue: { ...it, status: status || it.status, reopened: false } }); onChanged();
  };
  return (
    <div className="si-d">
      <div className="si-meta"><span className="si-sender">{it.sender_code}</span><span className={`si-kind k-${it.kind}`}>{it.kind}</span>
        <span>{it.hits} times · {it.users} users · first {fmtWhen(it.first_seen)} · last {fmtWhen(it.last_seen)}</span></div>
      <h3>Message format</h3>
      <div className="si-tplbox"><Template text={it.template} /></div>
      {it.amounts?.length > 0 && <div className="si-amts">Amounts seen: {it.amounts.map(a => <span key={a}>₹{Number(a).toLocaleString('en-IN')}</span>)}</div>}
      <div className="si-status">{STATUS.map(([k, l]) => <button key={k} className={it.status === k ? `on s-${k}` : ''} onClick={() => save(k)}>{l}</button>)}</div>
      <div className="si-row">
        <input placeholder="Fixed in app version (e.g. 1.7.2)" value={fixedIn} onChange={e => setFixedIn(e.target.value)} />
        <button className="sp-send" onClick={() => save()}>Save</button>
      </div>
      <textarea rows={3} placeholder="Notes: what the reader should do with this format…" value={note} onChange={e => setNote(e.target.value)} onBlur={() => save()} />
      <h3>Messages ({d.samples.length})</h3>
      <ul className="si-samples">
        {d.samples.map(s => (
          <li key={s.id}>
            <div className="si-sm-meta"><b>{s.sender}</b> · {s.sms_at ? fmtWhen(s.sms_at) : ''} · app {s.app_version || '?'}</div>
            <div className="si-sm-body">{s.body}</div>
            {s.parsed && <code>{JSON.stringify(s.parsed)}</code>}
          </li>))}
      </ul>
    </div>
  );
}
