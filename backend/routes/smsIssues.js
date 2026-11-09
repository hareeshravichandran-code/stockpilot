// SMS reading issues: the app's "Help improve SMS reading" sends messages the reader struggled with;
// the admin sees one issue per message format and marks it pending / included in code / ignored.
const router = require('express').Router();
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');
const { report } = require('../services/smsIssues');

async function requireAdmin(req, res, next) {
  const { data } = await supabase.from('users').select('is_admin').eq('id', req.user.id).maybeSingle();
  if (!data?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// POST /api/sms-issues/report { app_version, items: [{ sender, body, at, kind, parsed }] } (masked on the phone)
router.post('/sms-issues/report', requireAuth, async (req, res) => {
  try {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 300);
    const out = await report(supabase, req.user.id, items, String(req.body?.app_version || '').slice(0, 20));
    res.json({ ok: true, filed: out.filter(Boolean).length, results: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin/sms-issues', requireAuth, requireAdmin, async (req, res) => {
  try {
    let q = supabase.from('sms_issues').select('id, sender_code, template, sample, kind, status, hits, users, amounts, first_seen, last_seen, admin_note, fixed_in, reopened', { count: 'exact' });
    if (['pending', 'included', 'ignored'].includes(req.query.status)) q = q.eq('status', req.query.status);
    if (req.query.sender) q = q.ilike('sender_code', `%${String(req.query.sender).replace(/[%_]/g, '')}%`);
    if (req.query.q) q = q.ilike('sample', `%${String(req.query.q).replace(/[%_]/g, '')}%`);
    const sort = req.query.sort === 'recent' ? 'last_seen' : 'hits';
    const page = Math.max(0, +req.query.page || 0);
    const { data, count, error } = await q.order('reopened', { ascending: false }).order(sort, { ascending: false }).range(page * 50, page * 50 + 49);
    if (error) throw error;
    const counts = {};
    for (const s of ['pending', 'included', 'ignored']) {
      const { count: c } = await supabase.from('sms_issues').select('id', { count: 'exact', head: true }).eq('status', s);
      counts[s] = c || 0;
    }
    const { data: senders } = await supabase.from('sms_issues').select('sender_code').eq('status', 'pending').limit(5000);
    const bySender = {};
    (senders || []).forEach(r => { bySender[r.sender_code] = (bySender[r.sender_code] || 0) + 1; });
    res.json({ issues: data || [], count: count || 0, page, counts, senders: Object.entries(bySender).sort((a, b) => b[1] - a[1]).slice(0, 30) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/sms-issues/:id', requireAuth, requireAdmin, async (req, res) => {
  const [{ data: issue }, { data: samples }] = await Promise.all([
    supabase.from('sms_issues').select('*').eq('id', req.params.id).maybeSingle(),
    supabase.from('sms_issue_samples').select('id, body, sender, sms_at, parsed, app_version, created_at').eq('issue_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (!issue) return res.status(404).json({ error: 'Not found' });
  res.json({ issue, samples: samples || [] });
});

router.put('/admin/sms-issues/:id', requireAuth, requireAdmin, async (req, res) => {
  const f = { updated_at: new Date().toISOString() };
  if (['pending', 'included', 'ignored'].includes(req.body?.status)) { f.status = req.body.status; f.reopened = false; }
  if (typeof req.body?.admin_note === 'string') f.admin_note = req.body.admin_note.slice(0, 4000);
  if (typeof req.body?.fixed_in === 'string') f.fixed_in = req.body.fixed_in.slice(0, 20) || null;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [req.params.id];
  const { error } = await supabase.from('sms_issues').update(f).in('id', ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, updated: ids.length });
});

// File a diagnostics upload's financial-but-unread SMS as issues (for uploads sent before this module)
router.post('/admin/sms-issues/import-diag/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: up } = await supabase.from('diag_uploads').select('id, user_id, app_version').eq('id', req.params.id).maybeSingle();
    if (!up) return res.status(404).json({ error: 'Upload not found' });
    let filed = 0;
    for (let from = 0; ; from += 500) {
      const { data } = await supabase.from('diag_sms').select('sender, body, sms_at, parsed').eq('upload_id', up.id).eq('financial', true).is('parsed', null)
        .order('id').range(from, from + 499);
      const items = (data || []).filter(r => /(?:rs\.?|inr|₹)\s*[\d,]+/i.test(r.body) && /\b(debited|credited|spent|withdrawn|sent|paid|received|deposited|transferred)\b/i.test(r.body)
        && !/\botp\b|one time password|pre-?approved|offer|declined|failed|not completed|will be debited|requested money|is due|due on|reminder/i.test(r.body))
        .map(r => ({ sender: r.sender, body: r.body, at: r.sms_at ? Date.parse(r.sms_at) : null, kind: 'missed' }));
      if (items.length) filed += (await report(supabase, up.user_id, items, up.app_version)).filter(Boolean).length;
      if (!data || data.length < 500) break;
    }
    res.json({ ok: true, filed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
