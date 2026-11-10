// Kanalyst end-to-end encryption core (Web Crypto). The same formats are implemented in
// Kotlin (Android, KCrypto.kt) and Node (backend/services/kcrypto.js); test vectors keep them identical.
//
// Keys per user
//   DEK   random 32 bytes, AES-256-GCM: encrypts sensitive fields. Never leaves a device unwrapped.
//   SIV   HKDF(DEK, "kanalyst-siv")  : IV for deterministic encryption (equal plaintext -> equal ciphertext)
//   BIDX  HKDF(DEK, "kanalyst-bidx") : HMAC key for anonymous fingerprints of words and payees
//   EC    P-256 key pair             : lets the server lock data it creates (CAS, NPS) without reading it back
// Formats
//   "ev1:" + b64url(iv12 | ciphertext+tag)                         (random or deterministic IV)
//   "ep1:" + b64url(ephemeralPub65 | iv12 | ciphertext+tag)        (sealed to the user's public key)
//   wrap   { v:1, kdf:"pbkdf2-sha256", iter, salt, iv, ct }        (DEK locked by passphrase or recovery code)
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const b64u = {
  enc: (u8) => { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); },
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
const hex = (u8) => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');

export const isEnc = (s) => typeof s === 'string' && (s.startsWith('ev1:') || s.startsWith('ep1:'));

export function newDek() { return rand(32); }

async function hkdf(raw, info) {
  const k = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, k, 256);
  return new Uint8Array(bits);
}

/** Everything a device needs, from the raw DEK. Keys are non-extractable. */
export async function keysFromDek(dekRaw, privPkcs8 = null) {
  const aes = await subtle().importKey('raw', dekRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const siv = await subtle().importKey('raw', await hkdf(dekRaw, 'kanalyst-siv'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bidx = await subtle().importKey('raw', await hkdf(dekRaw, 'kanalyst-bidx'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const priv = privPkcs8 ? await subtle().importKey('pkcs8', privPkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) : null;
  return { aes, siv, bidx, priv };
}

export async function encrypt(keys, text, { deterministic = false } = {}) {
  if (text == null || text === '' || isEnc(text)) return text;
  const pt = te.encode(String(text));
  const iv = deterministic ? new Uint8Array(await subtle().sign('HMAC', keys.siv, pt)).slice(0, 12) : rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, keys.aes, pt));
  return 'ev1:' + b64u.enc(cat(iv, ct));
}

async function aesOpen(key, iv, ct) { return td.decode(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct)); }

export async function decrypt(keys, s) {
  if (!isEnc(s)) return s;
  const raw = b64u.dec(s.slice(4));
  if (s.startsWith('ev1:')) return aesOpen(keys.aes, raw.slice(0, 12), raw.slice(12));
  if (!keys.priv) throw new Error('No private key');
  const eph = await subtle().importKey('raw', raw.slice(0, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: eph }, keys.priv, 256));
  const k = await subtle().importKey('raw', await hkdf(shared, 'kanalyst-ep1'), 'AES-GCM', false, ['decrypt']);
  return aesOpen(k, raw.slice(65, 77), raw.slice(77));
}

/** Seal text to a public key (raw 65-byte P-256 point, base64url). Used by the server; clients can too. */
export async function sealTo(pubB64, text) {
  if (text == null || text === '' || isEnc(text)) return text;
  const pub = await subtle().importKey('raw', b64u.dec(pubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256));
  const k = await subtle().importKey('raw', await hkdf(shared, 'kanalyst-ep1'), 'AES-GCM', false, ['encrypt']);
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k, te.encode(String(text))));
  const ephRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  return 'ep1:' + b64u.enc(cat(ephRaw, iv, ct));
}

export async function newKeyPair() {
  const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { pub: b64u.enc(new Uint8Array(await subtle().exportKey('raw', kp.publicKey))), pkcs8: new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey)) };
}

