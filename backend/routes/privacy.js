// End-to-end encryption: key storage and the one-time encryption of existing data.
// The server stores only locked copies of the user's key (by passphrase, by recovery code) and the
// public key. It never receives the passphrase, the recovery code or the unlocked key.
const router = require('express').Router();
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');
const { isEnc, txnExtras } = require('../services/privacy');

const okWrap = (w) => w && typeof w === 'object' && w.v === 1 && w.kdf === 'pbkdf2-sha256' && Number(w.iter) >= 1000
  && ['salt', 'iv', 'ct'].every(k => typeof w[k] === 'string' && w[k].length < 200);

router.get('/privacy/keys', requireAuth, async (req, res) => {
  const { data: u, error } = await supabase.from('users')
    .select('enc_pub, enc_priv, enc_wrap_pass, enc_wrap_recovery, enc_ready_at, enc_migrated_at, is_test').eq('id', req.user.id).maybeSingle();
  if (error || !u) return res.status(404).json({ error: 'User not found' });
  // Rolled out in steps: the test account first, then everyone (E2E_REQUIRED=1 on the server)
  const required = process.env.E2E_REQUIRED === '1' || !!u.is_test;
  res.json({ ready: !!u.enc_ready_at, required, pub: u.enc_pub, priv: u.enc_priv, wrap_pass: u.enc_wrap_pass, wrap_recovery: u.enc_wrap_recovery,
    ready_at: u.enc_ready_at, migrated_at: u.enc_migrated_at });
});

// First device: store the public key, the private key (encrypted with the data key) and the two locked copies
router.post('/privacy/keys', requireAuth, async (req, res) => {
  try {
    const { pub, priv, wrap_pass, wrap_recovery } = req.body || {};
    if (typeof pub !== 'string' || pub.length < 80 || pub.length > 120) return res.status(400).json({ error: 'Bad public key' });
    if (!isEnc(priv) || !okWrap(wrap_pass) || !okWrap(wrap_recovery)) return res.status(400).json({ error: 'Bad key data' });
    const { data: u } = await supabase.from('users').select('enc_ready_at').eq('id', req.user.id).maybeSingle();
    if (u?.enc_ready_at) return res.status(409).json({ error: 'Encryption is already set up for this account' });
    const { error } = await supabase.from('users').update({ enc_pub: pub, enc_priv: priv, enc_wrap_pass: wrap_pass, enc_wrap_recovery: wrap_recovery,
      enc_ready_at: new Date().toISOString() }).eq('id', req.user.id);
    if (error) throw error;
    console.log(JSON.stringify({ event: 'ENC_KEYS_CREATED', userId: req.user.id }));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Change the passphrase or make a new recovery code (the device re-locks the same key)
router.put('/privacy/keys', requireAuth, async (req, res) => {
  const f = {};
  if (req.body?.wrap_pass) { if (!okWrap(req.body.wrap_pass)) return res.status(400).json({ error: 'Bad key data' }); f.enc_wrap_pass = req.body.wrap_pass; }
  if (req.body?.wrap_recovery) { if (!okWrap(req.body.wrap_recovery)) return res.status(400).json({ error: 'Bad key data' }); f.enc_wrap_recovery = req.body.wrap_recovery; }
  if (!Object.keys(f).length) return res.status(400).json({ error: 'Nothing to change' });
  const { error } = await supabase.from('users').update(f).eq('id', req.user.id).not('enc_ready_at', 'is', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── One-time encryption of existing data ─────────────────────────────────────
const TABLES = {
  transactions: { table: 'expense_transactions', fields: ['merchant', 'description', 'note', 'reference_no', 'sms_body'], owner: 'user_id' },
  rules: { table: 'user_sms_rules', fields: ['merchant_pattern'], owner: 'user_id' },
};

// Rows that still have readable values, a page at a time
router.get('/privacy/plain', requireAuth, async (req, res) => {
  try {
    const t = TABLES[req.query.table];
    if (!t) return res.status(400).json({ error: 'Unknown table' });
    const out = [];
    for (let from = 0; out.length < 400 && from < 20000; from += 1000) {
      const { data, error } = await supabase.from(t.table).select(['id', ...t.fields].join(', ')).eq(t.owner, req.user.id).order('id').range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) if (t.fields.some(f => r[f] != null && r[f] !== '' && !isEnc(r[f]))) out.push(r);
      if (!data || data.length < 1000) break;
    }
    res.json({ rows: out.slice(0, 400), more: out.length > 400 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Encrypted values back for those rows (every listed field must be encrypted or empty)
router.post('/privacy/encrypted', requireAuth, async (req, res) => {
  try {
    const t = TABLES[req.body?.table];
    if (!t) return res.status(400).json({ error: 'Unknown table' });
    const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).slice(0, 400);
    let done = 0;
    const queue = [...rows];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const r = queue.shift();
        const f = {};
        // Refuse a row that would put readable text back
        if (t.fields.some(k => k in r && r[k] != null && r[k] !== '' && !isEnc(r[k]))) continue;
        for (const k of t.fields) if (k in r) f[k] = r[k] || null;
        if (t.table === 'expense_transactions') Object.assign(f, txnExtras(r));
        if (t.table === 'user_sms_rules' && Array.isArray(r.pattern_tok)) f.pattern_tok = r.pattern_tok.slice(0, 20);
        const { error } = await supabase.from(t.table).update(f).eq('id', r.id).eq(t.owner, req.user.id);
        if (!error) done++;
      }
    }));
    res.json({ ok: true, done });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/privacy/migrated', requireAuth, async (req, res) => {
  await supabase.from('users').update({ enc_migrated_at: new Date().toISOString() }).eq('id', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
