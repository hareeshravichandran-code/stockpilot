import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { privacyAPI } from '../lib/api';
import { vault, createKeys, unlockKeys, onVaultChange } from '../lib/privacy/vault';
import { migrateAll } from '../lib/privacy/migrate';
import './PrivacyGate.css';

// Every account is end-to-end encrypted. Before any money page opens, this browser must hold the key:
// first time -> choose a passphrase and save the recovery code; new browser -> unlock once.
export default function PrivacyGate({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ phase: 'loading' });
  const [, force] = useState(0);
  useEffect(() => onVaultChange(() => force(n => n + 1)), []);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      try {
        const has = await vault.load(user.id, user.name || '');
        const { data } = await privacyAPI.keys();
        if (!alive) return;
        if (!data.ready && !data.required) setState({ phase: 'skip' });
        else if (!data.ready) setState({ phase: 'intro', server: data });
        else if (!has) setState({ phase: 'unlock', server: data });
        else if (!data.migrated_at) setState({ phase: 'migrate', server: data });
        else setState({ phase: 'open' });
      } catch (e) {
        if (alive) setState({ phase: 'error', error: e.response?.data?.error || e.message });
      }
    })();
    return () => { alive = false; };
  }, [user?.id, user?.name]);

  if (state.phase === 'skip' || (state.phase === 'open' && vault.unlocked())) return children;
  if (state.phase === 'open' && !vault.unlocked()) return <Shell><Unlock server={state.server} onDone={() => setState({ phase: 'open' })} /></Shell>;
  return (
    <Shell>
      {state.phase === 'loading' && <p className="pg-muted">Checking your privacy key…</p>}
      {state.phase === 'error' && <><h1>Could not check your key</h1><p className="pg-err">{state.error}</p><button className="pg-btn" onClick={() => window.location.reload()}>Try again</button></>}
      {state.phase === 'intro' && <Intro onNext={() => setState({ ...state, phase: 'create' })} />}
      {state.phase === 'create' && <Create user={user} onDone={(code) => setState({ phase: 'code', code })} />}
      {state.phase === 'code' && <Code code={state.code} onDone={() => setState({ phase: 'migrate' })} />}
      {state.phase === 'unlock' && <Unlock server={state.server} onDone={(srv) => setState({ phase: srv?.migrated_at ? 'open' : 'migrate' })} />}
      {state.phase === 'migrate' && <Migrate onDone={() => setState({ phase: 'open' })} />}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="pg-page">
      <div className="pg-card">
        <div className="pg-lock" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="56" height="56"><rect x="12" y="28" width="40" height="28" rx="8" fill="#2b2620" /><path d="M20 28v-7a12 12 0 0 1 24 0v7" stroke="#2b2620" strokeWidth="6" fill="none" strokeLinecap="round" /><circle cx="32" cy="41" r="4.5" fill="#f2b544" /><rect x="30" y="43" width="4" height="7" rx="2" fill="#f2b544" /></svg>
        </div>
        {children}
      </div>
    </div>
  );
}

function Intro({ onNext }) {
  return (
    <>
      <h1>Your money data, only for you</h1>
      <p>Kanalyst now encrypts the private parts of your data on your own device before it is saved: who you pay, SMS text, account, card,
        policy and folio numbers, notes and names. Not even the Kanalyst team can read them.</p>
      <ul className="pg-list">
        <li><b>A privacy passphrase</b> unlocks your data on each new phone or browser, once.</li>
        <li><b>A recovery code</b> is your spare key if you ever forget the passphrase.</li>
        <li>Amounts, dates and categories stay readable to the server so calendars, alerts and Blueprint keep working.</li>
      </ul>
      <button className="pg-btn" onClick={onNext}>Set my passphrase</button>
    </>
  );
}

const strength = (p) => { let s = 0; if (p.length >= 10) s++; if (p.length >= 14) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p) || /\s/.test(p)) s++; return s; };

