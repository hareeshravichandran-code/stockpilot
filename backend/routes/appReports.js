// Crash and error reports sent by the Android app (automatic, no user data: error text with digits masked + code stack).
// Login is optional: a crash can happen before login. Admin reads them in Supabase (table app_reports).
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

const hits = new Map();
function limited(key) {
  const now = Date.now();
  const t = (hits.get(key) || []).filter(x => now - x < 3600e3);
  t.push(now); hits.set(key, t);
  return t.length > 30;                          // 30 reports an hour per phone/IP
}
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
// Never keep numbers (amounts, accounts, phone numbers) even if an error message carried one
const mask = (v, n) => { const s = clip(v, n); return s == null ? null : s.replace(/\d{3,}/g, '#'); };

// POST /api/app-reports { reports: [{ kind, app_version, version_code, screen, error, stack, device, os, happened_at }] }
router.post('/app-reports', async (req, res) => {
  try {
    let uid = null;
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) { try { const d = jwt.verify(h.slice(7), process.env.JWT_SECRET); uid = d.id || d.userId || d.sub || null; } catch { /* expired: keep the report */ } }
    if (limited(uid || req.ip)) return res.status(429).json({ error: 'Too many reports' });
    const list = (Array.isArray(req.body?.reports) ? req.body.reports : []).slice(0, 10);
    const rows = list.map(r => ({
      user_id: uid, kind: ['crash', 'error'].includes(r?.kind) ? r.kind : 'error',
      app_version: clip(r?.app_version, 20), version_code: Number.isInteger(r?.version_code) ? r.version_code : null,
      screen: clip(r?.screen, 80), error: mask(r?.error, 500), stack: mask(r?.stack, 6000),
      device: clip(r?.device, 80), os: clip(r?.os, 40),
      happened_at: r?.happened_at && !isNaN(Date.parse(r.happened_at)) ? new Date(r.happened_at).toISOString() : null,
    })).filter(r => r.error || r.stack);
    if (rows.length) { const { error } = await supabase.from('app_reports').insert(rows); if (error) throw error; }
    res.json({ ok: true, saved: rows.length });
  } catch (err) { console.error('[app-reports]', err.message); res.status(500).json({ error: 'Could not save' }); }
});

module.exports = router;
