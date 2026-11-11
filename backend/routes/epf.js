/**
 * EPFO module: accounts, passbook upload (PDF) and SMS entries from the phone.
 *   GET    /api/epf                 accounts, recent entries, yearly totals
 *   POST   /api/epf/passbook        multipart "file" (PDF) or { text }
 *   POST   /api/epf/sms             { items: [{ date, amount, wage_month, balance, ref }] }  (read on the phone)
 *   POST   /api/epf/accounts        manual account { establishment, member_id, balance, balance_at }
 *   PUT    /api/epf/accounts/:id    edit / close
 *   DELETE /api/epf/accounts/:id
 * UAN and member id keep only the last 4 readable for encrypted accounts (full numbers sealed to the user's key).
 */
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');
const { parsePassbook, refreshAccount, wageMonth, fp, last4, num } = require('../services/epf');
const { lockRow, isEnc, encOk } = require('../services/privacy');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function accountFor(uid, { key, uan, memberId, establishment, source }) {
  let { data: have } = await supabase.from('epf_accounts').select('id').eq('user_id', uid).eq('member_key', key).maybeSingle();
  if (!have && !/X/.test(key)) {
    // An account first seen in SMS ("XX30") becomes this passbook's account once the full number is known
    const { data: accs } = await supabase.from('epf_accounts').select('id, member_key').eq('user_id', uid);
    const sms = (accs || []).filter(a => /X/.test(a.member_key) && key.endsWith(a.member_key.replace(/X/g, '')));
    if (sms.length === 1) { await supabase.from('epf_accounts').update({ member_key: key }).eq('id', sms[0].id); have = { id: sms[0].id }; }
  }
  if (have) {
    const patch = { updated_at: new Date().toISOString() };
    if (establishment) patch.establishment = String(establishment).slice(0, 120);
    if (uan || memberId) Object.assign(patch, await lockRow(uid, { ...(uan ? { uan } : {}), ...(memberId ? { member_id: memberId } : {}) }, { refs: ['uan', 'member_id'] }));
    await supabase.from('epf_accounts').update(patch).eq('id', have.id);
    return have.id;
  }
  const row = await lockRow(uid, { user_id: uid, member_key: key, uan: uan || null, member_id: memberId || null,
    establishment: establishment ? String(establishment).slice(0, 120) : null, source }, { refs: ['uan', 'member_id'] });
  const { data, error } = await supabase.from('epf_accounts').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: accounts }, { data: entries }] = await Promise.all([
      supabase.from('epf_accounts').select('*').eq('user_id', uid).order('created_at'),
      supabase.from('epf_entries').select('id, account_id, kind, wage_month, txn_date, employee, employer, pension, amount, balance, particulars, source')
        .eq('user_id', uid).order('txn_date', { ascending: false }).limit(600),
    ]);
    const byYear = {};
    for (const e of entries || []) {
      if (!e.txn_date) continue;
      const d = e.txn_date; const fy = +d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1;   // April–March
      const y = (byYear[fy] = byYear[fy] || { fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, employee: 0, employer: 0, pension: 0, interest: 0, withdrawn: 0 });
      if (e.kind === 'contribution') { y.employee += num(e.employee) || (e.source === 'sms' ? num(e.amount) : 0); y.employer += num(e.employer); y.pension += num(e.pension); }
      if (e.kind === 'interest') y.interest += num(e.employee) + num(e.employer);
      if (e.kind === 'withdrawal') y.withdrawn += -(num(e.employee) + num(e.employer));
    }
    const live = (accounts || []).filter(a => a.status !== 'closed');
    res.json({
      accounts: accounts || [], entries: entries || [],
      years: Object.values(byYear).sort((a, b) => b.fy.localeCompare(a.fy)),
      total: { balance: live.reduce((t, a) => t + num(a.balance), 0), pension: live.reduce((t, a) => t + num(a.pension), 0),
        monthly: live.reduce((t, a) => t + num(a.monthly), 0), at: live.map(a => a.balance_at).filter(Boolean).sort().pop() || null },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/passbook', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const uid = req.user.id;
    let text = req.body?.text || '';
    if (req.file) {
      if (!/pdf/i.test(req.file.mimetype) && !/\.pdf$/i.test(req.file.originalname || '')) return res.status(400).json({ error: 'Upload the passbook PDF from passbook.epfindia.gov.in' });
      try { text = (await pdfParse(req.file.buffer, req.body?.password ? { password: req.body.password } : undefined)).text; }
      catch { return res.status(400).json({ error: 'Could not read this PDF. If it is password protected, remove the password and try again.' }); }
    }
    const p = parsePassbook(text);
    if (!p.entries.length) return res.status(422).json({ error: 'No passbook rows found. Is this an EPFO member passbook?' });
    const key = last4(p.memberId || p.uan || 'EPF0');
    const accountId = await accountFor(uid, { key, uan: p.uan, memberId: p.memberId, establishment: p.establishment, source: 'passbook' });
    const rows = p.entries.map(e => ({ user_id: uid, account_id: accountId, source: 'passbook', ...e,
      fp: fp('pb', key, e.kind, e.wage_month || '', e.txn_date || '', e.employee, e.employer, e.pension) }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('epf_entries').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,fp', ignoreDuplicates: true });
      if (error) throw error;
    }
    await refreshAccount(uid, accountId);
    const { data: acc } = await supabase.from('epf_accounts').select('*').eq('id', accountId).single();
    res.json({ ok: true, account: acc, rows: rows.length, contributions: p.entries.filter(e => e.kind === 'contribution').length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// EPFO SMS read on the phone: contribution credited and passbook balance (the SMS text itself is not sent)
router.post('/sms', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 500).filter(i => isDate(i.date) && (num(i.amount) > 0 || num(i.balance) > 0));
    if (!items.length) return res.json({ ok: true, added: 0 });
    const groups = {};
    for (const it of items) (groups[last4(it.ref) || 'EPF0'] = groups[last4(it.ref) || 'EPF0'] || []).push(it);
    let added = 0;
    for (const [key, list] of Object.entries(groups)) {
      // EPFO SMS show only the last 2-4 digits ("XX30"): join the account whose number ends the same way,
      // or the only account the user has
      let k = key;
      const tail = key.replace(/X/g, '');
      if (key === 'EPF0' || tail.length < 4) {
        const { data: accs } = await supabase.from('epf_accounts').select('member_key').eq('user_id', uid);
        const hit = (accs || []).filter(a => tail && a.member_key.endsWith(tail));
        if (hit.length === 1) k = hit[0].member_key; else if ((accs || []).length === 1) k = accs[0].member_key;
      }
      const accountId = await accountFor(uid, { key: k, source: 'sms' });
      const rows = [];
      for (const it of list) {
        const wm = wageMonth(it.wage_month) || null;
        if (num(it.amount) > 0) rows.push({ user_id: uid, account_id: accountId, source: 'sms', kind: 'contribution', wage_month: wm, txn_date: it.date,
          amount: num(it.amount), particulars: wm ? `Contribution for ${wm}` : 'Contribution', fp: fp('sms', 'c', wm || it.date, num(it.amount)) });
        if (num(it.balance) > 0) rows.push({ user_id: uid, account_id: accountId, source: 'sms', kind: 'balance', txn_date: it.date, balance: num(it.balance),
          particulars: 'Passbook balance (EPFO SMS)', fp: fp('sms', 'b', it.date, num(it.balance)) });
      }
      const { data, error } = await supabase.from('epf_entries').upsert(rows, { onConflict: 'user_id,fp', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      added += (data || []).length;
      await refreshAccount(uid, accountId);
    }
    res.json({ ok: true, added });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id; const b = req.body || {};
    const key = last4(b.member_id || b.uan) || ('M' + Date.now().toString(36).slice(-3).toUpperCase());
    const row = await lockRow(uid, { user_id: uid, member_key: key, establishment: b.establishment ? String(b.establishment).slice(0, 120) : null,
      uan: b.uan || null, member_id: b.member_id || null, source: 'manual', balance: b.balance != null ? num(b.balance) : null, balance_at: isDate(b.balance_at) ? b.balance_at : null },
    { refs: ['uan', 'member_id'] });
    // Devices of encrypted accounts send the numbers already masked + encrypted
    for (const f of ['uan', 'member_id']) if (isEnc(b[f + '_enc']) && encOk(b[f + '_enc'])) { row[f] = String(b[f] || '').slice(0, 8); row[f + '_enc'] = b[f + '_enc']; }
    const { data, error } = await supabase.from('epf_accounts').insert(row).select().single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That member id is already added' : error.message });
    if (b.balance != null) await supabase.from('epf_entries').insert({ user_id: uid, account_id: data.id, source: 'manual', kind: 'balance', txn_date: isDate(b.balance_at) ? b.balance_at : new Date().toISOString().slice(0, 10), balance: num(b.balance), particulars: 'Balance entered', fp: fp('man', data.id, Date.now()) });
    await refreshAccount(uid, data.id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/accounts/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id; const b = req.body || {}; const patch = { updated_at: new Date().toISOString() };
    if (b.establishment !== undefined) patch.establishment = b.establishment ? String(b.establishment).slice(0, 120) : null;
    if (b.status === 'closed' || b.status === 'active') patch.status = b.status;
    await supabase.from('epf_accounts').update(patch).eq('id', req.params.id).eq('user_id', uid);
    if (b.balance != null) {
      await supabase.from('epf_entries').insert({ user_id: uid, account_id: req.params.id, source: 'manual', kind: 'balance', txn_date: isDate(b.balance_at) ? b.balance_at : new Date().toISOString().slice(0, 10), balance: num(b.balance), particulars: 'Balance entered', fp: fp('man', req.params.id, Date.now()) });
      await refreshAccount(uid, req.params.id);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  await supabase.from('epf_accounts').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
