/**
 * StockPilot CAS Parser  —  CDSL & NSDL
 *
 * CDSL demat format (confirmed from real PDF):
 *   ISIN  [name]  balance  --  --  --  free_bal  price  value
 *   The triple "-- -- --" is the definitive anchor.
 *
 * NSDL demat format:
 *   ISIN  SYMBOL.NSE/BSE  Company  FaceValue  Qty  Price  Value
 *
 * NSDL MF (SOA) format — NEW:
 *   Folio  FundName  InvestedValue  Units(3dp)  NAVDate  NAV  MarketValue  Gain/Loss
 *   No ISIN — identified by folio number. Goes to mf_holdings table.
 *   Statement date extracted from "As on Date" in PDF header.
 *
 * KEY RULE: parseNSDLCAS and parseCDSLCAS are UNCHANGED — they handle
 * demat equity + demat MF/ETF (INF ISINs). parseNSDLMF is a completely
 * separate function that handles SOA mutual funds only.
 */

// ── ISIN master lookup ──────────────────────────────────────────────
const ISIN_TO_SYMBOL = {
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
  'INE467B01029': { symbol: 'TCS',         company: 'Tata Consultancy Services Limited' },
  'INE009A01021': { symbol: 'INFY',        company: 'Infosys Limited' },
  'INE075A01022': { symbol: 'WIPRO',       company: 'Wipro Limited' },
  'INE860A01027': { symbol: 'HCLTECH',     company: 'HCL Technologies Limited' },
  'INE669C01036': { symbol: 'TECHM',       company: 'Tech Mahindra Limited' },
  'INE101A01026': { symbol: 'COFORGE',     company: 'Coforge Limited' },
  'INE214T01019': { symbol: 'LTIM',        company: 'LTIMindtree Limited' },
  'INE262H01021': { symbol: 'PERSISTENT',  company: 'Persistent Systems Limited' },
  'INE296A01024': { symbol: 'BAJFINANCE',  company: 'Bajaj Finance Limited' },
  'INE918I01026': { symbol: 'BAJAJFINSV',  company: 'Bajaj Finserv Limited' },
  'INE127D01025': { symbol: 'HDFCAMC',     company: 'HDFC Asset Management Company' },
  'INE121A01024': { symbol: 'CHOLAFIN',    company: 'Cholamandalam Investment & Finance' },
  'INE414G01012': { symbol: 'MUTHOOTFIN',  company: 'Muthoot Finance Limited' },
  'INE115A01026': { symbol: 'LICHSGFIN',   company: 'LIC Housing Finance Limited' },
  'INE030A01027': { symbol: 'HINDUNILVR',  company: 'Hindustan Unilever Limited' },
  'INE154A01025': { symbol: 'ITC',         company: 'ITC Limited' },
  'INE379A01028': { symbol: 'ITCHOTELS',   company: 'ITC Hotels Limited' },
  'INE239A01024': { symbol: 'NESTLEIND',   company: 'Nestle India Limited' },
  'INE216A01030': { symbol: 'BRITANNIA',   company: 'Britannia Industries Limited' },
  'INE259A01022': { symbol: 'COLPAL',      company: 'Colgate Palmolive (India) Limited' },
  'INE548C01032': { symbol: 'EMAMILTD',    company: 'Emami Limited' },
  'INE200M01021': { symbol: 'MANYAVAR',    company: 'Vedant Fashions Limited (Manyavar)' },
  'INE917I01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE066A01021': { symbol: 'EICHERMOT',   company: 'Eicher Motors Limited' },
  'INE158A01026': { symbol: 'HEROMOTOCO',  company: 'Hero MotoCorp Limited' },
  'INE155A01022': { symbol: 'TATAMOTORS',  company: 'Tata Motors Limited' },
  'INE438A01022': { symbol: 'APOLLOTYRE',  company: 'Apollo Tyres Limited' },
  'INE585B01010': { symbol: 'MARUTI',      company: 'Maruti Suzuki India Limited' },
  'INE348A01023': { symbol: 'DRREDDY',     company: 'Dr. Reddy\'s Laboratories Limited' },
  'INE059A01026': { symbol: 'CIPLA',       company: 'Cipla Limited' },
  'INE987B01026': { symbol: 'NATCOPHARM',  company: 'Natco Pharma Limited' },
  'INE232I01014': { symbol: 'SPARC',       company: 'Sun Pharma Advanced Research Co.' },
  'INE002A01018': { symbol: 'RELIANCE',    company: 'Reliance Industries Limited' },
  'INE079A01024': { symbol: 'POWERGRID',   company: 'Power Grid Corporation of India' },
  'INE053F01010': { symbol: 'IRFC',        company: 'Indian Railway Finance Corporation Ltd' },
  // InvITs & REITs
  'INE0GGX23010': { symbol: 'PGINVIT',     company: 'PowerGrid Infrastructure Investment Trust' },
  'INE230O23011': { symbol: 'INDIGRID',    company: 'India Grid Trust InvIT' },
  'INE465L23012': { symbol: 'STOVIND',     company: 'Stove Kraft Limited' },
  'INE098L23018': { symbol: 'MINDSPACE',   company: 'Mindspace Business Parks REIT' },
  'INE0J1Y23023': { symbol: 'EMBASSY',     company: 'Embassy Office Parks REIT' },
  'INE752O23027': { symbol: 'NEXUS',       company: 'Nexus Select Trust REIT' },
  'INE040H01021': { symbol: 'SUZLON',      company: 'Suzlon Energy Limited' },
  'INE047A01021': { symbol: 'TATASTEEL',   company: 'Tata Steel Limited' },
  'INE081A01020': { symbol: 'TATASTEEL',   company: 'Tata Steel Limited' },
  'INE092A01019': { symbol: 'TATACHEM',    company: 'Tata Chemicals Limited' },
  'INE176A01028': { symbol: 'BATAINDIA',   company: 'Bata (India) Limited' },
  'INE690A01028': { symbol: 'TTKPRESTIG',  company: 'TTK Prestige Limited' },
  'INE797F01020': { symbol: 'JUBLFOOD',    company: 'Jubilant FoodWorks Limited' },
  'INE411B01019': { symbol: 'VENUSREM',    company: 'Venus Remedies Limited' },
  'INE982F01036': { symbol: 'HATHWAY',     company: 'Hathway Cable and Datacom Limited' },
  'INE759V01019': { symbol: 'HUBL',        company: 'Heads Up Ventures Limited' },
  'INE302A01020': { symbol: 'EXIDEIND',    company: 'Exide Industries Limited' },
  'INF179KC1981': { symbol: 'HDFCGOLD',   company: 'HDFC Gold ETF' },
  'INF109KC18U7': { symbol: 'ICICIPRBNK', company: 'ICICI Prudential Nifty Private Bank ETF' },
  'INF204KB14I2': { symbol: 'NIFTYBEES',  company: 'Nippon India ETF Nifty 50 BeES' },
  'INF204KB15V2': { symbol: 'NIFTYIT',    company: 'Nippon India ETF Nifty IT' },
  'INF204KB17I3': { symbol: 'BANKBEES',   company: 'Nippon India ETF Bank BeES' },
  'INF204KB15I6': { symbol: 'GOLDBEES',   company: 'Nippon India ETF Gold BeES' },
  'INF204KB11I6': { symbol: 'JUNIORBEES', company: 'Nippon India ETF Junior BeES' },
  'INF109KC1UZ2': { symbol: 'ICICIB22',   company: 'ICICI Prudential Nifty Next 50 ETF' },
  'INF754K01NR9': { symbol: 'EDELNLM250', company: 'Edelweiss Nifty Large Midcap 250 Index Fund' },
  'INF879O01027': { symbol: 'PPFCF',      company: 'Parag Parikh Flexi Cap Fund (Direct-Growth)' },
  'INF846K01164': { symbol: 'AXISLCF',    company: 'Axis Large Cap Fund – Regular Growth' },
};

