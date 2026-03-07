import { useState, useEffect } from 'react';
import { emailAPI } from '../lib/api';

const STATUS_COLOR = {
  success:          '#00d4a1',
  failed:           '#f43f5e',
  password_failed:  '#f59e0b',
  skipped:          '#64748b',
  running:          '#0ea5e9',
  completed:        '#00d4a1',
};

const ERROR_BADGE = {
  NO_EMAILS:    { label: 'No emails',    bg: '#1e293b', color: '#64748b' },
  NO_PDF:       { label: 'No PDF',       bg: '#1c2333', color: '#64748b' },
  PDF_LOCKED:   { label: 'PDF Locked',   bg: '#2d1b00', color: '#f59e0b' },
  NO_TEXT:      { label: 'Empty PDF',    bg: '#2d1b00', color: '#f59e0b' },
  NO_ISIN:      { label: 'No ISINs',     bg: '#2d0a1e', color: '#f43f5e' },
  PARSE_FAILED: { label: 'Parse Error',  bg: '#2d0a1e', color: '#f43f5e' },
  GMAIL_ERROR:  { label: 'Gmail Error',  bg: '#2d0a1e', color: '#f43f5e' },
  AI_ERROR:     { label: 'AI Error',     bg: '#2d1b00', color: '#f59e0b' },
};

function Badge({ type, text }) {
  const cfg = ERROR_BADGE[type] || { label: text || type, bg: '#1e293b', color: '#94a3b8' };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
      {cfg.label || text || type}
    </span>
  );
}

