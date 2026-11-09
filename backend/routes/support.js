// Support chat between a user and the admin, and diagnostics uploads (logs, app data, masked SMS).
// The admin is any user with users.is_admin (Hareesh). Images live in the private 'support' storage bucket
// and are only handed out as short-lived signed links.
const router = require('express').Router();
const crypto = require('crypto');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

const MAX_IMG = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function me(uid) {
  const { data } = await supabase.from('users').select('id, name, email, is_admin').eq('id', uid).maybeSingle();
  return data;
}
async function requireAdmin(req, res, next) {
  const u = await me(req.user.id).catch(() => null);
  if (!u?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

async function saveImages(ownerId, images) {
  const paths = [];
  for (const img of (Array.isArray(images) ? images : []).slice(0, 4)) {
    const ext = TYPES[img?.type];
    if (!ext || typeof img.data !== 'string') continue;
    const buf = Buffer.from(img.data.replace(/^data:[^,]+,/, ''), 'base64');
    if (!buf.length || buf.length > MAX_IMG) continue;
    const path = `${ownerId}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    const { error } = await supabase.storage.from('support').upload(path, buf, { contentType: img.type });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

async function withLinks(msgs) {
  const paths = [...new Set(msgs.flatMap(m => m.images || []))];
  const links = {};
  if (paths.length) {
    const { data } = await supabase.storage.from('support').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) links[d.path] = d.signedUrl; });
  }
  return msgs.map(m => ({ ...m, images: (m.images || []).map(p => links[p]).filter(Boolean) }));
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

// ── User side ────────────────────────────────────────────────────────────────
router.get('/support/messages', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('support_messages').select('*').eq('user_id', req.user.id).order('created_at').limit(500);
    if (error) throw error;
    await supabase.from('support_messages').update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id).eq('from_admin', true).is('read_at', null);
    res.json({ messages: await withLinks(data || []) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/support/unread', requireAuth, async (req, res) => {
  const { count } = await supabase.from('support_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id).eq('from_admin', true).is('read_at', null);
  const u = await me(req.user.id);
  res.json({ unread: count || 0, is_admin: !!u?.is_admin });
});

router.post('/support/messages', requireAuth, async (req, res) => {
  try {
    const body = clip(req.body?.body, 4000)?.trim() || '';
    const images = await saveImages(req.user.id, req.body?.images);
    if (!body && !images.length && !req.body?.diag_id) return res.status(400).json({ error: 'Write a message or add an image' });
    const { data, error } = await supabase.from('support_messages').insert({
      user_id: req.user.id, author_id: req.user.id, from_admin: false, body, images, diag_id: req.body?.diag_id || null,
    }).select().single();
    if (error) throw error;
    res.json({ message: (await withLinks([data]))[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Diagnostics: start (logs + app data), then SMS in batches, then done
router.post('/diag/start', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const { data, error } = await supabase.from('diag_uploads').insert({
      user_id: req.user.id, app_version: clip(b.app_version, 40), device: b.device || null, note: clip(b.note, 2000),
      logs: clip(b.logs, 2_000_000), data: b.data || null,
    }).select('id').single();
    if (error) throw error;
    res.json({ id: data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/diag/:id/sms', requireAuth, async (req, res) => {
  try {
    const { data: up } = await supabase.from('diag_uploads').select('id, sms_count').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!up) return res.status(404).json({ error: 'Upload not found' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 1000).map(s => ({
      upload_id: up.id, user_id: req.user.id, sender: clip(s.sender, 60), body: clip(s.body, 2000),
      sms_at: s.at ? new Date(+s.at).toISOString() : null, financial: !!s.financial, parsed: s.parsed || null,
    }));
    if (items.length) {
      const { error } = await supabase.from('diag_sms').insert(items);
      if (error) throw error;
      await supabase.from('diag_uploads').update({ sms_count: (up.sms_count || 0) + items.length }).eq('id', up.id);
    }
    res.json({ ok: true, added: items.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/diag/:id/done', requireAuth, async (req, res) => {
  try {
    const { data: up } = await supabase.from('diag_uploads').update({ finished_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id).select('id, sms_count').maybeSingle();
    if (!up) return res.status(404).json({ error: 'Upload not found' });
    // Leaves a note in the support thread so the admin sees it next to the conversation
    await supabase.from('support_messages').insert({ user_id: req.user.id, author_id: req.user.id, from_admin: false, diag_id: up.id,
      body: clip(req.body?.note, 2000) || `Sent diagnostics: logs, app data and ${up.sms_count || 0} SMS (masked).` });
    res.json({ ok: true, id: up.id, sms_count: up.sms_count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin side ───────────────────────────────────────────────────────────────
router.get('/support/admin/threads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: msgs } = await supabase.from('support_messages').select('user_id, from_admin, body, created_at, read_at, diag_id, images')
      .order('created_at', { ascending: false }).limit(2000);
    const by = new Map();
    for (const m of msgs || []) {
      const t = by.get(m.user_id) || { user_id: m.user_id, last: m, unread: 0, count: 0 };
      t.count++;
      if (!m.from_admin && !m.read_at) t.unread++;
      by.set(m.user_id, t);
    }
    const ids = [...by.keys()];
    const { data: users } = ids.length ? await supabase.from('users').select('id, name, email').in('id', ids) : { data: [] };
    const umap = Object.fromEntries((users || []).map(u => [u.id, u]));
    res.json({ threads: [...by.values()].map(t => ({ ...t, user: umap[t.user_id] || null,
      last: { body: t.last.body, from_admin: t.last.from_admin, created_at: t.last.created_at, images: (t.last.images || []).length, diag: !!t.last.diag_id } })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/support/admin/threads/:uid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const uid = req.params.uid;
    const [{ data: msgs }, { data: user }, { data: ups }] = await Promise.all([
      supabase.from('support_messages').select('*').eq('user_id', uid).order('created_at').limit(500),
      supabase.from('users').select('id, name, email, created_at').eq('id', uid).maybeSingle(),
      supabase.from('diag_uploads').select('id, created_at, finished_at, app_version, device, note, sms_count, status').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    ]);
    await supabase.from('support_messages').update({ read_at: new Date().toISOString() }).eq('user_id', uid).eq('from_admin', false).is('read_at', null);
    res.json({ user, messages: await withLinks(msgs || []), uploads: ups || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/support/admin/threads/:uid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = clip(req.body?.body, 4000)?.trim() || '';
    const images = await saveImages(req.params.uid, req.body?.images);
    if (!body && !images.length) return res.status(400).json({ error: 'Write a reply' });
    const { data, error } = await supabase.from('support_messages').insert({
      user_id: req.params.uid, author_id: req.user.id, from_admin: true, body, images }).select().single();
    if (error) throw error;
    res.json({ message: (await withLinks([data]))[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// One diagnostics upload: logs, data and a page of SMS (filter: all | financial | unparsed)
router.get('/support/admin/diag/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: up } = await supabase.from('diag_uploads').select('*').eq('id', req.params.id).maybeSingle();
    if (!up) return res.status(404).json({ error: 'Not found' });
    const page = Math.max(0, +req.query.page || 0), size = 200;
    let q = supabase.from('diag_sms').select('id, sender, body, sms_at, financial, parsed', { count: 'exact' }).eq('upload_id', up.id);
    if (req.query.filter === 'financial') q = q.eq('financial', true);
    if (req.query.filter === 'unparsed') q = q.eq('financial', true).is('parsed', null);
    if (req.query.q) q = q.ilike('body', `%${String(req.query.q).replace(/[%_]/g, '')}%`);
    const { data: sms, count } = await q.order('sms_at', { ascending: false }).range(page * size, page * size + size - 1);
    const [{ count: fin }, { count: unparsed }] = await Promise.all([
      supabase.from('diag_sms').select('id', { count: 'exact', head: true }).eq('upload_id', up.id).eq('financial', true),
      supabase.from('diag_sms').select('id', { count: 'exact', head: true }).eq('upload_id', up.id).eq('financial', true).is('parsed', null),
    ]);
    res.json({ upload: up, stats: { total: up.sms_count, financial: fin || 0, unparsed: unparsed || 0 }, sms: sms || [], count: count || 0, page, size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/support/admin/diag/:id', requireAuth, requireAdmin, async (req, res) => {
  const f = {};
  if (['new', 'looking', 'fixed'].includes(req.body?.status)) f.status = req.body.status;
  if (typeof req.body?.admin_note === 'string') f.admin_note = req.body.admin_note.slice(0, 4000);
  const { error } = await supabase.from('diag_uploads').update(f).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