function lookupISIN(isin) { return ISIN_TO_SYMBOL[isin] || null; }
function assetType(isin)  { return (!isin.startsWith('INE') && isin.startsWith('INF')) ? 'MF' : 'Equity'; }
function symbolFromCompany(company) {
  if (!company) return null;
  return company.split(/[\s,(]/)[0].replace(/[^A-Z0-9&\-]/gi,'').toUpperCase().slice(0,10);
}

// ── Convert DD-Mon-YYYY or DD/MM/YYYY → YYYY-MM-DD ───────────────────
function toISODate(d) {
  if (!d) return null;
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const m1 = d.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) return `${m1[3]}-${months[m1[2]] || '01'}-${m1[1]}`;
  const m2 = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

// ── Extract CAS statement date ───────────────────────────────────────
// Returns YYYY-MM-DD or null
function parseCASDate(text) {
  const m = text.match(
    /(?:[Aa]s\s+[Oo]n\s+[Dd]ate\s*:?\s*|[Ss]tatement\s+as\s+on\s+)(\d{2}[-\/][A-Za-z\d]{2,3}[-\/]\d{4})/
  );
  if (m) return toISODate(m[1]);
  // Fallback: look for any DD-Mon-YYYY near the top of the document
  const m2 = text.slice(0, 500).match(/(\d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})/);
  if (m2) return toISODate(m2[1]);
  return null;
}

