const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const requireAuth = require('../middleware/requireAuth');

// ── Sign Up ──
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email).single();
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({ name, email, password_hash: hashed })
    .select('id, name, email, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: data });
});

// ── Login ──
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const { data: user } = await supabase
    .from('users').select('*').eq('email', email).single();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, pan: user.pan ? '****' + user.pan.slice(-4) : null, dob: user.dob ? true : false, broker: user.broker } });
});

// ── Get current user ──
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users').select('id, name, email, pan, dob, broker, created_at').eq('id', req.user.id).single();
  if (error) return res.status(404).json({ error: 'User not found' });
  // Mask PAN for security
  res.json({
    ...data,
    pan: data.pan ? '****' + data.pan.slice(-4) : null,
    panSet: !!data.pan,
    dobSet: !!data.dob
  });
});

// ── Update Profile (PAN, DOB, Name, Mobile, Client Code) ──
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

    const { error } = await supabase
      .from('users').update(updates).eq('id', req.user.id);

    if (error) throw error;
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get PDF passwords for this user (used by email sync) ──
router.get('/pdf-passwords', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users').select('pan, dob, broker, email').eq('id', req.user.id).single();
  if (error) return res.status(404).json({ error: 'User not found' });

  const passwords = generatePdfPasswords(data.pan, data.dob, data.email, data.broker);
  res.json({ passwords });
});

// Generate all possible PDF passwords for Indian brokers
function generatePdfPasswords(pan, dob, email, broker) {
  const passwords = [];
  if (!pan && !dob) return passwords;

  const p = pan?.toUpperCase() || '';
  const d = dob || ''; // DDMMYYYY

  // Parse DOB parts
  const dd = d.slice(0, 2);
  const mm = d.slice(2, 4);
  const yyyy = d.slice(4, 8);
  const yy = yyyy.slice(2, 4);

  if (p) {
    passwords.push(p);                          // ABCDE1234F
    passwords.push(p.toLowerCase());            // abcde1234f
  }

  if (p && d) {
    // ICICI Direct: PAN + DOB DDMMYYYY
    passwords.push(p + d);                      // ABCDE1234F01011980
    passwords.push(p.toLowerCase() + d);
    // ICICI Direct variant: PAN + DD/MM/YYYY
    passwords.push(p + dd + '/' + mm + '/' + yyyy);
    // HDFC Securities: PAN + DDMMYYYY
    passwords.push(p + dd + mm + yyyy);
    // Kotak: PAN + DOB DDMMYY
    passwords.push(p + dd + mm + yy);
    // Motilal Oswal: PAN lowercase + DOB
    passwords.push(p.toLowerCase() + dd + mm + yyyy);
    // Sharekhan: DOB DDMMYYYY only
    passwords.push(dd + mm + yyyy);
    // DOB variants
    passwords.push(yyyy + mm + dd);             // YYYYMMDD
    passwords.push(dd + '-' + mm + '-' + yyyy); // DD-MM-YYYY
  }

  if (d) {
    passwords.push(d);                          // DDMMYYYY alone
    passwords.push(dd + mm + yyyy);
  }

  // Remove duplicates and empty
  return [...new Set(passwords)].filter(Boolean);
}

module.exports = router;
