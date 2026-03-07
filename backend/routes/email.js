const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase = require('../services/supabase');
const { getAuthUrl, exchangeCode, fetchEmails } = require('../services/gmail');
const { parseEmail } = require('../services/emailParser');

// ── Get Gmail OAuth URL ──
router.get('/gmail/connect', requireAuth, (req, res) => {
  const url = getAuthUrl(req.user.id);
  res.json({ url });
});

// ── Gmail OAuth callback ──
router.get('/gmail/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard?error=oauth_failed`);
  }

  try {
    const tokens = await exchangeCode(code);

    // Save tokens to DB
    await supabase.from('email_connections').upsert({
      user_id: userId,
      provider: 'gmail',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      connected_at: new Date().toISOString()
    }, { onConflict: 'user_id,provider' });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?connected=gmail`);
  } catch (err) {
    console.error('Gmail OAuth error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?error=oauth_failed`);
  }
});

// ── Sync emails ──
router.post('/sync', requireAuth, async (req, res) => {
  try {
    // Get stored tokens
    const { data: conn } = await supabase
      .from('email_connections')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('provider', 'gmail')
      .single();

    if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

    // Fetch emails
    const emails = await fetchEmails(conn.access_token, conn.refresh_token);

    // Parse each email
    const parsed = [];
    for (const email of emails) {
      const result = parseEmail(email);
      if (result.type && result.data.length > 0) {
        parsed.push({ ...result, emailId: email.id, emailDate: email.date, subject: email.subject });
      }
    }

    // Save parsed transactions to DB
    const trades = parsed.filter(p => p.type === 'TRADE').flatMap(p =>
      p.data.map(d => ({
        user_id: req.user.id,
        email_id: p.emailId,
        type: d.type,
        symbol: d.symbol,
        quantity: d.quantity,
        price: d.price,
        broker: d.broker || p.broker || 'Unknown',
        trade_date: p.emailDate,
        raw_subject: p.subject
      }))
    );

    const dividends = parsed.filter(p => p.type === 'DIVIDEND').flatMap(p =>
      p.data.map(d => ({
        user_id: req.user.id,
        email_id: p.emailId,
        company: d.company,
        symbol: d.symbol,
        dividend_per_share: d.dividendPerShare,
        quantity: d.quantity,
        total_amount: d.totalAmount,
        credit_date: p.emailDate,
        source: d.source
      }))
    );

    if (trades.length > 0) {
      await supabase.from('transactions').upsert(trades, { onConflict: 'email_id,symbol,type' });
    }
    if (dividends.length > 0) {
      await supabase.from('dividends').upsert(dividends, { onConflict: 'email_id,company' });
    }

    // Update last synced
    await supabase.from('email_connections')
      .update({ last_synced: new Date().toISOString(), emails_parsed: emails.length })
      .eq('id', conn.id);

    res.json({
      success: true,
      emailsFound: emails.length,
      tradesFound: trades.length,
      dividendsFound: dividends.length,
      parsedSummary: parsed.map(p => ({ type: p.type, subject: p.subject, count: p.data.length }))
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed', message: err.message });
  }
});

// ── Get connection status ──
router.get('/status', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('email_connections')
    .select('provider, connected_at, last_synced, emails_parsed')
    .eq('user_id', req.user.id);
  res.json({ connections: data || [] });
});

module.exports = router;