/** Lock the DEK with a passphrase or recovery code. */
export async function wrapDek(secret, dekRaw, iter = 310000) {
  const salt = rand(16), iv = rand(12);
  const kek = await kekFrom(secret, salt, iter);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, dekRaw));
  return { v: 1, kdf: 'pbkdf2-sha256', iter, salt: b64u.enc(salt), iv: b64u.enc(iv), ct: b64u.enc(ct) };
}
export async function unwrapDek(secret, w) {
  const kek = await kekFrom(secret, b64u.dec(w.salt), w.iter);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64u.dec(w.iv) }, kek, b64u.dec(w.ct)));
}
async function kekFrom(secret, salt, iter) {
  const base = await subtle().importKey('raw', te.encode(normSecret(secret)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Recovery codes are typed with or without dashes and in any case. */
export const normSecret = (s) => /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){5}$/.test(String(s).trim()) || /^[A-Za-z0-9]{24}$/.test(String(s).trim())
  ? String(s).trim().replace(/-/g, '').toUpperCase() : String(s);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  const r = rand(24); let s = '';
  r.forEach((b, i) => { s += CODE_CHARS[b % 32]; if (i % 4 === 3 && i < 23) s += '-'; });
  return s;
}

// ── Anonymous fingerprints (blind index) ─────────────────────────────────────
const NOISE = new Set(['the', 'and', 'for', 'from', 'to', 'by', 'on', 'at', 'of', 'via', 'using', 'your', 'a/c', 'acct', 'account', 'bank', 'ltd', 'limited',
  'pvt', 'private', 'india', 'rs', 'inr', 'upi', 'ref', 'info', 'txn', 'xx', 'payment', 'paid', 'debited', 'credited', 'sent', 'received']);
/** Words that identify a payee: lowercase letters/digits, 3+ characters, minus generic words. */
export function words(text) {
  return [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w)))];
}
/** "Zomato Limi Using Icici" -> "zomato" (same rule as the app's payee grouping). */
export function payeeKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/\s+(?:using|via|thru|through|on|at)\b.*$/, '')
    .replace(/\b(?:limited|limi|ltd|pvt|private|india|payments?|services?|ser|se|di|technologies|tech|online|retail|cybs|cybersource|razorpay|payu)\b\.?/g, ' ')
    .replace(/[^a-z0-9 &]/g, ' ').replace(/\s+/g, ' ').trim();
  return (k || String(raw || '').toLowerCase().trim()).slice(0, 40);
}
async function mac(key, s) { return hex(new Uint8Array(await subtle().sign('HMAC', key, te.encode(s)))); }
export async function tokens(keys, text) { return Promise.all(words(text).slice(0, 40).map(async w => (await mac(keys.bidx, 'w:' + w)).slice(0, 16))); }
export async function fingerprint(keys, text) { return text ? (await mac(keys.bidx, 'k:' + payeeKey(text))).slice(0, 24) : null; }

// ── Signals the server may know (a fixed public vocabulary, never names) ─────
export const SIGNALS = {
  emi: /\bemi\b/, loan: /\bloan\b/, card: /credit\s*card|\bcc\b/, bill: /payment|towards|\bbill\b/, sip: /\bsip\b/, mutual: /mutual|\bmf\b/,
  nach: /\bnach\b|\bach\b|mandate|autopay|standing instruction/, units: /\bunits\b/, rd: /\brd\b|recurring/, salary: /salary|\bsal\b|payroll/,
  dividend: /\bdiv\b|dividend/, refund: /refund|reversed|reversal/, invest: /groww|zerodha|indmoney|kuvera|coin|paytm money|clearing corp|\bnse\b|\bbse\b|stocks|mutual|\bsip\b|\bmf\b|nps/,
  insurance: /insurance|policy|premium|\blic\b|life|health|lombard|ergo|bupa|acko/, cardbill: /credit\s*card.*(payment|bill)|card\s*bill|cc\s*payment|bbps.*card/,
  everyday: /swiggy|zomato|blinkit|zepto|instamart|bigbasket|dmart|uber|ola|rapido|petrol|fuel|hpcl|iocl|bpcl|cafe|hotel|restaurant|bakery|medical|pharma|grocer/,
};
export function signals(text, selfName = '') {
  const t = String(text || '').toLowerCase();
  const out = Object.entries(SIGNALS).filter(([, rx]) => rx.test(t)).map(([k]) => k);
  const me = words(selfName);
  if (me.length && me.every(w => t.includes(w))) out.push('self');
  return out;
}
