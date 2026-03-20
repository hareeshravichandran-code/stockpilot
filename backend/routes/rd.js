/**
 * Kanalyst — Recurring Deposit Routes
 * GET    /api/rd      — list all RDs with computed fields
 * POST   /api/rd      — create RD
 * PUT    /api/rd/:id  — update RD
 * DELETE /api/rd/:id  — delete RD
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── RD compound-interest formula (per-installment loop) ──────────
function computeRD(rd, asOfDate = new Date()) {
  const today        = asOfDate;
  const startDate    = new Date(rd.start_date);
  const tenureMonths = rd.tenure_months;
  const R            = parseFloat(rd.monthly_installment);
  const r            = parseFloat(rd.interest_rate_pa) / 100;
  const n            = 4; // quarterly compounding (standard)

  // Maturity date
  const matDate = new Date(startDate);
  matDate.setMonth(matDate.getMonth() + tenureMonths);

  // Installments paid so far
  const monthsElapsed   = Math.max(0, Math.min(
    tenureMonths,
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth()   - startDate.getMonth())
  ));
  const installmentsPaid      = monthsElapsed;
  const installmentsRemaining = Math.max(0, tenureMonths - installmentsPaid);
  const missed                = Math.min(rd.missed_installments || 0, installmentsPaid);

  // Total invested (actual cash out)
  const totalInvested            = (installmentsPaid - missed) * R;
  const projectedTotalInvestment = tenureMonths * R;

  // Maturity amount — sum of each installment compounded to end
  let maturityAmount = 0;
  for (let i = 1; i <= tenureMonths; i++) {
    const remainingMonths = tenureMonths - i + 1;
    maturityAmount += R * Math.pow(1 + r / n, n * remainingMonths / 12);
  }

  // Accrued value today — only instalments paid, compounded to today
  let accruedValue = 0;
  for (let i = 1; i <= installmentsPaid; i++) {
    const monthsCompounded = monthsElapsed - i + 1;
    if (monthsCompounded < 0) continue;
    accruedValue += R * Math.pow(1 + r / n, n * monthsCompounded / 12);
  }

  // Premature closure adjustment
  const closeDate = rd.premature_close_dt ? new Date(rd.premature_close_dt) : null;
  if (closeDate) {
    const penalty = parseFloat(rd.premature_penalty || 0) / 100;
    const earnedInterest = accruedValue - totalInvested;
    accruedValue = totalInvested + earnedInterest * (1 - penalty);
  }

  const currentValue         = Math.max(0, accruedValue);
  const totalInterest        = maturityAmount - projectedTotalInvestment;
  const tdsRate              = rd.tds_applicable ? (parseFloat(rd.tds_rate) || 10) / 100 : 0;
  const netInterestAfterTDS  = totalInterest * (1 - tdsRate);
  const netMaturity          = projectedTotalInvestment + netInterestAfterTDS;
  const daysToMaturity       = Math.round((matDate - today) / (1000 * 60 * 60 * 24));
  const monthlyShortfall     = missed > 0 ? missed * R : 0;
  const isActive             = !closeDate && today <= matDate;

  return {
    maturity_date:          matDate.toISOString().split('T')[0],
    maturity_amount:        parseFloat(maturityAmount.toFixed(2)),
    total_invested:         parseFloat(totalInvested.toFixed(2)),
    projected_total_invest: parseFloat(projectedTotalInvestment.toFixed(2)),
    total_interest:         parseFloat(totalInterest.toFixed(2)),
    net_interest_after_tds: parseFloat(netInterestAfterTDS.toFixed(2)),
    net_maturity:           parseFloat(netMaturity.toFixed(2)),
    current_value:          parseFloat(currentValue.toFixed(2)),
    accrued_value:          parseFloat(accruedValue.toFixed(2)),
    installments_paid:      installmentsPaid,
    installments_remaining: installmentsRemaining,
    monthly_shortfall:      parseFloat(monthlyShortfall.toFixed(2)),
    days_to_maturity:       daysToMaturity,
    is_active:              isActive,
  };
}

// ── GET / ─────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('recurring_deposits')
    .select('*, goals(id, name, target_date, target_amount)')
    .eq('user_id', req.user.id)
    .order('start_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const enriched = (data || []).map(rd => ({ ...rd, ...computeRD(rd) }));

  const summary = {
    count:              enriched.length,
    active:             enriched.filter(r => r.is_active).length,
    totalMonthlyCommit: enriched.filter(r => r.is_active).reduce((s, r) => s + parseFloat(r.monthly_installment), 0),
    totalInvested:      enriched.reduce((s, r) => s + r.total_invested, 0),
    totalCurrentValue:  enriched.reduce((s, r) => s + r.current_value, 0),
    totalMaturityValue: enriched.filter(r => r.is_active).reduce((s, r) => s + r.maturity_amount, 0),
  };

  res.json({ rds: enriched, summary });
});

// ── POST / ────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.institution_name) return res.status(400).json({ error: 'institution_name required' });
  if (!b.monthly_installment || b.monthly_installment < 100) return res.status(400).json({ error: 'Minimum installment is ₹100' });
  if (!b.interest_rate_pa || b.interest_rate_pa < 0.01 || b.interest_rate_pa > 15) return res.status(400).json({ error: 'Rate must be between 0.01–15%' });
  if (!b.tenure_months || b.tenure_months < 6 || b.tenure_months > 120) return res.status(400).json({ error: 'Tenure must be 6–120 months' });
  if (b.form_15g) b.tds_applicable = false;

  const { data, error } = await supabase.from('recurring_deposits').insert({
    user_id:             req.user.id,
    institution_name:    b.institution_name,
    institution_type:    b.institution_type || 'bank',
    nickname:            b.nickname || null,
    account_reference:   b.account_reference || null,
    monthly_installment: b.monthly_installment,
    interest_rate_pa:    b.interest_rate_pa,
    compounding_freq:    b.compounding_freq || 'quarterly',
    is_senior_rate:      !!b.is_senior_rate,
    start_date:          b.start_date,
    tenure_months:       b.tenure_months,
    missed_installments: b.missed_installments || 0,
    penalty_per_100:     b.penalty_per_100 || 1.50,
    tds_applicable:      b.tds_applicable !== false,
    form_15g:            !!b.form_15g,
    tds_rate:            b.tds_rate || 10,
    goal_id:             b.goal_id || null,
    goal_earmark_pct:    b.goal_earmark_pct || 100,
    notes:               b.notes || null,
    updated_at:          new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rd: { ...data, ...computeRD(data) } });
});

// ── PUT /:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  if (b.form_15g) b.tds_applicable = false;

  const allowed = [
    'institution_name','institution_type','nickname','account_reference',
    'monthly_installment','interest_rate_pa','compounding_freq','is_senior_rate',
    'start_date','tenure_months','missed_installments','penalty_per_100',
    'tds_applicable','form_15g','tds_rate',
    'premature_close_dt','premature_penalty',
    'goal_id','goal_earmark_pct','notes',
  ];
  const update = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('recurring_deposits').update(update)
    .eq('rd_id', req.params.id).eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ rd: { ...data, ...computeRD(data) } });
});

// ── DELETE /:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('recurring_deposits').delete()
    .eq('rd_id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
