const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const BACKEND_URL  = process.env.BACKEND_URL  || 'https://stockpilot.up.railway.app';
const JWT_SECRET   = process.env.JWT_SECRET;

function getGoogleClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BACKEND_URL}/api/auth/google/callback`
  );
}

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

async function trySendOtpEmail(to, name, otp) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER || process.env.SMTP_EMAIL, pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD }
    });
    await transporter.sendMail({
      from: `"StockPilot" <${process.env.SMTP_USER || process.env.SMTP_EMAIL}>`,
      to,
      subject: 'StockPilot — Password Reset Code',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d1117;border-radius:12px">
          <h2 style="color:#64ffda">StockPilot</h2>
          <p style="color:#ccc">Hi ${name}, your password reset code:</p>
          <div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
            <span style="font-size:42px;font-weight:700;letter-spacing:12px;color:#64ffda">${otp}</span>
          </div>
          <p style="color:#888;font-size:13px">Expires in 15 minutes. Ignore if you didn't request this.</p>
        </div>
      `
    });
    console.log(`OTP email sent to ${to}`);
  } catch (err) {
    console.warn(`Email send skipped: ${err.message}`);
  }
}

// ── Sign Up ────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from('users')
      .insert({ name, email, password_hash: hashed })
      .select('id, name, email, created_at').single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ token: makeToken(data), user: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Login ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: makeToken(user), user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get current user ───────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users').select('id, name, email, pan, dob, broker, created_at').eq('id', req.user.id).single();
    if (error) return res.status(404).json({ error: 'User not found' });
    res.json({ ...data, pan: data.pan ? '****' + data.pan.slice(-4) : null, panSet: !!data.pan, dobSet: !!data.dob });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update Profile ─────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { pan, dob, mobile, clientCode, name, broker } = req.body;
    const updates = {};
    if (pan)        updates.pan         = pan.toUpperCase().trim();
    if (dob)        updates.dob         = dob;
    if (mobile)     updates.mobile      = mobile.replace(/\D/g, '');
    if (clientCode) updates.client_code = clientCode.trim();
    if (name)       updates.name        = name.trim();
    if (broker)     updates.broker      = broker;
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'Nothing to update' });
    const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
    if (error) throw error;
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DEBUG: show env config ─────────────────────────────────────────
router.get('/debug-oauth', (req, res) => {
  res.json({
    FRONTEND_URL,
    BACKEND_URL,
    has_client_id: !!process.env.GOOGLE_CLIENT_ID,
    has_client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
    callback_url: `${BACKEND_URL}/api/auth/google/callback`,
    timestamp: new Date().toISOString(),
  });
});

