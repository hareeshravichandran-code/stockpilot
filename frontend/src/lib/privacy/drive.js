// Automatic key backup in the user's own Google Drive (hidden app folder, only Kanalyst can see it there).
// Two halves, neither enough alone:
//   Google Drive  holds a random backup secret
//   Kanalyst      holds the key locked with that secret (enc_wrap_drive)
// The browser talks to Drive directly, so the Kanalyst server never gets Drive access.
import * as K from './kcrypto';
import { privacyAPI } from '../api';

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '530143058705-fi42mdsqe8dhb03b42tii67r9n6mejl9.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'kanalyst-key-backup.json';

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not reach Google'));
    document.head.appendChild(s);
  });
}

/** A short-lived Drive token from a Google popup (the user picks their account). */
async function driveToken(hint) {
  await loadGis();
  return new Promise((res, rej) => {
    const c = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, hint,
      callback: (r) => (r.error ? rej(new Error(r.error_description || r.error)) : res(r.access_token)),
      error_callback: (e) => rej(new Error(e?.message || 'Google sign-in was closed')),
    });
    c.requestAccessToken({ prompt: '' });
  });
}

const gfetch = async (token, url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(r.status === 403 ? 'Google Drive is not enabled for Kanalyst yet' : `Google Drive error ${r.status}`);
  return r;
};
async function findFile(token) {
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await gfetch(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return (await r.json()).files?.[0]?.id || null;
}

/** Turn on the backup. Needs the raw key (right after creating it, or after typing the passphrase). */
export async function backupToDrive(uid, email, dek) {
  const token = await driveToken(email);
  const secret = K.b64u.enc(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const content = JSON.stringify({ v: 1, uid, secret, made: new Date().toISOString() });
  const existing = await findFile(token);
  const boundary = 'kb' + Date.now();
  const meta = existing ? {} : { name: FILE, parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const url = existing ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await gfetch(token, url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  // The secret is random and long, so few rounds are enough
  await privacyAPI.backup({ wrap_drive: await K.wrapDek(secret, dek, 1000) });
}

/** New browser: read the secret from Drive and open the key with it. Returns the raw DEK. */
export async function dekFromDrive(server, email) {
  if (!server?.wrap_drive) throw new Error('No Google Drive backup is turned on for this account');
  const token = await driveToken(email);
  const id = await findFile(token);
  if (!id) throw new Error('No Kanalyst key backup in this Google account. Pick the account you used when you turned it on.');
  const f = await (await gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
  try { return await K.unwrapDek(f.secret, server.wrap_drive); } catch { throw new Error('This Drive backup belongs to a different key. Use your passphrase or recovery code.'); }
}