function StatusDot({ status }) {
  return (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status] || '#475569', marginRight: 6 }} />
  );
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel() {
  const [tab, setTab]           = useState('sessions');
  const [sessions, setSessions] = useState([]);
  const [failures, setFailures] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionLogs, setSessionLogs]         = useState([]);
  const [expandedLog, setExpandedLog]         = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, f] = await Promise.all([emailAPI.sessions(), emailAPI.failures()]);
      setSessions(s.data.sessions || []);
      setFailures(f.data.failures || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function openSession(session) {
    setSelectedSession(session);
    setSessionLogs([]);
    try {
      const r = await emailAPI.sessionLogs(session.id);
      setSessionLogs(r.data.logs || []);
    } catch (e) { console.error(e); }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#94a3b8' }}>
      Loading sync logs…
    </div>
  );

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'Calibri, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>⚙ Sync Admin Panel</h2>
        <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
          Every email/PDF parse attempt is logged here. Use this to diagnose why a CAS sync failed.
        </p>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Sessions', value: sessions.length, color: '#0ea5e9' },
          { label: 'Successful',     value: sessions.filter(s => s.status === 'completed').length, color: '#00d4a1' },
          { label: 'Failed',         value: sessions.filter(s => s.status === 'failed').length,    color: '#f43f5e' },
          { label: 'Parse Failures', value: failures.length, color: '#f59e0b' },
        ].map(stat => (
          <div key={stat.label} style={{ background: '#131f35', border: `1px solid #1e3a5f`, borderRadius: 8, padding: '12px 20px', flex: 1 }}>
            <div style={{ color: stat.color, fontSize: 26, fontWeight: 700 }}>{stat.value}</div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #1e3a5f', paddingBottom: 0 }}>
        {[
          { id: 'sessions', label: `📋 Sessions (${sessions.length})` },
          { id: 'failures', label: `❌ Failures (${failures.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#1e3a5f' : 'transparent',
            color: tab === t.id ? '#00d4a1' : '#64748b',
            border: 'none', borderBottom: tab === t.id ? '2px solid #00d4a1' : '2px solid transparent',
            padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sessions Tab ── */}
      {tab === 'sessions' && (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Session list */}
          <div style={{ flex: '0 0 360px' }}>
            {sessions.length === 0 ? (
              <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No sync sessions yet.<br/>Click "Sync CAS" to start.</div>
            ) : sessions.map(s => (
              <div key={s.id}
                onClick={() => openSession(s)}
                style={{
                  background: selectedSession?.id === s.id ? '#1e3a5f' : '#131f35',
                  border: `1px solid ${selectedSession?.id === s.id ? '#0ea5e9' : '#1e3a5f'}`,
                  borderRadius: 8, padding: '12px 16px', marginBottom: 8, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <StatusDot status={s.status} />
                    <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{fmt(s.started_at)}</span>
                  </div>
                  <Badge type={s.status} text={s.status} />
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  {[
                    ['Scanned', s.emails_scanned],
                    ['Parsed',  s.emails_parsed],
                    ['Failed',  s.emails_failed],
                    ['Holdings',s.holdings_found],
                  ].map(([l, v]) => (
                    <div key={l} style={{ textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>{l}</div>
                      <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{v ?? 0}</div>
                    </div>
                  ))}
                </div>
                {s.error_message && (
                  <div style={{ marginTop: 8, color: '#f43f5e', fontSize: 11, fontFamily: 'monospace', background: '#1a0a0e', padding: '4px 8px', borderRadius: 4 }}>
                    {s.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Session detail */}
          <div style={{ flex: 1 }}>
            {!selectedSession ? (
              <div style={{ color: '#475569', textAlign: 'center', padding: 60 }}>← Click a session to see its logs</div>
            ) : (
              <>
                <div style={{ background: '#131f35', border: '1px solid #1e3a5f', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>SESSION DETAIL</div>
                  <div style={{ color: '#e2e8f0', fontSize: 13 }}>
                    ID: <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{selectedSession.id}</span>
                  </div>
                  {selectedSession.summary && (
                    <div style={{ marginTop: 8, color: '#64748b', fontSize: 12, fontFamily: 'monospace', background: '#0b1120', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                      {JSON.stringify(selectedSession.summary, null, 2)}
                    </div>
                  )}
                </div>

                {sessionLogs.length === 0 ? (
                  <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No logs for this session.</div>
                ) : sessionLogs.map(log => (
                  <div key={log.id} style={{
                    background: '#0d1b2a', border: `1px solid ${log.status === 'success' ? '#00d4a120' : log.status === 'skipped' ? '#47556920' : '#f43f5e20'}`,
                    borderLeft: `3px solid ${STATUS_COLOR[log.status] || '#475569'}`,
                    borderRadius: 8, padding: '10px 14px', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <StatusDot status={log.status} />
                          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                            {log.email_subject || '(no subject)'}
                          </span>
                          {log.error_type && <Badge type={log.error_type} />}
                          {log.has_pdf && <span style={{ color: '#0ea5e9', fontSize: 10, fontWeight: 700 }}>PDF</span>}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
                          From: {log.email_from} · {fmt(log.logged_at)}
                          {log.items_found > 0 && <span style={{ color: '#00d4a1', marginLeft: 8 }}>✓ {log.items_found} items</span>}
                        </div>
                        {log.error_message && (
                          <div style={{ marginTop: 6, color: '#f43f5e', fontSize: 12, background: '#1a0a0e', padding: '4px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                            {log.error_message}
                          </div>
                        )}
                        {log.pdf_filename && (
                          <div style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>
                            PDF: {log.pdf_filename} · {log.pdf_unlocked ? <span style={{ color: '#00d4a1' }}>Unlocked</span> : <span style={{ color: '#f59e0b' }}>Locked</span>}
                          </div>
                        )}
                      </div>
                      {(log.raw_text_snippet || log.error_stack) && (
                        <button onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                          style={{ background: '#1e3a5f', color: '#94a3b8', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {expandedLog === log.id ? 'Hide' : 'Debug ▾'}
                        </button>
                      )}
                    </div>

                    {expandedLog === log.id && (
                      <div style={{ marginTop: 10, background: '#060e1a', borderRadius: 4, padding: '10px 12px' }}>
                        {log.raw_text_snippet && (
                          <>
                            <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>RAW TEXT SNIPPET</div>
                            <pre style={{ color: '#94a3b8', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{log.raw_text_snippet}</pre>
                          </>
                        )}
                        {log.error_stack && (
                          <>
                            <div style={{ color: '#f43f5e', fontSize: 10, fontWeight: 700, margin: '8px 0 4px' }}>STACK TRACE</div>
                            <pre style={{ color: '#f87171', fontSize: 9, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{log.error_stack}</pre>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Failures Tab ── */}
      {tab === 'failures' && (
        <div>
          {failures.length === 0 ? (
            <div style={{ color: '#475569', textAlign: 'center', padding: 60 }}>
              No failures recorded. Great!
            </div>
          ) : (
            <>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
                Showing last 50 failures across all sessions. Use the "Debug" button to inspect raw text and stack traces.
              </div>
              {failures.map(log => (
                <div key={log.id} style={{
                  background: '#0d1b2a', border: '1px solid #2d1b1b',
                  borderLeft: `3px solid ${STATUS_COLOR[log.status] || '#f43f5e'}`,
                  borderRadius: 8, padding: '12px 16px', marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <Badge type={log.error_type} />
                        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                          {log.email_subject || '(no subject)'}
                        </span>
                      </div>
                      <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', marginBottom: 4 }}>
                        {fmt(log.logged_at)} · From: {log.email_from || '—'}
                        {log.pdf_filename && ` · PDF: ${log.pdf_filename}`}
                      </div>
                      <div style={{ color: '#f43f5e', fontSize: 12, background: '#1a0a0e', padding: '4px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                        {log.error_message}
                      </div>

                      {/* Fix suggestions */}
                      <div style={{ marginTop: 8 }}>
                        {log.error_type === 'PDF_LOCKED' && (
                          <div style={{ color: '#f59e0b', fontSize: 11, background: '#1c1200', padding: '4px 10px', borderRadius: 4 }}>
                            💡 Fix: Go to Profile Settings and enter your PAN + Date of Birth. Gemini AI uses these to generate the PDF password.
                          </div>
                        )}
                        {log.error_type === 'NO_ISIN' && (
                          <div style={{ color: '#0ea5e9', fontSize: 11, background: '#0a1628', padding: '4px 10px', borderRadius: 4 }}>
                            💡 Fix: PDF was opened but no ISIN codes found. This may be a non-standard CAS format — expand Debug to see raw text.
                          </div>
                        )}
                        {log.error_type === 'NO_PDF' && (
                          <div style={{ color: '#64748b', fontSize: 11, background: '#0d1a2a', padding: '4px 10px', borderRadius: 4 }}>
                            ℹ️ This email had no PDF attachment. CAS from this sender is usually a PDF — check your email directly.
                          </div>
                        )}
                        {log.error_type === 'GMAIL_ERROR' && (
                          <div style={{ color: '#f43f5e', fontSize: 11, background: '#1a0a0e', padding: '4px 10px', borderRadius: 4 }}>
                            💡 Fix: Gmail OAuth may have expired. Disconnect and reconnect your Gmail account.
                          </div>
                        )}
                      </div>
                    </div>
                    {(log.raw_text_snippet || log.error_stack) && (
                      <button onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                        style={{ background: '#1e3a5f', color: '#94a3b8', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', marginLeft: 12, whiteSpace: 'nowrap' }}>
                        {expandedLog === log.id ? 'Hide' : 'Debug ▾'}
                      </button>
                    )}
                  </div>

                  {expandedLog === log.id && (
                    <div style={{ marginTop: 10, background: '#060e1a', borderRadius: 4, padding: '10px 12px' }}>
                      {log.raw_text_snippet && (
                        <>
                          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>RAW TEXT SNIPPET (first 500 chars)</div>
                          <pre style={{ color: '#94a3b8', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{log.raw_text_snippet}</pre>
                        </>
                      )}
                      {log.error_stack && (
                        <>
                          <div style={{ color: '#f43f5e', fontSize: 10, fontWeight: 700, margin: '10px 0 4px' }}>STACK TRACE</div>
                          <pre style={{ color: '#f87171', fontSize: 9, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{log.error_stack}</pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
