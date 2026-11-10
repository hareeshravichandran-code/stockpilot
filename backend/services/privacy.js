// Helpers for working with end-to-end encrypted fields on the server.
// The server never has the user's key. Encrypted values ("ev1:" / "ep1:") are opaque here; features
// use what the device sends alongside them instead:
//   signals       public words a payment mentions (emi, loan, salary, insurance, bank names "org:hdfc",
//                 bank-masked account endings "x:3542", "self" for the user's own name) — never a payee
//   merchant_key  anonymous fingerprint of the payee (same payee -> same key)
//   merchant_tok  anonymous fingerprints of each word (rules match when all their words are present)
const isEnc = (s) => typeof s === 'string' && (s.startsWith('ev1:') || s.startsWith('ep1:'));
const plain = (s) => (isEnc(s) ? '' : String(s || ''));

/** Readable text of a transaction (empty for encrypted fields). */
const txnText = (t) => `${plain(t.merchant)} ${plain(t.description)} ${plain(t.sms_body)}`.toLowerCase();

/** Does this transaction mention [signal]? Uses the device's signals for encrypted rows, the text otherwise. */
function has(t, signal, rx) {
  if (Array.isArray(t.signals) && t.signals.includes(signal)) return true;
  return rx ? rx.test(txnText(t)) : false;
}

/** Rule match: all the rule's word fingerprints in the payment's, or plain text containment. */
function ruleMatches(rule, t) {
  if (Array.isArray(rule.pattern_tok) && rule.pattern_tok.length && Array.isArray(t.merchant_tok) && t.merchant_tok.length) {
    const set = new Set(t.merchant_tok);
    return rule.pattern_tok.every(x => set.has(x));
  }
  const p = plain(rule.merchant_pattern).toLowerCase().trim();
  return p.length >= 3 && txnText(t).includes(p);
}

/** Group key for "same payee" (fingerprint, or the readable name). */
const payeeKey = (t) => t.merchant_key || plain(t.merchant).trim().toLowerCase() || null;

/** Allowed extra columns a device may send with a transaction. */
function txnExtras(b) {
  const arr = (x, n) => (Array.isArray(x) ? x.filter(s => typeof s === 'string' && s.length <= 40).slice(0, n) : undefined);
  const out = {};
  if (typeof b.merchant_key === 'string') out.merchant_key = b.merchant_key.slice(0, 40);
  const tok = arr(b.merchant_tok, 120); if (tok) out.merchant_tok = tok;
  const sig = arr(b.signals, 40); if (sig) out.signals = sig;
  return out;
}

// ── Values the server creates itself (CAS, NPS, SMS setup) ──────────────────
// Sealed to the user's public key ("ep1"): the server can lock them but never read them back.
const nodeCrypto = require('crypto');
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Same format as the apps: "ep1:" + b64url(ephemeralPub65 | iv12 | ciphertext+tag). */
function sealTo(pubB64, text) {
  if (text == null || text === '' || isEnc(text)) return text;
  const eph = nodeCrypto.createECDH('prime256v1'); eph.generateKeys();
  const shared = eph.computeSecret(unb64u(pubB64));
  const key = Buffer.from(nodeCrypto.hkdfSync('sha256', shared, Buffer.alloc(32), Buffer.from('kanalyst-ep1'), 32));
  const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final(), c.getAuthTag()]);
  return 'ep1:' + b64u(Buffer.concat([eph.getPublicKey(), iv, ct]));
}

/** Account, folio, PRAN and PAN numbers keep only their last 4 readable ("XX4521") so matching still works. */
function maskRef(s) {
  if (s == null || s === '' || isEnc(s)) return s;
  const a = String(s).replace(/[^a-z0-9]/gi, '');
  return a.length <= 4 ? String(s) : 'XX' + a.slice(-4);
}

