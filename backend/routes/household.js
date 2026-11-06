/**
 * Kanalyst — Family OS: members, insurance, documents & renewals, calendar.
 *
 * Every row belongs to the account that added it (owner_id). People in the same
 * family group (family_members) see each other's rows; only the owner can change them.
 *
 *   GET    /api/household/overview          attention list, cover by person, counts
 *   GET    /api/household/members           POST, PUT /:id, DELETE /:id
 *   GET    /api/household/policies          POST, PUT /:id, DELETE /:id
 *   GET    /api/household/documents         POST, PUT /:id, DELETE /:id
 *   GET    /api/household/events            POST, PUT /:id, DELETE /:id
 *   GET    /api/household/calendar?from&to  every dated thing from every module
 */
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { computeFD } = require('./fd');
const { computeRD } = require('./rd');

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const nowIso = () => new Date().toISOString();
const DAY = 864e5;
const todayStr = () => new Date().toISOString().slice(0, 10);

const RELATIONS = ['self', 'spouse', 'child', 'parent', 'sibling', 'grandparent', 'in_law', 'other'];
const POLICY_KINDS = ['term', 'life', 'health', 'vehicle', 'home', 'accident', 'travel', 'other'];
const FREQS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'single'];
const DOC_KINDS = ['passport', 'driving_licence', 'pan', 'aadhaar', 'voter_id', 'vehicle_rc', 'puc', 'property_tax', 'school_fees', 'subscription', 'other'];
const REPEATS = ['none', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const COLORS = ['moss', 'aubergine', 'prussian', 'terracotta', 'mulberry', 'marigold', 'teal', 'ink'];

// ── Family scope ─────────────────────────────────────────────────────
async function familyScope(uid) {
  const { data: mine } = await supabase.from('family_members').select('group_id').eq('user_id', uid);
  const groups = (mine || []).map(m => m.group_id);
  let ids = [uid];
  if (groups.length) {
    const { data: members } = await supabase.from('family_members').select('user_id').in('group_id', groups);
    ids = [...new Set([uid, ...(members || []).map(m => m.user_id)])];
  }
  const { data: users } = await supabase.from('users').select('id, name, email, dob').in('id', ids);
  const byId = Object.fromEntries((users || []).map(u => [u.id, u]));
  return { ids, users: byId };
}
const firstName = (u) => ((u?.name || u?.email || 'Member').split(/[ @]/)[0]);

// ── Field cleaning ───────────────────────────────────────────────────
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const cleanDate = (v) => (v === '' || v === null ? null : isDate(v) ? v : undefined);
const cleanText = (v, max = 200) => (v === null || v === '' ? null : typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const cleanNum = (v) => (v === '' || v === null ? null : Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0 ? parseFloat(v) : undefined);
const last4 = (v) => (v === '' || v === null ? null : typeof v === 'string' ? (v.replace(/[^A-Za-z0-9]/g, '').slice(-4) || null) : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);

function pick(body, spec) {
  const out = {};
  for (const [k, fn] of Object.entries(spec)) {
    if (body[k] === undefined) continue;
    const v = fn(body[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const MEMBER_SPEC = { name: (v) => cleanText(v, 60), relation: oneOf(RELATIONS), dob: cleanDate, color: oneOf(COLORS), notes: (v) => cleanText(v, 500), sort_order: (v) => (Number.isInteger(v) ? v : undefined) };
const POLICY_SPEC = {
  kind: oneOf(POLICY_KINDS), insurer: (v) => cleanText(v, 80), plan_name: (v) => cleanText(v, 120), policy_ref: last4,
  sum_assured: cleanNum, premium: cleanNum, premium_frequency: oneOf(FREQS), start_date: cleanDate, renewal_date: cleanDate, end_date: cleanDate,
  member_ids: (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20) : undefined),
  nominee: (v) => cleanText(v, 80), notes: (v) => cleanText(v, 1000), status: oneOf(['active', 'lapsed', 'ended']),
};
const DOC_SPEC = {
  kind: oneOf(DOC_KINDS), title: (v) => cleanText(v, 100), ref_last4: last4, issued_on: cleanDate, due_date: cleanDate, repeat: oneOf(REPEATS),
  amount: cleanNum, remind_days: (v) => (Number.isFinite(+v) && +v >= 0 && +v <= 365 ? Math.round(+v) : undefined),
  kept_at: (v) => cleanText(v, 120), notes: (v) => cleanText(v, 1000), done: (v) => (typeof v === 'boolean' ? v : undefined),
  member_id: (v) => (v === null || v === '' ? null : typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined),
};
const EVENT_SPEC = {
  title: (v) => cleanText(v, 100), date: cleanDate, repeat: oneOf(['none', 'monthly', 'yearly']), kind: oneOf(['event', 'anniversary', 'payment', 'reminder']),
  amount: cleanNum, notes: (v) => cleanText(v, 500),
  member_id: DOC_SPEC.member_id,
};

// ── Members (self is created automatically for every account in the family) ──
async function ensureSelves(scope) {
  const { data: selves } = await supabase.from('household_members').select('owner_id').in('owner_id', scope.ids).eq('relation', 'self');
  const have = new Set((selves || []).map(s => s.owner_id));
  const missing = scope.ids.filter(id => !have.has(id));
  if (!missing.length) return;
  await supabase.from('household_members').insert(missing.map(id => ({
    owner_id: id, name: firstName(scope.users[id]), relation: 'self', dob: scope.users[id]?.dob || null,
    linked_user_id: id, color: id === scope.ids[0] ? 'ink' : 'mulberry',
  })));
}

async function loadMembers(uid, scope) {
  await ensureSelves(scope);
  const { data } = await supabase.from('household_members').select('*').in('owner_id', scope.ids).order('sort_order').order('created_at');
  let list = data || [];
  // A person added by me who has their own account shows once, as their own record
  const selfOf = new Set(list.filter(m => m.relation === 'self').map(m => m.owner_id));
  list = list.filter(m => m.relation === 'self' || !m.linked_user_id || !selfOf.has(m.linked_user_id));
  return list.map(m => ({
    ...m,
    mine: m.owner_id === uid,
    is_me: m.relation === 'self' && m.owner_id === uid,
    has_account: m.relation === 'self',
    added_by: m.owner_id === uid ? null : firstName(scope.users[m.owner_id]),
    // A family member's own record reads as their relation to the group, not "self"
    relation_label: m.relation === 'self' ? (m.owner_id === uid ? 'You' : 'Family account') : m.relation,
  }));
}

function crud(table, spec, opts = {}) {
  const r = require('express').Router();
  r.get('/', requireAuth, async (req, res) => {
    try {
      const scope = await familyScope(req.user.id);
      const { data, error } = await supabase.from(table).select('*').in('owner_id', scope.ids).order(opts.order || 'created_at');
      if (error) throw error;
      res.json({ items: (data || []).map(x => ({ ...x, mine: x.owner_id === req.user.id, added_by: x.owner_id === req.user.id ? null : firstName(scope.users[x.owner_id]) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/', requireAuth, async (req, res) => {
    try {
      const row = pick(req.body || {}, spec);
      for (const k of opts.required || []) if (!row[k]) return res.status(400).json({ error: `${opts.labels?.[k] || k} is required` });
      const { data, error } = await supabase.from(table).insert({ ...(opts.defaults || {}), ...row, owner_id: req.user.id }).select().single();
      if (error) throw error;
      res.json({ item: { ...data, mine: true } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.put('/:id', requireAuth, async (req, res) => {
    try {
      const row = pick(req.body || {}, spec);
      for (const k of opts.required || []) if (k in row && !row[k]) return res.status(400).json({ error: `${opts.labels?.[k] || k} can’t be empty` });
      if (opts.timestamps !== false) row.updated_at = nowIso();
      const { data, error } = await supabase.from(table).update(row).eq('id', req.params.id).eq('owner_id', req.user.id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Only the person who added this can change it' });
      res.json({ item: { ...data, mine: true } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.delete('/:id', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase.from(table).delete().eq('id', req.params.id).eq('owner_id', req.user.id).select('id');
      if (error) throw error;
      if (!data || !data.length) return res.status(404).json({ error: 'Only the person who added this can delete it' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return r;
}

// Members need their own GET (auto self, de-duplication) and a guard on deleting yourself
router.get('/members', requireAuth, async (req, res) => {
  try { res.json({ items: await loadMembers(req.user.id, await familyScope(req.user.id)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/members/:id', requireAuth, async (req, res, next) => {
  const { data } = await supabase.from('household_members').select('relation').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
  if (data?.relation === 'self') return res.status(400).json({ error: 'You can’t remove yourself' });
  next();
});
router.put('/members/:id', requireAuth, async (req, res, next) => {
  const { data } = await supabase.from('household_members').select('relation').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
  if (data?.relation === 'self' && req.body?.relation && req.body.relation !== 'self') delete req.body.relation;
  if (data?.relation !== 'self' && req.body?.relation === 'self') delete req.body.relation;
  next();
});
router.post('/members', requireAuth, (req, res, next) => { if (req.body?.relation === 'self') req.body.relation = 'other'; next(); });
router.use('/members', crud('household_members', MEMBER_SPEC, { required: ['name'], labels: { name: 'Name' }, order: 'sort_order', defaults: { relation: 'other', sort_order: 0 } }));
router.use('/policies', crud('insurance_policies', POLICY_SPEC, { required: ['kind'], defaults: { status: 'active', premium_frequency: 'yearly', member_ids: [] } }));
router.use('/documents', crud('family_documents', DOC_SPEC, { required: ['title'], labels: { title: 'Name' }, defaults: { repeat: 'none', remind_days: 30, done: false } }));
router.use('/events', crud('family_events', EVENT_SPEC, { required: ['title', 'date'], labels: { title: 'Name', date: 'Date' }, timestamps: false, defaults: { repeat: 'none', kind: 'event' } }));

// ═══════════════════════════════════════════════════════════════════
//  Calendar — one timeline from every module
// ═══════════════════════════════════════════════════════════════════
const STEP_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
function addMonths(d, m) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d.getUTCDate(), last));
  return x;
}
const ymd = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + 'T00:00:00Z');

// Dates of a repeating item that fall in [from, to]
function occurrences(start, repeat, from, to, max = 40) {
  if (!start) return [];
  const s = parse(start), f = parse(from), t = parse(to);
  const step = STEP_MONTHS[repeat];
  if (!step) return s >= f && s <= t ? [start] : [];
  const out = [];
  // jump close to `from` first
  let k = Math.max(0, Math.floor(((f.getUTCFullYear() - s.getUTCFullYear()) * 12 + f.getUTCMonth() - s.getUTCMonth()) / step) - 1);
  for (let i = 0; i < max + 4 && out.length < max; i++, k++) {
    const d = addMonths(s, k * step);
    if (d > t) break;
    if (d >= f) out.push(ymd(d));
  }
  return out;
}
const yearly = (date, from, to) => {
  if (!date) return [];
  const d = parse(date), out = [];
  for (let y = parse(from).getUTCFullYear(); y <= parse(to).getUTCFullYear(); y++) {
    const x = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
    if (ymd(x) >= from && ymd(x) <= to) out.push(ymd(x));
  }
  return out;
};
const ageOn = (dob, on) => { const a = parse(dob), b = parse(on); let n = b.getUTCFullYear() - a.getUTCFullYear(); if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) n--; return n; };
const POLICY_LABEL = { term: 'Term insurance', life: 'Life insurance', health: 'Health insurance', vehicle: 'Vehicle insurance', home: 'Home insurance', accident: 'Accident cover', travel: 'Travel insurance', other: 'Insurance' };
const DOC_LABEL = { passport: 'Passport', driving_licence: 'Driving licence', pan: 'PAN', aadhaar: 'Aadhaar', voter_id: 'Voter ID', vehicle_rc: 'Vehicle RC', puc: 'PUC certificate', property_tax: 'Property tax', school_fees: 'School fees', subscription: 'Subscription', other: 'Document' };

async function buildCalendar(uid, from, to) {
  const scope = await familyScope(uid);
  const ids = scope.ids;
  const members = await loadMembers(uid, scope);
  const mName = Object.fromEntries(members.map(m => [m.id, m.is_me ? 'You' : m.name]));
  const ownerMember = (ownerId) => members.find(m => m.relation === 'self' && m.owner_id === ownerId);

  const [pol, docs, evs, fds, rds, bks, rev] = await Promise.all([
    supabase.from('insurance_policies').select('*').in('owner_id', ids).eq('status', 'active'),
    supabase.from('family_documents').select('*').in('owner_id', ids),
    supabase.from('family_events').select('*').in('owner_id', ids),
    supabase.from('fixed_deposits').select('*').in('user_id', ids),
    supabase.from('recurring_deposits').select('*').in('user_id', ids),
    supabase.from('bp_buckets').select('id, user_id, name, kind, status, target_amount, target_date, recurrence, recurrence_day, recurrence_month, is_emi, is_loan, special_kind').in('user_id', ids).eq('kind', 'goal').neq('status', 'completed'),
    // Events master (Discover / manual): EMIs, SIPs, card dues, subscriptions, salary...
    // Insurance and RD rows are already drawn from their own tables above, so skip them here.
    supabase.from('recurring_events').select('*').in('owner_id', ids).eq('status', 'active')
      .not('master_table', 'in', '("insurance_policies","recurring_deposits")'),
  ]);
  const items = [];
  const push = (o) => items.push({ id: `${o.module}:${o.ref}:${o.date}`, ...o });

  // Birthdays
  for (const m of members) {
    if (!m.dob) continue;
    for (const d of yearly(m.dob, from, to)) push({ module: 'family', kind: 'birthday', ref: m.id, date: d, title: m.is_me ? 'Your birthday' : `${m.name}’s birthday`, sub: `Turns ${ageOn(m.dob, d)}`, member_ids: [m.id] });
  }
  // Insurance renewals and cover end
  for (const p of pol.data || []) {
    const name = p.plan_name || `${p.insurer ? p.insurer + ' ' : ''}${POLICY_LABEL[p.kind] || 'Policy'}`;
    const freq = p.premium_frequency === 'single' ? 'none' : p.premium_frequency;
    for (const d of occurrences(p.renewal_date, freq, from, to)) push({ module: 'insurance', kind: 'premium', ref: p.id, date: d, title: `${name} premium`, amount: num(p.premium) || null, member_ids: p.member_ids || [], alert_level: p.alert_level || null, policy_id: p.id });
    if (p.end_date && p.end_date >= from && p.end_date <= to) push({ module: 'insurance', kind: 'cover_end', ref: p.id, date: p.end_date, title: `${name} cover ends`, member_ids: p.member_ids || [] });
  }
  // Documents and renewals (overdue ones show on the first day so they aren't lost)
  for (const d of docs.data || []) {
    if (d.done || !d.due_date) continue;
    const label = DOC_LABEL[d.kind] || 'Document';
    const isExpiry = ['passport', 'driving_licence', 'vehicle_rc', 'puc', 'voter_id'].includes(d.kind);
    const dates = d.repeat !== 'none' ? occurrences(d.due_date, d.repeat, from, to) : (d.due_date <= to ? [d.due_date < from ? from : d.due_date] : []);
    for (const dt of dates) push({ module: 'documents', kind: isExpiry ? 'expiry' : 'due', ref: d.id, date: dt, overdue: d.repeat === 'none' && d.due_date < todayStr(), due_date: d.due_date,
      title: isExpiry ? `${d.title} expires` : `${d.title} due`, sub: d.title === label ? null : label, amount: num(d.amount) || null, member_ids: d.member_id ? [d.member_id] : [] });
  }
  // Custom events
  for (const e of evs.data || []) {
    const dates = e.repeat === 'yearly' ? yearly(e.date, from, to) : occurrences(e.date, e.repeat, from, to);
    for (const d of dates) push({ module: 'family', kind: e.kind || 'event', ref: e.id, date: d, title: e.title, amount: num(e.amount) || null, member_ids: e.member_id ? [e.member_id] : [], custom: true, mine: e.owner_id === uid });
  }
  // FD maturities and RD instalments / maturities
  for (const fd of fds.data || []) {
    let c; try { c = computeFD(fd); } catch (e) { continue; }
    if (c.maturity_date >= from && c.maturity_date <= to) {
      const om = ownerMember(fd.user_id);
      push({ module: 'money', kind: 'maturity', ref: String(fd.fd_id || fd.id), date: c.maturity_date, title: `${fd.nickname || fd.institution_name || 'FD'} matures`, amount: c.maturity_amount, member_ids: om ? [om.id] : [] });
    }
  }
  for (const rd of rds.data || []) {
    let c; try { c = computeRD(rd); } catch (e) { continue; }
    const om = ownerMember(rd.user_id);
    const name = rd.nickname || rd.institution_name || 'RD';
    if (c.maturity_date >= from && c.maturity_date <= to) push({ module: 'money', kind: 'maturity', ref: String(rd.rd_id || rd.id), date: c.maturity_date, title: `${name} matures`, amount: c.maturity_amount, member_ids: om ? [om.id] : [] });
    if (rd.start_date && c.installments_remaining > 0) {
      const until = c.maturity_date < to ? c.maturity_date : to;
      for (const d of occurrences(rd.start_date, 'monthly', from, until, 24)) push({ module: 'money', kind: 'instalment', ref: String(rd.rd_id || rd.id), date: d, title: `${name} instalment`, amount: num(rd.monthly_installment), member_ids: om ? [om.id] : [] });
    }
  }
  // Blueprint goals: target dates, monthly / yearly goals and EMIs
  for (const b of bks.data || []) {
    if (b.is_loan) continue;
    const om = ownerMember(b.user_id);
    const base = { module: b.is_emi ? 'loans' : 'goals', ref: b.id, member_ids: om ? [om.id] : [] };
    if (b.recurrence === 'monthly' && b.recurrence_day) {
      const t0 = parse(from); const start = ymd(new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), Math.min(28, b.recurrence_day))));
      for (const d of occurrences(start, 'monthly', from, to, 24)) push({ ...base, kind: b.is_emi ? 'emi' : 'goal_due', date: d, title: b.is_emi ? `${b.name} EMI` : b.name, amount: num(b.target_amount) || null });
    } else if (b.recurrence === 'yearly' && b.recurrence_month) {
      const y0 = parse(from).getUTCFullYear();
      const start = `${y0}-${String(b.recurrence_month).padStart(2, '0')}-${String(Math.min(28, b.recurrence_day || 1)).padStart(2, '0')}`;
      for (const d of yearly(start, from, to)) push({ ...base, kind: 'goal_due', date: d, title: b.name, amount: num(b.target_amount) || null });
    } else if (b.recurrence === 'none' && b.target_date && b.target_date >= from && b.target_date <= to) {
      push({ ...base, kind: b.special_kind === 'retirement' ? 'retirement' : 'goal_target', date: b.target_date, title: `${b.name} target date`, amount: num(b.target_amount) || null });
    }
  }
  // Events master: one series per obligation, with paid / overdue from event_payments
  const evRows = (rev && rev.data) || [];
  if (evRows.length) {
    const { data: pays } = await supabase.from('event_payments').select('event_id, period, status')
      .in('event_id', evRows.map(e => e.id)).gte('period', ymd(new Date(parse(from).getTime() - 10 * DAY))).lte('period', ymd(new Date(parse(to).getTime() + 10 * DAY)));
    const paidOn = {};
    for (const p of pays || []) if (p.status === 'paid') (paidOn[p.event_id] = paidOn[p.event_id] || []).push(parse(p.period).getTime());
    const isPaid = (id, d) => (paidOn[id] || []).some(t => Math.abs(t - parse(d).getTime()) <= 6 * DAY);
    const blueprintEmis = items.filter(i => i.kind === 'emi');
    const MODULE = { emi: 'loans', sip: 'money', rd_instalment: 'money', salary: 'money', card_due: 'money', premium: 'insurance', subscription: 'calendar', bill: 'calendar', maturity: 'money' };
    const today = todayStr();
    for (const e of evRows) {
      const day = Math.min(28, e.due_day || (e.start_date ? parseInt(e.start_date.slice(8, 10), 10) : 1) || 1);
      let dates = [];
      if (e.frequency === 'once') { const d = e.end_date || e.start_date; if (d && d >= from && d <= to) dates = [d]; }
      else if (e.frequency === 'monthly') {
        const f0 = parse(from); dates = occurrences(ymd(new Date(Date.UTC(f0.getUTCFullYear(), f0.getUTCMonth(), day))), 'monthly', from, to, 24);
      } else {
        const m = e.due_month || (e.start_date ? parseInt(e.start_date.slice(5, 7), 10) : parse(from).getUTCMonth() + 1);
        const anchor = ymd(new Date(Date.UTC(parse(from).getUTCFullYear() - 1, m - 1, day)));
        dates = occurrences(anchor, e.frequency, from, to, 12);
      }
      if (e.end_date) dates = dates.filter(d => d <= e.end_date);
      if (e.start_date) dates = dates.filter(d => d >= e.start_date);
      // Only call a past date overdue if we were already tracking it then
      const trackedFrom = ymd(new Date((e.created_at ? Date.parse(e.created_at) : Date.now()) - 7 * DAY));
      const om = ownerMember(e.owner_id);
      for (const d of dates) {
        // A Blueprint EMI with the same amount in the same month is the same obligation
        if (e.kind === 'emi' && blueprintEmis.some(b => b.date.slice(0, 7) === d.slice(0, 7) && b.amount && e.amount && Math.abs(b.amount - num(e.amount)) <= num(e.amount) * 0.02)) continue;
        const paid = isPaid(e.id, d);
        push({ module: MODULE[e.kind] || 'calendar', kind: e.kind, ref: e.id, date: d, title: e.title, amount: num(e.amount) || null,
          sub: paid ? 'Paid' : null, paid, overdue: !paid && d < today && d >= trackedFrom, direction: e.direction,
          member_ids: e.member_id ? [e.member_id] : (om ? [om.id] : []), event_id: e.id, alert_level: e.alert_level || null, manual: e.master_table === 'manual' });
      }
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.module.localeCompare(b.module));
  return { items, members: members.map(m => ({ id: m.id, name: mName[m.id], color: m.color })) };
}

router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const t = todayStr();
    const from = isDate(req.query.from) ? req.query.from : t;
    let to = isDate(req.query.to) ? req.query.to : ymd(new Date(Date.now() + 90 * DAY));
    if (parse(to) - parse(from) > 400 * DAY) to = ymd(new Date(parse(from).getTime() + 400 * DAY));
    res.json({ from, to, ...(await buildCalendar(req.user.id, from, to)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
//  Overview — what needs attention, who is covered
// ═══════════════════════════════════════════════════════════════════
router.get('/overview', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const scope = await familyScope(uid);
    const t = todayStr();
    const [members, pol, docs, cal] = await Promise.all([
      loadMembers(uid, scope),
      supabase.from('insurance_policies').select('*').in('owner_id', scope.ids),
      supabase.from('family_documents').select('*').in('owner_id', scope.ids),
      buildCalendar(uid, t, ymd(new Date(Date.now() + 60 * DAY))),
    ]);
    const policies = (pol.data || []).filter(p => p.status === 'active');
    const allDocs = docs.data || [];
    const yearlyPremium = policies.reduce((s, p) => s + num(p.premium) * ({ monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, single: 0 }[p.premium_frequency] ?? 1), 0);

    // Cover per person
    const cover = members.map(m => {
      const mine = policies.filter(p => (p.member_ids || []).includes(m.id));
      const life = mine.filter(p => ['term', 'life'].includes(p.kind)).reduce((s, p) => s + num(p.sum_assured), 0);
      const health = mine.filter(p => p.kind === 'health').reduce((s, p) => s + num(p.sum_assured), 0);
      return { member_id: m.id, name: m.is_me ? 'You' : m.name, color: m.color, relation: m.relation, life, health, policies: mine.length };
    });

    // Attention: overdue or within the reminder window
    const daysTo = (d) => Math.round((parse(d) - parse(t)) / DAY);
    const attention = [];
    for (const d of allDocs) {
      if (d.done || !d.due_date) continue;
      const n = daysTo(d.due_date);
      if (n <= (d.remind_days ?? 30)) attention.push({ module: 'documents', ref: d.id, title: d.title, date: d.due_date, days: n, member_ids: d.member_id ? [d.member_id] : [], amount: num(d.amount) || null, kind: d.kind });
    }
    for (const p of policies) {
      if (!p.renewal_date) continue;
      const n = daysTo(p.renewal_date);
      if (n <= 30) attention.push({ module: 'insurance', ref: p.id, title: `${p.plan_name || p.insurer || POLICY_LABEL[p.kind]} premium`, date: p.renewal_date, days: n, member_ids: p.member_ids || [], amount: num(p.premium) || null, kind: p.kind });
    }
    for (const it of cal.items) {
      if (['birthday', 'maturity', 'retirement', 'goal_target', 'anniversary', 'event'].includes(it.kind) && daysTo(it.date) <= 21) attention.push({ ...it, days: daysTo(it.date) });
      else if (['emi', 'card_due', 'sip', 'subscription', 'rd_instalment', 'bill', 'rent', 'school_fee', 'premium'].includes(it.kind) && !it.paid) {
        const { alertOf } = require('../services/alerts');
        const n = daysTo(it.date);
        const a = alertOf(it.kind, it.alert_level, n, !!it.overdue);
        if (a.blink || (n >= 0 && n <= 5)) attention.push({ ...it, days: n, level: a.level, blink: a.blink });
      }
    }
    { const { RANK } = require('../services/alerts');
      attention.sort((a, b) => ((b.blink ? 1 : 0) - (a.blink ? 1 : 0)) || ((RANK[a.level] ?? 4) - (RANK[b.level] ?? 4)) || a.days - b.days); }
    // Gaps worth pointing out
    const gaps = [];
    for (const c of cover) {
      const m = members.find(x => x.id === c.member_id);
      if (!c.health) gaps.push({ member_id: c.member_id, text: `${c.name === 'You' ? 'You have' : c.name + ' has'} no health cover recorded` });
      if (!c.life && ['self', 'spouse'].includes(m.relation)) gaps.push({ member_id: c.member_id, text: `${c.name === 'You' ? 'You have' : c.name + ' has'} no life or term cover recorded` });
    }

    res.json({
      members, cover, attention: attention.slice(0, 12), gaps: policies.length ? gaps.slice(0, 6) : [],
      counts: {
        members: members.length, policies: policies.length, documents: allDocs.length,
        upcoming: cal.items.length, overdue: allDocs.filter(d => !d.done && d.due_date && d.due_date < t).length,
      },
      premiums: { yearly: Math.round(yearlyPremium) },
      upcoming: cal.items.slice(0, 40),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports._test = { occurrences, yearly, ageOn };
module.exports.buildCalendar = buildCalendar;
module.exports.calendarHelpers = { occurrences, ymd, parse, DAY };
