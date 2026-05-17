/**
 * Income Rules & Entries API — StockPilot
 *
 * Rules define HOW to detect income from bank credit emails:
 *   - receive_bank (mandatory): which bank account receives the money
 *   - date window: day_from to day_to (e.g. 28th–5th = end/start of month)
 *   - credit_only: only consider CREDITED emails (not debits)
 *   - lookback_months: how far back to scan history (0 = from now)
 *   - category: Salary / Rental / Freelance / Business / Interest / Bonus / <custom>
 *
 * Auto-scan runs every 30 mins via /api/income/scan (called by cron or frontend)
 *
 * Routes:
 *   GET    /api/income/rules        list rules
 *   POST   /api/income/rules        create rule
 *   PUT    /api/income/rules/:id    update rule
 *   DELETE /api/income/rules/:id    delete rule
 *   POST   /api/income/scan         scan Gmail now
 *   GET    /api/income/entries      list entries + summary
 *   POST   /api/income/entries      manual entry
 *   DELETE /api/income/entries/:id  delete entry
 *   GET    /api/income/categories   category list
 */

const router      = require('express').Router();
const { decrypt } = require('../services/tokenCrypto');
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

const PRESET_CATEGORIES = ['Salary', 'Freelance', 'Rental', 'Business', 'Interest', 'Bonus', 'Other'];

// Indian banks - sender email domains for matching
const INDIAN_BANKS = [
  { label: 'HDFC Bank',          domain: 'hdfcbank' },
  { label: 'ICICI Bank',         domain: 'icicibank' },
  { label: 'SBI',                domain: 'sbi' },
  { label: 'Axis Bank',          domain: 'axisbank' },
  { label: 'Kotak Mahindra',     domain: 'kotak' },
  { label: 'IndusInd Bank',      domain: 'indusind' },
  { label: 'Yes Bank',           domain: 'yesbank' },
  { label: 'Punjab National',    domain: 'pnb' },
  { label: 'Bank of Baroda',     domain: 'bankofbaroda' },
  { label: 'Canara Bank',        domain: 'canarabank' },
  { label: 'Union Bank',         domain: 'unionbank' },
  { label: 'Bank of India',      domain: 'bankofindia' },
  { label: 'Federal Bank',       domain: 'federalbank' },
  { label: 'IDFC First Bank',    domain: 'idfcfirstbank' },
  { label: 'RBL Bank',           domain: 'rblbank' },
  { label: 'Tamilnad Mercantile',domain: 'tmbonline' },
  { label: 'Equitas SFB',        domain: 'equitasbank' },
  { label: 'AU Small Finance',   domain: 'aubank' },
  { label: 'Ujjivan SFB',        domain: 'ujjivansfb' },
  { label: 'Jana SFB',           domain: 'janabank' },
];

// ── Helper: check if email text indicates a CREDIT transaction ──────
function isCreditEmail(subject, body) {
  const combined = (subject + ' ' + body).toLowerCase();
  // Strong credit signals
  const creditSignals = [
    'credited', 'credit alert', 'money received', 'amount credited',
    'salary credit', 'salary credited', 'has been credited', 'is credited',
    'received in your account', 'deposit', 'received credit',
    'incoming transfer', 'neft credit', 'rtgs credit', 'imps credit',
    'credit of rs', 'credited rs', 'credited inr', 'credited ₹',
    'cr alert', 'credit txn',
  ];
  // Debit signals to EXCLUDE
  const debitSignals = [
    'debited', 'debit alert', 'payment made', 'amount debited',
    'withdrawn', 'transferred from', 'dr alert', 'debit txn',
    'purchase at', 'spent at', 'transaction at',
  ];
  const hasCredit = creditSignals.some(s => combined.includes(s));
  const hasDebit  = debitSignals.some(s => combined.includes(s));
  // If has debit signal and no credit signal, it's a debit
  if (hasDebit && !hasCredit) return false;
  // If has credit signal, it's a credit
  if (hasCredit) return true;
  // Neutral — allow through (let amount extraction decide)
  return true;
}

