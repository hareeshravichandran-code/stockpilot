/**
 * StockPilot CAS Parser  —  CDSL & NSDL
 *
 * CDSL format (confirmed from real PDF via pdfplumber analysis):
 *   Each holding row:
 *     ISIN  [optional company name / text, 0–200 chars]
 *     <current_balance>  --  --  --  <free_balance>  <market_price>  <value_inr>
 *
 *   The triple "-- -- --" is the definitive anchor for every CDSL holding row.
 *   ISINs are exactly 12 chars: IN + 10 alphanumeric (equity=INE, MF/ETF=INF).
 *   Quantities have 3 decimal places for MF units, 3 zeros for equities.
 *
 * NSDL format:
 *   ISIN  SYMBOL.NSE/BSE  Company  FaceValue  Qty  Price  Value
 *   No "--" anchor — uses exchange suffix as anchor.
 */

// ── ISIN master table (123 stocks + ETFs from nseStocks.js) ──────────
// Used as fallback when company name extraction fails from PDF text
const ISIN_TO_SYMBOL = {
  // Banks
  'INE040A01034': { symbol: 'HDFCBANK',    company: 'HDFC Bank Limited' },
  'INE090A01021': { symbol: 'ICICIBANK',   company: 'ICICI Bank Limited' },
  'INE238A01034': { symbol: 'AXISBANK',    company: 'Axis Bank Limited' },
  'INE062A01020': { symbol: 'SBIN',        company: 'State Bank of India' },
  'INE237A01028': { symbol: 'KOTAKBANK',   company: 'Kotak Mahindra Bank Limited' },
  'INE095A01012': { symbol: 'INDUSINDBK',  company: 'IndusInd Bank Limited' },
  'INE171A01029': { symbol: 'FEDERALBNK',  company: 'The Federal Bank Limited' },
  'INE545U01014': { symbol: 'BANDHANBNK',  company: 'Bandhan Bank Limited' },
  'INE0KN901016': { symbol: 'IDFCFIRSTB',  company: 'IDFC First Bank Limited' },
  'INE211T01019': { symbol: 'TMB',         company: 'Tamilnad Mercantile Bank Limited' },
  'INE491A01021': { symbol: 'EQUITASBNK',  company: 'Equitas Small Finance Bank' },
  'INE949L01017': { symbol: 'AUBANK',      company: 'AU Small Finance Bank Limited' },
  'INE160A01022': { symbol: 'PNB',         company: 'Punjab National Bank' },
  'INE028A01039': { symbol: 'BANKBARODA',  company: 'Bank of Baroda' },
  'INE476A01014': { symbol: 'CANBK',       company: 'Canara Bank' },
  'INE683A01023': { symbol: 'SOUTHBANK',   company: 'The South Indian Bank Limited' },
  // IT
  'INE467B01029': { symbol: 'TCS',         company: 'Tata Consultancy Services Limited' },
  'INE009A01021': { symbol: 'INFY',        company: 'Infosys Limited' },
  'INE075A01022': { symbol: 'WIPRO',       company: 'Wipro Limited' },
  'INE860A01027': { symbol: 'HCLTECH',     company: 'HCL Technologies Limited' },
  'INE669C01036': { symbol: 'TECHM',       company: 'Tech Mahindra Limited' },
  'INE101A01026': { symbol: 'COFORGE',     company: 'Coforge Limited' },
  'INE214T01019': { symbol: 'LTIM',        company: 'LTIMindtree Limited' },
  'INE262H01021': { symbol: 'PERSISTENT',  company: 'Persistent Systems Limited' },
  // Finance / NBFC
  'INE296A01024': { symbol: 'BAJFINANCE',  company: 'Bajaj Finance Limited' },
  'INE918I01026': { symbol: 'BAJAJFINSV',  company: 'Bajaj Finserv Limited' },
  'INE127D01025': { symbol: 'HDFCAMC',     company: 'HDFC Asset Management Company' },
  'INE121A01024': { symbol: 'CHOLAFIN',    company: 'Cholamandalam Investment & Finance' },
  'INE414G01012': { symbol: 'MUTHOOTFIN',  company: 'Muthoot Finance Limited' },
  'INE115A01026': { symbol: 'LICHSGFIN',   company: 'LIC Housing Finance Limited' },
  // FMCG
  'INE030A01027': { symbol: 'HINDUNILVR',  company: 'Hindustan Unilever Limited' },
  'INE154A01025': { symbol: 'ITC',         company: 'ITC Limited' },
  'INE379A01028': { symbol: 'ITCHOTELS',   company: 'ITC Hotels Limited' },
  'INE239A01024': { symbol: 'NESTLEIND',   company: 'Nestle India Limited' },
  'INE216A01030': { symbol: 'BRITANNIA',   company: 'Britannia Industries Limited' },
  'INE259A01022': { symbol: 'COLPAL',      company: 'Colgate Palmolive (India) Limited' },
  'INE548C01032': { symbol: 'EMAMILTD',    company: 'Emami Limited' },
  'INE200M01021': { symbol: 'MANYAVAR',    company: 'Vedant Fashions Limited (Manyavar)' },
  // Auto
  'INE917I01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE066A01021': { symbol: 'EICHERMOT',   company: 'Eicher Motors Limited' },
  'INE158A01026': { symbol: 'HEROMOTOCO',  company: 'Hero MotoCorp Limited' },
  'INE155A01022': { symbol: 'TATAMOTORS',  company: 'Tata Motors Limited' },
  'INE438A01022': { symbol: 'APOLLOTYRE',  company: 'Apollo Tyres Limited' },
  'INE585B01010': { symbol: 'MARUTI',      company: 'Maruti Suzuki India Limited' },
  // Pharma
  'INE348A01023': { symbol: 'DRREDDY',     company: 'Dr. Reddy\'s Laboratories Limited' },
  'INE059A01026': { symbol: 'CIPLA',       company: 'Cipla Limited' },
  'INE987B01026': { symbol: 'NATCOPHARM',  company: 'Natco Pharma Limited' },
  'INE232I01014': { symbol: 'SPARC',       company: 'Sun Pharma Advanced Research Co.' },
  // Energy / Infra
  'INE002A01018': { symbol: 'RELIANCE',    company: 'Reliance Industries Limited' },
  'INE066A01021': { symbol: 'BPCL',        company: 'Bharat Petroleum Corp Limited' },
  'INE079A01024': { symbol: 'POWERGRID',   company: 'Power Grid Corporation of India' },
  'INE053F01010': { symbol: 'IRFC',        company: 'Indian Railway Finance Corporation Ltd' },
  'INE040H01021': { symbol: 'SUZLON',      company: 'Suzlon Energy Limited' },
  // Metals / Materials
  'INE047A01021': { symbol: 'TATASTEEL',   company: 'Tata Steel Limited' },
  'INE081A01020': { symbol: 'TATASTEEL',   company: 'Tata Steel Limited' },
  'INE092A01019': { symbol: 'TATACHEM',    company: 'Tata Chemicals Limited' },
  // Consumer
  'INE176A01028': { symbol: 'BATAINDIA',   company: 'Bata (India) Limited' },
  'INE690A01028': { symbol: 'TTKPRESTIG',  company: 'TTK Prestige Limited' },
  'INE797F01020': { symbol: 'JUBLFOOD',    company: 'Jubilant FoodWorks Limited' },
  'INE411B01019': { symbol: 'VENUSREM',    company: 'Venus Remedies Limited' },
  'INE982F01036': { symbol: 'HATHWAY',     company: 'Hathway Cable and Datacom Limited' },
  'INE759V01019': { symbol: 'HUBL',        company: 'Heads Up Ventures Limited' },
  'INE302A01020': { symbol: 'EXIDEIND',    company: 'Exide Industries Limited' },
  // ETFs
  'INF179KC1981': { symbol: 'HDFCGOLD',   company: 'HDFC Gold ETF' },
  'INF109KC18U7': { symbol: 'ICICIPRBNK', company: 'ICICI Prudential Nifty Private Bank ETF' },
  'INF204KB14I2': { symbol: 'NIFTYBEES',  company: 'Nippon India ETF Nifty 50 BeES' },
  'INF204KB15V2': { symbol: 'NIFTYIT',    company: 'Nippon India ETF Nifty IT' },
  'INF204KB17I3': { symbol: 'BANKBEES',   company: 'Nippon India ETF Bank BeES' },
  'INF204KB15I6': { symbol: 'GOLDBEES',   company: 'Nippon India ETF Gold BeES' },
  'INF204KB11I6': { symbol: 'JUNIORBEES', company: 'Nippon India ETF Junior BeES' },
  'INF109KC1UZ2': { symbol: 'ICICIB22',   company: 'ICICI Prudential Nifty Next 50 ETF' },
  // Mutual Funds (demat)
  'INF754K01NR9': { symbol: 'EDELNLM250', company: 'Edelweiss Nifty Large Midcap 250 Index Fund' },
  'INF879O01027': { symbol: 'PPFCF',      company: 'Parag Parikh Flexi Cap Fund (Direct-Growth)' },
  'INF846K01164': { symbol: 'AXISLCF',    company: 'Axis Large Cap Fund – Regular Growth' },
};

