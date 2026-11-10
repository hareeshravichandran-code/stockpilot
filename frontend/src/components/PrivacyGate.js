import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { privacyAPI } from '../lib/api';
import { vault, createKeys, unlockKeys, onVaultChange, keysFromServerDek } from '../lib/privacy/vault';
import { backupToDrive, dekFromDrive, driveToken, saveSecret, loadGis } from '../lib/privacy/drive';
import { migrateAll, MIGRATION_V } from '../lib/privacy/migrate';
import { isEnc } from '../lib/privacy/kcrypto';
import './PrivacyGate.css';

// Every account is end-to-end encrypted. Before any money page opens, this browser must hold the key.
// First time: the key is made here and kept in the user's own Google account (no passphrase to remember);
// a passphrase is the alternative. New browser: one tap on "Unlock with Google" (or the recovery code).
export default function PrivacyGate({ children }) {
  const { user, refresh } = useAuth();
  const [state, setState] = useState({ phase: 'loading' });
  const [, force] = useState(0);
  useEffect(() => onVaultChange(() => force(n => n + 1)), []);
  useEffect(() => { loadGis().catch(() => {}); }, []);   // ready before the Google button is pressed (popup blockers)
  // Once unlocked: read the profile again (name, PAN, birthday come back encrypted until now)
  const unlocked = vault.unlocked();
  useEffect(() => {
    if (!unlocked) return;
    refresh?.().then(me => { if (me?.name) vault.setSelf(me.name); });
  }, [unlocked]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      try {
        const has = await vault.load(user.id, isEnc(user.name) ? '' : (user.name || ''));
        const { data } = await privacyAPI.keys();
        if (!alive) return;
        if (!data.ready && !data.required) setState({ phase: 'skip' });
        else if (!data.ready) setState({ phase: 'intro', server: data });
        else if (!has) setState({ phase: 'unlock', server: data });
        else if (!data.migrated_at || (data.migrated_v || 0) < MIGRATION_V) setState({ phase: 'migrate', server: data });
        else setState({ phase: 'open' });
      } catch (e) {
        if (alive) setState({ phase: 'error', error: e.response?.data?.error || e.message });
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (state.phase === 'skip' || (state.phase === 'open' && vault.unlocked())) return children;
  if (state.phase === 'open' && !vault.unlocked()) return <Shell><Unlock server={state.server} onDone={() => setState({ phase: 'open' })} /></Shell>;
  return (
    <Shell>
      {state.phase === 'loading' && <p className="pg-muted">Checking your privacy key…</p>}
      {state.phase === 'error' && <><h1>Could not check your key</h1><p className="pg-err">{state.error}</p><button className="pg-btn" onClick={() => window.location.reload()}>Try again</button></>}
      {state.phase === 'intro' && <Intro user={user} onPassphrase={() => setState({ ...state, phase: 'create' })} onDone={(code) => setState({ phase: 'saved', code })} />}
      {state.phase === 'saved' && <Saved code={state.code} onDone={() => setState({ phase: 'migrate' })} />}
      {state.phase === 'create' && <Create user={user} onDone={(code, dek) => setState({ phase: 'code', code, dek })} />}
      {state.phase === 'code' && <Code code={state.code} dek={state.dek} user={user} onDone={() => setState({ phase: 'migrate' })} />}
      {state.phase === 'unlock' && <Unlock server={state.server} onDone={(srv) => setState({ phase: srv?.migrated_at && (srv.migrated_v || 0) >= MIGRATION_V ? 'open' : 'migrate' })} />}
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

function Intro({ user, onPassphrase, onDone }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  // The key is made in this browser; its unlock secret goes to the user's own Google Drive (hidden app folder)
  const viaGoogle = async () => {
    setBusy(true); setErr('');
    try {
      const token = await driveToken(user.email);
      const secret = await saveSecret(token, user.id);
      const { body, code, keys } = await createKeys(null, { driveSecret: secret });
      await privacyAPI.create(body);
      await vault.remember(user.id, keys, isEnc(user.name) ? '' : (user.name || ''));
      onDone(code);
    } catch (e) { setErr(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <h1>Your money data, only for you</h1>
      <p>Kanalyst encrypts the private parts of your data on your own device before it is saved: who you pay, SMS text, account, card,
        policy and folio numbers, notes and names. Not even the Kanalyst team can read them.</p>
      <ul className="pg-list">
        <li><b>Nothing to remember.</b> Your key is kept in your own Google account, in a hidden Kanalyst folder.</li>
        <li><b>New phone or browser?</b> Sign in with Google and tap once. Android phones restored from your old phone open by themselves.</li>
        <li>Amounts, dates and categories stay readable to the server so calendars, alerts and Blueprint keep working.</li>
      </ul>
      {err && <p className="pg-err">{err}. You can use a passphrase instead.</p>}
      <button className="pg-btn" disabled={busy} onClick={viaGoogle}>{busy ? 'Saving your key…' : 'Keep my key in my Google account'}</button>
      <button type="button" className="pg-link" onClick={onPassphrase}>Use a passphrase instead</button>
    </>
  );
}

/** After the Google set-up: the recovery code is an optional spare key. */
function Saved({ code, onDone }) {
  const [show, setShow] = useState(false);
  const save = () => {
    const blob = new Blob([`Kanalyst recovery code\n\n${code}\n\nA spare key: unlocks your data if you ever lose access to your Google account.\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kanalyst-recovery-code.txt'; a.click();
  };
  return (
    <>
      <h1>Your data is protected</h1>
      <p className="pg-muted">Your key is kept in your Google account. On a new phone or browser, sign in with Google and tap “Unlock with Google”.</p>
      {!show ? <button type="button" className="pg-link" onClick={() => setShow(true)}>Want a spare key? Show my recovery code</button> : (
        <div className="pg-drive">
          <b>Recovery code (optional)</b>
          <span>Only needed if you ever lose access to your Google account. Keep it somewhere safe.</span>
          <div className="pg-code">{code}</div>
          <div className="pg-row">
            <button type="button" className="pg-btn ghost" onClick={() => navigator.clipboard?.writeText(code)}>Copy</button>
            <button type="button" className="pg-btn ghost" onClick={save}>Download</button>
          </div>
        </div>
      )}
      <button className="pg-btn" onClick={onDone}>Continue</button>
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
      const { body, code, keys, dek } = await createKeys(p1);
      await privacyAPI.create(body);
      await vault.remember(user.id, keys, user.name || '');
      onDone(code, dek);
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

function Code({ code, dek, user, onDone }) {
  const [ok, setOk] = useState(false);
  const [drive, setDrive] = useState(''); const [dErr, setDErr] = useState('');
  const toDrive = async () => {
    setDrive('busy'); setDErr('');
    try { await backupToDrive(user.id, user.email, dek); setDrive('done'); } catch (e) { setDrive(''); setDErr(e.message); }
  };
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
      <div className="pg-drive">
        <b>Also keep a backup in my Google Drive</b>
        <span>Unlock a new phone or browser by just picking your Google account. Kanalyst cannot open it on its own.</span>
        {drive === 'done' ? <em>✓ Backed up to Google Drive</em>
          : <button type="button" className="pg-btn ghost" disabled={drive === 'busy'} onClick={toDrive}>{drive === 'busy' ? 'Saving…' : 'Back up to Google Drive'}</button>}
        {dErr && <p className="pg-err">{dErr}</p>}
      </div>
      <label className="pg-check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I have saved my recovery code</label>
      <button className="pg-btn" disabled={!ok} onClick={onDone}>Continue</button>
    </>
  );
}

function Unlock({ server: given, onDone }) {
  const [server, setServer] = useState(given || null);
  useEffect(() => { if (!server) privacyAPI.keys().then(r => setServer(r.data)).catch(() => {}); }, [server]);
  const [secret, setSecret] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const viaDrive = async () => {
    setBusy(true); setErr('');
    try {
      const srv = server || (await privacyAPI.keys()).data;
      const u = JSON.parse(localStorage.getItem('sp_user') || '{}');
      const { keys } = await keysFromServerDek(srv, await dekFromDrive(srv, u.email));
      if (remember) await vault.remember(u.id, keys, u.name || ''); else vault.hold(u.id, keys, u.name || '');
      onDone(srv);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
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
  const hasPass = !!server?.wrap_pass;
  const google = !!server?.wrap_drive;
  return (
    <form onSubmit={go}>
      <h1>Unlock your data</h1>
      {google && <>
        <p className="pg-muted">Your key is kept in your Google account. Pick the same Google account you used before.</p>
        <button type="button" className="pg-btn" disabled={busy} onClick={viaDrive}>{busy ? 'Unlocking…' : 'Unlock with Google'}</button>
        <div className="pg-or"><span>or</span></div>
      </>}
      {!hasPass && !useCode && <button type="button" className="pg-link" onClick={() => { setUseCode(true); setSecret(''); setErr(''); }}>Use my recovery code</button>}
      {(hasPass || useCode) && <>
      <p className="pg-muted">{useCode ? 'Enter your 24-character recovery code.' : 'Enter your privacy passphrase. You only do this once on this browser.'}</p>
      <input className="pg-in" type={useCode ? 'text' : 'password'} autoFocus placeholder={useCode ? 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' : 'Privacy passphrase'}
        value={secret} onChange={e => setSecret(e.target.value)} />
      <label className="pg-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember this browser</label>
      {err && <p className="pg-err">{err}</p>}
      <button className={google ? 'pg-btn ghost' : 'pg-btn'} disabled={busy || !secret}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      {hasPass && <button type="button" className="pg-link" onClick={() => { setUseCode(!useCode); setSecret(''); setErr(''); }}>
        {useCode ? 'Use my passphrase instead' : 'Forgot it? Use my recovery code'}</button>}
      </>}
      {err && !(hasPass || useCode) && <p className="pg-err">{err}</p>}
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