/** sealer(uid): { on, seal(text), ref(value) -> { masked, enc } } — a no-op for accounts without keys. */
async function sealer(uid) {
  const supabase = require('./supabase');
  const { data } = await supabase.from('users').select('enc_pub, enc_ready_at').eq('id', uid).maybeSingle();
  const pub = data?.enc_ready_at && data?.enc_pub ? data.enc_pub : null;
  return {
    on: !!pub,
    seal: (t) => (pub ? sealTo(pub, t) : t),
    ref: (v) => (pub && v != null && v !== '' && !isEnc(v) ? { masked: maskRef(v), enc: sealTo(pub, String(v)) } : { masked: v ?? null, enc: null }),
  };
}

const _sealers = new Map();
/** Lock a row the server is about to save: refs keep last 4 readable + "<field>_enc"; texts are sealed whole. */
async function lockRow(uid, rec, { refs = [], texts = [] } = {}) {
  let c = _sealers.get(uid);
  if (!c || c.at < Date.now() - 60e3) { c = { at: Date.now(), s: await sealer(uid) }; _sealers.set(uid, c); }
  if (!c.s.on) return rec;
  const out = { ...rec };
  for (const f of refs) if (out[f] != null && out[f] !== '' && !isEnc(out[f])) { const r = c.s.ref(out[f]); out[f] = r.masked; out[f + '_enc'] = r.enc; }
  for (const f of texts) if (out[f]) out[f] = c.s.seal(out[f]);
  return out;
}

/**
 * The user's own PAN / DOB / name / mobile, for opening statement PDFs and age-based plans. Encrypted
 * accounts send them from the device for that request only (X-Kanalyst-Profile, base64url JSON); they are
 * used in memory and never stored readable.
 */
function profileOf(req, row = {}) {
  let h = {};
  try { const raw = req.headers?.['x-kanalyst-profile']; if (raw) h = JSON.parse(unb64u(raw).toString('utf8')) || {}; } catch { h = {}; }
  const out = { ...row };
  for (const k of ['name', 'pan', 'dob', 'mobile', 'client_code']) {
    const v = row[k];
    const hidden = v == null || v === '' || isEnc(v) || (k === 'pan' && /^XX/.test(String(v)));
    if (hidden && typeof h[k] === 'string' && h[k]) out[k] = h[k].slice(0, 80);
    else if (hidden && isEnc(v)) out[k] = null;
  }
  if (out.pan && /^XX/.test(out.pan)) out.pan = null;
  return out;
}

/** Name checks that also work on encrypted names: the device's signals first, then readable text. */
function nameHas(o, signal, rx) {
  if (Array.isArray(o?.signals) && o.signals.includes(signal)) return true;
  return rx.test(plain(o?.name ?? o?.title));
}

/** Public vocabulary for goal / master names (the server sees only these words, never the name). */
const NAME_SIGNALS = {
  household_expense: /month(ly)?\s*(house(hold)?\s*)?expens|household expens|living expens/i,
  insurance: /insur|premium/i, emergency: /emergenc|rainy day|contingen/i, retire: /retire/i,
  home: /home|house/i, car: /\bcar\b/i, personal: /personal/i, education: /education/i, gold: /gold/i, vehicle: /vehicle|two.?wheeler|bike/i,
};
/** Signals of a readable name (the server works them out before it locks a name it created). */
const signalsOfName = (t) => (t && !isEnc(t) ? Object.entries(NAME_SIGNALS).filter(([, rx]) => rx.test(t)).map(([k]) => k) : []);
/** Signals a device may send with a name (filtered to the public vocabulary). */
const nameSignals = (arr) => (Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x in NAME_SIGNALS).slice(0, 12) : undefined);

/** Text cleaners pass encrypted values through untouched (cutting them would destroy them). */
const encOk = (v) => isEnc(v) && v.length <= 8000;

module.exports = { signalsOfName, lockRow, isEnc, plain, txnText, has, ruleMatches, payeeKey, txnExtras, sealTo, maskRef, sealer, profileOf, nameHas, NAME_SIGNALS, nameSignals, encOk };