// ── MF category from fund name ────────────────────────────────────────
function mfCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('liquid') || n.includes('overnight')) return 'Debt-Liquid';
  if (n.includes('debt') || n.includes('bond') || n.includes('gilt')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced'))   return 'Hybrid';
  if (n.includes('elss') || n.includes('tax saver'))    return 'ELSS';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex')) return 'Index';
  if (n.includes('etf'))                                return 'ETF';
  if (n.includes('small cap') || n.includes('smallcap')) return 'Equity-SmallCap';
  if (n.includes('mid cap')   || n.includes('midcap'))   return 'Equity-MidCap';
  if (n.includes('large cap') || n.includes('largecap') || n.includes('bluechip')) return 'Equity-LargeCap';
  if (n.includes('flexi') || n.includes('multi cap'))   return 'Equity-Flexi';
  return 'Equity';
}

function mfFundHouse(name) {
  const n = (name || '').toLowerCase();
  const map = [
    ['parag parikh', 'PPFAS AMC'], ['hdfc', 'HDFC AMC'],
    ['icici', 'ICICI Prudential AMC'], ['sbi', 'SBI Funds Management'],
    ['axis', 'Axis AMC'], ['kotak', 'Kotak Mahindra AMC'],
    ['nippon', 'Nippon India AMC'], ['mirae', 'Mirae Asset AMC'],
    ['dsp', 'DSP Investment Managers'], ['franklin', 'Franklin Templeton AMC'],
    ['tata', 'Tata AMC'], ['uti', 'UTI AMC'],
    ['aditya birla', 'Aditya Birla Sun Life AMC'], ['absl', 'Aditya Birla Sun Life AMC'],
    ['sundaram', 'Sundaram AMC'], ['edelweiss', 'Edelweiss AMC'],
    ['quant', 'Quant AMC'], ['motilal', 'Motilal Oswal AMC'],
    ['canara', 'Canara Robeco AMC'], ['invesco', 'Invesco AMC'],
    ['navi', 'Navi AMC'], ['white oak', 'White Oak AMC'],
    ['pgim', 'PGIM India AMC'], ['bandhan', 'Bandhan AMC'],
  ];
  for (const [k, v] of map) { if (n.includes(k)) return v; }
  return 'Other AMC';
}

