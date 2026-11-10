import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { privacyAPI } from '../lib/api';
import { vault, unlockKeys } from '../lib/privacy/vault';
import { backupToDrive } from '../lib/privacy/drive';
import * as K from '../lib/privacy/kcrypto';
import '../components/PrivacyGate.css';

// Public page: what Kanalyst can and cannot see. Signed-in users also get their privacy controls here.
export default function Privacy() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="pg-page" style={{ alignItems: 'start' }}>
      <div className="pg-card" style={{ maxWidth: 720 }}>
        <button className="pg-link" style={{ margin: 0 }} onClick={() => nav(user ? '/dashboard' : '/')}>← Back</button>
        <h1>Privacy at Kanalyst</h1>
        <p>Your private details are encrypted on your own phone or browser, with a key only you hold, before they are saved.
          The Kanalyst team cannot read them, and neither could anyone who got a copy of our database.</p>
        <table className="pv-table"><tbody>
          <tr><th>Encrypted, only you can read</th><td>Who you pay and who pays you, SMS text, full account / folio / PRAN / PAN numbers, your name, birthday and mobile, master and goal names, nominees, notes and comments, statement text</td></tr>
          <tr><th>Readable to the server</th><td>Amounts, dates, categories and statuses; bank, AMC and insurer names; the last 4 digits of account, card, folio and policy numbers (as on a bank SMS) — so calendars, alerts, money flow and Blueprint can work</td></tr>
          <tr><th>Used, never stored</th><td>To open your CAS and NPS statements and plan by age, your device hands the server your PAN, birthday and name for that one request</td></tr>
          <tr><th>Anonymous fingerprints</th><td>Codes that say "same payee as before" or "mentions EMI" without saying who</td></tr>
          <tr><th>Stays on your phone</th><td>Your SMS inbox. Only the transactions read from it are saved</td></tr>
          <tr><th>Only if you choose</th><td>Diagnostics and "Help improve SMS reading" send masked messages to the Kanalyst team, and only when you turn them on</td></tr>
        </tbody></table>
        <p className="pg-muted">Your key is unlocked by your privacy passphrase, or by your recovery code. We never see either, so we cannot reset them.
          You can also keep a backup in your own Google Drive: Drive holds half, Kanalyst holds the other half, and neither can open it alone.
          If all of these are lost, encrypted details cannot be recovered (amounts and dates remain).</p>
        {user && <Controls user={user} onDeleted={() => { logout?.(); nav('/'); }} />}
      </div>
    </div>
  );
}

function Controls({ user, onDeleted }) {
  const [msg, setMsg] = useState('');
  const [p1, setP1] = useState(''); const [cur, setCur] = useState('');
  const [code, setCode] = useState('');
  const change = async (kind) => {
    setMsg('');
    try {
      const { data: srv } = await privacyAPI.keys();
      const { dek } = await unlockKeys(srv, cur);
      if (kind === 'pass') {
        if (p1.length < 8) return setMsg('Use at least 8 characters.');
        await privacyAPI.update({ wrap_pass: await K.wrapDek(p1, dek) }); setMsg('Passphrase changed.'); setP1('');
      } else if (kind === 'drive') {
        await backupToDrive(user.id, user.email, dek); setMsg('Your key is backed up to your Google Drive.');
      } else {
        const c = K.newRecoveryCode();
        await privacyAPI.update({ wrap_recovery: await K.wrapDek(c, dek, 100000) }); setCode(c); setMsg('New recovery code made. The old one no longer works.');
      }
      setCur('');
    } catch (e) { setMsg(e.response?.data?.error || e.message); }
  };
  const del = async () => {
    if (!window.confirm('Delete your Kanalyst account and all its data? This cannot be undone.')) return;
    if (window.prompt('Type DELETE to confirm') !== 'DELETE') return;
    await privacyAPI.deleteAccount(); await vault.forget(); onDeleted();
  };
  return (
    <div className="pv-controls">
      <h2>Your controls</h2>
      <p className="pg-muted">Signed in as {user.email}. This browser is {vault.unlocked() ? 'unlocked' : 'locked'}.</p>
      <button className="pg-btn ghost" onClick={async () => { await vault.forget(); setMsg('This browser is locked. You will be asked for your passphrase next time.'); }}>Lock this browser</button>
      <h3>Change passphrase or recovery code</h3>
      <input className="pg-in" type="password" placeholder="Current passphrase or recovery code" value={cur} onChange={e => setCur(e.target.value)} />
      <input className="pg-in" type="password" placeholder="New passphrase" value={p1} onChange={e => setP1(e.target.value)} />
      <div className="pg-row">
        <button className="pg-btn" disabled={!cur || !p1} onClick={() => change('pass')}>Change passphrase</button>
        <button className="pg-btn ghost" disabled={!cur} onClick={() => change('code')}>New recovery code</button>
      </div>
      <button className="pg-btn ghost" disabled={!cur} onClick={() => change('drive')}>Back up key to my Google Drive</button>
      <button className="pg-link" onClick={async () => { await privacyAPI.removeBackup(); setMsg('Google Drive backup turned off.'); }}>Turn off Google Drive backup</button>
      {code && <div className="pg-code">{code}</div>}
      {msg && <p className="pg-muted">{msg}</p>}
      <h3>Delete account</h3>
      <p className="pg-muted">Deletes your account and every record we hold for it.</p>
      <button className="pg-btn" style={{ background: '#a82c2c' }} onClick={del}>Delete my account and data</button>
    </div>
  );
}
