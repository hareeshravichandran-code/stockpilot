/**
 * MF Statement Parser — CAMS & KFintech
 *
 * Both RTAs send a PDF with this structure per folio:
 *   Fund Name
 *   Folio No: XXXXXXXX  PAN: ABCDE1234F
 *   ...transactions...
 *   Closing Balance: <units> units  NAV: <nav>  Value: <value>
 */

// ── ISIN lookup for common funds ────────────────────────────────────
const FUND_ISIN = {
  'parag parikh flexi':          'INF879O01027',
  'axis bluechip':               'INF846K01DP8',
  'axis large cap':              'INF846K01164',
  'hdfc mid-cap':                'INF179K01754',
  'hdfc top 100':                'INF179K01339',
  'sbi bluechip':                'INF200K01RB2',
  'mirae asset large cap':       'INF769K01010',
  'nippon india small cap':      'INF204K01U11',
  'kotak small cap':             'INF174K01LS2',
  'quant small cap':             'INF966L01010',
  'edelweiss large midcap':      'INF754K01NR9',
};

function lookupISIN(fundName) {
  const n = (fundName || '').toLowerCase();
  for (const [key, isin] of Object.entries(FUND_ISIN)) {
    if (n.includes(key)) return isin;
  }
  return null;
}

// ── Fund category heuristic ─────────────────────────────────────────
function category(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('liquid') || n.includes('overnight')) return 'Debt-Liquid';
  if (n.includes('debt') || n.includes('bond') || n.includes('gilt')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced'))  return 'Hybrid';
  if (n.includes('elss') || n.includes('tax'))         return 'ELSS';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex')) return 'Index';
  if (n.includes('etf'))                               return 'ETF';
  if (n.includes('small cap') || n.includes('smallcap')) return 'Equity-SmallCap';
  if (n.includes('mid cap') || n.includes('midcap'))   return 'Equity-MidCap';
  if (n.includes('large cap') || n.includes('largecap') || n.includes('bluechip')) return 'Equity-LargeCap';
  if (n.includes('flexi') || n.includes('multi cap'))  return 'Equity-Flexi';
  return 'Equity';
}

function guessFundHouse(name) {
  const n = (name || '').toLowerCase();
  const map = {
    'hdfc': 'HDFC AMC', 'icici': 'ICICI Prudential AMC', 'sbi': 'SBI Funds Management',
    'axis': 'Axis AMC', 'kotak': 'Kotak Mahindra AMC', 'nippon': 'Nippon India AMC',
    'mirae': 'Mirae Asset AMC', 'parag parikh': 'PPFAS AMC', 'dsp': 'DSP Investment Managers',
    'franklin': 'Franklin Templeton AMC', 'tata': 'Tata AMC', 'uti': 'UTI AMC',
    'aditya birla': 'ADITYA Birla Sun Life AMC', 'absl': 'Aditya Birla Sun Life AMC',
    'sundaram': 'Sundaram AMC', 'edelweiss': 'Edelweiss AMC', 'quant': 'Quant AMC',
    'motilal': 'Motilal Oswal AMC', 'canara': 'Canara Robeco AMC',
  };
  for (const [k, v] of Object.entries(map)) { if (n.includes(k)) return v; }
  return 'Other AMC';
}

/**
 * parseMFStatement — parses CAMS/KFintech PDF text into MF holding records
 *
 * CAMS text structure (per fund section):
 *   Scheme: HDFC Mid-Cap Opportunities Fund - Growth
 *   Folio No: 12345678 / PAN: ABCDE1234F
 *   ...
 *   Closing Balance: 245.678 Units  |  NAV on 28-Feb-2026: ₹189.23  |  Value: ₹46,421.01
 *
 * KFintech is similar with slight keyword differences.
 */
function parseMFStatement(text, rta = 'CAMS') {
  const holdings = [];
  const seen = new Set();

  // ── Strategy: find "Closing Balance" anchors ──────────────────
  // Both CAMS and KFintech always have a "Closing Balance" line
  // Format: Closing Balance: <units> Units  NAV... <nav>  Value: <value>
  const closingRe = /Closing Balance[:\s]+([0-9,]+\.[0-9]+)\s+[Uu]nits?[\s\S]{0,200}?(?:NAV[^:]*:[^0-9₹]*)([0-9,]+\.[0-9]+)[\s\S]{0,100}?(?:Value[^:]*:[^0-9₹]*)([0-9,]+\.[0-9]+)/g;

  let m;
  while ((m = closingRe.exec(text)) !== null) {
    const units = parseFloat(m[1].replace(/,/g, ''));
    const nav   = parseFloat(m[2].replace(/,/g, ''));
    const value = parseFloat(m[3].replace(/,/g, ''));

    if (units <= 0) continue;

    // Look back up to 800 chars before this match for fund name + folio
    const before = text.slice(Math.max(0, m.index - 800), m.index);

    // Fund name: "Scheme:" or just a capitalised line
    const schemeMatch = before.match(/(?:Scheme|Fund)[:\s]+([A-Z][^\n\r]{10,100})/i)
      || before.match(/\n([A-Z][A-Za-z0-9\s\-&().]+(?:Fund|Scheme|Growth|IDCW|Option)[^\n\r]{0,60})\n/);
    const fundName = schemeMatch ? schemeMatch[1].trim().replace(/\s+/g,' ') : 'Unknown Fund';

    // Folio number
    const folioMatch = before.match(/Folio(?:\s*No)?[.:\s]+([0-9A-Z\/\-]+)/i);
    const folioNumber = folioMatch ? folioMatch[1].trim() : null;

    const key = folioNumber || fundName;
    if (seen.has(key)) continue;
    seen.add(key);

    // Invested value (cost) — look for "Cost Value" or "Invested"
    const costMatch = before.match(/(?:Cost Value|Invested|Purchase Cost)[:\s₹]+([\d,]+\.[\d]+)/i)
      || text.slice(m.index, m.index + 300).match(/(?:Cost Value|Invested)[:\s₹]+([\d,]+\.[\d]+)/i);
    const investedValue = costMatch ? parseFloat(costMatch[1].replace(/,/g,'')) : null;

    holdings.push({
      fund_name:      fundName,
      fund_house:     guessFundHouse(fundName),
      fund_category:  category(fundName),
      isin:           lookupISIN(fundName),
      folio_number:   folioNumber,
      units,
      nav,
      current_value:  value || units * nav,
      invested_value: investedValue,
      source:         rta,
    });
  }

  // ── Fallback: simpler pattern for KFintech ────────────────────
  if (holdings.length === 0) {
    const kfinRe = /([A-Z][A-Za-z0-9\s\-&.()]+Fund[^\n\r]{0,50})\s*\n[\s\S]{0,400}?Balance[:\s]+([0-9,]+\.[0-9]+)/g;
    while ((m = kfinRe.exec(text)) !== null) {
      const fundName = m[1].trim();
      const units    = parseFloat(m[2].replace(/,/g,''));
      if (units <= 0 || seen.has(fundName)) continue;
      seen.add(fundName);
      holdings.push({
        fund_name:     fundName,
        fund_house:    guessFundHouse(fundName),
        fund_category: category(fundName),
        isin:          lookupISIN(fundName),
        units,
        nav:           null,
        current_value: null,
        source:        rta,
      });
    }
  }

  console.log(JSON.stringify({ event: 'MF_PARSE_RESULT', rta, found: holdings.length,
    sample: holdings.slice(0,3).map(h => `${h.fund_name}: ${h.units} units @ ₹${h.nav}`) }));

  return holdings;
}

module.exports = { parseMFStatement, guessFundHouse, category };
