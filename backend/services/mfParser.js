/**
 * MF Statement Parser — MFCentral CAS (combined CAMS + KFintech)
 *
 * MFCentral SEBI-CAS PDF structure (per fund section):
 *
 *   [AMC section header]
 *   HDFC Asset Management Company Limited
 *   Registrar: CAMS
 *
 *   Scheme   : HDFC Mid-Cap Opportunities Fund - Regular Growth
 *   ISIN     : INF179K01754
 *   Folio No.: 1234567890 / PAN: ABCDE1234F
 *   ...transaction rows...
 *   Closing Balance : 245.678  |  NAV (28-Feb-2026) : 189.230  |  Value : 46,421.01
 *   Cost Value      : 38,000.00
 *
 * Key anchors: "Closing Balance" with units, NAV, Value on same logical line
 * Also handles CDSL-style demat MF rows with "-- -- --" pattern
 */

// ── ISIN → clean name lookup ─────────────────────────────────────────
const ISIN_NAMES = {
  'INF879O01027': 'Parag Parikh Flexi Cap Fund - Direct Growth',
  'INF754K01NR9': 'Edelweiss Nifty Large Midcap 250 Index Fund',
  'INF846K01164': 'Axis Large Cap Fund - Regular Growth',
  'INF179KC1981': 'HDFC Gold ETF',
  'INF109KC18U7': 'ICICI Prudential Nifty Private Bank ETF',
  'INF204KB14I2': 'Nippon India ETF Nifty 50 BeES',
  'INF204KB15V2': 'Nippon India ETF Nifty IT',
  'INF204KB17I3': 'Nippon India ETF Bank BeES',
  'INF204KB15I6': 'Nippon India ETF Gold BeES',
  'INF204KB11I6': 'Nippon India ETF Junior BeES',
};

function guessFundHouse(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('parag parikh'))               return 'PPFAS AMC';
  if (n.includes('hdfc'))                       return 'HDFC AMC';
  if (n.includes('icici'))                      return 'ICICI Prudential AMC';
  if (n.includes('sbi'))                        return 'SBI Funds Management';
  if (n.includes('axis'))                       return 'Axis AMC';
  if (n.includes('kotak'))                      return 'Kotak Mahindra AMC';
  if (n.includes('nippon'))                     return 'Nippon India AMC';
  if (n.includes('mirae'))                      return 'Mirae Asset AMC';
  if (n.includes('dsp'))                        return 'DSP Investment Managers';
  if (n.includes('franklin'))                   return 'Franklin Templeton AMC';
  if (n.includes('tata'))                       return 'Tata AMC';
  if (n.includes('uti'))                        return 'UTI AMC';
  if (n.includes('aditya birla') || n.includes('absl')) return 'Aditya Birla Sun Life AMC';
  if (n.includes('sundaram'))                   return 'Sundaram AMC';
  if (n.includes('edelweiss'))                  return 'Edelweiss AMC';
  if (n.includes('quant'))                      return 'Quant AMC';
  if (n.includes('motilal'))                    return 'Motilal Oswal AMC';
  if (n.includes('canara'))                     return 'Canara Robeco AMC';
  return 'Other AMC';
}

function guessFundCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('etf') || n.includes('bees'))                            return 'ETF';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex')) return 'Index';
  if (n.includes('elss') || n.includes('tax saver'))                      return 'ELSS';
  if (n.includes('liquid') || n.includes('overnight'))                    return 'Debt-Liquid';
  if (n.includes('debt') || n.includes('bond') || n.includes('gilt'))     return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced'))                     return 'Hybrid';
  if (n.includes('flexi') || n.includes('multi cap'))                     return 'Equity-Flexi';
  if (n.includes('large cap') || n.includes('largecap') || n.includes('bluechip')) return 'Equity-LargeCap';
  if (n.includes('mid cap') || n.includes('midcap'))                      return 'Equity-MidCap';
  if (n.includes('small cap') || n.includes('smallcap'))                  return 'Equity-SmallCap';
  return 'Equity';
}

/**
 * parseMFStatement
 * Handles MFCentral CAS format (CAMS + KFintech combined)
 * Also handles CDSL demat MF rows (INF ISIN + -- -- -- pattern)
 */
