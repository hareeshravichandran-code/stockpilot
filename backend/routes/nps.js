/**
 * Kanalyst — NPS Routes
 * GET  /api/nps            — latest + history
 * GET  /api/nps/history    — all snapshots for chart
 * POST /api/nps/sync       — scan Gmail for NPS statements (all historical)
 * POST /api/nps/manual     — manual entry
 * PUT  /api/nps/:id        — update (goal link, manual edits)
 * DELETE /api/nps/:id      — delete single record
 */
const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const { generateNPSPasswords, parseNPSPDF } = require('../services/npsParser');

// ── GET / — latest holding + summary ─────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('nps_holdings')
    .select('*, goals(id, name, target_date, target_amount)')
    .eq('user_id', req.user.id)
    .order('statement_to', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const rows   = data || [];
  const latest = rows[0] || null;

  // History for chart: monthly points
  const history = rows.map(r => ({
    date:          r.statement_to,
    total_value:   parseFloat(r.total_value || 0),
    scheme_e:      parseFloat(r.scheme_e_value || 0),
    scheme_c:      parseFloat(r.scheme_c_value || 0),
    scheme_g:      parseFloat(r.scheme_g_value || 0),
    xirr:          r.xirr,
  })).reverse(); // oldest first for chart

  const growthPct = history.length > 1 && history[0].total_value > 0
    ? (((history[history.length-1].total_value - history[0].total_value) / history[0].total_value) * 100).toFixed(2)
    : null;

  res.json({ latest, history, count: rows.length, growthPct });
});

