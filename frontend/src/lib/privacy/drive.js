// Automatic key backup in the user's own Google Drive (hidden app folder, only Kanalyst can see it there).
// Two halves, neither enough alone:
//   Google Drive  holds a random backup secret
//   Kanalyst      holds the key locked with that secret (enc_wrap_drive)
// The browser talks to Drive directly, so the Kanalyst server never gets Drive access.
import * as K from './kcrypto';
import { privacyAPI } from '../api';

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '530143058705-fi42mdsqe8dhb03b42tii67r9n6mejl9.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const LEGACY = 'kanalyst-key-backup.json';          // 1.9.0-1.9.1: one file for every Kanalyst account
const fileFor = (uid) => `kanalyst-key-${uid}.json`;  // one file per Kanalyst account (several can share a Google account)

export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not reach Google'));
    document.head.appendChild(s);
  });
}

/** A short-lived Drive token from a Google popup (the user picks their account). */
export async function driveToken(hint) {
  await loadGis();
  return new Promise((res, rej) => {
    const c = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, hint,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        // Google may show the Drive permission as a separate tick box: make sure it was ticked
        if (window.google.accounts.oauth2.hasGrantedAllScopes && !window.google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE))
          return rej(new Error('Please tick the Google Drive box ("Kanalyst\'s own configuration data") in the Google window'));
        res(r.access_token);
      },
      error_callback: (e) => rej(new Error(e?.message || 'Google sign-in was closed')),
    });
    c.requestAccessToken({ prompt: '' });
  });
}

/** Google's own reason, in plain words. */
export function driveReason(status, body) {
  let j = {}; try { j = JSON.parse(body || '{}'); } catch { j = {}; }
  const e = j.error || {};
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || (e.details && e.details[0] && e.details[0].reason) || e.status || '';
  const msg = String(e.message || '');
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + msg)) return 'The Google Drive API is turned off for Kanalyst in Google Cloud (Drive API not enabled)';
  if (/insufficient|SCOPE/i.test(reason + msg)) return 'Google did not give Drive access. Tick the Google Drive box in the Google window';
  if (status === 401) return 'Google sign-in expired. Try again';
  return `Google Drive error ${status}${reason ? ' (' + reason + ')' : ''}${msg ? ': ' + msg.slice(0, 160) : ''}`;
}
const gfetch = async (token, url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(driveReason(r.status, await r.text().catch(() => '')));
  return r;
};
async function findFile(token, name) {
  const q = encodeURIComponent(`name='${name}'`);
  const r = await gfetch(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return (await r.json()).files?.[0]?.id || null;
}

/** Save a new random backup secret in the user's Drive and return it. */
export async function saveSecret(token, uid) {
  const secret = K.b64u.enc(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const content = JSON.stringify({ v: 1, uid, secret, made: new Date().toISOString() });
  const existing = await findFile(token, fileFor(uid));
  const boundary = 'kb' + Date.now();
  const meta = existing ? {} : { name: fileFor(uid), parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const url = existing ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await gfetch(token, url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return secret;
}

/** Turn on the backup for an existing key. Needs the raw key (after the passphrase / recovery code). */
export async function backupToDrive(uid, email, dek) {
  const secret = await saveSecret(await driveToken(email), uid);
  // The secret is random and long, so few rounds are enough
  await privacyAPI.backup({ wrap_drive: await K.wrapDek(secret, dek, 1000) });
}

/** New browser: read the secret from Drive and open the key with it. Returns the raw DEK. */
export async function dekFromDrive(server, email) {
  if (!server?.wrap_drive) throw new Error('No Google Drive backup is turned on for this account');
  const token = await driveToken(email);
  const uid = JSON.parse(localStorage.getItem('sp_user') || '{}').id;
  return K.unwrapDek(await readSecret(token, uid), server.wrap_drive).catch(() => { throw new Error('This Google backup belongs to a different key. Use your recovery code.'); });
}

/** The backup secret from the user's Drive. */
export async function readSecret(token, uid) {
  // This account's own file; older app versions wrote one shared file (used only if it belongs to this account)
  const own = uid && await findFile(token, fileFor(uid));
  const id = own || await findFile(token, LEGACY);
  if (!id) throw new Error('No Kanalyst key backup in this Google account. Pick the account you used when you turned it on.');
  const f = await (await gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
  if (!f?.secret) throw new Error('The Google backup is damaged. Use your recovery code.');
  if (!own && uid && f.uid && f.uid !== uid) throw new Error('No Kanalyst key for this account in this Google account. Pick the Google account you used when you set it up.');
  return f.secret;
}
