const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

// Only bcryptjs, jsonwebtoken, googleapis, supabase — all guaranteed installed
// nodemailer/mailer loaded lazily inside functions so missing package never crashes startup

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

// Safe email sender — tries nodemailer directly, never throws on failure
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
    // Never throw — server keeps running even if email fails
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

// ── Google OAuth — initiate ────────────────────────────────────────
router.get('/google', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return res.status(500).json({ error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Railway env vars.' });
    const url = getGoogleClient().generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account'
    });
    res.redirect(url);
  } catch (err) {
    console.error('Google initiate error:', err.message);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

// ── Google OAuth — callback ────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('[Google CB] query:', { code: code ? 'present' : 'missing', error });
  console.log('[Google CB] BACKEND_URL:', BACKEND_URL);
  console.log('[Google CB] FRONTEND_URL:', FRONTEND_URL);
  console.log('[Google CB] GOOGLE_CLIENT_ID set:', !!process.env.GOOGLE_CLIENT_ID);
  console.log('[Google CB] redirect_uri will be:', `${BACKEND_URL}/api/auth/google/callback`);

  if (error) return res.redirect(`${FRONTEND_URL}/login?error=google_denied`);
  try {
    const client = getGoogleClient();
    console.log('[Google CB] getting token...');
    const { tokens } = await client.getToken(code);
    console.log('[Google CB] token received, getting user info...');
    client.setCredentials(tokens);
    const { data: gUser } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    console.log('[Google CB] gUser email:', gUser.email, 'name:', gUser.name);
    let { data: user } = await supabase.from('users').select('*').eq('email', gUser.email).single();
    if (!user) {
      console.log('[Google CB] creating new user...');
      const { data: newUser, error: createErr } = await supabase.from('users')
        .insert({ name: gUser.name, email: gUser.email, google_id: gUser.id, password_hash: '' })
        .select('id, name, email').single();
      if (createErr) {
        console.error('[Google CB] create user error:', createErr.message);
        return res.redirect(`${FRONTEND_URL}/login?error=create_failed`);
      }
      user = newUser;
    } else if (!user.google_id) {
      await supabase.from('users').update({ google_id: gUser.id }).eq('id', user.id);
    }
    console.log('[Google CB] success, redirecting user:', user.id);
    res.redirect(`${FRONTEND_URL}/login?token=${makeToken(user)}&name=${encodeURIComponent(user.name)}`);
  } catch (err) {
    console.error('[Google CB] FULL ERROR:', err.message);
    console.error('[Google CB] ERROR STACK:', err.stack);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed&reason=${encodeURIComponent(err.message)}`);
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
    await trySendOtpEmail(email, user.name, otp); // never throws
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

module.exports = router;