// ── POST /sync — scan Gmail for all NPS emails ───────────────────
router.post('/sync', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { fromDate } = req.body; // optional date limit

  const { data: conn } = await supabase
    .from('email_connections').select('*')
    .eq('user_id', userId).eq('provider', 'gmail').single();

  if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

  const { data: userProfile } = await supabase
    .from('users').select('pan, dob, name').eq('id', userId).single();

  const passwords = generateNPSPasswords(userProfile?.name, userProfile?.dob);
  if (passwords.length === 0) {
    return res.status(400).json({ error: 'Set your name and date of birth in Profile settings to unlock NPS PDFs' });
  }

  // Build query — NPS statements from Protean (formerly NSDL e-Gov)
  const queryParts = [
    'from:(protean-tinpan.com OR npsstatement.com OR cra@nsdl.co.in OR nps@nsdlpension.com)',
    'subject:(NPS OR "Pension" OR "Transaction Statement")',
    'has:attachment',
  ];
  if (fromDate) queryParts.push(`after:${fromDate.replace(/-/g, '/')}`);

  // Fallback queries
  const searchAttempts = [
    queryParts.join(' '),
    'subject:"NPS Transaction Statement" has:attachment',
    'subject:"National Pension System" has:attachment',
    'from:(protean) subject:(NPS OR statement) has:attachment',
  ];

  // Respond immediately — process async
  res.json({
    success:  true,
    message:  'NPS sync started — scanning Gmail for NPS statements. Results will appear shortly.',
    passwords: passwords.length,
  });

  // ── Async processing ─────────────────────────────────────────
  (async () => {
    const { fetchEmails } = require('../services/gmail');
    let saved = 0, errors = 0;

    for (const query of searchAttempts) {
      try {
        console.log(JSON.stringify({ event: 'NPS_GMAIL_SEARCH', query }));
        const emails = await fetchEmails(
          conn.access_token, conn.refresh_token,
          query, userProfile || {},
          { maxResults: 60 }
        );

        console.log(JSON.stringify({ event: 'NPS_EMAILS_FOUND', count: emails.length, query }));
        if (emails.length === 0) continue;

        for (const email of emails) {
          try {
            // Try each PDF attachment
            const attachments = email.attachments || [];
            // Also try inline PDF if exists
            if (email.pdfBuffer) attachments.push({ buffer: email.pdfBuffer, name: 'nps.pdf' });

            for (const att of attachments) {
              const buf = att.buffer || att.data;
              if (!buf) continue;

              const parsed = await parseNPSPDF(Buffer.from(buf), passwords);
              if (!parsed || !parsed.total_value) continue;
              if (!parsed.statement_to) {
                // Use email date as fallback
                const d = new Date(email.date);
                parsed.statement_to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
                  .toISOString().split('T')[0]; // last day of email's month
              }

              const { error } = await supabase.from('nps_holdings').upsert({
                user_id:             userId,
                pran:                parsed.pran,
                subscriber_name:     parsed.subscriber_name,
                registration_date:   parsed.registration_date,
                statement_from:      parsed.statement_from,
                statement_to:        parsed.statement_to,
                cbo_name:            parsed.cbo_name,
                tier:                parsed.tier || 'I',
                total_value:         parsed.total_value,
                total_contributions: parsed.total_contributions,
                total_withdrawals:   parsed.total_withdrawals || 0,
                notional_gain:       parsed.notional_gain,
                xirr:                parsed.xirr,
                num_contributions:   parsed.num_contributions,
                scheme_e_value:      parsed.scheme_e_value,
                scheme_e_units:      parsed.scheme_e_units,
                scheme_e_nav:        parsed.scheme_e_nav,
                scheme_e_pct:        parsed.scheme_e_pct,
                scheme_c_value:      parsed.scheme_c_value,
                scheme_c_units:      parsed.scheme_c_units,
                scheme_c_nav:        parsed.scheme_c_nav,
                scheme_c_pct:        parsed.scheme_c_pct,
                scheme_g_value:      parsed.scheme_g_value,
                scheme_g_units:      parsed.scheme_g_units,
                scheme_g_nav:        parsed.scheme_g_nav,
                scheme_g_pct:        parsed.scheme_g_pct,
                source:              'email',
                raw_text_snippet:    parsed.raw_text_snippet,
                updated_at:          new Date().toISOString(),
              }, { onConflict: 'user_id,statement_to' });

              if (error) {
                console.error(JSON.stringify({ event: 'NPS_SAVE_ERROR', error: error.message }));
                errors++;
              } else {
                saved++;
                console.log(JSON.stringify({ event: 'NPS_SAVED', date: parsed.statement_to, value: parsed.total_value }));
              }
              break; // one PDF per email is enough
            }
          } catch(e) {
            console.error(JSON.stringify({ event: 'NPS_EMAIL_ERROR', error: e.message }));
            errors++;
          }
        }

        if (saved > 0) break; // found results, stop trying other queries
      } catch(e) {
        console.error(JSON.stringify({ event: 'NPS_SEARCH_ERROR', error: e.message }));
      }
    }

    console.log(JSON.stringify({ event: 'NPS_SYNC_DONE', saved, errors }));
  })();
});

// ── POST /manual — add NPS data manually ─────────────────────────
router.post('/manual', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.statement_to || !b.total_value) {
    return res.status(400).json({ error: 'statement_to and total_value are required' });
  }

  const { data, error } = await supabase.from('nps_holdings').upsert({
    user_id:             req.user.id,
    pran:                b.pran || null,
    statement_to:        b.statement_to,
    statement_from:      b.statement_from || null,
    total_value:         b.total_value,
    total_contributions: b.total_contributions || null,
    notional_gain:       b.notional_gain || null,
    xirr:                b.xirr || null,
    scheme_e_value:      b.scheme_e_value || null,
    scheme_e_pct:        b.scheme_e_pct || 75,
    scheme_c_value:      b.scheme_c_value || null,
    scheme_c_pct:        b.scheme_c_pct || 15,
    scheme_g_value:      b.scheme_g_value || null,
    scheme_g_pct:        b.scheme_g_pct || 10,
    goal_id:             b.goal_id || null,
    goal_earmark_pct:    b.goal_earmark_pct || 100,
    source:              'manual',
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'user_id,statement_to' }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ nps: data });
});

// ── PUT /:id — update (goal link etc) ────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const allowed = ['goal_id','goal_earmark_pct','pran','total_value',
    'scheme_e_value','scheme_c_value','scheme_g_value',
    'total_contributions','notional_gain','xirr'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('nps_holdings').update(update)
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ nps: data });
});

// ── DELETE /:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('nps_holdings').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
