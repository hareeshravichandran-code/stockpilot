/**
 * Kanalyst — NPS Routes
 * Fixed: BUG-2 (use email.body not email.attachments/pdfBuffer)
 * Fixed: BUG-3 (pass NPS passwords to fetchEmails via npsPasswords field)
 * Fixed: BUG-6 (handle image-based PDFs via OCR text in email.body)
 */
const router                      = require('express').Router();
const { decrypt } = require('../services/tokenCrypto');
const requireAuth                 = require('../middleware/requireAuth');
const supabase                    = require('../services/supabase');
const { parseNPSText, generateNPSPasswords } = require('../services/npsParser');

// ── GET / — latest holding + history ─────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  // Fetch NPS holdings (no join — avoids FK issues with goals)
  const { data, error } = await supabase
    .from('nps_holdings')
    .select('*')
    .eq('user_id', req.user.id)
    .order('statement_to', { ascending: false });

  if (error) {
    console.error(JSON.stringify({ event: 'NPS_GET_ERROR', error: error.message }));
    return res.status(500).json({ error: error.message });
  }

  console.log(JSON.stringify({ event: 'NPS_GET', userId: req.user.id, count: (data||[]).length }));

  const rows   = data || [];
  // One row per PRAN (latest statement each). Two accounts (e.g. Protean + CAMS) add up.
  const byPran = {};
  for (const r of rows) { const k = r.pran || 'NPS'; if (!byPran[k]) byPran[k] = r; }
  const accounts = Object.values(byPran);
  const sumOf = (list, f) => list.reduce((t, r) => t + parseFloat(r[f] || 0), 0);
  let latest = rows[0] || null;
  if (accounts.length > 1) {
    latest = { ...accounts[0], pran: accounts.map(a => a.pran).join(' + '),
      total_value: sumOf(accounts, 'total_value'), total_contributions: sumOf(accounts, 'total_contributions'),
      notional_gain: sumOf(accounts, 'notional_gain'), statement_to: accounts.map(a => a.statement_to).sort().pop() };
  }
  if (latest?.goal_id) {
    const { data: goal } = await supabase
      .from('goals').select('id, name, target_date, target_amount')
      .eq('id', latest.goal_id).single();
    if (goal) latest = { ...latest, goals: goal };
  }

  // History: at each statement date, each account counts with its latest value up to that date
  const datesAsc = [...new Set(rows.map(r => r.statement_to))].sort();
  const multi = accounts.length > 1;
  const history = !multi ? null : datesAsc.map(d => {
    const at = Object.keys(byPran).map(k => rows.find(r => (r.pran || 'NPS') === k && r.statement_to <= d)).filter(Boolean);
    return { date: d, email_date: null, total_value: sumOf(at, 'total_value'), total_contributions: sumOf(at, 'total_contributions'),
      notional_gain: sumOf(at, 'notional_gain'), scheme_e: sumOf(at, 'scheme_e_value'), scheme_c: sumOf(at, 'scheme_c_value'),
      scheme_g: sumOf(at, 'scheme_g_value'), xirr: null };
  });
  const historySingle = rows.map(r => ({
    date:               r.statement_to,
    email_date:         r.email_date || null,
    total_value:        parseFloat(r.total_value || 0),
    total_contributions:parseFloat(r.total_contributions || 0),
    notional_gain:      parseFloat(r.notional_gain || 0),
    scheme_e:           parseFloat(r.scheme_e_value || 0),
    scheme_c:           parseFloat(r.scheme_c_value || 0),
    scheme_g:           parseFloat(r.scheme_g_value || 0),
    xirr:               r.xirr,
  })).reverse();
  const hist = history || historySingle;

  const growthPct = hist.length > 1 && hist[0].total_value > 0
    ? (((hist[hist.length - 1].total_value - hist[0].total_value) / hist[0].total_value) * 100).toFixed(2)
    : null;

  res.json({ latest, history: hist, count: rows.length, growthPct,
    accounts: accounts.map(a => ({ id: a.id, pran: a.pran, cra: a.source === 'cams_link' ? 'CAMS' : 'Protean', statement_to: a.statement_to, total_value: parseFloat(a.total_value || 0) })) });
});

