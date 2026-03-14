/**
 * Income Rules & Entries API
 * 
 * GET    /api/income/rules        — list all rules
 * POST   /api/income/rules        — create rule
 * PUT    /api/income/rules/:id    — update rule
 * DELETE /api/income/rules/:id    — delete rule
 * POST   /api/income/scan         — scan Gmail using all active rules
 * GET    /api/income/entries      — list entries (with summary)
 * POST   /api/income/entries      — add manual entry
 * DELETE /api/income/entries/:id  — delete entry
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Rental', 'Business', 'Interest', 'Bonus', 'Other'];

// ── List rules ────────────────────────────────────────────────────
router.get('/rules', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('income_rules')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Create rule ───────────────────────────────────────────────────
router.post('/rules', requireAuth, async (req, res) => {
  const { rule_name, category, bank_sender, subject_pattern,
          body_pattern, account_last4, min_amount, period, remark } = req.body;
  if (!rule_name || !category)
    return res.status(400).json({ error: 'rule_name and category are required' });
  if (!INCOME_CATEGORIES.includes(category))
    return res.status(400).json({ error: `category must be one of: ${INCOME_CATEGORIES.join(', ')}` });

  const { data, error } = await supabase.from('income_rules').insert({
    user_id: req.user.id, rule_name, category,
    bank_sender:     bank_sender     || null,
    subject_pattern: subject_pattern || null,
    body_pattern:    body_pattern    || null,
    account_last4:   account_last4   || null,
    min_amount:      min_amount      ? parseFloat(min_amount) : 0,
    period:          period          || 'monthly',
    remark:          remark          || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Update rule ───────────────────────────────────────────────────
router.put('/rules/:id', requireAuth, async (req, res) => {
  const { rule_name, category, bank_sender, subject_pattern,
          body_pattern, account_last4, min_amount, period, remark, is_active } = req.body;
  const { data, error } = await supabase.from('income_rules')
    .update({
      rule_name, category, bank_sender, subject_pattern,
      body_pattern, account_last4,
      min_amount: min_amount ? parseFloat(min_amount) : 0,
      period, remark,
      is_active: is_active !== undefined ? is_active : true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Delete rule ───────────────────────────────────────────────────
router.delete('/rules/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('income_rules')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Scan Gmail for income using all active rules ───────────────────
router.post('/scan', requireAuth, async (req, res) => {
  try {
    // Get Gmail token
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token').eq('user_id', req.user.id)
      .eq('provider', 'gmail').single();
    if (!conn) return res.status(400).json({ error: 'Gmail not connected. Please connect Gmail first.' });

    // Get active rules
    const { data: rules } = await supabase.from('income_rules')
      .select('*').eq('user_id', req.user.id).eq('is_active', true);
    if (!rules || rules.length === 0)
      return res.json({ found: 0, entries: [], message: 'No active rules. Please create a rule first.' });

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token:  conn.access_token,
      refresh_token: conn.refresh_token,
    });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const newEntries = [];

    for (const rule of rules) {
      // Build Gmail search query from rule
      const parts = [];
      if (rule.bank_sender)     parts.push(`from:${rule.bank_sender}`);
      if (rule.subject_pattern) parts.push(`subject:"${rule.subject_pattern}"`);
      // Search last 90 days
      const since = Math.floor((Date.now() - 90 * 86400000) / 1000);
      parts.push(`after:${since}`);

      const query = parts.join(' ');

      let messageIds = [];
      try {
        const listRes = await gmail.users.messages.list({
          userId: 'me', q: query, maxResults: 50
        });
        messageIds = listRes.data.messages || [];
      } catch(e) {
        console.warn(`Gmail search failed for rule ${rule.id}: ${e.message}`);
        continue;
      }

      for (const msg of messageIds) {
        // Check if already imported
        const { data: existing } = await supabase.from('income_entries')
          .select('id').eq('user_id', req.user.id).eq('email_id', msg.id).single();
        if (existing) continue; // already captured

        let fullMsg;
        try {
          fullMsg = await gmail.users.messages.get({
            userId: 'me', id: msg.id, format: 'full'
          });
        } catch(e) { continue; }

        const headers  = fullMsg.data.payload?.headers || [];
        const subject  = headers.find(h => h.name === 'Subject')?.value || '';
        const fromHdr  = headers.find(h => h.name === 'From')?.value    || '';
        const dateHdr  = headers.find(h => h.name === 'Date')?.value    || '';

        // Get email body text
        let bodyText = '';
        const getBody = (parts) => {
          if (!parts) return;
          for (const p of parts) {
            if (p.mimeType === 'text/plain' && p.body?.data) {
              bodyText += Buffer.from(p.body.data, 'base64').toString('utf-8');
            }
            if (p.parts) getBody(p.parts);
          }
        };
        if (fullMsg.data.payload?.body?.data) {
          bodyText = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
        }
        getBody(fullMsg.data.payload?.parts);

        const combined = (subject + ' ' + bodyText).toLowerCase();

        // Apply body_pattern filter
        if (rule.body_pattern && !combined.includes(rule.body_pattern.toLowerCase())) continue;

        // Apply account_last4 filter
        if (rule.account_last4 && !combined.includes(rule.account_last4)) continue;

        // Extract amount — look for ₹ or Rs or INR followed by number
        const amtMatch = combined.match(/(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
          || combined.match(/(?:credited|credit|cr).*?([0-9,]{4,}(?:\.[0-9]{1,2})?)/i)
          || bodyText.match(/([0-9,]{5,}(?:\.[0-9]{1,2})?)/);

        if (!amtMatch) continue;
        const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
        if (isNaN(amount) || amount <= 0) continue;
        if (rule.min_amount > 0 && amount < rule.min_amount) continue;

        // Parse date from email header
        let credited_on;
        try { credited_on = new Date(dateHdr).toISOString().split('T')[0]; }
        catch(e) { credited_on = new Date().toISOString().split('T')[0]; }

        // Save entry
        const { data: entry, error: insertErr } = await supabase
          .from('income_entries').insert({
            user_id:       req.user.id,
            rule_id:       rule.id,
            category:      rule.category,
            amount,
            credited_on,
            bank_sender:   fromHdr,
            email_subject: subject,
            email_id:      msg.id,
            description:   `${rule.rule_name} — auto-detected`,
            source:        'auto',
          }).select().single();

        if (!insertErr && entry) newEntries.push(entry);
      }
    }

    res.json({
      found:   newEntries.length,
      entries: newEntries,
      message: newEntries.length > 0
        ? `Found ${newEntries.length} new income credit${newEntries.length > 1 ? 's' : ''}`
        : 'No new income found. Try adjusting your rules.',
    });
  } catch (err) {
    console.error('Income scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── List entries with summary ─────────────────────────────────────
router.get('/entries', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('income_entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('credited_on', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const entries = data || [];

  // FY summary (Apr–Mar)
  const now   = new Date();
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);

  const currentFY = entries.filter(e => new Date(e.credited_on) >= fyStart);
  const thisMonth = entries.filter(e => {
    const d = new Date(e.credited_on);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  // By category
  const byCategory = {};
  for (const e of currentFY) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }

  res.json({
    entries,
    summary: {
      currentFYTotal: currentFY.reduce((s, e) => s + e.amount, 0),
      thisMonthTotal: thisMonth.reduce((s, e) => s + e.amount, 0),
      byCategory,
      entryCount: entries.length,
    }
  });
});

// ── Add manual entry ──────────────────────────────────────────────
router.post('/entries', requireAuth, async (req, res) => {
  const { category, amount, credited_on, description, remark } = req.body;
  if (!category || !amount || !credited_on)
    return res.status(400).json({ error: 'category, amount and credited_on are required' });
  const { data, error } = await supabase.from('income_entries').insert({
    user_id: req.user.id,
    category, amount: parseFloat(amount),
    credited_on,
    description: description || remark || category,
    source: 'manual',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Delete entry ──────────────────────────────────────────────────
router.delete('/entries/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('income_entries')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Categories list (for frontend dropdowns) ──────────────────────
router.get('/categories', requireAuth, (req, res) => {
  res.json(INCOME_CATEGORIES);
});

module.exports = router;
