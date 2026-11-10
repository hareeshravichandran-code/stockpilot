// End-to-end encryption: key storage and the one-time encryption of existing data.
// The server stores only locked copies of the user's key (by passphrase, by recovery code) and the
// public key. It never receives the passphrase, the recovery code or the unlocked key.
const router = require('express').Router();
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');
const { isEnc, txnExtras, nameSignals } = require('../services/privacy');

const okWrap = (w) => w && typeof w === 'object' && w.v === 1 && w.kdf === 'pbkdf2-sha256' && Number(w.iter) >= 1000
  && ['salt', 'iv', 'ct'].every(k => typeof w[k] === 'string' && w[k].length < 200);

router.get('/privacy/keys', requireAuth, async (req, res) => {
  const { data: u, error } = await supabase.from('users')
    .select('enc_pub, enc_priv, enc_wrap_pass, enc_wrap_recovery, enc_ready_at, enc_migrated_at, enc_migrated_v, enc_wrap_drive, enc_drive_at, enc_wrap_block, is_test').eq('id', req.user.id).maybeSingle();
  if (error || !u) return res.status(404).json({ error: 'User not found' });
  // Rolled out in steps: the test account first, then everyone (E2E_REQUIRED=1 on the server)
  const required = process.env.E2E_REQUIRED === '1' || !!u.is_test;
  res.json({ ready: !!u.enc_ready_at, required, pub: u.enc_pub, priv: u.enc_priv, wrap_pass: u.enc_wrap_pass, wrap_recovery: u.enc_wrap_recovery,
    ready_at: u.enc_ready_at, migrated_at: u.enc_migrated_at, migrated_v: u.enc_migrated_v || 0,
    wrap_drive: u.enc_wrap_drive || null, drive_at: u.enc_drive_at || null, wrap_block: u.enc_wrap_block || null });
});