function parseMFStatement(text, source = 'MFCENTRAL') {
  const holdings = [];
  const seen     = new Set();

  function add(h) {
    const key = h.folio_number || h.isin || h.fund_name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    holdings.push(h);
  }

  // ── Pattern 1: MFCentral / CAMS "Closing Balance" anchor ─────────
  // Handles both single-line and multi-line formats
  // "Closing Balance : 245.678   NAV (28-Feb-2026) : 189.230   Value : 46,421.01"
  const closingRe = /Closing\s+Balance\s*[:\|]\s*([\d,]+\.[\d]+)\s*(?:Units?)?[\s\S]{0,300}?NAV[^:\d]*([\d,]+\.[\d]+)[\s\S]{0,200}?Value\s*[:\|]\s*([\d,]+\.[\d]+)/gi;
  let m;
  while ((m = closingRe.exec(text)) !== null) {
    const units = parseFloat(m[1].replace(/,/g, ''));
    const nav   = parseFloat(m[2].replace(/,/g, ''));
    const value = parseFloat(m[3].replace(/,/g, ''));
    if (units <= 0) continue;

    // Look back 1200 chars for scheme name, ISIN, folio
    const before = text.slice(Math.max(0, m.index - 1200), m.index);

    // Scheme name — "Scheme : HDFC Mid-Cap..." or last capitalised fund-like line
    const schemeM = before.match(/Scheme\s*[:\-]\s*([A-Z][^\n\r]{8,120})/i)
      || before.match(/\n\s*([A-Z][A-Za-z0-9 \-&().,']+(?:Fund|Scheme|Plan|Option|Growth|IDCW|ETF|BeES)[^\n\r]{0,80})\s*\n/);
    const fundName = schemeM ? schemeM[1].trim().replace(/\s+/g, ' ') : '';

    // ISIN
    const isinM = before.match(/ISIN\s*[:\-]\s*(IN[A-Z0-9]{10})/i)
      || before.match(/\b(INF[A-Z0-9]{9})\b/);
    const isin = isinM ? isinM[1] : null;

    // Folio
    const folioM = before.match(/Folio\s*(?:No\.?|Number)?\s*[:\-]\s*([0-9\/A-Z\-]+)/i);
    const folio  = folioM ? folioM[1].trim().split('/')[0].trim() : null;

    // Cost value
    const costM = text.slice(m.index, m.index + 400)
      .match(/Cost\s+Value\s*[:\|]\s*([\d,]+\.[\d]+)/i)
      || before.match(/Cost\s+Value\s*[:\|]\s*([\d,]+\.[\d]+)/i);
    const investedValue = costM ? parseFloat(costM[1].replace(/,/g,'')) : null;

    const resolvedName = fundName || (isin && ISIN_NAMES[isin]) || isin || 'Unknown Fund';

    add({
      fund_name:      resolvedName,
      fund_house:     guessFundHouse(resolvedName),
      fund_category:  guessFundCategory(resolvedName),
      isin,
      folio_number:   folio,
      units,
      nav,
      current_value:  value || parseFloat((units * nav).toFixed(2)),
      invested_value: investedValue,
      source,
    });
  }

  // ── Pattern 2: CDSL demat MF (INF ISIN + -- -- -- anchor) ────────
  // "INF879O01027 Parag Parikh... 245.678 -- -- -- 245.678 89.23 21916.12"
  const cdslRe = /(INF[A-Z0-9]{9})[\s\S]{0,200}?([\d,]+\.[\d]+)\s+--\s+--\s+--\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)/g;
  while ((m = cdslRe.exec(text)) !== null) {
    const isin  = m[1];
    const units = parseFloat(m[2].replace(/,/g,''));
    const nav   = parseFloat(m[4].replace(/,/g,''));
    const value = parseFloat(m[5].replace(/,/g,''));
    if (units <= 0) continue;

    // Company name between ISIN and first number
    const isinEnd  = m.index + isin.length;
    const balStart = text.indexOf(m[2], isinEnd);
    const rawName  = text.slice(isinEnd, balStart).trim().replace(/[\d,.]/g,'').replace(/\s+/g,' ').trim();
    const resolvedName = ISIN_NAMES[isin] || rawName || isin;

    add({
      fund_name:      resolvedName,
      fund_house:     guessFundHouse(resolvedName),
      fund_category:  guessFundCategory(resolvedName),
      isin,
      folio_number:   null,
      units,
      nav,
      current_value:  value,
      invested_value: null,
      source:         'CDSL',
    });
  }

  // ── Pattern 3: KFintech format — "Balance : 245.678 units" ───────
  if (holdings.length === 0) {
    const kfinRe = /([A-Z][A-Za-z0-9 \-&().,']+(?:Fund|ETF|Scheme|Growth|IDCW)[^\n\r]{0,60})\n[\s\S]{0,600}?Balance\s*[:\|]\s*([\d,]+\.[\d]+)\s*[Uu]nits?/g;
    while ((m = kfinRe.exec(text)) !== null) {
      const fundName = m[1].trim();
      const units    = parseFloat(m[2].replace(/,/g,''));
      if (units <= 0) continue;
      add({
        fund_name:      fundName,
        fund_house:     guessFundHouse(fundName),
        fund_category:  guessFundCategory(fundName),
        isin:           null,
        folio_number:   null,
        units,
        nav:            null,
        current_value:  null,
        invested_value: null,
        source,
      });
    }
  }

  console.log(JSON.stringify({
    event:  'MF_PARSE_RESULT',
    source,
    found:  holdings.length,
    sample: holdings.slice(0,3).map(h => `${h.fund_name}: ${h.units}u @ ₹${h.nav}`),
  }));

  return holdings;
}

module.exports = { parseMFStatement, guessFundHouse, guessFundCategory };
