// Which fields are encrypted before a request leaves the browser. The Android app has the same list
// (Sealing.kt). Kinds:
//   text  encrypted whole
//   ref   account / folio / PRAN / PAN numbers: last 4 stay readable ("XX4521") for matching, the full
//         number goes in "<field>_enc"
//   date  only "<field>_enc" is sent (the readable date is dropped)
//   sig   public name signals (home, retire, insurance, ...) worked out from that field before encryption
import * as K from './kcrypto';
import { vault, sealTxn, sealRule } from './vault';

export const NAME_SIGNALS = {
  household_expense: /month(ly)?\s*(house(hold)?\s*)?expens|household expens|living expens/i,
  insurance: /insur|premium/i, emergency: /emergenc|rainy day|contingen/i, retire: /retire/i,
  home: /home|house/i, car: /\bcar\b/i, personal: /personal/i, education: /education/i, gold: /gold/i, vehicle: /vehicle|two.?wheeler|bike/i,
};
export const nameSignals = (t) => Object.entries(NAME_SIGNALS).filter(([, rx]) => rx.test(String(t || ''))).map(([k]) => k);
export const maskRef = (s) => { const a = String(s).replace(/[^a-z0-9]/gi, ''); return a.length <= 4 ? String(s) : 'XX' + a.slice(-4); };
const filled = (v) => typeof v === 'string' && v !== '' && !K.isEnc(v);

/** Encrypt the fields of one object by a spec { text, ref, date, sig }. */
export async function sealFields(o, spec) {
  const keys = vault.keys;
  if (!keys || !o || typeof o !== 'object') return o;
  const out = { ...o };
  if (spec.sig && filled(o[spec.sig])) out.signals = nameSignals(o[spec.sig]);
  for (const f of spec.text || []) if (filled(o[f])) out[f] = await K.encrypt(keys, o[f]);
  for (const f of spec.ref || []) if (filled(o[f])) { out[f + '_enc'] = await K.encrypt(keys, o[f]); out[f] = maskRef(o[f]); }
  for (const f of spec.date || []) if (filled(o[f])) { out[f + '_enc'] = await K.encrypt(keys, o[f]); delete out[f]; }
  return out;
}

const each = (arr, fn) => (Array.isArray(arr) ? Promise.all(arr.map(fn)) : arr);
const MASTER = { text: ['title'], sig: 'title' };
const keywordTok = async (o) => {
  // Keywords stay readable (they are the payee / institution words); their fingerprints go along too
  if (!o?.match || !Array.isArray(o.match.keywords) || !o.match.keywords.length) return o;
  const tok = (await Promise.all(o.match.keywords.map(k => K.tokens(vault.keys, k)))).flat();
  return { ...o, match: { ...o.match, keyword_tok: [...new Set(tok)].slice(0, 40) } };
};

/** [path regex, methods, how to seal the body] */
const RULES = [
  [/^\/api\/expense\/transactions(\/bulk|\/[^/]+)?$/, ['post', 'put'], (d) => (Array.isArray(d) ? Promise.all(d.map(sealTxn)) : sealTxn(d))],
  [/^\/api\/expense\/sms-rules(\/[^/]+)?$/, ['post', 'put'], sealRule],
  [/^\/api\/expense\/sync\/push$/, ['post'], async (d) => ({ ...d, sms_rules: await each(d.sms_rules, sealRule) })],
  [/^\/api\/setup\/apply$/, ['post'], async (d) => {
    if (d.step === 'rules') return { ...d, items: await each(d.items, async it => { const r = await sealRule({ merchant_pattern: it.pattern }); return { ...it, pattern: r.merchant_pattern, pattern_tok: r.pattern_tok }; }) };
    return { ...d, items: await each(d.items, it => sealFields(it, { text: ['title'] })) };
  }],
  [/^\/api\/masters$|^\/api\/masters\/[0-9a-f-]{36}$/, ['post', 'put'], async (d) => sealFields(await keywordTok(d), MASTER)],
  [/^\/api\/masters\/apply$/, ['post'], async (d) => ({ ...d, finds: await each(d.finds, async f => ({ ...(await sealFields(await keywordTok(f), MASTER)), ...(f.event ? { event: await sealFields(f.event, { text: ['title'] }) } : {}) })) })],
  [/^\/api\/masters\/events(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['title', 'notes'] })],
  [/^\/api\/events\/rules(\/[^/]+)?$/, ['post', 'put'], sealRule],
  [/^\/api\/events(\/[0-9a-f-]{36})?$/, ['post', 'put'], (d) => sealFields(d, { text: ['title', 'notes'] })],
  [/^\/api\/household\/policies(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['nominee', 'notes'] })],
  [/^\/api\/household\/members(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['name', 'notes'] })],
  [/^\/api\/household\/documents(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['title', 'kept_at', 'notes'] })],
  [/^\/api\/household\/events(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['title', 'notes'] })],
  [/^\/api\/fd(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['notes'], ref: ['branch_ref'] })],
  [/^\/api\/rd(\/[^/]+)?$/, ['post', 'put'], (d) => sealFields(d, { text: ['notes'], ref: ['account_reference'] })],
  [/^\/api\/nps\/(manual|[0-9a-f-]{36})$/, ['post', 'put'], (d) => sealFields(d, { text: ['subscriber_name'], ref: ['pran'] })],
  [/^\/api\/blueprint\/buckets(\/[0-9a-f-]{36})?$/, ['post', 'put'], (d) => sealFields(d, { text: ['name'], sig: 'name' })],
  [/^\/api\/blueprint\/buckets\/[^/]+\/emi$/, ['post'], (d) => sealFields(d, { text: ['loan_name'] })],
  [/^\/api\/blueprint\/buckets\/[^/]+\/comments$/, ['post'], (d) => sealFields(d, { text: ['body'] })],
  [/^\/api\/auth\/profile$/, ['put'], (d) => sealFields(d, { text: ['name', 'mobile', 'clientCode'], ref: ['pan'], date: ['dob'] })],
  [/^\/api\/epf\/accounts$/, ['post'], (d) => sealFields(d, { ref: ['uan', 'member_id'] })],
];

export async function sealRequest(url, method, data) {
  if (!vault.unlocked() || !data || typeof data !== 'object' || data instanceof FormData) return data;
  const path = String(url || '').split('?')[0];
  const m = String(method || '').toLowerCase();
  for (const [rx, methods, fn] of RULES) if (methods.includes(m) && rx.test(path)) return fn(data);
  return data;
}

// The server needs PAN / DOB / name for opening statement PDFs and for age-based plans. Encrypted accounts
// hand them over on just those requests, from this device, and the server never stores them readable.
const PROFILE_PATHS = /^\/api\/(email|nps|mf|epf|retirement|household|portfolio\/history|auth\/pdf-passwords)(\/|$)/;
let profile = null;
export const rememberProfile = (me) => {
  if (!me || typeof me !== 'object') return;
  profile = { name: me.name || null, pan: me.pan_enc || null, dob: me.dob || null, mobile: me.mobile || null, client_code: me.client_code || null };
};
export const forgetProfile = () => { profile = null; };
export function profileHeader(url) {
  if (!vault.unlocked() || !profile || !PROFILE_PATHS.test(String(url || '').split('?')[0])) return null;
  const json = JSON.stringify(Object.fromEntries(Object.entries(profile).filter(([, v]) => typeof v === 'string' && v && !K.isEnc(v))));
  return K.b64u.enc(new TextEncoder().encode(json));
}