// ══════════════════════════════════════════════════════════════════════
//  CDSL DEMAT PARSER — UNCHANGED
//  Handles: equity (INE) + demat MF/ETF (INF) by ISIN
//  Anchor: "-- -- --" sentinel in every row
// ══════════════════════════════════════════════════════════════════════
function parseCDSLCAS(text) {
  const holdings = [];
  const seen     = new Set();

  const rowRe = new RegExp(
    '(IN[A-Z0-9]{10})'         +
    '[\\s\\S]{0,200}?'         +
    '([\\d,]+\\.\\d+)'         +
    '\\s+--\\s+--\\s+--\\s+'   +
    '([\\d,]+\\.\\d+)'         +
    '\\s+([\\d,]+\\.\\d+)'     +
    '\\s+([\\d,]+\\.\\d+)',
    'g'
  );

  let match;
  while ((match = rowRe.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    seen.add(isin);

    const quantity     = parseFloat(match[2].replace(/,/g, ''));
    const market_price = parseFloat(match[4].replace(/,/g, ''));
    const market_value = parseFloat(match[5].replace(/,/g, ''));

    if (quantity <= 0 || market_price <= 0) continue;

    const isinEnd  = match.index + isin.length;
    const balStart = text.indexOf(match[2], isinEnd);
    const nameSlice = text.slice(isinEnd, balStart).trim().replace(/\s+/g, ' ');
    const rawName   = nameSlice.replace(/[\d,.\-–]/g, ' ').replace(/\s+/g, ' ').trim();

    const lookup = lookupISIN(isin);
    holdings.push({
      isin,
      symbol:       lookup?.symbol  || symbolFromCompany(rawName || isin),
      company:      lookup?.company || rawName || isin,
      quantity:     Math.round(quantity * 1000) / 1000,
      market_price,
      market_value,
      asset_type:   assetType(isin),
      cas_source:   'CDSL',
    });
  }

  return holdings;
}

// ══════════════════════════════════════════════════════════════════════
//  NSDL DEMAT PARSER — UNCHANGED
//  Handles: equity (INE) + demat MF/ETF (INF) by ISIN
//  Anchor: exchange suffix .NSE/.BSE in symbol column
// ══════════════════════════════════════════════════════════════════════
function parseNSDLCAS(text) {
  const holdings = [];
  const seen     = new Set();

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

  // Fallback: ISIN only with surrounding numbers
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

// ══════════════════════════════════════════════════════════════════════
//  NSDL MF (SOA) PARSER — NEW
//
//  Handles: Mutual Fund Statement of Account section in NSDL CAS.
//  These are SIP/lump-sum MF investments NOT held in demat form.
//  They have NO ISIN — identified by folio number.
//
//  Row structure (pdfjs space-joined):
//  FolioNo  FundName  InvestedValue  Units(3dp)  DD-Mon-YYYY  NAV  MarketValue  Gain/Loss
//
//  Anchor: NAV date in DD-Mon-YYYY format is unique to MF rows.
//  Units always have exactly 3 decimal places.
//  Folio is a 7-15 digit number (sometimes with / suffix like "1234567/10").
//
//  Returns array of mfHolding objects → go to mf_holdings table.
// ══════════════════════════════════════════════════════════════════════
function parseNSDLMF(text) {
  const mfHoldings = [];
  const seen = new Set(); // dedup by folio

  // Primary regex — folio anchored at line start to prevent cross-line digit bleeding
  // e.g. "13,319.73\n9876543210 Fund..." must NOT match as folio "73\n9876543210"
  // Folio: 7-16 pure digits optionally followed by /N suffix
  // Anchor: NAV date DD-Mon-YYYY is unique to MF rows
  const MF_ROW_RE = /(?:^|\n)\s*(\d{7,16}(?:\/\d+)?)\s+([A-Z][A-Za-z0-9\s\-&().,]{5,100}?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{3})\s+(\d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})\s+([\d,]+\.\d{2,4})\s+([\d,]+\.\d{2})/gm;

  // Folio validation — must be 7-16 pure digits, optionally with /N suffix
  function validFolio(raw) {
    const t = raw.trim().replace(/\s+/g, '');
    return /^\d{7,16}(\/\d+)?$/.test(t) ? t : null;
  }

  let match;
  while ((match = MF_ROW_RE.exec(text)) !== null) {
    const folio      = validFolio(match[1]);
    if (!folio) continue;  // reject header lines and false positives
    const fund_name  = match[2].trim().replace(/\s+/g, ' ');
    const invested   = parseFloat(match[3].replace(/,/g, ''));
    const units      = parseFloat(match[4].replace(/,/g, ''));
    const nav_date   = toISODate(match[5]);
    const nav        = parseFloat(match[6].replace(/,/g, ''));
    const mkt_value  = parseFloat(match[7].replace(/,/g, ''));

    if (!folio || units <= 0) continue;
    if (seen.has(folio)) continue;
    seen.add(folio);

    // Extract gain/loss from text after this match (within 60 chars)
    const afterSlice = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const glNeg      = afterSlice.trimStart().startsWith('(');
    const glAmt      = afterSlice.match(/([\d,]+\.\d{2})/);
    const glPct      = afterSlice.match(/([+\-][\d.]+)%/);
    const gainLoss   = glAmt ? parseFloat(glAmt[1].replace(/,/g,'')) * (glNeg ? -1 : 1) : (mkt_value - invested);
    const gainLossPct= glPct ? parseFloat(glPct[1]) : (invested > 0 ? ((gainLoss / invested) * 100) : null);

    mfHoldings.push({
      folio_number:   folio,
      isin:           null,        // SOA MF has no ISIN
      fund_name,
      fund_house:     mfFundHouse(fund_name),
      fund_category:  mfCategory(fund_name),
      units,
      nav,
      nav_date,
      current_value:  mkt_value,
      invested_value: invested > 0 ? invested : null,
      gain_loss:      gainLoss,
      gain_loss_pct:  gainLossPct ? parseFloat(gainLossPct.toFixed(2)) : null,
      source:         'NSDL',
    });
  }

  console.log(JSON.stringify({
    event: 'NSDL_MF_PARSE',
    found: mfHoldings.length,
    sample: mfHoldings.slice(0,3).map(h => `${h.fund_name}: ${h.units}u @ ₹${h.nav} = ₹${h.current_value}`),
  }));

  return mfHoldings;
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
  summary.statementDate = parseCASDate(text);
  return summary;
}

// ── Dedup equity holdings by ISIN ────────────────────────────────────
function dedupHoldings(holdings) {
  const map = {};
  for (const h of holdings) {
    if (map[h.isin]) map[h.isin].quantity += h.quantity;
    else map[h.isin] = { ...h };
  }
  return Object.values(map);
}

// ── Main entry point ─────────────────────────────────────────────────
// Returns:
//   type           — 'CDSL' | 'NSDL' | 'UNKNOWN'
//   holdings       — equity + demat MF/ETF (go to holdings/mf_holdings by ISIN prefix)
//   mfHoldings     — SOA MF (NSDL only, go to mf_holdings by folio)
//   summary        — portfolio totals + statementDate
function parseCAS(text) {
  if (!text) return { type: 'UNKNOWN', holdings: [], mfHoldings: [], summary: {} };

  const type    = detectCASType(text);
  const summary = parseCASummary(text);

  // Step 1: demat holdings (equity + INF) — BOTH parsers always run
  const cdslHoldings = parseCDSLCAS(text);
  const nsdlHoldings = parseNSDLCAS(text);

  const cdslIsins = new Set(cdslHoldings.map(h => h.isin));
  const combined  = [...cdslHoldings];
  for (const h of nsdlHoldings) {
    if (!cdslIsins.has(h.isin)) combined.push(h);
  }
  const holdings = dedupHoldings(combined);

  // Step 2: SOA MF holdings (NSDL only — folio-based, no ISIN)
  // Only run for NSDL — CDSL doesn't have SOA MF section in its CAS format
  const mfHoldings = (type === 'NSDL' || nsdlHoldings.length > 0 || text.includes('National Securities'))
    ? parseNSDLMF(text)
    : [];

  console.log(JSON.stringify({
    event:      'CAS_PARSE_RESULT',
    type,
    casDate:    summary.statementDate,
    cdslFound:  cdslHoldings.length,
    nsdlFound:  nsdlHoldings.length,
    equityTotal: holdings.length,
    mfSOATotal: mfHoldings.length,
    sample:     holdings.slice(0, 3).map(h => `${h.symbol}(${h.isin}):${h.quantity}@₹${h.market_price}`),
  }));

  return { type, holdings, mfHoldings, summary };
}

module.exports = {
  parseCAS,
  parseCDSLCAS,
  parseNSDLCAS,
  parseNSDLMF,
  parseCASDate,
  detectCASType,
  ISIN_TO_SYMBOL,
};