// First device: store the public key, the private key (encrypted with the data key) and the two locked copies
router.post('/privacy/keys', requireAuth, async (req, res) => {
  try {
    const { pub, priv, wrap_pass, wrap_recovery, wrap_drive, wrap_block } = req.body || {};
    if (typeof pub !== 'string' || pub.length < 80 || pub.length > 120) return res.status(400).json({ error: 'Bad public key' });
    // The key is always locked by a recovery code, plus at least one everyday way in:
    // the user's Google account (Drive backup) or a passphrase. The phone's screen lock (Block Store) is extra.
    const opt = (w) => w == null || okWrap(w);
    if (!isEnc(priv) || !okWrap(wrap_recovery) || !opt(wrap_pass) || !opt(wrap_drive) || !opt(wrap_block) || !(wrap_pass || wrap_drive))
      return res.status(400).json({ error: 'Bad key data' });
    const { data: u } = await supabase.from('users').select('enc_ready_at').eq('id', req.user.id).maybeSingle();
    if (u?.enc_ready_at) return res.status(409).json({ error: 'Encryption is already set up for this account' });
    const now = new Date().toISOString();
    const { error } = await supabase.from('users').update({ enc_pub: pub, enc_priv: priv, enc_wrap_pass: wrap_pass || null, enc_wrap_recovery: wrap_recovery,
      enc_wrap_drive: wrap_drive || null, enc_drive_at: wrap_drive ? now : null, enc_wrap_block: wrap_block || null, enc_ready_at: now }).eq('id', req.user.id);
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
  if (req.body?.wrap_block) { if (!okWrap(req.body.wrap_block)) return res.status(400).json({ error: 'Bad key data' }); f.enc_wrap_block = req.body.wrap_block; }
  if (!Object.keys(f).length) return res.status(400).json({ error: 'Nothing to change' });
  const { error } = await supabase.from('users').update(f).eq('id', req.user.id).not('enc_ready_at', 'is', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Google Drive backup: the key locked with a random secret that only the user's Drive holds
router.put('/privacy/drive', requireAuth, async (req, res) => {
  const w = req.body?.wrap_drive;
  if (!okWrap(w)) return res.status(400).json({ error: 'Bad key data' });
  const { error } = await supabase.from('users').update({ enc_wrap_drive: w, enc_drive_at: new Date().toISOString() }).eq('id', req.user.id).not('enc_ready_at', 'is', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
router.delete('/privacy/drive', requireAuth, async (req, res) => {
  // Without a passphrase, Google is the everyday way in: keep it until a passphrase is set
  const { data: u } = await supabase.from('users').select('enc_wrap_pass').eq('id', req.user.id).maybeSingle();
  if (!u?.enc_wrap_pass) return res.status(409).json({ error: 'Set a passphrase first. Your Google account is how you unlock now.' });
  await supabase.from('users').update({ enc_wrap_drive: null, enc_drive_at: null }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ── One-time encryption of existing data ─────────────────────────────────────
// text: encrypted whole · ref: last 4 kept readable + full number in "<field>_enc" · date: only "<field>_enc" kept
const TABLES = {
  transactions: { table: 'expense_transactions', text: ['merchant', 'description', 'note', 'reference_no', 'sms_body'], owner: 'user_id' },
  rules:     { table: 'user_sms_rules', text: ['merchant_pattern'], owner: 'user_id' },
  masters:   { table: 'money_masters', text: ['title'], owner: 'owner_id', signals: true },
  events:    { table: 'recurring_events', text: ['title', 'notes'], owner: 'owner_id' },
  policies:  { table: 'insurance_policies', text: ['nominee', 'notes'], owner: 'owner_id' },
  members:   { table: 'household_members', text: ['name', 'notes'], owner: 'owner_id' },
  documents: { table: 'family_documents', text: ['title', 'kept_at', 'notes'], owner: 'owner_id' },
  family_events: { table: 'family_events', text: ['title', 'notes'], owner: 'owner_id' },
  fd:        { table: 'fixed_deposits', id: 'fd_id', text: ['notes'], ref: ['branch_ref'], owner: 'user_id' },
  rd:        { table: 'recurring_deposits', id: 'rd_id', text: ['notes'], ref: ['account_reference'], owner: 'user_id' },
  nps:       { table: 'nps_holdings', text: ['subscriber_name', 'raw_text_snippet'], ref: ['pran'], owner: 'user_id' },
  mf:        { table: 'mf_holdings', text: [], ref: ['folio_number'], owner: 'user_id' },
  buckets:   { table: 'bp_buckets', text: ['name'], owner: 'user_id', signals: true },
  comments:  { table: 'bp_comments', text: ['body'], owner: 'user_id' },
  profile:   { table: 'users', text: ['name', 'mobile', 'client_code'], ref: ['pan'], date: ['dob'], owner: 'id' },
};
const MIGRATION_ORDER = Object.keys(TABLES);
const colsOf = (t) => [t.id || 'id', ...t.text, ...(t.ref || []).flatMap(f => [f, f + '_enc']), ...(t.date || []).flatMap(f => [f, f + '_enc'])];
const filled = (v) => v != null && v !== '';
/** Does this row still hold something readable? */
const isPlainRow = (t, r) => t.text.some(f => filled(r[f]) && !isEnc(r[f]))
  || (t.ref || []).some(f => filled(r[f]) && !isEnc(r[f + '_enc']))
  || (t.date || []).some(f => filled(r[f]));

/** Blueprint goals map folios / PRANs by number: follow them to the masked number (the user's own and a partner's maps). */
async function moveAssetRefs(uid, table, old, f) {
  const pairs = [];
  if (table === 'mf_holdings' && old.folio_number && f.folio_number && old.folio_number !== f.folio_number) {
    const isin = old.isin || '';
    pairs.push(['mf', `${old.folio_number}|${isin}`, `${f.folio_number}|${isin}`, true], ['mf', `fam:${uid}:${old.folio_number}|${isin}`, `fam:${uid}:${f.folio_number}|${isin}`, false]);
  }
  if (table === 'nps_holdings' && old.pran && f.pran && old.pran !== f.pran) {
    pairs.push(['nps', old.pran, f.pran, true], ['nps', `fam:${uid}:${old.pran}`, `fam:${uid}:${f.pran}`, false]);
  }
  for (const [type, from, to, mine] of pairs) {
    let q = supabase.from('bp_bucket_assets').update({ asset_ref: to }).eq('asset_type', type).eq('asset_ref', from);
    if (mine) q = q.eq('user_id', uid);
    await q;
  }
}

router.get('/privacy/tables', requireAuth, (req, res) => res.json({ order: MIGRATION_ORDER,
  spec: Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, { id: t.id || 'id', text: t.text, ref: t.ref || [], date: t.date || [], signals: !!t.signals }])) }));

// Rows that still have readable values, a page at a time
router.get('/privacy/plain', requireAuth, async (req, res) => {
  try {
    const t = TABLES[req.query.table];
    if (!t) return res.status(400).json({ error: 'Unknown table' });
    const idc = t.id || 'id';
    const out = [];
    for (let from = 0; out.length < 400 && from < 20000; from += 1000) {
      const { data, error } = await supabase.from(t.table).select(colsOf(t).join(', ')).eq(t.owner, req.user.id).order(idc).range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) if (isPlainRow(t, r)) out.push(idc === 'id' ? r : { ...r, id: r[idc] });
      if (!data || data.length < 1000) break;
    }
    res.json({ rows: out.slice(0, 400), more: out.length > 400 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Encrypted values back for those rows (nothing readable may come back, except the last 4 of a reference)
router.post('/privacy/encrypted', requireAuth, async (req, res) => {
  try {
    const t = TABLES[req.body?.table];
    if (!t) return res.status(400).json({ error: 'Unknown table' });
    const idc = t.id || 'id';
    const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).slice(0, 400);
    let done = 0;
    const queue = [...rows];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const r = queue.shift();
        const f = {};
        if (t.text.some(k => k in r && filled(r[k]) && !isEnc(r[k]))) continue;          // refuse readable text
        for (const k of t.text) if (k in r) f[k] = r[k] || null;
        let bad = false;
        for (const k of t.ref || []) {
          if (!(k in r)) continue;
          if (filled(r[k]) && (isEnc(r[k]) || String(r[k]).length > 8 || !isEnc(r[k + '_enc']))) { bad = true; break; }
          f[k] = r[k] || null; f[k + '_enc'] = r[k + '_enc'] || null;
        }
        for (const k of t.date || []) {
          if (!(k + '_enc' in r)) continue;
          if (!isEnc(r[k + '_enc'])) { bad = true; break; }
          f[k + '_enc'] = r[k + '_enc']; f[k] = null;
        }
        if (bad) continue;
        if (t.table === 'expense_transactions') Object.assign(f, txnExtras(r));
        if (t.table === 'user_sms_rules' && Array.isArray(r.pattern_tok)) f.pattern_tok = r.pattern_tok.slice(0, 20);
        if (t.signals) { const sg = nameSignals(r.signals); if (sg) f.signals = sg; }
        if (!Object.keys(f).length) continue;
        const old = (t.table === 'mf_holdings' || t.table === 'nps_holdings')
          ? (await supabase.from(t.table).select(t.table === 'mf_holdings' ? 'folio_number, isin' : 'pran').eq(idc, r.id).eq(t.owner, req.user.id).maybeSingle()).data : null;
        const { error } = await supabase.from(t.table).update(f).eq(idc, r.id).eq(t.owner, req.user.id);
        if (!error) { done++; if (old) await moveAssetRefs(req.user.id, t.table, old, f); }
      }
    }));
    res.json({ ok: true, done });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/privacy/migrated', requireAuth, async (req, res) => {
  const v = Math.max(1, Math.min(50, parseInt(req.body?.v, 10) || 1));
  await supabase.from('users').update({ enc_migrated_at: new Date().toISOString(), enc_migrated_v: v }).eq('id', req.user.id);
  // Old statement-sync logs held readable text and tried passwords: clear those (they are only diagnostics)
  await supabase.from('sync_logs').update({ raw_text_snippet: null, parsed_data: null }).eq('user_id', req.user.id).not('raw_text_snippet', 'like', 'ep1:%');
  await supabase.from('sync_logs').update({ pdf_password_tried: null }).eq('user_id', req.user.id).not('pdf_password_tried', 'like', 'ep1:%');
  res.json({ ok: true });
});

module.exports = router;