function lookupISIN(isin) {
  return ISIN_TO_SYMBOL[isin] || null;
}

// ── Asset type from ISIN prefix ──────────────────────────────────────
function assetType(isin) {
  // INF = Mutual Fund / ETF, INE = Equity
  if (!isin.startsWith('INE') && isin.startsWith('INF')) return 'MF';
  return 'Equity';
}

// ── Derive NSE symbol from company name when ISIN not in table ────────
function symbolFromCompany(company) {
  if (!company) return null;
  // Take first word, strip non-alphanumeric, uppercase, max 10 chars
  return company.split(/[\s,(]/)[0].replace(/[^A-Z0-9&\-]/gi, '').toUpperCase().slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════
//  CDSL PARSER
//  Key insight from real PDF: every holding row has "-- -- --" sentinel
//  representing frozen/pledged/locked shares (usually all zeros/dashes).
//  Row structure:
//    ISIN  [company name, 0–200 chars]  balance  --  --  --  free_bal  price  value
// ══════════════════════════════════════════════════════════════════════
function parseCDSLCAS(text) {
  const holdings = [];
  const seen     = new Set();

  // Primary regex — matches the confirmed CDSL row format
  // Works for both single-line and multi-line (pdfplumber / pdfjs extraction)
  const rowRe = new RegExp(
    '(IN[A-Z0-9]{10})'         +  // ① ISIN: IN + 10 alphanumeric (INE=equity, INF=MF/ETF)
    '[\\s\\S]{0,200}?'         +  // optional company name / spaces (non-greedy)
    '([\\d,]+\\.\\d+)'         +  // ② current balance (total units held)
    '\\s+--\\s+--\\s+--\\s+'   +  // frozen / pledged / locked sentinel ← KEY ANCHOR
    '([\\d,]+\\.\\d+)'         +  // ③ free balance (available units)
    '\\s+([\\d,]+\\.\\d+)'     +  // ④ market price per unit
    '\\s+([\\d,]+\\.\\d+)',       // ⑤ total value in ₹
    'g'
  );

  let match;
  while ((match = rowRe.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    seen.add(isin);

    const quantity    = parseFloat(match[2].replace(/,/g, ''));
    const market_price = parseFloat(match[4].replace(/,/g, ''));
    const market_value = parseFloat(match[5].replace(/,/g, ''));

    if (quantity <= 0 || market_price <= 0) continue;

    // Extract company name: text between ISIN end and the balance number
    const isinEnd   = match.index + isin.length;
    const balStart  = text.indexOf(match[2], isinEnd);
    const nameSlice = text.slice(isinEnd, balStart).trim().replace(/\s+/g, ' ');

    // Clean name: remove anything that looks like a number or stray chars
    const rawName = nameSlice.replace(/[\d,.\-–]/g, ' ').replace(/\s+/g, ' ').trim();

    const lookup = lookupISIN(isin);
    holdings.push({
      isin,
      symbol:       lookup?.symbol  || symbolFromCompany(rawName || isin),
      company:      lookup?.company || rawName  || isin,
      quantity:     Math.round(quantity * 1000) / 1000,  // preserve MF decimals
      market_price,
      market_value,
      asset_type:   assetType(isin),
      cas_source:   'CDSL',
    });
  }

  return holdings;
}

// ══════════════════════════════════════════════════════════════════════
//  NSDL PARSER
//  Row structure:
//    ISIN  SYMBOL.NSE/BSE  Company  FaceValue  Qty  Price  Value
// ══════════════════════════════════════════════════════════════════════
function parseNSDLCAS(text) {
  const holdings = [];
  const seen     = new Set();

  // Primary: full tabular row with exchange suffix anchor
  const lineRe = /(INE[A-Z0-9]{9})\s+([A-Z0-9&\-]+\.(NSE|BSE))\s+(.+?)\s+([\d]+\.[\d]+)\s+([\d,]+)\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)/g;
  let match;
  while ((match = lineRe.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    const rawSymbol = match[2].split('.')[0];
    const company   = match[4].trim();
    const qty       = parseInt(match[6].replace(/,/g, ''));
    const price     = parseFloat(match[7].replace(/,/g, ''));
    if (qty > 0 && price > 0) {
      seen.add(isin);
      const lookup = lookupISIN(isin);
      holdings.push({
        isin,
        symbol:       lookup?.symbol  || rawSymbol,
        company:      lookup?.company || company,
        quantity:     qty,
        market_price: price,
        market_value: parseFloat(match[8].replace(/,/g, '')),
        asset_type:   'Equity',
        cas_source:   'NSDL',
      });
    }
  }

  // Fallback: just ISIN + surrounding numbers (no exchange suffix found)
  if (holdings.length === 0) {
    const isinRe = /\b(INE[A-Z0-9]{9})\b/g;
    while ((match = isinRe.exec(text)) !== null) {
      const isin = match[1];
      if (seen.has(isin)) continue;
      const after    = text.slice(match.index + 12, match.index + 500);
      const numMatch = after.match(/([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/);
      if (numMatch) {
        const qty   = parseInt(numMatch[1].replace(/,/g, ''));
        const price = parseFloat(numMatch[2].replace(/,/g, ''));
        if (qty > 0 && price > 0) {
          seen.add(isin);
          const lookup = lookupISIN(isin);
          holdings.push({
            isin,
            symbol:       lookup?.symbol || isin,
            company:      lookup?.company || isin,
            quantity:     qty,
            market_price: price,
            market_value: parseFloat(numMatch[3].replace(/,/g, '')),
            asset_type:   'Equity',
            cas_source:   'NSDL',
          });
        }
      }
    }
  }

  return holdings;
}

// ── Detect CAS source ────────────────────────────────────────────────
function detectCASType(text) {
  if (!text) return 'UNKNOWN';
  if (/CDSL|Central Depository Services/i.test(text)) return 'CDSL';
  if (/NSDL|National Securities Depository/i.test(text)) return 'NSDL';
  return 'UNKNOWN';
}

// ── Parse portfolio summary block ────────────────────────────────────
function parseCASummary(text) {
  const summary = {};
  const total = text.match(/Total Portfolio Value\D+([\d,]+\.?\d*)/i);
  if (total) summary.totalValue = parseFloat(total[1].replace(/,/g, ''));
  const eq  = text.match(/Equity\s+([\d,]+\.?\d*)\s+([\d.]+)/i);
  if (eq)   summary.equityValue = parseFloat(eq[1].replace(/,/g, ''));
  const mf  = text.match(/Mutual Funds?\s+(?:Held in Demat Form\s+)?([\d,]+\.?\d*)\s+([\d.]+)/i);
  if (mf)   summary.mfValue = parseFloat(mf[1].replace(/,/g, ''));
  return summary;
}

// ── Dedup by ISIN (sum qty if duped across pages) ────────────────────
function dedupHoldings(holdings) {
  const map = {};
  for (const h of holdings) {
    if (map[h.isin]) {
      map[h.isin].quantity += h.quantity;
    } else {
      map[h.isin] = { ...h };
    }
  }
  return Object.values(map);
}

// ── Main entry point ─────────────────────────────────────────────────
function parseCAS(text) {
  if (!text) return { type: 'UNKNOWN', holdings: [], summary: {} };

  const type    = detectCASType(text);
  const summary = parseCASummary(text);

  // Run both parsers — CDSL is primary for CDSL docs, NSDL for NSDL
  // We merge so a combined CAS (rare but exists) is handled too
  const cdslHoldings = parseCDSLCAS(text);
  const nsdlHoldings = parseNSDLCAS(text);

  // Prefer whichever parser found more holdings
  const cdslIsins = new Set(cdslHoldings.map(h => h.isin));
  const combined  = [...cdslHoldings];
  for (const h of nsdlHoldings) {
    if (!cdslIsins.has(h.isin)) combined.push(h);
  }

  const holdings = dedupHoldings(combined);

  console.log(JSON.stringify({
    event:      'CAS_PARSE_RESULT',
    type,
    cdslFound:  cdslHoldings.length,
    nsdlFound:  nsdlHoldings.length,
    totalFound: holdings.length,
    sample:     holdings.slice(0, 5).map(h =>
      `${h.symbol}(${h.isin}):qty=${h.quantity}@₹${h.market_price}`
    ),
  }));

  return { type, holdings, summary };
}

module.exports = {
  parseCAS,
  parseCDSLCAS,
  parseNSDLCAS,
  detectCASType,
  ISIN_TO_SYMBOL,
};