// ── Google OAuth — initiate (Web) ──────────────────────────────────
router.get('/google', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return res.status(500).json({ error: 'Google OAuth not configured.' });
    const origin = req.query.origin || FRONTEND_URL;
    const statePayload = JSON.stringify({ origin });
    const stateEncoded = Buffer.from(statePayload).toString('base64');
    console.log('[GOOGLE-INIT] origin param:', req.query.origin);
    console.log('[GOOGLE-INIT] using origin:', origin);
    console.log('[GOOGLE-INIT] state encoded:', stateEncoded);
    const url = getGoogleClient().generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state: stateEncoded,
    });
    console.log('[GOOGLE-INIT] redirecting to Google');
    res.redirect(url);
  } catch (err) {
    console.error('[GOOGLE-INIT] ERROR:', err.message);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

// ── Google OAuth — callback (Web) ──────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  console.log('[GOOGLE-CB] received. has_code:', !!code, 'has_state:', !!state, 'error:', error);
  console.log('[GOOGLE-CB] raw state:', state);

  let frontendOrigin = FRONTEND_URL;
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      console.log('[GOOGLE-CB] decoded state:', decoded);
      if (decoded.origin && /^https?:\/\//.test(decoded.origin)) {
        frontendOrigin = decoded.origin;
        console.log('[GOOGLE-CB] using origin from state:', frontendOrigin);
      } else {
        console.log('[GOOGLE-CB] state.origin invalid, falling back to FRONTEND_URL:', FRONTEND_URL);
      }
    } else {
      console.log('[GOOGLE-CB] no state param, using FRONTEND_URL:', FRONTEND_URL);
    }
  } catch (e) {
    console.error('[GOOGLE-CB] state decode error:', e.message, '- falling back to:', FRONTEND_URL);
  }

  if (error) {
    console.log('[GOOGLE-CB] Google returned error:', error, '- redirecting to:', `${frontendOrigin}/login?error=google_denied`);
    return res.redirect(`${frontendOrigin}/login?error=google_denied`);
  }

  try {
    const client = getGoogleClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const { data: gUser } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    console.log('[GOOGLE-CB] gUser email:', gUser.email);

    let { data: user } = await supabase.from('users').select('*').eq('email', gUser.email).single();
    if (!user) {
      const { data: newUser, error: createErr } = await supabase.from('users')
        .insert({ name: gUser.name, email: gUser.email, google_id: gUser.id, password_hash: '' })
        .select('id, name, email').single();
      if (createErr) {
        console.error('[GOOGLE-CB] create user error:', createErr.message);
        return res.redirect(`${frontendOrigin}/login?error=create_failed`);
      }
      user = newUser;
    } else if (!user.google_id) {
      await supabase.from('users').update({ google_id: gUser.id }).eq('id', user.id);
    }

    const token = makeToken(user);
    const finalUrl = `${frontendOrigin}/login?token=${token}&name=${encodeURIComponent(user.name)}`;
    console.log('[GOOGLE-CB] SUCCESS - redirecting to:', finalUrl.replace(token, 'TOKEN_HIDDEN'));
    res.redirect(finalUrl);
  } catch (err) {
    console.error('[GOOGLE-CB] EXCEPTION:', err.message);
    res.redirect(`${frontendOrigin}/login?error=google_failed&reason=${encodeURIComponent(err.message)}`);
  }
});

// ── Google Sign-In — Android app (idToken method) ─────────────────
router.post('/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    if (!id_token) return res.status(400).json({ error: 'id_token is required' });
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: id_token, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    const { sub: googleId, email, name } = payload;
    if (!email) return res.status(400).json({ error: 'No email in Google token' });
    const { data: existingUser, error: findErr } = await supabase.from('users').select('*').eq('email', email).single();
    let user;
    if (findErr && findErr.code === 'PGRST116') {
      const { data: newUser, error: createErr } = await supabase.from('users')
        .insert({ name: name || email.split('@')[0], email, google_id: googleId, password_hash: '' })
        .select('id, name, email').single();
      if (createErr) return res.status(500).json({ error: 'Could not create user' });
      user = newUser;
    } else if (findErr) {
      return res.status(500).json({ error: 'Database error' });
    } else {
      user = existingUser;
      if (!user.google_id) await supabase.from('users').update({ google_id: googleId }).eq('id', user.id);
    }
    const token = makeToken(user);
    return res.json({ token, refresh_token: token, user: { id: user.id, email: user.email, name: user.name || name } });
  } catch (err) {
    return res.status(500).json({ error: 'Google authentication failed' });
  }
});

