/**
 * Kanalyst — Fixed Deposit Routes
 * GET    /api/fd           — list all FDs with computed fields
 * POST   /api/fd           — create FD
 * PUT    /api/fd/:id       — update FD
 * DELETE /api/fd/:id       — delete FD
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── Pure computation helpers (no DB) ──────────────────────────────

function compoundingPeriodsPerYear(freq) {
  return { monthly:12, quarterly:4, half_yearly:2, annually:1, simple:1 }[freq] || 4;
}

function computeFD(fd, asOfDate = new Date()) {
  const today      = asOfDate;
  const startDate  = new Date(fd.start_date);
  const matDate    = new Date(startDate);
  matDate.setDate(matDate.getDate() + fd.tenor_days);

  const P   = parseFloat(fd.principal_amount);
  const r   = parseFloat(fd.interest_rate_pa) / 100;
  const n   = compoundingPeriodsPerYear(fd.compounding_freq);
  const tFull = fd.tenor_days / 365;

  // Maturity amount (cumulative)
  let maturityAmount;
  if (fd.payout_type === 'cumulative') {
    if (fd.compounding_freq === 'simple') {
      maturityAmount = P * (1 + r * tFull);
    } else {
      maturityAmount = P * Math.pow(1 + r / n, n * tFull);
    }
  } else {
    maturityAmount = P; // non-cumulative: interest paid out periodically
  }

  const totalInterest    = maturityAmount - P;
  const tdsRate          = fd.tds_applicable ? (parseFloat(fd.tds_rate) || 10) / 100 : 0;
  const netInterestAfterTDS = totalInterest * (1 - tdsRate);
  const netMaturity      = P + netInterestAfterTDS;

  // Accrued interest as of today
  const closeDate   = fd.premature_close_dt ? new Date(fd.premature_close_dt) : null;
  const effectiveEnd = closeDate || (today < matDate ? today : matDate);
  const daysElapsed  = Math.max(0, (effectiveEnd - startDate) / (1000 * 60 * 60 * 24));
  const tElapsed     = daysElapsed / 365;

  let accruedInterest;
  if (fd.compounding_freq === 'simple') {
    accruedInterest = P * r * tElapsed;
  } else {
    accruedInterest = P * (Math.pow(1 + r / n, n * tElapsed) - 1);
  }

  // Premature penalty
  if (closeDate && fd.premature_penalty) {
    const penalty = parseFloat(fd.premature_penalty) / 100;
    accruedInterest = accruedInterest * (1 - penalty);
  }

  const currentValue   = P + accruedInterest;
  const daysToMaturity = Math.round((matDate - today) / (1000 * 60 * 60 * 24));
  const isActive       = !closeDate && today <= matDate;

  return {
    maturity_date:         matDate.toISOString().split('T')[0],
    maturity_amount:       parseFloat(maturityAmount.toFixed(2)),
    total_interest:        parseFloat(totalInterest.toFixed(2)),
    net_interest_after_tds:parseFloat(netInterestAfterTDS.toFixed(2)),
    net_maturity:          parseFloat(netMaturity.toFixed(2)),
    accrued_interest:      parseFloat(accruedInterest.toFixed(2)),
    current_value:         parseFloat(currentValue.toFixed(2)),
    days_to_maturity:      daysToMaturity,
    is_active:             isActive,
  };
}

// ── GET / — list all FDs ──────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('fixed_deposits')
    .select('*, goals(id, name, target_date, target_amount)')
    .eq('user_id', req.user.id)
    .order('start_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const enriched = (data || []).map(fd => ({ ...fd, ...computeFD(fd) }));

  const summary = {
    count:        enriched.length,
    active:       enriched.filter(f => f.is_active).length,
    totalPrincipal: enriched.reduce((s, f) => s + parseFloat(f.principal_amount), 0),
    totalCurrentValue: enriched.reduce((s, f) => s + f.current_value, 0),
    totalMaturityValue: enriched.filter(f => f.is_active).reduce((s, f) => s + f.maturity_amount, 0),
  };

  res.json({ fds: enriched, summary });
});

// ── POST / — create FD ────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.institution_name) return res.status(400).json({ error: 'institution_name required' });
  if (!b.principal_amount || b.principal_amount < 1000) return res.status(400).json({ error: 'Minimum principal is ₹1,000' });
  if (!b.interest_rate_pa || b.interest_rate_pa < 0.01 || b.interest_rate_pa > 20) return res.status(400).json({ error: 'Interest rate must be between 0.01 and 20%' });
  if (!b.start_date) return res.status(400).json({ error: 'start_date required' });
  if (!b.tenor_days || b.tenor_days < 7) return res.status(400).json({ error: 'Minimum tenor is 7 days' });
  if (b.is_tax_saving_fd && Math.abs(b.tenor_days - 1825) > 1) return res.status(400).json({ error: '80C FDs must be exactly 5 years (1825 days)' });
  if (b.form_15g) b.tds_applicable = false;

  const { data, error } = await supabase.from('fixed_deposits').insert({
    user_id:            req.user.id,
    institution_name:   b.institution_name,
    institution_type:   b.institution_type || 'bank',
    nickname:           b.nickname || null,
    branch_ref:         b.branch_ref || null,
    principal_amount:   b.principal_amount,
    interest_rate_pa:   b.interest_rate_pa,
    compounding_freq:   b.compounding_freq || 'quarterly',
    payout_type:        b.payout_type || 'cumulative',
    payout_frequency:   b.payout_frequency || null,
    is_senior_rate:     !!b.is_senior_rate,
    start_date:         b.start_date,
    tenor_days:         b.tenor_days,
    on_maturity_action: b.on_maturity_action || 'undecided',
    auto_renew_type:    b.auto_renew_type || null,
    tds_applicable:     b.tds_applicable !== false,
    form_15g:           !!b.form_15g,
    tds_rate:           b.tds_rate || 10,
    is_tax_saving_fd:   !!b.is_tax_saving_fd,
    goal_id:            b.goal_id || null,
    goal_earmark_pct:   b.goal_earmark_pct || 100,
    notes:              b.notes || null,
    updated_at:         new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ fd: { ...data, ...computeFD(data) } });
});

// ── PUT /:id — update FD ──────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  if (b.form_15g) b.tds_applicable = false;

  const allowed = [
    'institution_name','institution_type','nickname','branch_ref',
    'principal_amount','interest_rate_pa','compounding_freq','payout_type',
    'payout_frequency','is_senior_rate','start_date','tenor_days',
    'on_maturity_action','auto_renew_type','renewal_count',
    'tds_applicable','form_15g','tds_rate','is_tax_saving_fd',
    'premature_close_dt','premature_penalty',
    'goal_id','goal_earmark_pct','is_pledged','pledge_against','notes',
  ];
  const update = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('fixed_deposits').update(update)
    .eq('fd_id', req.params.id).eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ fd: { ...data, ...computeFD(data) } });
});

// ── DELETE /:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('fixed_deposits').delete()
    .eq('fd_id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
