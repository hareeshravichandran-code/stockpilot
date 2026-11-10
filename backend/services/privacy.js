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

module.exports = { isEnc, plain, txnText, has, ruleMatches, payeeKey, txnExtras };