// ── Helper: extract credit amount from email body ────────────────────
function extractAmount(subject, body) {
  const combined = subject + '\n' + body;

  // Pattern 1: ₹ followed by number (most reliable)
  const p1 = combined.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (p1) return parseFloat(p1[1].replace(/,/g, ''));

  // Pattern 2: Rs./INR followed by number
  const p2 = combined.match(/(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (p2) return parseFloat(p2[1].replace(/,/g, ''));

  // Pattern 3: "credited with" / "credited by" amount
  const p3 = combined.match(/credited\s+(?:with|by|of|for)?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (p3) return parseFloat(p3[1].replace(/,/g, ''));

  // Pattern 4: "Amount: X" or "Amt: X"
  const p4 = combined.match(/(?:amount|amt)\s*:?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (p4) return parseFloat(p4[1].replace(/,/g, ''));

  // Pattern 5: large number with decimals (>=4 digits before decimal)
  const p5 = combined.match(/\b(\d{1,3}(?:,\d{2,3})+(?:\.\d{2})?)\b/);
  if (p5) return parseFloat(p5[1].replace(/,/g, ''));

  return null;
}

// ── Helper: check if email date falls in rule's date window ─────────
function inDateWindow(emailDate, dayFrom, dayTo) {
  if (!dayFrom && !dayTo) return true; // no window set
  const d = new Date(emailDate);
  const day = d.getDate();
  // Window can span month boundary: e.g. dayFrom=28, dayTo=5
  // means: day >= 28 OR day <= 5
  if (dayFrom > dayTo) {
    // Spans month boundary
    return day >= dayFrom || day <= dayTo;
  }
  // Same month window: day >= from AND day <= to
  return day >= dayFrom && day <= dayTo;
}

// ── Helper: compute Gmail "after:" timestamp from lookback ───────────
function lookbackToGmailAfter(lookbackMonths) {
  if (!lookbackMonths || lookbackMonths === 0) {
    // Default: scan from 1st of current month to catch this month's income
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return Math.floor(startOfMonth.getTime() / 1000);
  }
  const ms = lookbackMonths * 30 * 86400000;
  return Math.floor((Date.now() - ms) / 1000);
}

// ── GET /api/income/rules ─────────────────────────────────────────
router.get('/rules', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('income_rules')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/income/rules ────────────────────────────────────────
router.post('/rules', requireAuth, async (req, res) => {
  const {
    rule_name, category, receive_bank,
    bank_sender, subject_pattern, body_pattern,
    account_last4, min_amount, period, remark,
    date_day_from, date_day_to, lookback_months, credit_only
  } = req.body;

  if (!rule_name)    return res.status(400).json({ error: 'rule_name is required' });
  if (!receive_bank) return res.status(400).json({ error: 'receive_bank is required (which bank receives the money)' });
  if (!category)     return res.status(400).json({ error: 'category is required' });

  const { data, error } = await supabase.from('income_rules').insert({
    user_id:         req.user.id,
    rule_name,
    category:        category.trim(),
    receive_bank:    receive_bank.trim(),
    bank_sender:     bank_sender     || null,
    subject_pattern: subject_pattern || null,
    body_pattern:    body_pattern    || null,
    account_last4:   account_last4   || null,
    min_amount:      min_amount ? parseFloat(min_amount) : 0,
    period:          period     || 'monthly',
    remark:          remark     || null,
    date_day_from:   date_day_from ? parseInt(date_day_from) : null,
    date_day_to:     date_day_to   ? parseInt(date_day_to)   : null,
    lookback_months: lookback_months ? parseInt(lookback_months) : 0,
    credit_only:     credit_only !== false,
    is_active: true,
    updated_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── PUT /api/income/rules/:id ────────────────────────────────────
router.put('/rules/:id', requireAuth, async (req, res) => {
  const {
    rule_name, category, receive_bank,
    bank_sender, subject_pattern, body_pattern,
    account_last4, min_amount, period, remark,
    date_day_from, date_day_to, lookback_months, credit_only, is_active
  } = req.body;

  const updates = {};
  if (rule_name !== undefined)        updates.rule_name        = rule_name;
  if (category !== undefined)         updates.category         = category?.trim();
  if (receive_bank !== undefined)     updates.receive_bank     = receive_bank?.trim();
  if (bank_sender !== undefined)      updates.bank_sender      = bank_sender   || null;
  if (subject_pattern !== undefined)  updates.subject_pattern  = subject_pattern || null;
  if (body_pattern !== undefined)     updates.body_pattern     = body_pattern  || null;
  if (account_last4 !== undefined)    updates.account_last4    = account_last4 || null;
  if (min_amount !== undefined)       updates.min_amount       = parseFloat(min_amount) || 0;
  if (period !== undefined)           updates.period           = period;
  if (remark !== undefined)           updates.remark           = remark || null;
  if (date_day_from !== undefined)    updates.date_day_from    = parseInt(date_day_from);
  if (date_day_to !== undefined)      updates.date_day_to      = parseInt(date_day_to);
  if (lookback_months !== undefined)  updates.lookback_months  = parseInt(lookback_months);
  if (credit_only !== undefined)      updates.credit_only      = credit_only;
  if (is_active !== undefined)        updates.is_active        = is_active;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('income_rules')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/income/rules/:id ─────────────────────────────────
router.delete('/rules/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('income_rules')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/income/scan ────────────────────────────────────────
// Scan Gmail using all active rules. Called manually + every 30 mins.
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token')
      .eq('user_id', req.user.id).eq('provider', 'gmail').single();
    if (!conn) return res.status(400).json({ error: 'Gmail not connected. Please connect Gmail first.' });

    const { data: rules } = await supabase.from('income_rules')
      .select('*').eq('user_id', req.user.id).eq('is_active', true);
    // If no rules, use a broad default scan for the current month
    const effectiveRules = (rules && rules.length > 0) ? rules : [{
      id: null, rule_name: 'Default Scan', category: 'Other',
      receive_bank: null, bank_sender: null, subject_pattern: null,
      body_pattern: null, account_last4: null, min_amount: 0,
      credit_only: true, lookback_months: 0,
      date_day_from: null, date_day_to: null,
    }];

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token:  decrypt(conn.access_token),
      refresh_token: decrypt(conn.refresh_token),
    });

    // Auto-refresh token if expired
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await supabase.from('email_connections')
          .update({ access_token: require('../services/tokenCrypto').encrypt(tokens.access_token), updated_at: new Date().toISOString() })
          .eq('user_id', req.user.id).eq('provider', 'gmail');
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const newEntries = [];
    const scanTime = new Date().toISOString();
    // Per-rule tracking for detailed response
    const ruleStats = {};
    for (const rule of effectiveRules) {
      ruleStats[rule.rule_name] = {
        ruleName: rule.rule_name, category: rule.category || 'Other',
        receiveBank: rule.receive_bank || null,
        emailsFound: 0, emailsRead: 0, captured: 0, skipped: 0,
        skipReasons: {},
      };
    }

    for (const rule of effectiveRules) {
      // Build Gmail query
      const afterTs = lookbackToGmailAfter(rule.lookback_months || 0);
      const parts = [`after:${afterTs}`];

      // Build from: filter using receive_bank (mandatory) + bank_sender (optional override)
      const senderToSearch = rule.bank_sender || null;
      const bankLabel = rule.receive_bank || '';
      const bankRecord = INDIAN_BANKS.find(b =>
        b.label.toLowerCase() === bankLabel.toLowerCase()
      );

      if (senderToSearch) {
        // User typed explicit sender email - use as-is
        parts.push(`from:${senderToSearch}`);
      } else if (bankRecord) {
        // Use bank domain from our lookup table
        parts.push(`from:${bankRecord.domain}`);
      }
      // If neither - no from: filter, rely on credit keywords

      // Subject pattern
      if (rule.subject_pattern) parts.push(`subject:"${rule.subject_pattern}"`);

      // Credit keywords always added when credit_only is true
      if (rule.credit_only !== false) {
        parts.push('(credited OR "credit alert" OR "salary credit" OR "money received" OR "amount credited")');
      }

      const query = parts.join(' ');
      console.log(`[INCOME_SCAN] rule="${rule.rule_name}" query="${query}"`);

      let messageIds = [];
      try {
        const listRes = await gmail.users.messages.list({
          userId: 'me', q: query, maxResults: 100
        });
        messageIds = listRes.data.messages || [];
        if (ruleStats[rule.rule_name]) ruleStats[rule.rule_name].emailsFound = messageIds.length;
      } catch(e) {
        console.warn(`[INCOME_SCAN] Gmail search failed rule=${rule.id}: ${e.message}`);
        if (ruleStats[rule.rule_name]) ruleStats[rule.rule_name].skipReasons['query_error'] = e.message;
        continue;
      }

      for (const msg of messageIds) {
        if (ruleStats[rule.rule_name]) ruleStats[rule.rule_name].emailsRead++;
        // Skip already-imported emails
        const { data: existing } = await supabase.from('income_entries')
          .select('id').eq('user_id', req.user.id).eq('email_id', msg.id).maybeSingle();
        if (existing) continue; // already imported - not counted

        let fullMsg;
        try {
          fullMsg = await gmail.users.messages.get({
            userId: 'me', id: msg.id, format: 'full'
          });
        } catch(e) { continue; }

        const headers   = fullMsg.data.payload?.headers || [];
        const subject   = headers.find(h => h.name === 'Subject')?.value || '';
        const fromHdr   = headers.find(h => h.name === 'From')?.value    || '';
        const dateHdr   = headers.find(h => h.name === 'Date')?.value    || '';

        // Extract body text
        let bodyText = '';
        const getBody = (parts) => {
          if (!parts) return;
          for (const p of parts) {
            if (p.mimeType === 'text/plain' && p.body?.data)
              bodyText += Buffer.from(p.body.data, 'base64').toString('utf-8');
            if (p.parts) getBody(p.parts);
          }
        };
        if (fullMsg.data.payload?.body?.data)
          bodyText = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
        getBody(fullMsg.data.payload?.parts);

        // ── Filter 1: Credit only ──
        if (rule.credit_only !== false && !isCreditEmail(subject, bodyText)) {
          if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k='not credit'; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
          continue;
        }

        // ── Filter 2: Body pattern ──
        const combined = (subject + ' ' + bodyText).toLowerCase();
        if (rule.body_pattern && !combined.includes(rule.body_pattern.toLowerCase())) {
          if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k='body pattern'; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
          continue;
        }

        // ── Filter 3: Account last 4 ──
        if (rule.account_last4 && !combined.includes(rule.account_last4)) {
          if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k='account mismatch'; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
          continue;
        }

        // ── Get email date ──
        let credited_on;
        try { credited_on = new Date(dateHdr).toISOString().split('T')[0]; }
        catch(e) { credited_on = new Date().toISOString().split('T')[0]; }

        // ── Filter: Date window (only if user explicitly set it) ──
        // e.g. window 28→5: salary arrives between 28th of prev month and 5th of this month
        // If date_day_from/to are null, all dates pass through
        if (rule.date_day_from && rule.date_day_to) {
          if (!inDateWindow(credited_on, rule.date_day_from, rule.date_day_to)) {
            if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k=`outside date window ${rule.date_day_from}-${rule.date_day_to}`; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
            continue;
          }
        }

        // ── Extract amount ──
        const amount = extractAmount(subject, bodyText);
        if (!amount || isNaN(amount) || amount <= 0) {
          if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k='no amount found'; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
          continue;
        }
        if (rule.min_amount > 0 && amount < rule.min_amount) {
          if (ruleStats[rule.rule_name]) { ruleStats[rule.rule_name].skipped++; const k=`below min ₹${rule.min_amount}`; ruleStats[rule.rule_name].skipReasons[k]=(ruleStats[rule.rule_name].skipReasons[k]||0)+1; }
          continue;
        }

        // ── Save entry ──
        const { data: entry, error: insertErr } = await supabase
          .from('income_entries').insert({
            user_id:        req.user.id,
            rule_id:        rule.id,
            category:       rule.category,
            amount,
            credited_on,
            receive_bank:   rule.receive_bank || null,
            bank_sender:    fromHdr,
            email_subject:  subject,
            email_id:       msg.id,
            description:    `${rule.rule_name} — auto-detected`,
            source:         'auto',
            auto_scanned_at: scanTime,
          }).select().single();

        if (!insertErr && entry) {
          newEntries.push(entry);
          if (ruleStats[rule.rule_name]) ruleStats[rule.rule_name].captured++;
          console.log(`[INCOME_SCAN] Saved entry: rule="${rule.rule_name}" amount=₹${amount} date=${credited_on}`);
        } else if (insertErr) {
          console.error('[INCOME_SCAN] Insert failed:', insertErr.message);
        }
      }
    }

    // Update last_scan_at on real rules (not the default placeholder)
    const realRuleIds = [...new Set(effectiveRules.filter(r => r.id).map(r => r.id))];
    if (realRuleIds.length > 0) {
      await supabase.from('income_rules')
        .update({ updated_at: scanTime })
        .in('id', realRuleIds)
        .eq('user_id', req.user.id);
    }

    const totalEmailsRead    = Object.values(ruleStats).reduce((s,r)=>s+r.emailsRead,0);
    const totalEmailsFound   = Object.values(ruleStats).reduce((s,r)=>s+r.emailsFound,0);
    const totalSkipped       = Object.values(ruleStats).reduce((s,r)=>s+r.skipped,0);

    const summary = newEntries.length > 0
      ? `✅ Captured ${newEntries.length} income entr${newEntries.length>1?'ies':'y'} from ${totalEmailsRead} emails read`
      : `📭 No new income found. Read ${totalEmailsRead} email${totalEmailsRead!==1?'s':''} across ${effectiveRules.length} rule${effectiveRules.length!==1?'s':''}.`;

    console.log(`[INCOME_SCAN] Done: found=${totalEmailsFound} read=${totalEmailsRead} captured=${newEntries.length} skipped=${totalSkipped}`);

    res.json({
      found:          newEntries.length,
      emailsFound:    totalEmailsFound,
      emailsRead:     totalEmailsRead,
      emailsSkipped:  totalSkipped,
      rulesApplied:   effectiveRules.length,
      ruleResults:    Object.values(ruleStats),
      entries:        newEntries,
      scannedAt:      scanTime,
      message:        summary,
    });
  } catch (err) {
    console.error('[INCOME_SCAN_ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/income/entries ───────────────────────────────────────
router.get('/entries', requireAuth, async (req, res) => {
  const { month, year } = req.query; // optional filters

  let query = supabase
    .from('income_entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('credited_on', { ascending: false });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const entries = data || [];
  const now   = new Date();

  // Financial year: Apr–Mar
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart     = new Date(fyStartYear, 3, 1); // April 1

  const currentFY   = entries.filter(e => new Date(e.credited_on) >= fyStart);
  const thisMonth   = entries.filter(e => {
    const d = new Date(e.credited_on);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  // By category (current FY)
  const byCategory = {};
  for (const e of currentFY) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }

  // By month (current FY, for chart)
  const byMonth = {};
  for (const e of currentFY) {
    const key = e.credited_on.slice(0, 7); // YYYY-MM
    byMonth[key] = (byMonth[key] || 0) + e.amount;
  }

  res.json({
    entries,
    summary: {
      currentFYTotal:  currentFY.reduce((s, e) => s + e.amount, 0),
      thisMonthTotal:  thisMonth.reduce((s, e) => s + e.amount, 0),
      byCategory,
      byMonth,
      entryCount: entries.length,
      fyLabel: `FY${String(fyStartYear + 1).slice(-2)}`,
    }
  });
});

// ── POST /api/income/entries (manual) ────────────────────────────
router.post('/entries', requireAuth, async (req, res) => {
  const { category, amount, credited_on, description, receive_bank, remark } = req.body;
  if (!category || !amount || !credited_on)
    return res.status(400).json({ error: 'category, amount and credited_on are required' });

  const { data, error } = await supabase.from('income_entries').insert({
    user_id:      req.user.id,
    category:     category.trim(),
    amount:       parseFloat(amount),
    credited_on,
    receive_bank: receive_bank || null,
    description:  description || remark || category,
    source:       'manual',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── DELETE /api/income/entries/:id ───────────────────────────────
router.delete('/entries/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('income_entries')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── GET /api/income/categories ───────────────────────────────────
router.get('/categories', requireAuth, (req, res) => {
  res.json(PRESET_CATEGORIES);
});

// ── GET /api/income/banks ────────────────────────────────────────
router.get('/banks', requireAuth, (req, res) => {
  res.json(INDIAN_BANKS);
});

module.exports = router;