function Create({ user, onDone }) {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const s = strength(p1);
  const go = async (e) => {
    e.preventDefault();
    if (p1.length < 8) return setErr('Use at least 8 characters. A short sentence is easy to remember.');
    if (p1 !== p2) return setErr('The two passphrases are different.');
    setBusy(true); setErr('');
    try {
      const { body, code, keys } = await createKeys(p1);
      await privacyAPI.create(body);
      await vault.remember(user.id, keys, user.name || '');
      onDone(code);
    } catch (e2) { setErr(e2.response?.data?.error || e2.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go}>
      <h1>Choose a privacy passphrase</h1>
      <p className="pg-muted">It is different from your login. We never see it, so we cannot reset it for you.</p>
      <input className="pg-in" type="password" autoFocus placeholder="Passphrase (e.g. a short sentence)" value={p1} onChange={e => setP1(e.target.value)} />
      <div className="pg-meter"><i style={{ width: `${Math.min(100, s * 20)}%`, background: s >= 4 ? '#4c6b1c' : s >= 2 ? '#f2b544' : '#a82c2c' }} /></div>
      <input className="pg-in" type="password" placeholder="Type it again" value={p2} onChange={e => setP2(e.target.value)} />
      {err && <p className="pg-err">{err}</p>}
      <button className="pg-btn" disabled={busy}>{busy ? 'Creating your key…' : 'Create my key'}</button>
    </form>
  );
}

function Code({ code, onDone }) {
  const [ok, setOk] = useState(false);
  const save = () => {
    const blob = new Blob([`Kanalyst recovery code\n\n${code}\n\nKeep this safe. With it you can unlock your data if you forget your privacy passphrase.\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kanalyst-recovery-code.txt'; a.click();
  };
  return (
    <>
      <h1>Save your recovery code</h1>
      <p className="pg-muted">If you forget your passphrase, this code is the only other way in. Write it down or save it somewhere safe.</p>
      <div className="pg-code">{code}</div>
      <div className="pg-row">
        <button type="button" className="pg-btn ghost" onClick={() => navigator.clipboard?.writeText(code)}>Copy</button>
        <button type="button" className="pg-btn ghost" onClick={save}>Download</button>
      </div>
      <label className="pg-check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I have saved my recovery code</label>
      <button className="pg-btn" disabled={!ok} onClick={onDone}>Continue</button>
    </>
  );
}

function Unlock({ server, onDone }) {
  const [secret, setSecret] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const srv = server || (await privacyAPI.keys()).data;
      const { keys } = await unlockKeys(srv, secret);
      const u = JSON.parse(localStorage.getItem('sp_user') || '{}');
      if (remember) await vault.remember(u.id, keys, u.name || '');
      else vault.hold(u.id, keys, u.name || '');
      onDone(srv);
    } catch (e2) { setErr(e2.response?.data?.error || e2.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go}>
      <h1>Unlock your data</h1>
      <p className="pg-muted">{useCode ? 'Enter your 24-character recovery code.' : 'Enter your privacy passphrase. You only do this once on this browser.'}</p>
      <input className="pg-in" type={useCode ? 'text' : 'password'} autoFocus placeholder={useCode ? 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' : 'Privacy passphrase'}
        value={secret} onChange={e => setSecret(e.target.value)} />
      <label className="pg-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember this browser</label>
      {err && <p className="pg-err">{err}</p>}
      <button className="pg-btn" disabled={busy || !secret}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      <button type="button" className="pg-link" onClick={() => { setUseCode(!useCode); setSecret(''); setErr(''); }}>
        {useCode ? 'Use my passphrase instead' : 'Forgot it? Use my recovery code'}</button>
    </form>
  );
}

function Migrate({ onDone }) {
  const [n, setN] = useState(0); const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    migrateAll(d => alive && setN(d)).then(() => alive && onDone()).catch(e => alive && setErr(e.response?.data?.error || e.message));
    return () => { alive = false; };
  }, [onDone]);
  return (
    <>
      <h1>Encrypting your data</h1>
      <p className="pg-muted">This happens once. Your existing records are being locked with your key.</p>
      <div className="pg-spin" /><p className="pg-count">{n} records encrypted</p>
      {err && <><p className="pg-err">{err}</p><button className="pg-btn" onClick={() => window.location.reload()}>Try again</button></>}
    </>
  );
}
