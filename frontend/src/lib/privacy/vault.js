// The device's copy of the user's keys. Unlocked keys are kept as non-extractable CryptoKeys in
// IndexedDB ("remember this browser"), so they can be used here but never read out.
import * as K from './kcrypto';

const DB = 'kanalyst-vault', STORE = 'keys';
let current = null;          // { uid, keys, selfName }
const listeners = new Set();
export const onVaultChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(current));

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode); const st = tx.objectStore(STORE);
    const req = fn(st); tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error);
  });
}

export const vault = {
  get keys() { return current?.keys || null; },
  get selfName() { return current?.selfName || ''; },
  unlocked: () => !!current?.keys,

  /** Load this browser's saved keys for the user, if any. */
  async load(uid, selfName) {
    try {
      const saved = await idbDo('readonly', st => st.get(uid));
      current = saved ? { uid, keys: saved, selfName } : { uid, keys: null, selfName };
    } catch { current = { uid, keys: null, selfName }; }
    emit();
    return !!current.keys;
  },

  async remember(uid, keys, selfName) {
    try { await idbDo('readwrite', st => st.put(keys, uid)); } catch { /* private window: keys live for this tab only */ }
    current = { uid, keys, selfName }; emit();
  },

  /** Use keys for this tab only (not saved in the browser). */
  hold(uid, keys, selfName) { current = { uid, keys, selfName }; emit(); },

  async forget() {
    if (current?.uid) { try { await idbDo('readwrite', st => st.delete(current.uid)); } catch { /* nothing saved */ } }
    current = current ? { ...current, keys: null } : null; emit();
  },
};

/** First device: new keys, locked by the passphrase and by a new recovery code. Returns { body, code, keys }. */
export async function createKeys(passphrase) {
  const dek = K.newDek();
  const kp = await K.newKeyPair();
  const keys = await K.keysFromDek(dek, kp.pkcs8);
  const code = K.newRecoveryCode();
  const body = {
    pub: kp.pub,
    priv: await K.encrypt(keys, K.b64u.enc(kp.pkcs8)),
    wrap_pass: await K.wrapDek(passphrase, dek),
    wrap_recovery: await K.wrapDek(code, dek, 100000),
  };
  return { body, code, keys, dek };
}

/** Any device: unlock with the passphrase or the recovery code. Throws if neither fits. */
export async function unlockKeys(server, secret) {
  let dek = null;
  for (const w of [server.wrap_pass, server.wrap_recovery]) {
    if (!w) continue;
    try { dek = await K.unwrapDek(secret, w); break; } catch { /* try the other lock */ }
  }
  if (!dek) throw new Error('That passphrase or recovery code does not match.');
  const tmp = await K.keysFromDek(dek);
  const pkcs8 = K.b64u.dec(await K.decrypt(tmp, server.priv));
  return { keys: await K.keysFromDek(dek, pkcs8), dek };
}

// ── Field rules: what is encrypted, and what the server gets instead ─────────
/** A transaction body ready for the server: names encrypted, fingerprints and public signals added. */
export async function sealTxn(t) {
  const keys = vault.keys;
  if (!keys || !t || typeof t !== 'object') return t;
  const readable = [t.merchant, t.description, t.sms_body].filter(x => x && !K.isEnc(x)).join(' ');
  const out = { ...t };
  if (readable) {
    out.signals = K.signals([readable, t.note].filter(Boolean).join(' '), vault.selfName);
    out.merchant_tok = await K.tokens(keys, readable);
    if (t.merchant && !K.isEnc(t.merchant)) out.merchant_key = await K.fingerprint(keys, t.merchant);
  }
  out.merchant = await K.encrypt(keys, t.merchant, { deterministic: true });
  out.reference_no = await K.encrypt(keys, t.reference_no, { deterministic: true });
  out.description = await K.encrypt(keys, t.description);
  out.note = await K.encrypt(keys, t.note);
  out.sms_body = await K.encrypt(keys, t.sms_body);
  for (const k of ['merchant', 'reference_no', 'description', 'note', 'sms_body']) if (t[k] === undefined) delete out[k];
  return out;
}

export async function sealRule(r) {
  const keys = vault.keys;
  if (!keys || !r?.merchant_pattern || K.isEnc(r.merchant_pattern)) return r;
  return { ...r, pattern_tok: await K.tokens(keys, r.merchant_pattern), merchant_pattern: await K.encrypt(keys, r.merchant_pattern.toLowerCase().trim(), { deterministic: true }) };
}

/** Decrypts every encrypted string anywhere in a response. Unreadable values show as a lock. */
export async function openDeep(v) {
  const keys = vault.keys;
  if (!keys) return v;
  if (typeof v === 'string') { if (!K.isEnc(v)) return v; try { return await K.decrypt(keys, v); } catch { return '🔒'; } }
  if (Array.isArray(v)) return Promise.all(v.map(openDeep));
  if (v && typeof v === 'object') {
    const out = {};
    await Promise.all(Object.keys(v).map(async k => { out[k] = await openDeep(v[k]); }));
    return out;
  }
  return v;
}