// ── POST /sync — scan ALL Gmail NPS emails ────────────────────────
router.post('/sync', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { fromDate } = req.body;

  const { data: conn } = await supabase
    .from('email_connections').select('*')
    .eq('user_id', userId).eq('provider', 'gmail').single();
  if (!conn) return res.status(400).json({ error: 'No Gmail account connected' });

  const { data: userProfile } = await supabase
    .from('users').select('pan, dob, name').eq('id', userId).single();

  // Generate NPS-specific passwords: first4(name).lower() + DDMM from DOB
  const npsPasswords = generateNPSPasswords(userProfile?.name, userProfile?.dob);
  console.log(JSON.stringify({
    event: 'NPS_PASSWORDS_GENERATED',
    count: npsPasswords.length,
    sample: npsPasswords[0] || 'none',
    name: userProfile?.name?.slice(0, 5),
    dob: userProfile?.dob,
  }));

  if (npsPasswords.length === 0) {
    return res.status(400).json({
      error: 'Cannot generate NPS PDF password. Please set your Name and Date of Birth in Settings → Profile & PAN.'
    });
  }

  // Build search queries — most specific first
  const queryParts = ['has:attachment'];
  if (fromDate) queryParts.push(`after:${fromDate.replace(/-/g, '/')}`);

  const searchAttempts = [
    // Protean CRA (formerly NSDL e-Gov) — main NPS statement sender
    `from:(proteantech.in OR protean-tinpan.com OR nps.protean-tinpan.com) ${queryParts.join(' ')}`,
    // Subject-based fallbacks
    `subject:"NPS Transaction Statement" ${queryParts.join(' ')}`,
    `subject:"National Pension System" has:attachment`,
    // Broad fallback — any email with NPS + PDF
    `(nps OR "pension fund") subject:(statement OR transaction) has:attachment`,
  ];

  res.json({
    success:   true,
    message:   `NPS sync started — scanning Gmail with ${npsPasswords.length} password(s). Check back in ~30 seconds.`,
    passwords: npsPasswords.length,
    queries:   searchAttempts.length,
  });

  // ── Async background processing ──────────────────────────────────
  (async () => {
    const { fetchEmails } = require('../services/gmail');
    const SyncLogger = require('../services/logger');
    const logger = new SyncLogger(userId);
    let saved = 0, parsed = 0, errors = 0, emailsFound = 0;

    // Create a tracked session
    await supabase.from('sync_sessions').insert({
      user_id:    userId,
      started_at: new Date().toISOString(),
      status:     'running',
      sync_type:  'nps_backfill',
      summary:    { queries: searchAttempts.length, passwords: npsPasswords.length, fromDate },
    }).select('id').single().then(({ data }) => { if (data) logger.sessionId = data.id; });

    for (const query of searchAttempts) {
      try {
        console.log(JSON.stringify({ event: 'NPS_SEARCH', query }));

        // Pass NPS passwords via npsPasswords field on userProfile
        // gmail.js will prepend them to the password list for PDF extraction
        const profileWithNPS = {
          ...(userProfile || {}),
          npsPasswords,
        };

        const emails = await fetchEmails(
          decrypt(conn.access_token),
          decrypt(conn.refresh_token),
          query,
          profileWithNPS,
          { maxResults: 60 }   // BUG-1 FIX: now actually used
        );

        emailsFound += emails.length;
        console.log(JSON.stringify({ event: 'NPS_EMAILS_FOUND', count: emails.length, query }));

        if (emails.length === 0) continue;

        for (const email of emails) {
          try {
            // BUG-2 FIX: email.body already contains extracted PDF text
            // gmail.js extracts PDF → text and puts it all in email.body
            const textToParse = email.body || '';

            if (!textToParse || textToParse.length < 100) {
              console.log(JSON.stringify({ event: 'NPS_SKIP_EMPTY', subject: email.subject }));
              continue;
            }

            // Check if this looks like an NPS statement
            const isNPS = /NPS|National Pension|PRAN|Protean|Pension Fund/i.test(textToParse);
            if (!isNPS) {
              console.log(JSON.stringify({ event: 'NPS_SKIP_NOT_NPS', subject: email.subject, bodyStart: textToParse.slice(0, 100) }));
              continue;
            }

            console.log(JSON.stringify({
              event: 'NPS_PARSING',
              subject: email.subject,
              hasPdf: email.hasPdf,
              pdfFailed: email.pdfFailed,
              bodyLength: textToParse.length,
              bodyStart: textToParse.slice(0, 200),
            }));

            // BUG-4 FIX: Use parseNPSText() on already-extracted text, not parseNPSPDF()
            const parsed_data = parseNPSText(textToParse);

            if (!parsed_data || !parsed_data.total_value) {
              console.log(JSON.stringify({
                event: 'NPS_PARSE_FAILED',
                subject: email.subject,
                reason: 'parseNPSText returned null or no total_value',
                textSnippet: textToParse.slice(0, 300),
              }));
              errors++;
              continue;
            }

            // Use email date as fallback for statement_to
            if (!parsed_data.statement_to) {
              try {
                const d = new Date(email.date);
                // Use last day of that month
                parsed_data.statement_to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
                  .toISOString().split('T')[0];
              } catch(e) {
                parsed_data.statement_to = new Date().toISOString().split('T')[0];
              }
            }

            console.log(JSON.stringify({
              event: 'NPS_PARSED_OK',
              date: parsed_data.statement_to,
              totalValue: parsed_data.total_value,
              schemeE: parsed_data.scheme_e_value,
              xirr: parsed_data.xirr,
              pran: parsed_data.pran,
            }));

            const { error: dbErr } = await supabase.from('nps_holdings').upsert({
              user_id:             userId,
              pran:                parsed_data.pran,
              subscriber_name:     parsed_data.subscriber_name,
              registration_date:   parsed_data.registration_date,
              statement_from:      parsed_data.statement_from,
              statement_to:        parsed_data.statement_to,
              cbo_name:            parsed_data.cbo_name,
              tier:                parsed_data.tier || 'I',
              total_value:         parsed_data.total_value,
              total_contributions: parsed_data.total_contributions,
              total_withdrawals:   parsed_data.total_withdrawals || 0,
              notional_gain:       parsed_data.notional_gain,
              xirr:                parsed_data.xirr,
              num_contributions:   parsed_data.num_contributions,
              scheme_e_value:      parsed_data.scheme_e_value,
              scheme_e_units:      parsed_data.scheme_e_units,
              scheme_e_nav:        parsed_data.scheme_e_nav,
              scheme_e_pct:        parsed_data.scheme_e_pct,
              scheme_c_value:      parsed_data.scheme_c_value,
              scheme_c_units:      parsed_data.scheme_c_units,
              scheme_c_nav:        parsed_data.scheme_c_nav,
              scheme_c_pct:        parsed_data.scheme_c_pct,
              scheme_g_value:      parsed_data.scheme_g_value,
              scheme_g_units:      parsed_data.scheme_g_units,
              scheme_g_nav:        parsed_data.scheme_g_nav,
              scheme_g_pct:        parsed_data.scheme_g_pct,
              source:              email.pdfFailed ? 'email_text' : 'email',
              email_date:          email.date ? new Date(email.date).toISOString().split('T')[0] : null,
              raw_text_snippet:    textToParse.slice(0, 500),
              updated_at:          new Date().toISOString(),
            }, { onConflict: 'user_id,pran,statement_to' });

            if (dbErr) {
              console.error(JSON.stringify({ event: 'NPS_DB_ERROR', error: dbErr.message }));
              await logger.logFailure({ phase: 'nps', emailId: email.id, subject: email.subject, from: email.from, date: email.date, hasPdf: email.hasPdf, errorType: 'DB_ERROR', errorMessage: dbErr.message });
              errors++;
            } else {
              saved++;
              await logger.logSuccess({ phase: 'nps', emailId: email.id, subject: email.subject, from: email.from, date: email.date, hasPdf: email.hasPdf, itemsFound: 1, parsedData: [{ date: parsed_data.statement_to, value: parsed_data.total_value }] });
              console.log(JSON.stringify({ event: 'NPS_SAVED', date: parsed_data.statement_to, value: parsed_data.total_value }));
            }
            parsed++;
          } catch (e) {
            console.error(JSON.stringify({ event: 'NPS_EMAIL_ERROR', error: e.message, stack: e.stack?.slice(0, 200) }));
            errors++;
          }
        }

        if (saved > 0) {
          console.log(JSON.stringify({ event: 'NPS_SYNC_DONE_EARLY', reason: 'found results', saved }));
          break;
        }
      } catch (e) {
        console.error(JSON.stringify({ event: 'NPS_SEARCH_ERROR', query, error: e.message }));
      }
    }

    // ── CAMS CRA accounts: the monthly statement is a download link (PDF locked with PAN) ──
    try {
      const { parsePdfWithPasswords } = require('../services/gmail');
      const camsMails = await fetchEmails(decrypt(conn.access_token), decrypt(conn.refresh_token),
        'from:camsnps.com subject:"Transaction Statement"', userProfile || {}, { maxResults: 3 });
      camsMails.sort((a, b) => new Date(b.date) - new Date(a.date));
      for (const email of camsMails.slice(0, 2)) {
        const url = (email.links || []).find(l => /camsnps\.in\/.*statement/i.test(l));
        if (!url) { console.log(JSON.stringify({ event: 'NPS_CAMS_NO_LINK', subject: email.subject })); continue; }
        const r = await fetch(url, { redirect: 'follow' });
        const buf = Buffer.from(await r.arrayBuffer());
        if (!r.ok || buf.slice(0, 4).toString() !== '%PDF') {
          await logger.logFailure({ phase: 'nps', emailId: email.id, subject: email.subject, from: email.from, date: email.date,
            errorType: 'CAMS_LINK', errorMessage: `Statement link gave ${r.status} ${r.headers.get('content-type') || ''} (may have expired)` });
          continue;
        }
        const pans = [userProfile?.pan, userProfile?.pan?.toUpperCase()].filter(Boolean);
        const { text } = await parsePdfWithPasswords(buf, pans, 'cams-nps.pdf');
        const pd = text ? parseNPSText(text) : null;
        if (!pd || !pd.total_value) {
          await logger._writeLog({ phase: 'nps_cams_debug', status: 'skipped', email_id: email.id, email_subject: email.subject,
            email_from: email.from, email_date: email.date, has_pdf: true, items_found: 0, error_type: 'CAMS_NOT_READ',
            error_message: text ? 'CAMS NPS statement opened but not understood' : 'Could not open the CAMS PDF with PAN',
            raw_text_snippet: (text || '').slice(0, 6000) });
          errors++;
          continue;
        }
        if (!pd.statement_to) { const d = new Date(email.date); pd.statement_to = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10); }
        const { error: e2 } = await supabase.from('nps_holdings').upsert({
          user_id: userId, pran: pd.pran || 'CAMS', subscriber_name: pd.subscriber_name, registration_date: pd.registration_date,
          statement_from: pd.statement_from, statement_to: pd.statement_to, cbo_name: pd.cbo_name, tier: pd.tier || 'I',
          total_value: pd.total_value, total_contributions: pd.total_contributions, total_withdrawals: pd.total_withdrawals || 0,
          notional_gain: pd.notional_gain, xirr: pd.xirr, num_contributions: pd.num_contributions,
          scheme_e_value: pd.scheme_e_value, scheme_e_units: pd.scheme_e_units, scheme_e_nav: pd.scheme_e_nav, scheme_e_pct: pd.scheme_e_pct,
          scheme_c_value: pd.scheme_c_value, scheme_c_units: pd.scheme_c_units, scheme_c_nav: pd.scheme_c_nav, scheme_c_pct: pd.scheme_c_pct,
          scheme_g_value: pd.scheme_g_value, scheme_g_units: pd.scheme_g_units, scheme_g_nav: pd.scheme_g_nav, scheme_g_pct: pd.scheme_g_pct,
          source: 'cams_link', email_date: new Date(email.date).toISOString().slice(0, 10), raw_text_snippet: text.slice(0, 500),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,pran,statement_to' });
        if (e2) { errors++; console.error(JSON.stringify({ event: 'NPS_CAMS_DB_ERROR', error: e2.message })); }
        else { saved++; parsed++; await logger.logSuccess({ phase: 'nps', emailId: email.id, subject: email.subject, from: email.from, date: email.date, hasPdf: true, itemsFound: 1, parsedData: [{ pran: pd.pran, date: pd.statement_to, value: pd.total_value }] }); break; }
      }
    } catch (e) { console.error(JSON.stringify({ event: 'NPS_CAMS_ERROR', error: e.message })); }

    console.log(JSON.stringify({ event: 'NPS_SYNC_COMPLETE', emailsFound, parsed, saved, errors }));
    await logger.finishSession({ emailsFound, parsed, saved, errors });
  })();
});

