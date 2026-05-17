/**
 * tokenCrypto.js — AES-256-GCM symmetric encryption for OAuth tokens
 * Required by Google's Limited Use Policy for gmail.readonly scope.
 * Tokens must be encrypted at rest.
 *
 * Set TOKEN_ENCRYPTION_KEY in Railway env vars:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

const ALGO    = 'aes-256-gcm';
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY;

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a single string: iv:authTag:ciphertext (all hex).
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
}

/**
 * Decrypt a value produced by encrypt().
 * Returns the original plaintext, or null if input is null/empty.
 */
function decrypt(value) {
  if (!value) return null;
  // Handle plain-text tokens that were stored before encryption was enabled
  if (!value.includes(':')) return value;
  const key = getKey();
  const [ivHex, tagHex, enc] = value.split(':');
  const iv  = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

/**
 * Re-encrypts a value if it's stored as plain text (migration helper).
 * Safe to call on already-encrypted values — detects by ':' separator.
 */
function ensureEncrypted(value) {
  if (!value) return null;
  if (value.includes(':')) return value; // already encrypted
  return encrypt(value);
}

module.exports = { encrypt, decrypt, ensureEncrypted };
