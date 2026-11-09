import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supportAPI } from '../lib/api';
import { Bubbles, Composer, fmtWhen } from './supportChat';
import './Support.css';

// Admin inbox: every user's thread, replies with screenshots, and their diagnostics uploads
export default function AdminSupport() {
  const nav = useNavigate();
  const [threads, setThreads] = useState(null);
  const [sel, setSel] = useState(null);
  const [thread, setThread] = useState(null);
  const [diagId, setDiagId] = useState(null);
  const [err, setErr] = useState('');
  const loadThreads = useCallback(() => supportAPI.threads().then(r => setThreads(r.data.threads)).catch(e => setErr(e.response?.data?.error || e.message)), []);
  const loadThread = useCallback((uid) => supportAPI.thread(uid).then(r => setThread(r.data)).catch(e => setErr(e.response?.data?.error || e.message)), []);
  useEffect(() => { loadThreads(); const t = setInterval(loadThreads, 30000); return () => clearInterval(t); }, [loadThreads]);
  useEffect(() => { if (sel) { setThread(null); setDiagId(null); loadThread(sel); } }, [sel, loadThread]);

  if (err === 'Admin only') return <div className="sp-page"><div className="sp-empty">This page is for the Kanalyst admin.</div></div>;
  return (
    <div className="sp-admin">
      <aside className="sp-list">
        <header className="sp-head small"><button className="sp-back" onClick={() => nav('/dashboard')}>←</button><h1>Support inbox</h1></header>
        {err && <div className="sp-err">{err}</div>}
        {!threads ? <div className="sp-empty">Loading…</div> : threads.length === 0 ? <div className="sp-empty">No messages yet.</div> :
          threads.map(t => (
            <button key={t.user_id} className={`sp-thread ${sel === t.user_id ? 'on' : ''}`} onClick={() => setSel(t.user_id)}>
              <b>{t.user?.name || t.user?.email || t.user_id.slice(0, 8)}</b>
              {t.unread > 0 && <span className="sp-badge">{t.unread}</span>}
              <em>{t.last.from_admin ? 'You: ' : ''}{t.last.body || (t.last.diag ? 'Diagnostics' : t.last.images ? 'Image' : '')}</em>
              <small>{t.user?.email} · {fmtWhen(t.last.created_at)}</small>
            </button>))}
      </aside>
      <section className="sp-main">
        {!sel ? <div className="sp-empty">Pick a conversation.</div> : !thread ? <div className="sp-empty">Loading…</div> : (
          <>
            <div className="sp-head small"><div><h1>{thread.user?.name}</h1><p>{thread.user?.email}</p></div></div>
            {thread.uploads.length > 0 && (
              <div className="sp-uploads">
                {thread.uploads.map(u => (
                  <button key={u.id} className={`sp-up st-${u.status} ${diagId === u.id ? 'on' : ''}`} onClick={() => setDiagId(u.id)}>
                    📦 {fmtWhen(u.created_at)} · {u.sms_count} SMS · v{u.app_version || '?'} <i>{u.status}</i>
                  </button>))}
              </div>
            )}
            {diagId ? <DiagView id={diagId} onClose={() => setDiagId(null)} onChanged={() => loadThread(sel)} /> : (
              <>
                <div className="sp-chat"><Bubbles messages={thread.messages} mine={m => m.from_admin} onDiag={setDiagId} /></div>
                <Composer placeholder="Reply…" onSend={async (d) => { await supportAPI.reply(sel, d); await loadThread(sel); loadThreads(); }} />
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function DiagView({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [filter, setFilter] = useState('financial');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('sms');
  const [note, setNote] = useState('');
  useEffect(() => {
    supportAPI.diag(id, { filter, q: q || undefined, page }).then(r => { setD(r.data); setNote(r.data.upload.admin_note || ''); });
  }, [id, filter, q, page]);
  if (!d) return <div className="sp-empty">Loading diagnostics…</div>;
  const u = d.upload;
  const setStatus = async (status) => { await supportAPI.updateDiag(id, { status, admin_note: note }); setD({ ...d, upload: { ...u, status } }); onChanged(); };
  return (
    <div className="sp-diagview">
      <div className="sp-diag-top">
        <button className="sp-back" onClick={onClose}>←</button>
        <div>
          <b>Diagnostics · {fmtWhen(u.created_at)}</b>
          <div className="sp-stats">{d.stats.total} SMS · {d.stats.financial} financial · <span className="warn">{d.stats.unparsed} financial but not read</span> · app v{u.app_version} · {u.device?.model} Android {u.device?.android}</div>
        </div>
        <div className="sp-status">{['new', 'looking', 'fixed'].map(s => <button key={s} className={u.status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>
      </div>
      {u.note && <div className="sp-note">“{u.note}”</div>}
      <div className="sp-tabs">{[['sms', 'SMS'], ['logs', 'Logs'], ['data', 'App data'], ['notes', 'My notes']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'sms' && (
        <>
          <div className="sp-filters">
            {[['unparsed', 'Financial, not read'], ['financial', 'Financial'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setPage(0); }}>{l}</button>)}
            <input placeholder="Search text…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
            <span>{d.count} found</span>
          </div>
          <table className="sp-sms"><tbody>
            {d.sms.map(s => (
              <tr key={s.id} className={s.financial && !s.parsed ? 'miss' : ''}>
                <td className="w">{s.sms_at ? fmtWhen(s.sms_at) : ''}<br /><b>{s.sender}</b></td>
                <td>{s.body}</td>
                <td className="p">{s.parsed ? <code>{[s.parsed.type, s.parsed.amount, s.parsed.merchant, s.parsed.bank].filter(Boolean).join(' · ')}</code> : s.financial ? <i>not read</i> : ''}</td>
              </tr>))}
          </tbody></table>
          <div className="sp-pager">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Newer</button>
            <span>Page {page + 1} of {Math.max(1, Math.ceil(d.count / d.size))}</span>
            <button disabled={(page + 1) * d.size >= d.count} onClick={() => setPage(p => p + 1)}>Older →</button>
          </div>
        </>
      )}
      {tab === 'logs' && <pre className="sp-pre">{u.logs || 'No logs'}</pre>}
      {tab === 'data' && <pre className="sp-pre">{JSON.stringify(u.data, null, 2)}</pre>}
      {tab === 'notes' && (
        <div className="sp-notes"><textarea rows={8} value={note} onChange={e => setNote(e.target.value)} placeholder="What you found, what Claude should fix…" />
          <button className="sp-send" onClick={() => setStatus(u.status)}>Save notes</button></div>
      )}
    </div>
  );
}
