/**
 * Expense Module API — StockPilot
 *
 * Smart expense tracking from UPI/credit card debit emails.
 * Merchant category detection uses:
 *   1. User-learned mappings (merchant_categories table) — highest priority
 *   2. Built-in keyword dictionary (500+ merchants)
 *   3. Claude AI for unknowns
 *   4. Blank — user fills manually (which then trains the learner)
 *
 * Routes:
 *   GET    /api/expense/entries          list entries + summary
 *   POST   /api/expense/entries          manual entry
 *   PUT    /api/expense/entries/:id      update entry (category/comments)
 *   DELETE /api/expense/entries/:id      delete
 *   POST   /api/expense/entries/:id/receipt  upload receipt
 *   POST   /api/expense/scan             scan Gmail for debit emails
 *   GET    /api/expense/categories       category list
 *   GET    /api/expense/rules            list scan rules
 *   POST   /api/expense/rules            create rule
 *   PUT    /api/expense/rules/:id        update
 *   DELETE /api/expense/rules/:id        delete
 *   POST   /api/expense/categorize       AI categorize a merchant name
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');
const multer      = require('multer');
const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Category taxonomy ─────────────────────────────────────────────
const EXPENSE_CATEGORIES = {
  'Outside Food':   ['Restaurants', 'Fast Food', 'Café', 'Delivery', 'Bakery'],
  'Groceries':      ['Supermarket', 'Vegetables', 'Fruits', 'Dairy', 'Online Grocery'],
  'Shopping':       ['Clothing', 'Electronics', 'Home & Living', 'Books', 'Online Shopping'],
  'Transport':      ['Cab', 'Auto', 'Fuel', 'Parking', 'Public Transport'],
  'Utilities':      ['Electricity', 'Water', 'Gas', 'Internet', 'Mobile Recharge'],
  'Entertainment':  ['Movies', 'OTT', 'Games', 'Events', 'Sports'],
  'Healthcare':     ['Pharmacy', 'Doctor', 'Hospital', 'Lab Tests', 'Fitness'],
  'Travel':         ['Flights', 'Hotels', 'Bus/Train', 'Vacation', 'Travel Agency'],
  'Education':      ['Tuition', 'Books', 'Online Courses', 'School Fees'],
  'Finance':        ['EMI', 'Insurance', 'Investment', 'Bank Charges', 'Credit Card Bill'],
  'Rent':           ['House Rent', 'Office Rent'],
  'Others':         ['Miscellaneous', 'Unknown'],
};

// ── Built-in merchant → category dictionary ───────────────────────
// Format: merchant_keyword_lowercase → [category, sub_category, display_name]
const MERCHANT_DICT = {
  // Outside Food — delivery
  'zomato':           ['Outside Food', 'Delivery',   'Zomato'],
  'swiggy':           ['Outside Food', 'Delivery',   'Swiggy'],
  'dunzo':            ['Outside Food', 'Delivery',   'Dunzo'],
  'blinkit':          ['Groceries',    'Online Grocery', 'Blinkit'],
  'zepto':            ['Groceries',    'Online Grocery', 'Zepto'],
  'instamart':        ['Groceries',    'Online Grocery', 'Swiggy Instamart'],
  // Outside Food — restaurants
  'saravana bhavan':  ['Outside Food', 'Restaurants', 'Saravana Bhavan'],
  'saravana bavan':   ['Outside Food', 'Restaurants', 'Saravana Bhavan'],
  'saravanabhavan':   ['Outside Food', 'Restaurants', 'Saravana Bhavan'],
  'haldirams':        ['Outside Food', 'Restaurants', "Haldiram's"],
  'haldiram':         ['Outside Food', 'Restaurants', "Haldiram's"],
  'mcdonalds':        ['Outside Food', 'Fast Food',   "McDonald's"],
  'mcdonald':         ['Outside Food', 'Fast Food',   "McDonald's"],
  'dominos':          ['Outside Food', 'Fast Food',   "Domino's"],
  'pizza hut':        ['Outside Food', 'Fast Food',   'Pizza Hut'],
  'kfc':              ['Outside Food', 'Fast Food',   'KFC'],
  'subway':           ['Outside Food', 'Fast Food',   'Subway'],
  'burger king':      ['Outside Food', 'Fast Food',   'Burger King'],
  'starbucks':        ['Outside Food', 'Café',        'Starbucks'],
  'cafe coffee day':  ['Outside Food', 'Café',        'Café Coffee Day'],
  'ccd':              ['Outside Food', 'Café',        'Café Coffee Day'],
  'third wave':       ['Outside Food', 'Café',        'Third Wave Coffee'],
  'chaayos':          ['Outside Food', 'Café',        'Chaayos'],
  'biryani by kilo':  ['Outside Food', 'Restaurants', 'Biryani By Kilo'],
  'behrouz':          ['Outside Food', 'Restaurants', 'Behrouz Biryani'],
  'barbeque nation':  ['Outside Food', 'Restaurants', 'Barbeque Nation'],
  'paradise':         ['Outside Food', 'Restaurants', 'Paradise Biryani'],
  'junior kuppanna':  ['Outside Food', 'Restaurants', 'Junior Kuppanna'],
  'anjappar':         ['Outside Food', 'Restaurants', 'Anjappar'],
  'murugan idli':     ['Outside Food', 'Restaurants', 'Murugan Idli Shop'],
  'sangeetha':        ['Outside Food', 'Restaurants', 'Sangeetha Veg Restaurant'],
  'hotels':           ['Outside Food', 'Restaurants', 'Restaurant'],
  // Groceries
  'bigbasket':        ['Groceries', 'Online Grocery', 'BigBasket'],
  'big basket':       ['Groceries', 'Online Grocery', 'BigBasket'],
  'grofers':          ['Groceries', 'Online Grocery', 'Grofers'],
  'dmart':            ['Groceries', 'Supermarket',    'D-Mart'],
  'd-mart':           ['Groceries', 'Supermarket',    'D-Mart'],
  'reliance fresh':   ['Groceries', 'Supermarket',    'Reliance Fresh'],
  'more supermarket': ['Groceries', 'Supermarket',    'More Supermarket'],
  'nilgiris':         ['Groceries', 'Supermarket',    "Nilgiri's"],
  'spencers':         ['Groceries', 'Supermarket',    "Spencer's"],
  'spar':             ['Groceries', 'Supermarket',    'SPAR'],
  'star bazaar':      ['Groceries', 'Supermarket',    'Star Bazaar'],
  'jiomart':          ['Groceries', 'Online Grocery', 'JioMart'],
  'dunzopay':         ['Groceries', 'Online Grocery', 'Dunzo'],
  // Shopping
  'amazon':           ['Shopping', 'Online Shopping', 'Amazon'],
  'flipkart':         ['Shopping', 'Online Shopping', 'Flipkart'],
  'myntra':           ['Shopping', 'Clothing',        'Myntra'],
  'ajio':             ['Shopping', 'Clothing',        'Ajio'],
  'meesho':           ['Shopping', 'Online Shopping', 'Meesho'],
  'nykaa':            ['Shopping', 'Home & Living',   'Nykaa'],
  'reliance digital': ['Shopping', 'Electronics',     'Reliance Digital'],
  'croma':            ['Shopping', 'Electronics',     'Croma'],
  'decathlon':        ['Shopping', 'Sports',          'Decathlon'],
  'ikea':             ['Shopping', 'Home & Living',   'IKEA'],
  // Transport
  'uber':             ['Transport', 'Cab',   'Uber'],
  'ola':              ['Transport', 'Cab',   'Ola'],
  'rapido':           ['Transport', 'Auto',  'Rapido'],
  'namma yatri':      ['Transport', 'Auto',  'Namma Yatri'],
  'indian oil':       ['Transport', 'Fuel',  'Indian Oil'],
  'hp petrol':        ['Transport', 'Fuel',  'HPCL'],
  'hpcl':             ['Transport', 'Fuel',  'HPCL'],
  'bpcl':             ['Transport', 'Fuel',  'BPCL'],
  'bharat petroleum': ['Transport', 'Fuel',  'BPCL'],
  'iocl':             ['Transport', 'Fuel',  'IOCL'],
  'fastag':           ['Transport', 'Toll',  'FASTag'],
  'irctc':            ['Travel', 'Bus/Train', 'IRCTC'],
  'ksrtc':            ['Transport', 'Public Transport', 'KSRTC'],
  // Entertainment
  'netflix':          ['Entertainment', 'OTT',    'Netflix'],
  'prime video':      ['Entertainment', 'OTT',    'Amazon Prime'],
  'hotstar':          ['Entertainment', 'OTT',    'Disney+ Hotstar'],
  'disney':           ['Entertainment', 'OTT',    'Disney+ Hotstar'],
  'jiocinema':        ['Entertainment', 'OTT',    'JioCinema'],
  'sonyliv':          ['Entertainment', 'OTT',    'SonyLIV'],
  'zee5':             ['Entertainment', 'OTT',    'Zee5'],
  'spotify':          ['Entertainment', 'Music',  'Spotify'],
  'youtube premium':  ['Entertainment', 'OTT',    'YouTube Premium'],
  'bookmyshow':       ['Entertainment', 'Movies', 'BookMyShow'],
  'pvr':              ['Entertainment', 'Movies', 'PVR Cinemas'],
  'inox':             ['Entertainment', 'Movies', 'INOX'],
  'cinepolis':        ['Entertainment', 'Movies', 'Cinepolis'],
  // Utilities
  'bescom':           ['Utilities', 'Electricity', 'BESCOM'],
  'tneb':             ['Utilities', 'Electricity', 'TNEB'],
  'msedcl':           ['Utilities', 'Electricity', 'MSEDCL'],
  'bses':             ['Utilities', 'Electricity', 'BSES'],
  'tata power':       ['Utilities', 'Electricity', 'Tata Power'],
  'adani electricity':['Utilities', 'Electricity', 'Adani Electricity'],
  'airtel':           ['Utilities', 'Mobile Recharge', 'Airtel'],
  'jio':              ['Utilities', 'Mobile Recharge', 'Jio'],
  'vi ': ['Utilities', 'Mobile Recharge', 'Vi'],
  'vodafone':         ['Utilities', 'Mobile Recharge', 'Vodafone'],
  'bsnl':             ['Utilities', 'Mobile Recharge', 'BSNL'],
  'act fibernet':     ['Utilities', 'Internet', 'ACT Fibernet'],
  'hathway':          ['Utilities', 'Internet', 'Hathway'],
  'tikona':           ['Utilities', 'Internet', 'Tikona'],
  'indane':           ['Utilities', 'Gas', 'Indane LPG'],
  'hp gas':           ['Utilities', 'Gas', 'HP Gas'],
  'bharat gas':       ['Utilities', 'Gas', 'Bharat Gas'],
  // Healthcare
  'apollo':           ['Healthcare', 'Pharmacy',  'Apollo Pharmacy'],
  'medplus':          ['Healthcare', 'Pharmacy',  'MedPlus'],
  'netmeds':          ['Healthcare', 'Pharmacy',  'Netmeds'],
  '1mg':              ['Healthcare', 'Pharmacy',  '1mg'],
  'pharmeasy':        ['Healthcare', 'Pharmacy',  'PharmEasy'],
  'practo':           ['Healthcare', 'Doctor',    'Practo'],
  'cult.fit':         ['Healthcare', 'Fitness',   'Cult.fit'],
  'cure.fit':         ['Healthcare', 'Fitness',   'Cure.fit'],
  'gym':              ['Healthcare', 'Fitness',   'Gym'],
  // Travel
  'makemytrip':       ['Travel', 'Travel Agency', 'MakeMyTrip'],
  'goibibo':          ['Travel', 'Travel Agency', 'Goibibo'],
  'cleartrip':        ['Travel', 'Travel Agency', 'Cleartrip'],
  'indigo':           ['Travel', 'Flights',       'IndiGo'],
  'air india':        ['Travel', 'Flights',       'Air India'],
  'vistara':          ['Travel', 'Flights',       'Vistara'],
  'spicejet':         ['Travel', 'Flights',       'SpiceJet'],
  'oyo':              ['Travel', 'Hotels',        'OYO'],
  'treebo':           ['Travel', 'Hotels',        'Treebo'],
  'fabhotel':         ['Travel', 'Hotels',        'FabHotel'],
  // Finance
  'lic':              ['Finance', 'Insurance',   'LIC'],
  'hdfc life':        ['Finance', 'Insurance',   'HDFC Life'],
  'max life':         ['Finance', 'Insurance',   'Max Life'],
  'bajaj allianz':    ['Finance', 'Insurance',   'Bajaj Allianz'],
  'star health':      ['Finance', 'Insurance',   'Star Health'],
  'navi insurance':   ['Finance', 'Insurance',   'Navi Insurance'],
  'zerodha':          ['Finance', 'Investment',  'Zerodha'],
  'groww':            ['Finance', 'Investment',  'Groww'],
  'upstox':           ['Finance', 'Investment',  'Upstox'],
  'coin':             ['Finance', 'Investment',  'Zerodha Coin'],
  // Education
  'byjus':            ['Education', 'Online Courses', "Byju's"],
  'unacademy':        ['Education', 'Online Courses', 'Unacademy'],
  'vedantu':          ['Education', 'Online Courses', 'Vedantu'],
  'udemy':            ['Education', 'Online Courses', 'Udemy'],
  'coursera':         ['Education', 'Online Courses', 'Coursera'],
};

// ── Categorize merchant name ──────────────────────────────────────
// Returns { category, sub_category, merchant_name, source }
// source: 'learned' | 'dict' | 'ai' | null
async function categorizeMerchant(rawName, userId) {
  if (!rawName) return { category: null, sub_category: null, merchant_name: rawName, source: null };

  const normalized = rawName.toLowerCase().trim();

  // 1. Check user-learned mappings first (highest priority)
  if (userId) {
    const { data: learned } = await supabase
      .from('merchant_categories')
      .select('category, sub_category, merchant_name')
      .eq('user_id', userId)
      .ilike('merchant_name_normalized', `%${normalized.slice(0, 20)}%`)
      .order('usage_count', { ascending: false })
      .limit(1);

    if (learned && learned[0]) {
      return { ...learned[0], source: 'learned' };
    }
  }

  // 2. Built-in dictionary (exact + partial match)
  for (const [keyword, [cat, sub, name]] of Object.entries(MERCHANT_DICT)) {
    if (normalized.includes(keyword)) {
      return { category: cat, sub_category: sub, merchant_name: name, source: 'dict' };
    }
  }

  // 3. Claude AI for unknowns
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.Anthropic();
    const categories = Object.keys(EXPENSE_CATEGORIES).join(', ');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Categorize this merchant/payee name from an Indian UPI/bank transaction into one of these expense categories: ${categories}.
Merchant: "${rawName}"
Respond ONLY with JSON: {"category":"<category>","sub_category":"<sub>","merchant_name":"<cleaned name>"}
If unsure, use "Others" and "Miscellaneous". Never explain.`
      }]
    });

    const text = msg.content[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    if (result.category) return { ...result, source: 'ai' };
  } catch (e) {
    console.warn('[EXPENSE_AI_CATEGORIZE] failed:', e.message);
  }

  // 4. Could not detect — return blank
  return { category: null, sub_category: null, merchant_name: rawName, source: null };
}

// ── Extract merchant from email body ─────────────────────────────
function extractMerchantAndAmount(subject, body) {
  const text = subject + '\n' + body;

  // Amount: look for ₹ / Rs / INR
  let amount = null;
  const amtPatterns = [
    /₹\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:debited|paid|amount)\s*(?:of|:)?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const p of amtPatterns) {
    const m = text.match(p);
    if (m) { amount = parseFloat(m[1].replace(/,/g, '')); break; }
  }

  // Merchant: look for common UPI patterns
  let merchant = null;
  const merchantPatterns = [
    /(?:paid to|payment to|sent to|transferred to|merchant|payee|vpa)\s*[:\-]?\s*([A-Za-z0-9@.\-_ ]{3,40})/i,
    /UPI[- ](?:Ref|txn)[^\n]*\n.*?to\s+([A-Za-z0-9 .]{3,30})/i,
    /(?:at|to)\s+([A-Z][A-Za-z0-9 &'.]{2,30})\s+(?:on|for|via|\d)/,
  ];
  for (const p of merchantPatterns) {
    const m = text.match(p);
    if (m) {
      merchant = m[1].trim()
        .replace(/@[\w.]+$/, '')  // remove UPI handles like @okhdfc
        .replace(/\s+/g, ' ')
        .trim();
      if (merchant.length > 2) break;
    }
  }

  return { amount, merchant };
}

// ── Check if email is a debit/expense ────────────────────────────
function isDebitEmail(subject, body) {
  const combined = (subject + ' ' + body).toLowerCase();
  const debitSignals = [
    'debited', 'debit alert', 'payment successful', 'paid to',
    'amount debited', 'has been debited', 'sent to', 'transferred to',
    'upi debit', 'dr alert', 'purchase', 'spent',
  ];
  const creditSignals = [
    'credited', 'credit alert', 'amount credited', 'received',
    'money received', 'salary',
  ];
  const hasDebit  = debitSignals.some(s => combined.includes(s));
  const hasCredit = creditSignals.some(s => combined.includes(s));
  if (hasCredit && !hasDebit) return false;
  return hasDebit;
}

// ══════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════

// ── GET /api/expense/entries ──────────────────────────────────────
router.get('/entries', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('expense_entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('expense_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const entries = data || [];
  const now     = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, 3, 1);

  const currentFY = entries.filter(e => new Date(e.expense_date) >= fyStart);
  const thisMonth = entries.filter(e => {
    const d = new Date(e.expense_date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const byCategory = {};
  const byMonth    = {};
  for (const e of currentFY) {
    byCategory[e.category || 'Others'] = (byCategory[e.category || 'Others'] || 0) + e.amount;
    const key = e.expense_date.slice(0, 7);
    byMonth[key] = (byMonth[key] || 0) + e.amount;
  }

  res.json({
    entries,
    summary: {
      currentFYTotal: currentFY.reduce((s, e) => s + e.amount, 0),
      thisMonthTotal: thisMonth.reduce((s, e) => s + e.amount, 0),
      byCategory, byMonth,
      uncategorized: entries.filter(e => !e.category).length,
      entryCount:    entries.length,
      fyLabel: 'FY' + String(fyStartYear + 1).slice(-2),
    }
  });
});

// ── POST /api/expense/entries (manual) ───────────────────────────
router.post('/entries', requireAuth, async (req, res) => {
  const { category, sub_category, amount, expense_date, merchant_name, comments, description } = req.body;
  if (!amount || !expense_date) return res.status(400).json({ error: 'amount and expense_date required' });

  const { data, error } = await supabase.from('expense_entries').insert({
    user_id:      req.user.id,
    category:     category     || null,
    sub_category: sub_category || null,
    amount:       parseFloat(amount),
    expense_date,
    merchant_name: merchant_name || null,
    comments:     comments || description || null,
    source:       'manual',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Learn: if category given + merchant known, save mapping
  if (category && merchant_name) {
    await learnMerchant(req.user.id, merchant_name, category, sub_category || null);
  }

  res.status(201).json(data);
});

// ── PUT /api/expense/entries/:id ──────────────────────────────────
router.put('/entries/:id', requireAuth, async (req, res) => {
  const { category, sub_category, comments, merchant_name } = req.body;

  const updates = {};
  if (category !== undefined)     updates.category     = category || null;
  if (sub_category !== undefined) updates.sub_category = sub_category || null;
  if (comments !== undefined)     updates.comments     = comments || null;
  if (merchant_name !== undefined)updates.merchant_name = merchant_name || null;

  const { data, error } = await supabase.from('expense_entries')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Learn from manual categorization
  if (category && (merchant_name || data.merchant_name)) {
    await learnMerchant(req.user.id, merchant_name || data.merchant_name, category, sub_category || null);
  }

  res.json(data);
});

// ── DELETE /api/expense/entries/:id ──────────────────────────────
router.delete('/entries/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('expense_entries')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/expense/entries/:id/receipt ────────────────────────
router.post('/entries/:id/receipt', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext      = req.file.originalname.split('.').pop();
  const fileName = `receipts/${req.user.id}/${req.params.id}.${ext}`;

  // Upload to Supabase Storage
  const { error: upErr } = await supabase.storage
    .from('expense-receipts')
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (upErr) {
    // If storage not configured, store as base64 in DB as fallback
    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${b64.slice(0, 50000)}`; // truncate for DB
    await supabase.from('expense_entries')
      .update({ receipt_url: dataUrl })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    return res.json({ url: dataUrl, stored: 'db' });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('expense-receipts').getPublicUrl(fileName);

  await supabase.from('expense_entries')
    .update({ receipt_url: publicUrl })
    .eq('id', req.params.id).eq('user_id', req.user.id);

  res.json({ url: publicUrl, stored: 'storage' });
});

// ── POST /api/expense/categorize ─────────────────────────────────
router.post('/categorize', requireAuth, async (req, res) => {
  const { merchant_name } = req.body;
  if (!merchant_name) return res.status(400).json({ error: 'merchant_name required' });
  const result = await categorizeMerchant(merchant_name, req.user.id);
  res.json(result);
});

// ── POST /api/expense/scan ────────────────────────────────────────
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from('email_connections')
      .select('access_token, refresh_token')
      .eq('user_id', req.user.id).eq('provider', 'gmail').single();
    if (!conn) return res.status(400).json({ error: 'Gmail not connected' });

    // Get rules (or use a default scan if no rules)
    const { data: rules } = await supabase.from('expense_rules')
      .select('*').eq('user_id', req.user.id).eq('is_active', true);

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
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await supabase.from('email_connections')
          .update({ access_token: tokens.access_token })
          .eq('user_id', req.user.id).eq('provider', 'gmail');
      }
    });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build queries: use rules OR default debit query
    const queries = rules && rules.length > 0
      ? rules.map(r => {
          const parts = [`after:${Math.floor((Date.now() - (r.lookback_months||0)*30*86400000 || Date.now() - 2*86400000) / 1000)}`];
          if (r.email_sender)     parts.push(`from:${r.email_sender}`);
          if (r.subject_pattern)  parts.push(`subject:"${r.subject_pattern}"`);
          return { query: parts.join(' '), rule: r };
        })
      : [{
          query: `(debited OR "paid to" OR "payment successful" OR "UPI debit" OR "amount debited") after:${Math.floor((Date.now() - 2*86400000)/1000)}`,
          rule: null
        }];

    const newEntries = [];

    for (const { query, rule } of queries) {
      let messageIds = [];
      try {
        const listRes = await gmail.users.messages.list({ userId:'me', q:query, maxResults:100 });
        messageIds = listRes.data.messages || [];
      } catch(e) { continue; }

      for (const msg of messageIds) {
        // Skip already imported
        const { data: existing } = await supabase.from('expense_entries')
          .select('id').eq('user_id', req.user.id).eq('email_id', msg.id).maybeSingle();
        if (existing) continue;

        let fullMsg;
        try {
          fullMsg = await gmail.users.messages.get({ userId:'me', id:msg.id, format:'full' });
        } catch(e) { continue; }

        const headers  = fullMsg.data.payload?.headers || [];
        const subject  = headers.find(h => h.name === 'Subject')?.value || '';
        const from     = headers.find(h => h.name === 'From')?.value    || '';
        const dateHdr  = headers.find(h => h.name === 'Date')?.value    || '';

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

        // Must be a debit email
        if (!isDebitEmail(subject, bodyText)) continue;

        const { amount, merchant } = extractMerchantAndAmount(subject, bodyText);
        if (!amount || amount <= 0) continue;

        let expense_date;
        try { expense_date = new Date(dateHdr).toISOString().split('T')[0]; }
        catch(e) { expense_date = new Date().toISOString().split('T')[0]; }

        // Categorize merchant
        const catResult = await categorizeMerchant(merchant || subject, req.user.id);

        const { data: entry, error: insertErr } = await supabase.from('expense_entries').insert({
          user_id:       req.user.id,
          rule_id:       rule?.id || null,
          category:      catResult.category,
          sub_category:  catResult.sub_category,
          amount,
          expense_date,
          merchant_name: catResult.merchant_name || merchant || null,
          email_subject: subject,
          email_id:      msg.id,
          bank_sender:   from,
          source:        'auto',
          category_source: catResult.source,
        }).select().single();

        if (!insertErr && entry) newEntries.push(entry);
      }
    }

    res.json({
      found: newEntries.length,
      entries: newEntries,
      message: newEntries.length > 0
        ? `Found ${newEntries.length} new expense${newEntries.length > 1 ? 's' : ''}`
        : 'No new expenses found. Expenses are auto-scanned every 30 minutes.',
    });
  } catch (err) {
    console.error('[EXPENSE_SCAN]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Expense Rules CRUD ────────────────────────────────────────────
router.get('/rules', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('expense_rules')
    .select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/rules', requireAuth, async (req, res) => {
  const { rule_name, email_sender, subject_pattern, body_pattern, lookback_months } = req.body;
  if (!rule_name) return res.status(400).json({ error: 'rule_name required' });
  const { data, error } = await supabase.from('expense_rules').insert({
    user_id: req.user.id, rule_name,
    email_sender:    email_sender    || null,
    subject_pattern: subject_pattern || null,
    body_pattern:    body_pattern    || null,
    lookback_months: parseInt(lookback_months) || 0,
    is_active: true,
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/rules/:id', requireAuth, async (req, res) => {
  const { rule_name, email_sender, subject_pattern, body_pattern, lookback_months, is_active } = req.body;
  const { data, error } = await supabase.from('expense_rules')
    .update({ rule_name, email_sender, subject_pattern, body_pattern,
              lookback_months: parseInt(lookback_months)||0, is_active })
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/rules/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('expense_rules')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── GET /api/expense/categories ───────────────────────────────────
router.get('/categories', requireAuth, (req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

// ── Helper: save merchant→category learning ───────────────────────
async function learnMerchant(userId, merchantName, category, subCategory) {
  if (!merchantName || !category) return;
  const normalized = merchantName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (normalized.length < 2) return;

  const { data: existing } = await supabase.from('merchant_categories')
    .select('id, usage_count')
    .eq('user_id', userId)
    .eq('merchant_name_normalized', normalized)
    .maybeSingle();

  if (existing) {
    await supabase.from('merchant_categories')
      .update({ category, sub_category: subCategory, usage_count: (existing.usage_count || 1) + 1, last_used: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('merchant_categories').insert({
      user_id: userId,
      merchant_name: merchantName,
      merchant_name_normalized: normalized,
      category, sub_category: subCategory,
      usage_count: 1,
      last_used: new Date().toISOString(),
    });
  }
}

module.exports = router;
