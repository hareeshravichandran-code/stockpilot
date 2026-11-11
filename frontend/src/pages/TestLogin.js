import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI, testAPI } from '../lib/api';

// /test-login#k=<secret>: signs in to the private test account. The key sits in the URL fragment,
// so it never reaches server logs; it is removed from the address bar straight away.
export default function TestLogin() {
  const { loginWithToken } = useAuth();
  const nav = useNavigate();
  const [msg, setMsg] = useState('Signing in to the test account…');
  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get('k') || '';
    window.history.replaceState(null, '', '/test-login');
    if (!key) { setMsg('This link is missing its key.'); return; }
    authAPI.testLink(key)
      .then(r => { loginWithToken(r.data.token, r.data.user); nav('/dashboard', { replace: true }); })
      .catch(e => setMsg(e.response?.data?.error || 'This link did not work.'));
  }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #F5F1E8)', fontFamily: 'inherit' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🧪</div>
        <div style={{ fontSize: 16 }}>{msg}</div>
      </div>
    </div>
  );
}

// A small floating bar shown only to the test account: reset masters, reset everything, re-add dummy data.
export function TestAccountBar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  if (!user?.is_test) return null;
  const run = async (label, fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label); setNote('');
    try { await fn(); setNote(`${label}: done. Reloading…`); setTimeout(() => window.location.reload(), 700); }
    catch (e) { setNote(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };
  const btn = { display: 'block', width: '100%', margin: '6px 0 0', padding: '8px 10px', borderRadius: 10, border: '1px solid #E2DBCC',
    background: '#FBF9F4', cursor: 'pointer', textAlign: 'left', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 9999, fontSize: 13 }}>
      {open && (
        <div style={{ width: 240, marginBottom: 8, padding: 12, borderRadius: 14, background: '#F5F1E8', border: '1px solid #E2DBCC', boxShadow: '0 8px 24px rgba(40,30,20,.18)' }}>
          <b>Test account</b>
          <div style={{ color: '#85817A', fontSize: 12 }}>Only this account sees this.</div>
          <button style={btn} disabled={!!busy} onClick={() => run('Reset masters', () => testAPI.reset('masters'),
            'Delete all masters, events, rules and the special Blueprint cards? Setup can then run again.')}>↺ Reset masters</button>
          <button style={btn} disabled={!!busy} onClick={() => run('Reset everything', () => testAPI.reset('all'),
            'Delete everything in the test account and start again with the dummy stocks and funds?')}>⟲ Reset everything</button>
          <button style={btn} disabled={!!busy} onClick={() => run('Dummy data', () => testAPI.seed())}>＋ Re-add dummy stocks and funds</button>
          {busy && <div style={{ marginTop: 6 }}>{busy}…</div>}
          {note && <div style={{ marginTop: 6 }}>{note}</div>}
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} style={{ padding: '6px 12px', borderRadius: 999, border: 0, background: '#6F6A61', color: '#fff', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
        🧪 TEST
      </button>
    </div>
  );
}
