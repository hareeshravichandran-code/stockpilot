import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

// ─── tiny helpers ──────────────────────────────────────────────────
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtShort = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '';

const STATUS_COLOR = { completed:'#6b8e23', failed:'#a82c2c', running:'#a8741a', null:'var(--text-3)' };

function StatusBadge({ status, spinning }) {
  const c = STATUS_COLOR[status] || 'var(--text-3)';
  return (
    <span style={{
      fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:20,
      background:`${c}18`, color:c, border:`1px solid ${c}40`,
      fontFamily:'var(--font-mono)', letterSpacing:'.04em'
    }}>
      {spinning ? '⟳ RUNNING' : (status || 'UNKNOWN').toUpperCase()}
    </span>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background:'var(--surface)', borderRadius:8, padding:'8px 10px', border:'1px solid var(--border)', textAlign:'center' }}>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:20, fontWeight:700, color: color || 'var(--text)' }}>{value ?? '—'}</div>
      <div style={{ fontSize:10, color:'var(--text-3)', marginTop:2 }}>{label}</div>
    </div>
  );
}

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false);
  const isOk   = log.status === 'success';
  const isSkip = log.status === 'skipped';
  const dot    = isOk ? '✅' : isSkip ? '⚠️' : '❌';
  const errColor = isOk ? '#6b8e23' : isSkip ? '#a8741a' : '#a82c2c';

  return (
    <div style={{ borderBottom:'1px solid var(--border)', padding:'9px 12px' }}>
      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <span style={{ fontSize:13, flexShrink:0, marginTop:1 }}>{dot}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }}>
              {log.email_subject || '(no subject)'}
            </span>
            <span style={{ fontSize:10, color:'var(--text-4)', whiteSpace:'nowrap' }}>
              {fmtShort(log.email_date)}
            </span>
            {log.items_found > 0 && (
              <span style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'#6b8e23', background:'rgba(107,142,35,0.10)', padding:'1px 6px', borderRadius:4 }}>
                {log.items_found} holdings
              </span>
            )}
            {log.has_pdf && (
              <span style={{ fontSize:10, color:'var(--text-3)', background:'var(--surface-2)', padding:'1px 5px', borderRadius:4 }}>PDF</span>
            )}
            {log.pdf_unlocked === false && log.has_pdf && (
              <span style={{ fontSize:10, color:'#a82c2c', background:'rgba(168,44,44,0.08)', padding:'1px 5px', borderRadius:4 }}>🔒 PDF locked</span>
            )}
            {log.phase && (
              <span style={{ fontSize:9, color:'var(--text-4)', fontFamily:'var(--font-mono)', textTransform:'uppercase' }}>[{log.phase}]</span>
            )}
          </div>

          {!isOk && log.error_message && (
            <div style={{ fontSize:11, color:errColor, marginTop:3, fontFamily:'var(--font-mono)' }}>
              {log.error_type && <span style={{ fontWeight:700, marginRight:6 }}>[{log.error_type}]</span>}
              {log.error_message}
            </div>
          )}

          {log.pdf_filename && (
            <div style={{ fontSize:10, color:'var(--text-4)', marginTop:2 }}>
              PDF: {log.pdf_filename}
            </div>
          )}

          {(log.raw_text_snippet || log.error_stack) && !isOk && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize:10, color:'var(--text-4)', background:'none', border:'none', cursor:'pointer', padding:'2px 0', marginTop:2 }}
            >
              {expanded ? '▾ hide detail' : '▸ show detail'}
            </button>
          )}

          {expanded && (
            <div style={{ marginTop:6 }}>
              {log.raw_text_snippet && (
                <pre style={{ fontSize:10, color:'var(--text-3)', background:'var(--surface-2)', padding:8, borderRadius:6, whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:120, overflow:'auto', margin:0, marginBottom:4 }}>
                  {log.raw_text_snippet}
                </pre>
              )}
              {log.error_stack && (
                <pre style={{ fontSize:9, color:'#a82c2c', background:'rgba(168,44,44,0.04)', padding:8, borderRadius:6, whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:100, overflow:'auto', margin:0 }}>
                  {log.error_stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncSection({ title, syncType, running }) {
  const [session, setSession] = useState(null);
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const endpoint = syncType === 'nps_backfill'
        ? '/api/portfolio/history/nps/status'
        : '/api/portfolio/history/backfill/status';
      const r = await api.get(endpoint);
      setSession(r.data?.session || null);
      setLogs(r.data?.logs || []);
    } catch (e) {
      // endpoint not yet deployed — silently hide
    } finally {
      setLoading(false);
    }
  }, [syncType]);

  useEffect(() => {
    load();
  }, [load]);

  // If a run is in progress, poll until it finishes
  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(load, 4000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [running, load]);

  if (loading) return null;
  if (!session)  return null;

  const success = logs.filter(l => l.status === 'success').length;
  const failed  = logs.filter(l => l.status !== 'success').length;

  return (
    <div style={{ background:'var(--surface-2)', border:'1px solid var(--border-2)', borderRadius:10, padding:16, marginTop:14 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ fontWeight:700, fontSize:13, color:'var(--text)' }}>{title} — Last Run</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <StatusBadge status={session.status} spinning={running} />
          <button onClick={load} style={{ background:'none', border:'1px solid var(--border-2)', borderRadius:6, color:'var(--text-3)', fontSize:11, padding:'3px 8px', cursor:'pointer' }}>
            ↻
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 }}>
        <StatCard label="Emails found"   value={session.emails_scanned ?? logs.length}                    color="var(--indigo)" />
        <StatCard label="Parsed OK"      value={session.emails_parsed  ?? success}                        color="#6b8e23" />
        <StatCard label="Failed/Skipped" value={session.emails_failed  ?? failed}                         color={failed > 0 ? '#a82c2c' : 'var(--text-3)'} />
        <StatCard label="Snapshots"      value={session.holdings_found ?? success}                        color="#a8741a" />
      </div>

      <div style={{ fontSize:11, color:'var(--text-4)', marginBottom:10 }}>
        Started {fmtDate(session.started_at)}
        {session.finished_at && ` · Finished ${fmtDate(session.finished_at)}`}
      </div>

      {logs.length > 0 ? (
        <div style={{ maxHeight:280, overflowY:'auto', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)' }}>
          {logs.map((log, i) => <LogRow key={i} log={log} />)}
        </div>
      ) : running ? (
        <div style={{ textAlign:'center', padding:'16px', color:'var(--text-3)', fontSize:12 }}>⟳ Waiting for first email to process…</div>
      ) : null}
    </div>
  );
}

// ─── Activity Logger panel ─────────────────────────────────────────
// A separate "Start Logging" feature that tails Railway-style events
// stored in sync_logs for the user. All activities are logged — not
// just sync runs.
function ActivityLogPanel() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [since, setSince]     = useState('');
  const [filterPhase, setFilterPhase] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (since) params.since = since;
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterPhase !== 'all') params.phase = filterPhase;
      const r = await api.get('/api/email/failures', { params });
      setLogs(r.data?.failures || []);
    } catch (e) {
      console.error('[ActivityLog]', e.message);
    } finally {
      setLoading(false);
    }
  }, [since, filterPhase, filterStatus]);

  const loadAllLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Load all sessions then their logs
      const sessR = await api.get('/api/email/sessions');
      const sessions = sessR.data?.sessions || [];
      const allLogs = [];
      for (const sess of sessions.slice(0, 5)) {
        const logR = await api.get(`/api/email/sessions/${sess.id}/logs`);
        (logR.data?.logs || []).forEach(l => allLogs.push({ ...l, _sessionStatus: sess.status, _sessionDate: sess.started_at }));
      }
      setLogs(allLogs);
    } catch (e) {
      console.error('[ActivityLog]', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const phases = [...new Set(logs.map(l => l.phase).filter(Boolean))];
  const filtered = logs.filter(l =>
    (filterStatus === 'all' || l.status === filterStatus) &&
    (filterPhase  === 'all' || l.phase  === filterPhase)
  );

  return (
    <div style={{ background:'var(--surface-2)', border:'1px solid var(--border-2)', borderRadius:10, padding:16, marginTop:14 }}>
      <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', marginBottom:4 }}>📋 Detailed Activity Log</div>
      <div style={{ color:'var(--text-3)', fontSize:11, marginBottom:12 }}>
        Every email processed across all sync runs — use this to diagnose why a specific CAS or NPS statement wasn't captured.
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        <button onClick={loadAllLogs} disabled={loading}
          style={{ background:'var(--text)', color:'var(--bg)', border:'none', borderRadius:6, padding:'8px 14px', fontWeight:700, fontSize:12, cursor:'pointer' }}>
          {loading ? '⟳ Loading…' : '▶ Start Logging'}
        </button>
        <button onClick={loadLogs} disabled={loading}
          style={{ background:'var(--surface)', border:'1px solid var(--border-2)', color:'var(--text-3)', borderRadius:6, padding:'8px 12px', fontSize:12, cursor:'pointer' }}>
          ↻ Refresh
        </button>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background:'var(--surface)', border:'1px solid var(--border-2)', color:'var(--text-2)', borderRadius:6, padding:'7px 10px', fontSize:12, cursor:'pointer' }}>
          <option value="all">All statuses</option>
          <option value="success">✅ Success only</option>
          <option value="failed">❌ Failed only</option>
          <option value="skipped">⚠️ Skipped only</option>
          <option value="password_failed">🔒 Password failed</option>
        </select>

        {phases.length > 0 && (
          <select value={filterPhase} onChange={e => setFilterPhase(e.target.value)}
            style={{ background:'var(--surface)', border:'1px solid var(--border-2)', color:'var(--text-2)', borderRadius:6, padding:'7px 10px', fontSize:12, cursor:'pointer' }}>
            <option value="all">All phases</option>
            {phases.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}

        <input type="date" value={since} onChange={e => setSince(e.target.value)}
          placeholder="Since date"
          style={{ background:'var(--surface)', border:'1px solid var(--border-2)', color:'var(--text-2)', borderRadius:6, padding:'7px 10px', fontSize:12 }} />
      </div>

      {logs.length > 0 && (
        <div style={{ display:'flex', gap:16, marginBottom:12, flexWrap:'wrap' }}>
          {[
            { label:'Total', val: logs.length, color:'var(--text)' },
            { label:'Success', val: logs.filter(l=>l.status==='success').length, color:'#6b8e23' },
            { label:'Failed', val: logs.filter(l=>l.status==='failed').length, color:'#a82c2c' },
            { label:'Skipped', val: logs.filter(l=>l.status==='skipped').length, color:'#a8741a' },
            { label:'PDF locked', val: logs.filter(l=>l.status==='password_failed').length, color:'var(--indigo)' },
          ].map(s => (
            <div key={s.label} style={{ fontSize:12 }}>
              <span style={{ color:s.color, fontFamily:'var(--font-mono)', fontWeight:700, marginRight:4 }}>{s.val}</span>
              <span style={{ color:'var(--text-3)' }}>{s.label}</span>
            </div>
          ))}
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--text-4)' }}>
            Showing {filtered.length} of {logs.length}
          </div>
        </div>
      )}

      {filtered.length > 0 ? (
        <div style={{ maxHeight:400, overflowY:'auto', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)' }}>
          {filtered.map((log, i) => <LogRow key={i} log={log} />)}
        </div>
      ) : !loading ? (
        <div style={{ textAlign:'center', padding:'32px 16px', color:'var(--text-3)', fontSize:12 }}>
          {logs.length === 0
            ? 'Click "Start Logging" to load all sync activity across your last 5 sessions.'
            : 'No logs match the current filters.'}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────
export default function HistoricalSyncPanel() {
  return (
    <div>
      <SyncSection title="📊 CDSL &amp; NSDL CAS" syncType="backfill"     running={false} />
      <SyncSection title="🏛 NPS"                  syncType="nps_backfill" running={false} />
      <ActivityLogPanel />
    </div>
  );
}