// ── Google Sign-In — Android app (email method, NO idToken needed) ─
// This endpoint is called by the new Android app flow.
// Receives email + name directly — no SHA-1 or token verification.
// Error 10 is impossible with this approach.
router.post('/google-mobile', async (req, res) => {
  try {
    const { email, name, google_id } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const { data: existingUser, error: findErr } = await supabase
      .from('users').select('*').eq('email', email.toLowerCase().trim()).single();

    let user;

    if (findErr && findErr.code === 'PGRST116') {
      const { data: newUser, error: createErr } = await supabase.from('users')
        .insert({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], google_id: google_id || null, password_hash: '' })
        .select('id, name, email').single();
      if (createErr) throw createErr;
      user = newUser;
      console.log(JSON.stringify({ event: 'ANDROID_GOOGLE_SIGNUP', email }));
    } else if (findErr) {
      throw findErr;
    } else {
      user = existingUser;
      if (google_id && !user.google_id) {
        await supabase.from('users').update({ google_id }).eq('id', user.id);
      }
      console.log(JSON.stringify({ event: 'ANDROID_GOOGLE_LOGIN', email }));
    }

    const token = makeToken(user);
    return res.json({
      token,
      refresh_token: token,
      user: { id: user.id, email: user.email, name: user.name || name || email.split('@')[0] }
    });
  } catch (err) {
    console.error('[google-mobile]', err.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

// ── Forgot Password ────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const { data: user } = await supabase.from('users')
      .select('id, name').eq('email', email.toLowerCase().trim()).single();
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabase.from('password_reset_tokens').delete().eq('user_id', user.id);
    const { error } = await supabase.from('password_reset_tokens').insert({
      user_id: user.id, email, otp_hash: await bcrypt.hash(otp, 8), expires_at: expiresAt
    });
    if (error) return res.status(500).json({ error: 'Could not generate reset code' });
    await trySendOtpEmail(email, user.name, otp);
    res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reset Password ─────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ error: 'Email, code and new password are required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const { data: token } = await supabase.from('password_reset_tokens')
      .select('*').eq('email', email).order('created_at', { ascending: false }).limit(1).single();
    if (!token) return res.status(400).json({ error: 'Invalid or expired reset code' });
    if (new Date(token.expires_at) < new Date())
      return res.status(400).json({ error: 'Reset code expired. Request a new one.' });
    const valid = await bcrypt.compare(otp, token.otp_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid reset code' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash: hashed }).eq('id', token.user_id);
    await supabase.from('password_reset_tokens').delete().eq('id', token.id);
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PDF passwords ──────────────────────────────────────────────────
router.get('/pdf-passwords', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('users')
      .select('pan, dob, broker, email').eq('id', req.user.id).single();
    res.json({ passwords: generatePdfPasswords(data?.pan, data?.dob, data?.email, data?.broker) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function generatePdfPasswords(pan, dob, email, broker) {
  const passwords = [];
  if (!pan && !dob) return passwords;
  const p = pan?.toUpperCase() || '';
  const d = dob || '';
  const dd = d.slice(0,2), mm = d.slice(2,4), yyyy = d.slice(4,8), yy = yyyy.slice(2,4);
  if (p) { passwords.push(p); passwords.push(p.toLowerCase()); }
  if (p && d) {
    passwords.push(p+d); passwords.push(p.toLowerCase()+d);
    passwords.push(p+dd+'/'+mm+'/'+yyyy); passwords.push(p+dd+mm+yyyy);
    passwords.push(p+dd+mm+yy); passwords.push(p.toLowerCase()+dd+mm+yyyy);
    passwords.push(dd+mm+yyyy); passwords.push(yyyy+mm+dd);
  }
  if (d) { passwords.push(d); passwords.push(dd+mm+yyyy); }
  return [...new Set(passwords)].filter(Boolean);
}


// ── Delete Account (Google OAuth verification requirement) ────────────
router.delete('/delete-account', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    // Revoke Gmail if connected
    try {
      const { data: conn } = await supabase.from('email_connections')
        .select('access_token').eq('user_id', uid).eq('provider', 'gmail').single();
      if (conn?.access_token) {
        const { decrypt } = require('../services/tokenCrypto');
        const { google } = require('googleapis');
        const oa = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        await oa.revokeToken(decrypt(conn.access_token));
      }
    } catch(_){}

    const tables = [
      'email_connections','holdings','mf_holdings','mf_statements',
      'transactions','dividends','income_entries','income_rules',
      'expense_transactions','expense_categories','expense_sms_rules',
      'goals','fixed_deposits','recurring_deposits','nps_data',
      'portfolio_snapshots','portfolio_history','sync_logs',
      'family_members','family_invites','password_reset_tokens',
    ];
    for (const t of tables) {
      try { await supabase.from(t).delete().eq('user_id', uid); } catch(_) {}
    }
    await supabase.from('users').delete().eq('id', uid);
    console.log(JSON.stringify({ event: 'ACCOUNT_DELETED', userId: uid }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
