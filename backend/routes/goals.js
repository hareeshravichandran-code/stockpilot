/**
 * Kanalyst — Goals Module API
 *
 * Routes:
 *   GET    /api/goals              list all goals (with linked assets + progress)
 *   POST   /api/goals              create goal
 *   PUT    /api/goals/:id          update goal
 *   DELETE /api/goals/:id          delete goal
 *   POST   /api/goals/:id/picture  upload goal picture
 *   GET    /api/goals/:id/assets   list linked assets
 *   POST   /api/goals/:id/assets   link an asset
 *   DELETE /api/goals/:id/assets/:assetId  unlink asset
 *   POST   /api/goals/:id/progress  recompute current_value from linked assets
 *   GET    /api/goals/:id/cycles   list goal cycles
 *   POST   /api/goals/:id/cycles   create/close a cycle
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const multer      = require('multer');
const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Duration types ─────────────────────────────────────────────────
const DURATION_TYPES = {
  ultra_short: { label: 'Ultra Short', hint: 'Days / Weeks' },
  short:       { label: 'Short',       hint: 'Months'       },
  mid:         { label: 'Mid Term',    hint: '1–5 Years'    },
  long:        { label: 'Long Term',   hint: '5+ Years'     },
};

// ── Helper: compute current_value from linked assets ──────────────
async function computeGoalProgress(userId, goalId) {
  // Get all linked assets
  const { data: assets } = await supabase.from('goal_assets')
    .select('asset_type, asset_ref')
    .eq('goal_id', goalId).eq('user_id', userId);

  if (!assets || assets.length === 0) return 0;

  let total = 0;

  for (const asset of assets) {
    if (asset.asset_type === 'stock') {
      const { data: h } = await supabase.from('holdings')
        .select('quantity, last_price')
        .eq('user_id', userId).eq('isin', asset.asset_ref).maybeSingle();
      if (h && h.quantity && h.last_price) total += h.quantity * h.last_price;
    } else if (asset.asset_type === 'mf') {
      const { data: h } = await supabase.from('mf_holdings')
        .select('current_value')
        .eq('user_id', userId)
        .or(`isin.eq.${asset.asset_ref},folio_number.eq.${asset.asset_ref}`)
        .maybeSingle();
      if (h?.current_value) total += parseFloat(h.current_value);
    } else if (asset.asset_type === 'manual') {
      // manual amounts are stored in notes as JSON
      try {
        const parsed = JSON.parse(asset.notes || '{}');
        if (parsed.value) total += parseFloat(parsed.value);
      } catch(e) {}
    }
  }

  return Math.round(total * 100) / 100;
}

// ── GET /api/goals ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { status, duration_type } = req.query;

  let q = supabase.from('goals').select('*').eq('user_id', req.user.id);
  if (status)        q = q.eq('status', status);
  if (duration_type) q = q.eq('duration_type', duration_type);
  q = q.order('created_at', { ascending: false });

  const { data: goals, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach linked assets count + recomputed current_value for each goal
  const enriched = await Promise.all((goals || []).map(async (goal) => {
    const { data: assets } = await supabase.from('goal_assets')
      .select('id, asset_type, asset_name, asset_ref, notes')
      .eq('goal_id', goal.id);

    const currentValue = await computeGoalProgress(req.user.id, goal.id);

    // Auto-update status
    let status = goal.status;
    if (currentValue >= goal.target_value && goal.target_value > 0) status = 'completed';
    else if (currentValue > 0) status = 'inprogress';

    if (status !== goal.status) {
      await supabase.from('goals').update({ current_value: currentValue, status, updated_at: new Date().toISOString() }).eq('id', goal.id);
    } else if (currentValue !== goal.current_value) {
      await supabase.from('goals').update({ current_value: currentValue, updated_at: new Date().toISOString() }).eq('id', goal.id);
    }

    const progress = goal.target_value > 0 ? Math.min(100, (currentValue / goal.target_value) * 100) : 0;

    return {
      ...goal,
      current_value: currentValue,
      status,
      progress: Math.round(progress * 10) / 10,
      assets: assets || [],
      asset_count: (assets || []).length,
    };
  }));

  // Summary
  const summary = {
    total:      enriched.length,
    new:        enriched.filter(g => g.status === 'new').length,
    inprogress: enriched.filter(g => g.status === 'inprogress').length,
    completed:  enriched.filter(g => g.status === 'completed').length,
    totalTargetValue:  enriched.reduce((s,g) => s + parseFloat(g.target_value || 0), 0),
    totalCurrentValue: enriched.reduce((s,g) => s + parseFloat(g.current_value || 0), 0),
  };

  res.json({ goals: enriched, summary });
});

// ── POST /api/goals ────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const {
    name, description, target_value, duration_type, target_date,
    is_recurring, recurrence, recurrence_day, recurrence_month,
  } = req.body;

  if (!name || !target_value) return res.status(400).json({ error: 'name and target_value are required' });

  const { data, error } = await supabase.from('goals').insert({
    user_id:          req.user.id,
    name,
    description:      description || null,
    target_value:     parseFloat(target_value),
    current_value:    0,
    duration_type:    duration_type || 'mid',
    target_date:      target_date || null,
    started_on:       new Date().toISOString().split('T')[0],
    is_recurring:     !!is_recurring,
    recurrence:       is_recurring ? (recurrence || null) : null,
    recurrence_day:   is_recurring && recurrence_day ? parseInt(recurrence_day) : null,
    recurrence_month: is_recurring && recurrence_month ? parseInt(recurrence_month) : null,
    status:           'new',
    created_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // If recurring, create first cycle
  if (is_recurring && recurrence) {
    await supabase.from('goal_cycles').insert({
      goal_id:      data.id,
      user_id:      req.user.id,
      cycle_number: 1,
      cycle_start:  new Date().toISOString().split('T')[0],
      target_value: parseFloat(target_value),
      status:       'inprogress',
    });
  }

  res.status(201).json({ ...data, assets: [], asset_count: 0, progress: 0 });
});

// ── PUT /api/goals/:id ─────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const allowed = ['name','description','target_value','duration_type','target_date',
                   'is_recurring','recurrence','recurrence_day','recurrence_month','status'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('goals')
    .update(updates).eq('id', req.params.id).eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/goals/:id ──────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('goals')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/goals/:id/picture ────────────────────────────────────
router.post('/:id/picture', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext      = req.file.originalname.split('.').pop().toLowerCase();
  const fileName = `goals/${req.user.id}/${req.params.id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('goal-pictures').upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  let url;
  if (upErr) {
    // Fallback: store as base64 data URL
    url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64').slice(0, 100000)}`;
  } else {
    const { data: { publicUrl } } = supabase.storage.from('goal-pictures').getPublicUrl(fileName);
    url = publicUrl;
  }

  await supabase.from('goals').update({ picture_url: url, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.id);

  res.json({ url });
});

// ── GET /api/goals/:id/assets ──────────────────────────────────────
router.get('/:id/assets', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('goal_assets')
    .select('*').eq('goal_id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/goals/:id/assets — link an asset to a goal ──────────
router.post('/:id/assets', requireAuth, async (req, res) => {
  const { asset_type, asset_ref, asset_name, notes } = req.body;
  if (!asset_type || !asset_ref) return res.status(400).json({ error: 'asset_type and asset_ref required' });

  // Check not already linked
  const { data: existing } = await supabase.from('goal_assets')
    .select('id').eq('goal_id', req.params.id).eq('user_id', req.user.id)
    .eq('asset_ref', asset_ref).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Asset already linked to this goal' });

  const { data, error } = await supabase.from('goal_assets').insert({
    goal_id:    req.params.id,
    user_id:    req.user.id,
    asset_type, asset_ref,
    asset_name: asset_name || asset_ref,
    notes:      notes || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Recompute goal progress
  const currentValue = await computeGoalProgress(req.user.id, req.params.id);
  await supabase.from('goals').update({ current_value: currentValue, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.id);

  res.status(201).json(data);
});

// ── DELETE /api/goals/:id/assets/:assetId ─────────────────────────
router.delete('/:id/assets/:assetId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('goal_assets')
    .delete().eq('id', req.params.assetId).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });

  // Recompute
  const currentValue = await computeGoalProgress(req.user.id, req.params.id);
  await supabase.from('goals').update({ current_value: currentValue, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.id);

  res.json({ success: true });
});

// ── POST /api/goals/:id/progress — force recompute ────────────────
router.post('/:id/progress', requireAuth, async (req, res) => {
  const currentValue = await computeGoalProgress(req.user.id, req.params.id);

  const { data: goal } = await supabase.from('goals')
    .select('target_value, status').eq('id', req.params.id).single();

  let status = goal?.status || 'inprogress';
  if (currentValue >= (goal?.target_value || 0) && goal?.target_value > 0) status = 'completed';
  else if (currentValue > 0) status = 'inprogress';

  await supabase.from('goals').update({
    current_value: currentValue, status,
    updated_at: new Date().toISOString()
  }).eq('id', req.params.id).eq('user_id', req.user.id);

  res.json({ current_value: currentValue, status, progress: goal?.target_value > 0 ? Math.min(100, (currentValue/goal.target_value)*100) : 0 });
});

// ── GET /api/goals/:id/cycles ──────────────────────────────────────
router.get('/:id/cycles', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('goal_cycles')
    .select('*').eq('goal_id', req.params.id).eq('user_id', req.user.id)
    .order('cycle_number', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/goals/:id/cycles — create or close a cycle ──────────
router.post('/:id/cycles', requireAuth, async (req, res) => {
  const { action, achieved_value, notes } = req.body; // action: 'close' | 'new'

  if (action === 'close') {
    // Close current open cycle and open next
    const { data: current } = await supabase.from('goal_cycles')
      .select('*').eq('goal_id', req.params.id).eq('status', 'inprogress')
      .order('cycle_number', { ascending: false }).limit(1).single();

    if (current) {
      await supabase.from('goal_cycles').update({
        status:          parseFloat(achieved_value||0) >= parseFloat(current.target_value||0) ? 'completed' : 'missed',
        achieved_value:  parseFloat(achieved_value || 0),
        cycle_end:       new Date().toISOString().split('T')[0],
        notes:           notes || null,
      }).eq('id', current.id);

      // Create next cycle
      const { data: goal } = await supabase.from('goals').select('target_value, recurrence').eq('id', req.params.id).single();
      await supabase.from('goal_cycles').insert({
        goal_id:      req.params.id,
        user_id:      req.user.id,
        cycle_number: current.cycle_number + 1,
        cycle_start:  new Date().toISOString().split('T')[0],
        target_value: goal?.target_value || 0,
        status:       'inprogress',
      });
    }
  } else {
    const { data: goal } = await supabase.from('goals').select('target_value').eq('id', req.params.id).single();
    const { data: lastCycle } = await supabase.from('goal_cycles')
      .select('cycle_number').eq('goal_id', req.params.id)
      .order('cycle_number', { ascending: false }).limit(1).maybeSingle();

    await supabase.from('goal_cycles').insert({
      goal_id:      req.params.id,
      user_id:      req.user.id,
      cycle_number: (lastCycle?.cycle_number || 0) + 1,
      cycle_start:  new Date().toISOString().split('T')[0],
      target_value: goal?.target_value || 0,
      status:       'inprogress',
    });
  }

  res.json({ success: true });
});

// ── GET /api/goals/duration-types ─────────────────────────────────
router.get('/duration-types', requireAuth, (req, res) => res.json(DURATION_TYPES));

module.exports = router;
