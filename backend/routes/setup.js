/**
 * First-time setup from SMS (and re-run any time). The phone reads the inbox, the user confirms each
 * step, and the confirmed results arrive here in one call per step:
 *   accounts (+ latest balance) · salary (tied to its bank account) · credit cards · insurance ·
 *   loans (EMI + outstanding) · mutual fund folios / SIPs · EPF · subscriptions · category rules
 *
 *   GET  /api/setup/status   what already exists, so the phone can show "Created" on re-runs
 *   POST /api/setup/apply    { step, items }  → creates or updates masters, events and rules
 *   POST /api/setup/done     marks setup finished (or skipped)
 */
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const masters = require('./masters');
const { upsertMaster, syncEvent, linkFolios, linkActuals } = masters;
const { instKey, refKey, refMatch } = masters._test;

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const str = (v, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const nowIso = () => new Date().toISOString();
async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

const STEPS = ['accounts', 'salary', 'cards', 'insurance', 'loans', 'folios', 'epf', 'subscriptions', 'rules'];

async function mergeMeta(id, extra) {
  const { data: m } = await supabase.from('money_masters').select('meta').eq('id', id).maybeSingle();
  const meta = { ...(m?.meta || {}) };
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') meta[k] = v;
  await supabase.from('money_masters').update({ meta, updated_at: nowIso() }).eq('id', id);
}

async function master(uid, f, metaExtra = {}, patchExisting = {}) {
  const r = await upsertMaster(uid, { ...f, source: 'sms_setup' });
  if (r.table === 'money_masters') {
    if (Object.keys(metaExtra).length) await mergeMeta(r.id, metaExtra);
    // The user confirmed these values on screen: they win over what was there
    const patch = {};
    for (const [k, v] of Object.entries(patchExisting)) if (v !== null && v !== undefined && v !== '') patch[k] = v;
    if (r.status === 'linked' && Object.keys(patch).length) await supabase.from('money_masters').update({ ...patch, updated_at: nowIso() }).eq('id', r.id);
    const { data: fresh } = await supabase.from('money_masters').select('*').eq('id', r.id).maybeSingle();
    if (fresh) await syncEvent(uid, fresh);
  }
  return r;
}

router.get('/status', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [m, p, u, f] = await Promise.all([
      supabase.from('money_masters').select('id, kind, subtype, institution, ref, title, amount, due_day, meta, status').eq('owner_id', uid).neq('status', 'closed'),
      supabase.from('insurance_policies').select('id, kind, insurer, policy_ref, premium, renewal_date, status').eq('owner_id', uid),
      supabase.from('users').select('sms_setup_at').eq('id', uid).maybeSingle(),
      supabase.from('mf_holdings').select('folio_number').eq('user_id', uid),
    ]);
    res.json({ masters: m.data || [], policies: p.data || [], setup_at: u.data?.sms_setup_at || null,
      folios: [...new Set((f.data || []).map(r => String(r.folio_number || '').replace(/\D/g, '')).filter(Boolean))] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/apply', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const step = req.body?.step;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
  if (!STEPS.includes(step)) return res.status(400).json({ error: 'Unknown step' });
  const out = { created: 0, updated: 0, ids: [] };
  const note = (r) => { if (!r) return; out[r.status === 'created' ? 'created' : 'updated']++; out.ids.push(r.id); };
  try {
    const handle = async (it) => {
      if (step === 'accounts') {
        const r = await master(uid, { kind: 'bank_account', institution: it.bank, ref: it.last4, title: str(it.title) || `${it.bank} ••${refKey(it.last4)}`, frequency: 'irregular' },
          { balance: num(it.balance), balance_at: isDate(it.as_of) ? it.as_of : null, balance_rule: 'sms', account_type: str(it.type, 20) });
        note(r);
      } else if (step === 'salary') {
        // Salary is its own master (income · salary) tied to the account it lands in
        let bankId = null;
        if (it.bank || it.last4) {
          const a = await master(uid, { kind: 'bank_account', institution: it.bank, ref: it.last4, title: `${it.bank || 'Bank'} ••${refKey(it.last4) || ''}`, frequency: 'irregular' });
          bankId = a.id;
        }
        const kw = (Array.isArray(it.keywords) ? it.keywords : String(it.keywords || '').split(',')).map(s => String(s).trim().toLowerCase()).filter(s => s.length >= 3);
        const r = await master(uid, {
          kind: 'income', subtype: 'salary', title: str(it.title) || `Salary${it.employer ? ' · ' + it.employer : ''}`, institution: str(it.employer) || it.bank,
          amount: num(it.amount), frequency: 'monthly', due_day: num(it.day), category_id: 'salary',
          match: { keywords: kw, any_amount: true, sender: str(it.sender, 20) },
        }, { bank_master_id: bankId, bank: it.bank, account_last4: refKey(it.last4), last_amount: num(it.last_amount ?? it.amount), last_date: isDate(it.last_date) ? it.last_date : null, employer: str(it.employer) },
        { title: str(it.title), amount: num(it.amount), due_day: num(it.day) });
        note(r);
      } else if (step === 'cards') {
        const r = await master(uid, { kind: 'card', institution: it.bank, ref: it.last4, title: str(it.title) || `${it.bank} card ••${refKey(it.last4) || ''}`,
          amount: num(it.due_amount), frequency: 'monthly', due_day: num(it.due_day) },
        { due_amount: num(it.due_amount), min_due: num(it.min_due), due_date: isDate(it.due_date) ? it.due_date : null, credit_limit: num(it.limit), available: num(it.available), statement_at: isDate(it.as_of) ? it.as_of : null },
        { title: str(it.title), due_day: num(it.due_day), amount: num(it.due_amount) });
        note(r);
      } else if (step === 'insurance') {
        const d = isDate(it.due_date) ? it.due_date : null;
        const r = await upsertMaster(uid, { kind: 'insurance', institution: it.insurer, ref: it.policy_ref, amount: num(it.premium),
          frequency: it.frequency || 'yearly', due_day: d ? +d.slice(8, 10) : num(it.due_day), due_month: d ? +d.slice(5, 7) : num(it.due_month), start_date: d,
          meta: { policy_kind: it.kind, plan_name: str(it.title) }, source: 'sms_setup' });
        if (r.status === 'linked' && d) await supabase.from('insurance_policies').update({ renewal_date: d, premium: num(it.premium) ?? undefined, updated_at: nowIso() }).eq('id', r.id).eq('owner_id', uid);
        note(r);
      } else if (step === 'loans') {
        const r = await master(uid, { kind: 'loan', institution: it.lender, ref: it.ref, title: str(it.title) || `${it.lender} ${it.type || ''} loan`.replace(/\s+/g, ' '),
          amount: num(it.emi), frequency: 'monthly', due_day: num(it.due_day), category_id: 'p_loans', meta: it.fixed ? { fixed: '1' } : {} },
        { principal: num(it.principal), outstanding: num(it.outstanding), outstanding_at: isDate(it.as_of) ? it.as_of : null, tenure_months: num(it.tenure_months), loan_type: str(it.type, 20), rate: num(it.rate) },
        { title: str(it.title), amount: num(it.emi), due_day: num(it.due_day) });
        note(r);
      } else if (step === 'folios') {
        // The folio itself goes into mf_holdings, the same table the CAS fills (CAS rows replace these later)
        const folio = str(it.folio, 30);
        const digits = String(folio || '').replace(/\D/g, '');
        if (!digits) return;
        const { data: have } = await supabase.from('mf_holdings').select('id, folio_number, fund_name').eq('user_id', uid);
        const sameFolio = (have || []).filter(h => String(h.folio_number || '').replace(/\D/g, '').slice(-4) === digits.slice(-4));   // last 4: encrypted accounts keep only those
        const scheme = str(it.scheme, 160);
        const exists = sameFolio.some(h => !scheme || !h.fund_name || h.fund_name.toLowerCase().slice(0, 12) === scheme.toLowerCase().slice(0, 12)) && sameFolio.length > 0;
        if (exists) out.updated++;
        else {
          const row = await require('../services/privacy').lockRow(uid, { user_id: uid, folio_number: folio, fund_name: scheme || `${it.amc || 'Mutual fund'} folio ••${digits.slice(-4)}`,
            fund_house: str(it.amc, 80), nav: num(it.nav), nav_date: isDate(it.last_date) ? it.last_date : null, statement_date: isDate(it.last_date) ? it.last_date : null,
            source: 'sms', updated_at: nowIso() }, { refs: ['folio_number'] });
          const { error } = await supabase.from('mf_holdings').insert(row);
          if (error) throw error;
          out.created++;
        }
        // A regular SIP also becomes a master, so its instalments show on the calendar
        if (num(it.due_day)) {
          const r = await master(uid, { kind: 'sip', institution: it.amc, ref: folio, title: str(it.title) || `${scheme || it.amc} SIP`,
            amount: num(it.amount), frequency: 'monthly', due_day: num(it.due_day), category_id: 'mf_sip' },
          { folio, scheme, last_date: isDate(it.last_date) ? it.last_date : null });
          out.ids.push(r.id);
        }
      } else if (step === 'epf') {
        const r = await master(uid, { kind: 'epf', institution: 'EPFO', ref: it.uan_last4 || it.member_id, title: str(it.title) || 'EPF', amount: num(it.monthly), frequency: 'monthly' },
          { balance: num(it.balance), balance_at: isDate(it.as_of) ? it.as_of : null, last_contribution: num(it.monthly), wage_month: str(it.wage_month, 10) });
        note(r);
      } else if (step === 'subscriptions') {
        const kw = String(it.name || '').toLowerCase().trim();
        const r = await master(uid, { kind: 'subscription', institution: it.name, title: str(it.title) || it.name, amount: num(it.amount),
          frequency: it.frequency === 'yearly' ? 'yearly' : 'monthly', due_day: num(it.due_day), due_month: num(it.due_month), category_id: str(it.category_id, 40) || 'ott',
          match: { keywords: kw.length >= 3 ? [kw] : [], any_amount: false } },
        {}, { title: str(it.title), amount: num(it.amount), due_day: num(it.due_day) });
        note(r);
      } else if (step === 'rules') {
        // Category rules for grouped spends: future SMS from this name get the category.
        // Encrypted accounts send the pattern encrypted plus its word fingerprints (pattern_tok).
        const { isEnc } = require('../services/privacy');
        const enc = isEnc(it.pattern);
        const pattern = enc ? String(it.pattern).slice(0, 400) : String(it.pattern || '').toLowerCase().trim().slice(0, 80);
        const ptok = Array.isArray(it.pattern_tok) ? it.pattern_tok.filter(x => typeof x === 'string').slice(0, 20) : null;
        if ((!enc && pattern.length < 3) || (enc && !ptok?.length) || !str(it.category_id, 40)) return;
        const { data: ex } = await supabase.from('user_sms_rules').select('id').eq('user_id', uid).eq('merchant_pattern', pattern).maybeSingle();
        if (ex) { await supabase.from('user_sms_rules').update({ category_id: it.category_id, user_confirmed: true, ...(ptok ? { pattern_tok: ptok } : {}), updated_at: Date.now() }).eq('id', ex.id); out.updated++; }
        else { await supabase.from('user_sms_rules').insert({ id: require('crypto').randomUUID(), user_id: uid, merchant_pattern: pattern, ...(ptok ? { pattern_tok: ptok } : {}), category_id: it.category_id, match_count: num(it.count) || 1, user_confirmed: true, created_at: Date.now(), updated_at: Date.now() }); out.created++; }
        // The SMS group it came from is sorted now (web and app show it as done)
        await supabase.from('sms_groups').update({ status: 'ruled', category_id: it.category_id, updated_at: nowIso() }).eq('owner_id', uid).eq('key', pattern).eq('status', 'open');
        // Existing uncategorised transactions from this merchant follow the rule
        let q = supabase.from('expense_transactions').update({ category_id: it.category_id, updated_at: Date.now() }).eq('user_id', uid).is('category_id', null);
        q = ptok?.length ? q.contains('merchant_tok', ptok) : q.ilike('merchant', `%${pattern}%`);
        await q;
      }
    };
    // A few at a time: each item is several round trips, and 18 folios one by one took longer than the app waits
    await pool(items, 6, handle);
    res.json({ ok: true, ...out });
    // Linking folios and past payments can take a while: do it after answering
    setImmediate(async () => {
      if (step === 'folios') await linkFolios(uid).catch(e => console.error(JSON.stringify({ event: 'SETUP_LINK_FOLIOS_ERROR', error: e.message })));
      if (['salary', 'loans', 'cards', 'subscriptions', 'folios'].includes(step))
        await linkActuals(uid, { force: true }).catch(e => console.error(JSON.stringify({ event: 'SETUP_LINK_ACTUALS_ERROR', error: e.message })));
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'SETUP_APPLY_ERROR', step, error: err.message }));
    res.status(500).json({ error: err.message, ...out });
  }
});

// SMS groups found during setup (same payee, many SMS). Saved to the account so the user can sort them
// later on the web (Events > SMS groups) or in the app (Manage). Encrypted accounts send key / name / sample
// encrypted and the key's word fingerprints in pattern_tok. Stats refresh on every run; the user's decision stays.
router.post('/groups', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    const { data: ex } = await supabase.from('sms_groups').select('id, key, status').eq('owner_id', uid);
    const byKey = Object.fromEntries((ex || []).map(g => [g.key, g]));
    let created = 0, updated = 0;
    const rows = [];
    for (const it of items) {
      const key = typeof it.key === 'string' ? it.key.trim().slice(0, 600) : '';
      if (key.length < 3) continue;
      const row = {
        owner_id: uid, key, pattern_tok: Array.isArray(it.pattern_tok) ? it.pattern_tok.filter(x => typeof x === 'string').slice(0, 20) : null,
        name: str(it.name, 2000), sample: str(it.sample, 8000), sender_key: str(it.sender_key, 20),
        count: Math.max(0, Math.round(num(it.count) || 0)), total: num(it.total), avg_amount: num(it.avg_amount), min_amount: num(it.min_amount), max_amount: num(it.max_amount),
        first_seen: isDate(it.first_seen) ? it.first_seen : null, last_seen: isDate(it.last_seen) ? it.last_seen : null,
        cadence: ['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(it.cadence) ? it.cadence : null,
        due_day: (() => { const d = parseInt(it.due_day, 10); return d >= 1 && d <= 31 ? d : null; })(),
        suggested: str(it.suggested, 60), updated_at: nowIso(),
      };
      if (byKey[key]) { await supabase.from('sms_groups').update(row).eq('id', byKey[key].id); updated++; }
      else rows.push({ ...row, status: 'open', source: 'phone' });
    }
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('sms_groups').insert(rows.slice(i, i + 100));
      if (error) throw error;
      created += Math.min(100, rows.length - i);
    }
    res.json({ ok: true, created, updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/done', requireAuth, async (req, res) => {
  await supabase.from('users').update({ sms_setup_at: nowIso() }).eq('id', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
