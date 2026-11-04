/**
 * Kanalyst Blueprint — visual goal planner API
 *
 *   GET    /api/blueprint                     full canvas: boards, layers, buckets (valued), links
 *   GET    /api/blueprint/assets              mappable asset universe + which bucket owns each
 *   POST   /api/blueprint/layout              bulk save positions after drag/resize
 *
 *   POST   /api/blueprint/boards              PUT/DELETE /boards/:id
 *   POST   /api/blueprint/layers              PUT/DELETE /layers/:id
 *   POST   /api/blueprint/buckets             PUT/DELETE /buckets/:id
 *   POST   /api/blueprint/buckets/:id/complete | /reopen | /cycle
 *   POST   /api/blueprint/buckets/:id/assets  DELETE /buckets/:id/assets/:assetId
 *   POST   /api/blueprint/links               PUT/DELETE /links/:id
 *   GET    /api/blueprint/buckets/:id/notes   comments + attachments
 *   POST   /api/blueprint/buckets/:id/comments        DELETE /comments/:id
 *   POST   /api/blueprint/buckets/:id/attachments     (multipart "file")
 *   GET    /api/blueprint/attachments/:id/url          short-lived signed URL
 *   DELETE /api/blueprint/attachments/:id
 *
 * Rule: one stock / folio / FD / RD / NPS account / broker can be mapped to
 * only ONE bucket. A broker mapping covers every stock in that demat, so a
 * stock of that demat cannot sit in a different bucket (and vice versa).
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const multer      = require('multer');
const { computeFD } = require('./fd');
const { computeRD } = require('./rd');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const FILE_BUCKET = 'blueprint-files';

const nowIso = () => new Date().toISOString();
const today  = () => new Date().toISOString().split('T')[0];
const num    = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round(v * 100) / 100;

const BROKER_LABELS = {
  CDSL: 'CDSL demat',
  NSDL_ICICI: 'ICICI Direct (NSDL)',
  CDSL_GROWW: 'Groww (CDSL)',
  UNASSIGNED: 'Other / unassigned demat',
};
const brokerLabel = (d) => BROKER_LABELS[d] || d.replace(/_/g, ' ');

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  Asset universe — every mappable asset with its current value
// ═══════════════════════════════════════════════════════════════════
// Family: everyone in my family groups (from the existing Family module)
async function familyMembers(userId) {
  const { data: mine } = await supabase.from('family_members').select('group_id').eq('user_id', userId);
  const groups = (mine || []).map(m => m.group_id);
  let ids = [userId];
  if (groups.length) {
    const { data: members } = await supabase.from('family_members').select('user_id').in('group_id', groups);
    ids = [...new Set([userId, ...(members || []).map(m => m.user_id)])];
  }
  const { data: users } = await supabase.from('users').select('id, name, email').in('id', ids);
  const name = Object.fromEntries((users || []).map(u => [u.id, (u.name || u.email || 'Member').split(' ')[0]]));
  return ids.map(id => ({ id, name: id === userId ? 'You' : (name[id] || 'Member'), me: id === userId }));
}

// A stock's broker key: same owner prefix as the stock ("fam:<id>:" for family members)
function stockBrokerKey(ref) {
  const i = ref.lastIndexOf('|');
  const head = ref.slice(0, i);
  const prefix = head.startsWith('fam:') ? head.split(':').slice(0, 2).join(':') + ':' : '';
  return prefix + ref.slice(i + 1);
}

async function loadUniverse(userId) {
  const members = await familyMembers(userId);
  const parts = await Promise.all(members.map(m => loadMemberUniverse(m.id, m.me ? '' : `fam:${m.id}:`, m)));
  const items = parts.flat();
  const byKey = {};
  for (const it of items) byKey[`${it.asset_type}::${it.asset_ref}`] = it;
  return { items, byKey, members };
}

async function loadMemberUniverse(userId, prefix, member) {
  const [hRes, mfRes, fdRes, rdRes, npsRes] = await Promise.all([
    supabase.from('holdings').select('*').eq('user_id', userId),
    supabase.from('mf_holdings').select('*').eq('user_id', userId),
    supabase.from('fixed_deposits').select('*').eq('user_id', userId),
    supabase.from('recurring_deposits').select('*').eq('user_id', userId),
    supabase.from('nps_holdings').select('*').eq('user_id', userId).order('statement_to', { ascending: false }),
  ]);

  const items = [];

  // Stocks + broker roll-ups
  const brokers = {};
  for (const h of hRes.data || []) {
    if (!h.quantity) continue;
    const demat = h.demat_account || 'UNASSIGNED';
    const price = num(h.last_price) || num(h.avg_cost);
    const value = num(h.quantity) * price;
    const ref   = `${h.isin || h.symbol}|${demat}`;
    items.push({
      asset_type: 'stock', asset_ref: ref, demat,
      label: h.symbol || h.company, sub: `${h.company || ''} · ${num(h.quantity)} sh · ${brokerLabel(demat)}`,
      value: round2(value),
    });
    if (!brokers[demat]) brokers[demat] = { value: 0, count: 0 };
    brokers[demat].value += value;
    brokers[demat].count += 1;
  }
  for (const [demat, b] of Object.entries(brokers)) {
    items.push({
      asset_type: 'broker', asset_ref: demat, demat,
      label: brokerLabel(demat), sub: `Entire portfolio · ${b.count} stocks`,
      value: round2(b.value),
    });
  }

  // Mutual fund folios
  for (const m of mfRes.data || []) {
    if (num(m.units) <= 0 && num(m.current_value) <= 0) continue;
    items.push({
      asset_type: 'mf', asset_ref: `${m.folio_number || ''}|${m.isin || ''}`,
      label: m.fund_name || m.isin, sub: `Folio ${m.folio_number || '—'}${m.fund_category ? ' · ' + m.fund_category : ''}`,
      value: round2(num(m.current_value)),
    });
  }

  // FDs / RDs
  for (const fd of fdRes.data || []) {
    let c = {};
    try { c = computeFD(fd); } catch (e) { c = { current_value: num(fd.principal_amount), is_active: true }; }
    items.push({
      asset_type: 'fd', asset_ref: String(fd.fd_id || fd.id),
      label: fd.nickname || `${fd.institution_name || 'FD'}`, sub: `FD · matures ${c.maturity_date || '—'}${c.is_active ? '' : ' · closed'}`,
      value: round2(num(c.current_value)), inactive: !c.is_active,
    });
  }
  for (const rd of rdRes.data || []) {
    let c = {};
    try { c = computeRD(rd); } catch (e) { c = { current_value: 0, is_active: true }; }
    items.push({
      asset_type: 'rd', asset_ref: String(rd.rd_id || rd.id),
      label: rd.nickname || `${rd.institution_name || 'RD'}`, sub: `RD · ₹${num(rd.monthly_installment).toLocaleString('en-IN')}/mo${c.is_active ? '' : ' · closed'}`,
      value: round2(num(c.current_value)), inactive: !c.is_active,
    });
  }

  // NPS — latest statement per PRAN
  const seenPran = new Set();
  for (const n of npsRes.data || []) {
    const key = n.pran || n.id;
    if (seenPran.has(key)) continue;
    seenPran.add(key);
    items.push({
      asset_type: 'nps', asset_ref: String(key),
      label: `NPS ${n.tier ? 'Tier ' + n.tier : ''}`.trim(), sub: `PRAN ${n.pran || '—'} · as of ${n.statement_to || '—'}`,
      value: round2(num(n.total_value)),
    });
  }

  for (const it of items) {
    it.asset_ref = prefix + it.asset_ref;
    if (it.demat) it.demat = prefix + it.demat;
    it.owner_id = member.id;
    it.owner_name = member.name;
    it.owner_me = member.me;
    if (!member.me) it.sub = `${member.name} · ${it.sub}`;
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════
//  Income inflow (monthly average) for income buckets
// ═══════════════════════════════════════════════════════════════════
async function incomeInflows(userId, incomeBuckets) {
  const out = {};
  if (!incomeBuckets.length) return out;

  const since90  = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
  const since365 = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];

  const needCat = incomeBuckets.some(b => b.income_source === 'income_category');
  const needDiv = incomeBuckets.some(b => b.income_source === 'dividends');

  let entries = [], divs = [];
  if (needCat) {
    const { data } = await supabase.from('income_entries').select('category, amount, credited_on')
      .eq('user_id', userId).gte('credited_on', since90);
    entries = data || [];
  }
  if (needDiv) {
    // Kanalyst stores dividends in dividend_income (per ex-date); the older
    // dividends table (email-parsed credits) is used only as a fallback.
    const { data: di } = await supabase.from('dividend_income').select('total_dividend, ex_date')
      .eq('user_id', userId).gte('ex_date', since365).lte('ex_date', new Date().toISOString().split('T')[0]);
    divs = (di || []).map(d => ({ total_amount: d.total_dividend }));
    if (!divs.length) {
      const { data } = await supabase.from('dividends').select('total_amount, credit_date')
        .eq('user_id', userId).gte('credit_date', since365);
      divs = data || [];
    }
  }

  for (const b of incomeBuckets) {
    if (b.income_source === 'income_category' && b.income_category) {
      const cat = b.income_category.toLowerCase();
      const total = entries.filter(e => (e.category || '').toLowerCase() === cat).reduce((s, e) => s + num(e.amount), 0);
      out[b.id] = { monthly: round2(total / 3), basis: 'Avg of last 90 days' };
    } else if (b.income_source === 'dividends') {
      const total = divs.reduce((s, d) => s + num(d.total_amount), 0);
      out[b.id] = { monthly: round2(total / 12), basis: 'Avg of last 12 months' };
    } else {
      out[b.id] = { monthly: num(b.expected_amount), basis: 'Expected (manual)' };
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  GET /api/blueprint
// ═══════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [bRes, lRes, kRes, aRes, linkRes, cRes, atRes] = await Promise.all([
      supabase.from('bp_boards').select('*').eq('user_id', uid).order('created_at'),
      supabase.from('bp_layers').select('*').eq('user_id', uid).order('sort_order'),
      supabase.from('bp_buckets').select('*').eq('user_id', uid).order('created_at'),
      supabase.from('bp_bucket_assets').select('*').eq('user_id', uid),
      supabase.from('bp_links').select('*').eq('user_id', uid),
      supabase.from('bp_comments').select('bucket_id').eq('user_id', uid),
      supabase.from('bp_attachments').select('bucket_id').eq('user_id', uid),
    ]);
    const firstErr = [bRes, lRes, kRes, aRes, linkRes].find(r => r.error);
    if (firstErr) {
      const missing = /relation .* does not exist|Could not find the table/i.test(firstErr.error.message);
      return res.status(missing ? 503 : 500).json({
        error: missing ? 'Blueprint tables are not created yet. Run backend/migrations/2026-11-03_blueprint.sql in Supabase.' : firstErr.error.message,
        needsMigration: missing,
      });
    }

    const { byKey } = await loadUniverse(uid);
    const assetsByBucket = {};
    for (const a of aRes.data || []) {
      const live = byKey[`${a.asset_type}::${a.asset_ref}`];
      (assetsByBucket[a.bucket_id] = assetsByBucket[a.bucket_id] || []).push({
        ...a,
        label: live?.label || a.asset_label || a.asset_ref,
        sub: live?.sub || 'No longer found in your holdings',
        value: live ? live.value : 0,
        missing: !live,
      });
    }

    const countBy = (rows) => (rows || []).reduce((m, r) => { m[r.bucket_id] = (m[r.bucket_id] || 0) + 1; return m; }, {});
    const commentCount = countBy(cRes.data);
    const attachCount  = countBy(atRes.data);

    const buckets = kRes.data || [];
    const inflows = await incomeInflows(uid, buckets.filter(b => b.kind === 'income'));

    const enriched = buckets.map(b => {
      const assets = assetsByBucket[b.id] || [];
      const assetValue = assets.reduce((s, a) => s + num(a.value), 0);
      const current = round2(assetValue + num(b.manual_value));
      const target = num(b.target_amount);
      return {
        ...b,
        assets,
        current_value: current,
        progress: target > 0 ? Math.round(Math.min(999, (current / target) * 100) * 10) / 10 : 0,
        inflow: inflows[b.id] || null,
        comment_count: commentCount[b.id] || 0,
        attachment_count: attachCount[b.id] || 0,
      };
    });

    const boards = (bRes.data || []).map(bd => ({
      ...bd,
      layers: (lRes.data || []).filter(l => l.board_id === bd.id).sort((a, b) => a.sort_order - b.sort_order),
    }));

    res.json({ boards, buckets: enriched, links: linkRes.data || [] });
  } catch (err) {
    console.error(JSON.stringify({ event: 'BLUEPRINT_GET_ERROR', error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── Asset universe with ownership ──────────────────────────────────
router.get('/assets', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ items, members }, { data: links }, { data: buckets }, { data: incomeCats }] = await Promise.all([
      loadUniverse(uid),
      supabase.from('bp_bucket_assets').select('bucket_id, asset_type, asset_ref').eq('user_id', uid),
      supabase.from('bp_buckets').select('id, name').eq('user_id', uid),
      supabase.from('income_entries').select('category').eq('user_id', uid).limit(1000),
    ]);
    const nameOf = Object.fromEntries((buckets || []).map(b => [b.id, b.name]));
    const owner = {};
    const brokerOwner = {};
    for (const l of links || []) {
      owner[`${l.asset_type}::${l.asset_ref}`] = l.bucket_id;
      if (l.asset_type === 'broker') brokerOwner[l.asset_ref] = l.bucket_id;
    }
    const out = items.map(it => {
      let ownerId = owner[`${it.asset_type}::${it.asset_ref}`] || null;
      let via = null;
      if (!ownerId && it.asset_type === 'stock' && brokerOwner[it.demat]) { ownerId = brokerOwner[it.demat]; via = 'broker'; }
      return { ...it, owner_bucket_id: ownerId, owner_bucket_name: ownerId ? nameOf[ownerId] : null, owned_via: via };
    });
    const categories = [...new Set((incomeCats || []).map(r => r.category).filter(Boolean))].sort();
    res.json({ assets: out, incomeCategories: categories, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk layout save ───────────────────────────────────────────────
router.post('/layout', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { buckets = [], boards = [], layers = [] } = req.body || {};
  const jobs = [];
  for (const b of buckets.slice(0, 300)) {
    jobs.push(supabase.from('bp_buckets').update({
      ...pick(b, ['x', 'y', 'w', 'h', 'board_id', 'layer_id']), updated_at: nowIso(),
    }).eq('id', b.id).eq('user_id', uid));
  }
  for (const b of boards.slice(0, 50)) {
    jobs.push(supabase.from('bp_boards').update({ ...pick(b, ['x', 'y', 'w']), updated_at: nowIso() }).eq('id', b.id).eq('user_id', uid));
  }
  for (const l of layers.slice(0, 200)) {
    jobs.push(supabase.from('bp_layers').update(pick(l, ['height', 'sort_order'])).eq('id', l.id).eq('user_id', uid));
  }
  const results = await Promise.all(jobs);
  const err = results.find(r => r.error);
  if (err) return res.status(500).json({ error: err.error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Boards
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_LAYERS = [
  { label: 'This month',  period: 'month',      horizon: 'this_month' },
  { label: 'This year',   period: 'year',       horizon: 'this_year' },
  { label: 'Next year',   period: 'year',       horizon: 'next_year' },
  { label: '2 – 5 years', period: 'multi_year', horizon: 'years_2_5' },
  { label: '5+ years',    period: 'multi_year', horizon: 'beyond_5' },
];
const HORIZONS = ['this_week', 'this_month', 'this_year', 'next_year', 'year_2', 'year_3', 'year_4', 'year_5', 'years_1_5', 'years_2_5', 'beyond_5', 'custom'];
const cleanDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
function laneFields(body) {
  const out = pick(body || {}, ['label', 'period', 'height', 'sort_order', 'horizon', 'horizon_from', 'horizon_to']);
  if (out.horizon !== undefined && !HORIZONS.includes(out.horizon)) out.horizon = null;
  if (out.horizon_from !== undefined) out.horizon_from = cleanDate(out.horizon_from);
  if (out.horizon_to !== undefined) out.horizon_to = cleanDate(out.horizon_to);
  if (out.horizon && out.horizon !== 'custom') { out.horizon_from = null; out.horizon_to = null; }
  return out;
}

router.post('/boards', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const { data: board, error } = await supabase.from('bp_boards').insert({
    user_id: uid, name: b.name, description: b.description || null, color: b.color || 'lime',
    x: num(b.x) || 80, y: num(b.y) || 200, w: num(b.w) || 900,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const layerDefs = Array.isArray(b.layers) && b.layers.length ? b.layers : DEFAULT_LAYERS;
  const { data: layers, error: lErr } = await supabase.from('bp_layers').insert(
    layerDefs.map((l, i) => ({ user_id: uid, board_id: board.id, ...laneFields(l), label: l.label, period: l.period || 'year', height: 150, sort_order: i }))
  ).select();
  if (lErr) return res.status(500).json({ error: lErr.message });
  res.status(201).json({ ...board, layers: layers.sort((a, z) => a.sort_order - z.sort_order) });
});

router.put('/boards/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bp_boards')
    .update({ ...pick(req.body, ['name', 'description', 'color', 'x', 'y', 'w']), updated_at: nowIso() })
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/boards/:id', requireAuth, async (req, res) => {
  // Buckets inside cascade-delete with the board; links cascade with them.
  const { error } = await supabase.from('bp_boards').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Layers
// ═══════════════════════════════════════════════════════════════════
router.post('/layers', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { board_id, label, period, position, index } = req.body || {};
  if (!board_id || !label) return res.status(400).json({ error: 'board_id and label are required' });
  const { data: existing } = await supabase.from('bp_layers').select('id, sort_order').eq('board_id', board_id).eq('user_id', uid).order('sort_order');
  const list = existing || [];
  // index: insert at this position (lanes keep time order); else top / bottom
  let at = position === 'top' ? 0 : list.length;
  if (Number.isInteger(index)) at = Math.max(0, Math.min(list.length, index));
  // Re-number everything after the insertion point so order stays 0..n
  await Promise.all(list.map((l, i) => {
    const want = i < at ? i : i + 1;
    return l.sort_order === want ? null : supabase.from('bp_layers').update({ sort_order: want }).eq('id', l.id);
  }).filter(Boolean));
  const { data, error } = await supabase.from('bp_layers').insert({
    user_id: uid, board_id, ...laneFields(req.body), label, period: period || 'year', height: 150, sort_order: at,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/layers/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bp_layers')
    .update(laneFields(req.body))
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/layers/:id', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { count } = await supabase.from('bp_buckets').select('id', { count: 'exact', head: true })
    .eq('layer_id', req.params.id).eq('user_id', uid);
  if (count > 0) return res.status(409).json({ error: `Move or delete the ${count} bucket(s) in this layer first.` });
  const { error } = await supabase.from('bp_layers').delete().eq('id', req.params.id).eq('user_id', uid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Buckets
// ═══════════════════════════════════════════════════════════════════
const BUCKET_FIELDS = ['name', 'icon', 'color', 'recurrence_day', 'recurrence_month', 'target_amount', 'target_date', 'recurrence', 'cycle_start', 'manual_value',
  'income_source', 'income_category', 'expected_amount', 'x', 'y', 'w', 'h', 'board_id', 'layer_id', 'kind', 'status'];

function cleanBucket(body) {
  const b = pick(body || {}, BUCKET_FIELDS);
  for (const k of ['target_amount', 'manual_value', 'expected_amount']) if (b[k] !== undefined) b[k] = b[k] === '' || b[k] === null ? null : num(b[k]);
  if (b.target_date === '') b.target_date = null;
  if (b.recurrence && !['none', 'weekly', 'monthly', 'yearly'].includes(b.recurrence)) b.recurrence = 'none';
  const int = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  if (b.recurrence_day !== undefined) b.recurrence_day = b.recurrence_day === '' ? null : int(b.recurrence_day, 0, 31);
  if (b.recurrence_month !== undefined) b.recurrence_month = b.recurrence_month === '' ? null : int(b.recurrence_month, 1, 12);
  if (b.recurrence === 'none') { b.recurrence_day = null; b.recurrence_month = null; }
  if (b.color !== undefined && b.color !== null && !/^[a-z_]{2,20}$/.test(b.color)) b.color = null;
  if (b.kind && !['goal', 'income'].includes(b.kind)) b.kind = 'goal';
  if (b.kind === 'income') { b.board_id = null; b.layer_id = null; }
  return b;
}

router.post('/buckets', requireAuth, async (req, res) => {
  const b = cleanBucket(req.body);
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase.from('bp_buckets').insert({
    user_id: req.user.id, kind: 'goal', status: 'open', recurrence: 'none', ...b,
    cycle_start: b.recurrence && b.recurrence !== 'none' ? (b.cycle_start || today()) : null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/buckets/:id', requireAuth, async (req, res) => {
  const b = cleanBucket(req.body);
  delete b.status; // status changes go through complete / reopen
  // A special goal's target and date belong to its module (e.g. the Retirement planner)
  const { data: cur0 } = await supabase.from('bp_buckets').select('special_kind').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (cur0?.special_kind === 'retirement') { delete b.target_amount; delete b.target_date; delete b.recurrence; }
  if (b.recurrence && b.recurrence !== 'none' && b.cycle_start === undefined) {
    const { data: cur } = await supabase.from('bp_buckets').select('cycle_start').eq('id', req.params.id).single();
    if (!cur?.cycle_start) b.cycle_start = today();
  }
  const { data, error } = await supabase.from('bp_buckets').update({ ...b, updated_at: nowIso() })
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/buckets/:id', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: files } = await supabase.from('bp_attachments').select('storage_path').eq('bucket_id', req.params.id).eq('user_id', uid);
  if (files?.length) await supabase.storage.from(FILE_BUCKET).remove(files.map(f => f.storage_path)).catch(() => {});
  const { error } = await supabase.from('bp_buckets').delete().eq('id', req.params.id).eq('user_id', uid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

async function systemComment(uid, bucketId, body) {
  await supabase.from('bp_comments').insert({ user_id: uid, bucket_id: bucketId, body, is_system: true });
}

router.post('/buckets/:id/complete', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bp_buckets')
    .update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() })
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await systemComment(req.user.id, data.id, 'Goal marked as completed.');
  res.json(data);
});

router.post('/buckets/:id/reopen', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bp_buckets')
    .update({ status: 'inprogress', completed_at: null, updated_at: nowIso() })
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await systemComment(req.user.id, data.id, 'Goal reopened.');
  res.json(data);
});

// Recurring goal: close the current cycle and start the next one
router.post('/buckets/:id/cycle', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: b, error } = await supabase.from('bp_buckets').select('*').eq('id', req.params.id).eq('user_id', uid).single();
  if (error || !b) return res.status(404).json({ error: 'Bucket not found' });
  const achieved = num(req.body?.achieved);
  const fmt = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  await systemComment(uid, b.id,
    `Cycle ${b.cycle_start || ''} → ${today()} closed: ${fmt(achieved)} of ${fmt(num(b.target_amount))}${req.body?.note ? ' — ' + req.body.note : ''}`);
  // EMI: the instalment paid this cycle moves into the loan goal outside the box
  let loanPaid = null;
  if (b.is_emi && b.emi_loan_id) {
    const paid = achieved > 0 ? achieved : num(b.target_amount);
    const { data: loan } = await supabase.from('bp_buckets').select('id, manual_value, target_amount, name')
      .eq('id', b.emi_loan_id).eq('user_id', uid).maybeSingle();
    if (loan && paid > 0) {
      const total = round2(num(loan.manual_value) + paid);
      await supabase.from('bp_buckets').update({ manual_value: total, status: 'inprogress', updated_at: nowIso() })
        .eq('id', loan.id).eq('user_id', uid);
      await systemComment(uid, loan.id, `EMI ${fmt(paid)} paid from “${b.name}” — total paid ${fmt(total)} of ${fmt(num(loan.target_amount))}`);
      loanPaid = { loan_id: loan.id, paid, total };
    }
  }
  const { data, error: uErr } = await supabase.from('bp_buckets')
    .update({ cycle_start: today(), manual_value: 0, updated_at: nowIso() })
    .eq('id', b.id).eq('user_id', uid).select().single();
  if (uErr) return res.status(500).json({ error: uErr.message });
  res.json({ ...data, loanPaid });
});

// ── EMI on/off: creates (or removes) the loan goal outside the box ──
router.post('/buckets/:id/emi', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { enabled, loan_amount, loan_name, loan_paid, x, y } = req.body || {};
  const { data: b } = await supabase.from('bp_buckets').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!b) return res.status(404).json({ error: 'Goal not found' });
  if (b.kind !== 'goal' || b.is_loan) return res.status(400).json({ error: 'Only a goal can be an EMI' });

  if (!enabled) {
    if (b.emi_loan_id) await supabase.from('bp_buckets').delete().eq('id', b.emi_loan_id).eq('user_id', uid).eq('is_loan', true);
    const { data } = await supabase.from('bp_buckets').update({ is_emi: false, emi_loan_id: null, updated_at: nowIso() })
      .eq('id', b.id).eq('user_id', uid).select().single();
    return res.json(data);
  }

  if (!(num(loan_amount) > 0)) return res.status(400).json({ error: 'Enter the total loan amount' });
  let loanId = b.emi_loan_id;
  if (loanId) {
    await supabase.from('bp_buckets').update({
      name: (loan_name || '').trim() || `${b.name} — loan`, target_amount: num(loan_amount),
      ...(loan_paid !== undefined && loan_paid !== '' ? { manual_value: num(loan_paid) } : {}), updated_at: nowIso(),
    }).eq('id', loanId).eq('user_id', uid);
  } else {
    const { data: loan, error } = await supabase.from('bp_buckets').insert({
      user_id: uid, kind: 'goal', is_loan: true, status: 'inprogress', recurrence: 'none',
      name: (loan_name || '').trim() || `${b.name} — loan`, color: b.color || 'slate',
      target_amount: num(loan_amount), manual_value: num(loan_paid), target_date: b.target_date || null,
      board_id: null, layer_id: null, x: Math.round(num(x)), y: Math.round(num(y)), w: 230, h: 112,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    loanId = loan.id;
    await supabase.from('bp_links').insert({ user_id: uid, from_bucket_id: b.id, to_bucket_id: loanId, link_type: 'emi', label: null });
  }
  const { data, error: uErr } = await supabase.from('bp_buckets').update({
    is_emi: true, emi_loan_id: loanId,
    recurrence: b.recurrence === 'none' ? 'monthly' : b.recurrence,
    recurrence_day: b.recurrence === 'none' ? (b.recurrence_day || 5) : b.recurrence_day,
    cycle_start: b.cycle_start || today(), updated_at: nowIso(),
  }).eq('id', b.id).eq('user_id', uid).select().single();
  if (uErr) return res.status(500).json({ error: uErr.message });
  res.json(data);
});

// ── Asset mapping ──────────────────────────────────────────────────
router.post('/buckets/:id/assets', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const bucketId = req.params.id;
  const { asset_type, asset_ref, asset_label } = req.body || {};
  if (!['stock', 'broker', 'mf', 'fd', 'rd', 'nps'].includes(asset_type) || !asset_ref)
    return res.status(400).json({ error: 'Valid asset_type and asset_ref are required' });

  const { data: bucket } = await supabase.from('bp_buckets').select('id, kind').eq('id', bucketId).eq('user_id', uid).maybeSingle();
  if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
  if (bucket.kind === 'income') return res.status(400).json({ error: 'Income buckets cannot hold assets.' });

  const { data: mine } = await supabase.from('bp_bucket_assets').select('id, bucket_id, asset_type, asset_ref').eq('user_id', uid);
  const { data: names } = await supabase.from('bp_buckets').select('id, name').eq('user_id', uid);
  const nameOf = Object.fromEntries((names || []).map(n => [n.id, n.name]));
  const rows = mine || [];

  const same = rows.find(r => r.asset_type === asset_type && r.asset_ref === asset_ref);
  if (same) {
    if (same.bucket_id === bucketId) return res.status(409).json({ error: 'Already mapped to this bucket.' });
    return res.status(409).json({ error: `Already mapped to "${nameOf[same.bucket_id] || 'another bucket'}". One asset can fund only one goal.` });
  }

  let absorb = [];
  if (asset_type === 'stock') {
    const demat = stockBrokerKey(asset_ref);
    const brokerRow = rows.find(r => r.asset_type === 'broker' && r.asset_ref === demat);
    if (brokerRow) return res.status(409).json({
      error: brokerRow.bucket_id === bucketId
        ? 'This stock is already covered by the broker mapped to this bucket.'
        : `Its whole broker account is mapped to "${nameOf[brokerRow.bucket_id] || 'another bucket'}".`,
    });
  }
  if (asset_type === 'broker') {
    const stockRows = rows.filter(r => r.asset_type === 'stock' && stockBrokerKey(r.asset_ref) === asset_ref);
    const elsewhere = stockRows.filter(r => r.bucket_id !== bucketId);
    if (elsewhere.length) return res.status(409).json({
      error: `${elsewhere.length} stock(s) from this broker are already mapped to "${nameOf[elsewhere[0].bucket_id] || 'another bucket'}". Unmap them first.`,
    });
    absorb = stockRows.map(r => r.id); // same-bucket single stocks are replaced by the broker roll-up
  }

  if (absorb.length) await supabase.from('bp_bucket_assets').delete().in('id', absorb).eq('user_id', uid);

  const { data, error } = await supabase.from('bp_bucket_assets').insert({
    user_id: uid, bucket_id: bucketId, asset_type, asset_ref, asset_label: asset_label || null,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'This asset is already mapped to another bucket.' });
    return res.status(500).json({ error: error.message });
  }
  await supabase.from('bp_buckets').update({ status: 'inprogress', updated_at: nowIso() })
    .eq('id', bucketId).eq('user_id', uid).eq('status', 'open');
  res.status(201).json({ ...data, absorbed: absorb.length });
});

router.delete('/buckets/:id/assets/:assetId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('bp_bucket_assets').delete()
    .eq('id', req.params.assetId).eq('bucket_id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Links
// ═══════════════════════════════════════════════════════════════════
router.post('/links', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { from_bucket_id, to_bucket_id, to_board_id, link_type, label, amount } = req.body || {};
  if (!from_bucket_id || (!to_bucket_id && !to_board_id)) return res.status(400).json({ error: 'from_bucket_id and a target are required' });
  if (from_bucket_id === to_bucket_id) return res.status(400).json({ error: 'A bucket cannot link to itself.' });

  const { data: existing } = await supabase.from('bp_links').select('id').eq('user_id', uid)
    .eq('from_bucket_id', from_bucket_id)
    [to_bucket_id ? 'eq' : 'is']('to_bucket_id', to_bucket_id || null)
    [to_board_id ? 'eq' : 'is']('to_board_id', to_board_id || null).maybeSingle();
  if (existing) return res.status(409).json({ error: 'These are already linked.' });

  const { data: from } = await supabase.from('bp_buckets').select('kind').eq('id', from_bucket_id).eq('user_id', uid).maybeSingle();
  if (!from) return res.status(404).json({ error: 'Source bucket not found' });

  const { data, error } = await supabase.from('bp_links').insert({
    user_id: uid, from_bucket_id, to_bucket_id: to_bucket_id || null, to_board_id: to_board_id || null,
    link_type: link_type || (from.kind === 'income' ? 'funds' : 'backup'),
    label: label || null, amount: amount === undefined || amount === '' ? null : num(amount),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/links/:id', requireAuth, async (req, res) => {
  const body = pick(req.body, ['link_type', 'label', 'amount']);
  if (body.amount !== undefined) body.amount = body.amount === '' || body.amount === null ? null : num(body.amount);
  const { data, error } = await supabase.from('bp_links').update(body)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/links/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('bp_links').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Comments & attachments
// ═══════════════════════════════════════════════════════════════════
router.get('/buckets/:id/notes', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const [c, a] = await Promise.all([
    supabase.from('bp_comments').select('*').eq('bucket_id', req.params.id).eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('bp_attachments').select('*').eq('bucket_id', req.params.id).eq('user_id', uid).order('created_at', { ascending: false }),
  ]);
  if (c.error || a.error) return res.status(500).json({ error: (c.error || a.error).message });
  res.json({ comments: c.data || [], attachments: a.data || [] });
});

router.post('/buckets/:id/comments', requireAuth, async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment is empty' });
  const { data: owns } = await supabase.from('bp_buckets').select('id').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!owns) return res.status(404).json({ error: 'Bucket not found' });
  const { data, error } = await supabase.from('bp_comments').insert({
    user_id: req.user.id, bucket_id: req.params.id, body: body.slice(0, 4000),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/comments/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('bp_comments').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

let fileBucketReady = false;
async function ensureFileBucket() {
  if (fileBucketReady) return;
  const { error } = await supabase.storage.createBucket(FILE_BUCKET, { public: false });
  if (!error || /already exists|duplicate/i.test(error.message)) fileBucketReady = true;
}

router.post('/buckets/:id/attachments', requireAuth, upload.single('file'), async (req, res) => {
  const uid = req.user.id;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { data: owns } = await supabase.from('bp_buckets').select('id').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!owns) return res.status(404).json({ error: 'Bucket not found' });

  await ensureFileBucket();
  const safeName = req.file.originalname.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${uid}/${req.params.id}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage.from(FILE_BUCKET).upload(path, req.file.buffer, {
    contentType: req.file.mimetype, upsert: false,
  });
  if (upErr) return res.status(500).json({ error: `Upload failed: ${upErr.message}` });

  const { data, error } = await supabase.from('bp_attachments').insert({
    user_id: uid, bucket_id: req.params.id, file_name: req.file.originalname,
    mime_type: req.file.mimetype, size_bytes: req.file.size, storage_path: path,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.get('/attachments/:id/url', requireAuth, async (req, res) => {
  const { data: a } = await supabase.from('bp_attachments').select('storage_path, file_name')
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrl(a.storage_path, 300);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl, file_name: a.file_name });
});

router.delete('/attachments/:id', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: a } = await supabase.from('bp_attachments').select('storage_path').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  await supabase.storage.from(FILE_BUCKET).remove([a.storage_path]).catch(() => {});
  const { error } = await supabase.from('bp_attachments').delete().eq('id', req.params.id).eq('user_id', uid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
module.exports.loadUniverse = loadUniverse;