// ── POST /manual ──────────────────────────────────────────────────
router.post('/manual', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.total_value) {
    return res.status(400).json({ error: 'total_value is required' });
  }
  // Default statement_to to last day of current month if not provided
  if (!b.statement_to) {
    const now = new Date();
    b.statement_to = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
  }
  const { data, error } = await supabase.from('nps_holdings').upsert({
    user_id:             req.user.id,
    pran:                b.pran || null,
    statement_to:        b.statement_to,
    statement_from:      b.statement_from || null,
    total_value:         parseFloat(b.total_value),
    total_contributions: b.total_contributions ? parseFloat(b.total_contributions) : null,
    notional_gain:       b.notional_gain ? parseFloat(b.notional_gain) : null,
    xirr:                b.xirr ? parseFloat(b.xirr) : null,
    scheme_e_value:      b.scheme_e_value ? parseFloat(b.scheme_e_value) : null,
    scheme_e_pct:        parseFloat(b.scheme_e_pct || 75),
    scheme_c_value:      b.scheme_c_value ? parseFloat(b.scheme_c_value) : null,
    scheme_c_pct:        parseFloat(b.scheme_c_pct || 15),
    scheme_g_value:      b.scheme_g_value ? parseFloat(b.scheme_g_value) : null,
    scheme_g_pct:        parseFloat(b.scheme_g_pct || 10),
    goal_id:             b.goal_id || null,
    goal_earmark_pct:    parseFloat(b.goal_earmark_pct || 100),
    source:              'manual',
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'user_id,statement_to' }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ nps: data });
});

// ── PUT /:id ──────────────────────────────────────────────────────
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
