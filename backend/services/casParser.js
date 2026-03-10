/**
 * StockPilot CAS Parser — NSDL & CDSL
 */

// ── ISIN → NSE Symbol lookup for CDSL (no symbol in CDSL CAS) ──────
const ISIN_TO_SYMBOL = {
  'INE040A01034': { symbol: 'HDFCBANK',    company: 'HDFC Bank Limited' },
  'INE009A01021': { symbol: 'INFY',        company: 'Infosys Limited' },
  'INE467B01029': { symbol: 'TCS',         company: 'Tata Consultancy Services' },
  'INE062A01020': { symbol: 'HCLTECH',     company: 'HCL Technologies' },
  'INE075A01022': { symbol: 'WIPRO',       company: 'Wipro Limited' },
  'INE002A01018': { symbol: 'RELIANCE',    company: 'Reliance Industries' },
  'INE001A01036': { symbol: 'HDFCBANK',    company: 'HDFC Bank Limited' },
  'INE090A01021': { symbol: 'ICICIBANK',   company: 'ICICI Bank Limited' },
  'INE211T01019': { symbol: 'TMB',         company: 'Tamilnad Mercantile Bank' },
  'INE476A01014': { symbol: 'CANBANK',     company: 'Canara Bank' },
  'INE028A01039': { symbol: 'BANKBARODA',  company: 'Bank of Baroda' },
  'INE238A01034': { symbol: 'AXISBANK',    company: 'Axis Bank Limited' },
  'INE155A01022': { symbol: 'TATAMOTORS',  company: 'Tata Motors Limited' },
  'INE585B01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE917I01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE885A01032': { symbol: 'AMARAJABAT',  company: 'Amara Raja Energy & Mobility' },
  'INE036A01022': { symbol: 'HDFCAMC',     company: 'HDFC Asset Management' },
  'INE860A01027': { symbol: 'BAJFINANCE',  company: 'Bajaj Finance Limited' },
  'INE296A01024': { symbol: 'BAJAJFINSV',  company: 'Bajaj Finserv Limited' },
  'INE030A01027': { symbol: 'HINDUNILVR',  company: 'Hindustan Unilever' },
  'INE259A01022': { symbol: 'COLPAL',      company: 'Colgate Palmolive India' },
  'INE101A01026': { symbol: 'COFORGE',     company: 'Coforge Limited' },
  'INE200M01021': { symbol: 'MANYAVAR',    company: 'Vedant Fashions (Manyavar)' },
  'INE154A01025': { symbol: 'ITC',         company: 'ITC Limited' },
  'INE066A01021': { symbol: 'BPCL',        company: 'Bharat Petroleum Corp' },
  'INE079A01024': { symbol: 'POWERGRID',   company: 'Power Grid Corporation' },
  'INE434A01013': { symbol: 'ANDHRBANK',   company: 'Andhra Bank' },
  'INE491A01021': { symbol: 'EQUITASBNK',  company: 'Equitas Small Finance Bank' },
  'INE047A01021': { symbol: 'TATASTEEL',   company: 'Tata Steel Limited' },
  'INE585B01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE361B01024': { symbol: 'CASTROLIND',  company: 'Castrol India Limited' },
  'INE053F01010': { symbol: 'BANKBEES',    company: 'Nippon India ETF Bank BeES' },
  'INE348A01023': { symbol: 'DRREDDY',     company: 'Dr. Reddy\'s Laboratories' },
  'INE059A01026': { symbol: 'CIPLA',       company: 'Cipla Limited' },
  'INE322A01023': { symbol: 'ZYDUSLIFE',   company: 'Zydus Lifesciences' },
  'INE721A01013': { symbol: 'EICHERMOT',   company: 'Eicher Motors Limited' },
  'INE406A01037': { symbol: 'HEROMOTOCO',  company: 'Hero MotoCorp Limited' },
  'INE518A01013': { symbol: 'TATACONSUMER',company: 'Tata Consumer Products' },
  'INE752E01010': { symbol: 'HYUNDAI',     company: 'Hyundai Motor India' },
  'INE774D01024': { symbol: 'MOTHERSON',   company: 'Samvardhana Motherson' },
  'INE016A01026': { symbol: 'GRASIM',      company: 'Grasim Industries' },
  'INE397D01024': { symbol: 'EXIDEIND',    company: 'Exide Industries' },
};

function lookupISIN(isin) {
  return ISIN_TO_SYMBOL[isin] || { symbol: isin, company: isin };
}

// ── NSDL CAS Parser ────────────────────────────────────────────────
function parseNSDLCAS(text) {
  const holdings = [];
  const seen = new Set();

  // Primary: ISIN SYMBOL.NSE/BSE   COMPANY   FaceVal   Qty   Price   Value
  const lineRegex = /(INE[A-Z0-9]{9})\s+([A-Z0-9&\-]+\.(NSE|BSE))\s+(.+?)\s+([\d]+\.[\d]+)\s+([\d,]+)\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)/g;
  let match;
  while ((match = lineRegex.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    const rawSymbol = match[2].split('.')[0];
    const company   = match[4].trim();
    const qty   = parseInt(match[6].replace(/,/g, ''));
    const price = parseFloat(match[7].replace(/,/g, ''));
    if (qty > 0 && price > 0) {
      seen.add(isin);
      // Use ISIN lookup to get clean NSE symbol if raw symbol looks weird
      const lookup = ISIN_TO_SYMBOL[isin];
      holdings.push({
        isin,
        symbol:  lookup?.symbol  || rawSymbol,
        company: lookup?.company || company,
        quantity: qty, market_price: price, cas_source: 'NSDL'
      });
    }
  }

  // Fallback
  if (holdings.length === 0) {
    const simpleRegex = /(INE[A-Z0-9]{9})[\s\S]{0,200}?([\d,]+\.?\d*)\s+([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/g;
    while ((match = simpleRegex.exec(text)) !== null) {
      const isin = match[1];
      if (seen.has(isin)) continue;
      const qty   = parseInt(match[3].replace(/,/g, ''));
      const price = parseFloat(match[4].replace(/,/g, ''));
      if (qty > 0 && price > 0) {
        seen.add(isin);
        const lookup = lookupISIN(isin);
        holdings.push({ isin, ...lookup, quantity: qty, market_price: price, cas_source: 'NSDL' });
      }
    }
  }

  return holdings;
}

// ── CDSL CAS Parser ────────────────────────────────────────────────
function parseCDSLCAS(text) {
  const holdings = [];
  const seen = new Set();

  // CDSL format 1: tabular — ISIN followed by Qty, Price, Value on same/next lines
  // INE040A01034   HDFC BANK LTD   50   1543.25   77162.50
  const tabRegex = /(INE[A-Z0-9]{9})\s+([A-Z][A-Za-z0-9\s&.\-'()]+?)\s+([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/g;
  let match;
  while ((match = tabRegex.exec(text)) !== null) {
    const isin    = match[1];
    if (seen.has(isin)) continue;
    const rawCompany = match[2].trim();
    const qty     = parseInt(match[3].replace(/,/g, ''));
    const price   = parseFloat(match[4].replace(/,/g, ''));
    if (qty > 0 && price > 0) {
      seen.add(isin);
      const lookup = ISIN_TO_SYMBOL[isin];
      holdings.push({
        isin,
        symbol:  lookup?.symbol  || rawCompany.split(' ')[0].toUpperCase(),
        company: lookup?.company || rawCompany,
        quantity: qty, market_price: price, cas_source: 'CDSL'
      });
    }
  }

  // CDSL format 2: ISIN alone on line, numbers follow within 300 chars
  if (holdings.length === 0) {
    const isinRegex = /\b(INE[A-Z0-9]{9})\b/g;
    while ((match = isinRegex.exec(text)) !== null) {
      const isin = match[1];
      if (seen.has(isin)) continue;
      const after = text.slice(match.index + isin.length, match.index + isin.length + 400);
      // Try to extract company name (line after ISIN)
      const companyMatch = after.match(/^\s*\n?\s*([A-Z][A-Za-z0-9\s&.\-'()]{3,60})\n/);
      const rawCompany = companyMatch ? companyMatch[1].trim() : '';
      const numMatch = after.match(/([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/);
      if (numMatch) {
        const qty   = parseInt(numMatch[1].replace(/,/g, ''));
        const price = parseFloat(numMatch[2].replace(/,/g, ''));
        if (qty > 0 && price > 0) {
          seen.add(isin);
          const lookup = ISIN_TO_SYMBOL[isin];
          holdings.push({
            isin,
            symbol:  lookup?.symbol  || (rawCompany ? rawCompany.split(' ')[0].toUpperCase() : isin),
            company: lookup?.company || rawCompany || isin,
            quantity: qty, market_price: price, cas_source: 'CDSL'
          });
        }
      }
    }
  }

  return holdings;
}

function detectCASType(text) {
  if (!text) return 'UNKNOWN';
  if (/CDSL|Central Depository Services/i.test(text)) return 'CDSL';
  if (/NSDL|National Securities Depository/i.test(text)) return 'NSDL';
  return 'UNKNOWN';
}

function parseCASummary(text) {
  const summary = {};
  const total = text.match(/TOTAL\s+([\d,]+\.?\d*)/i);
  if (total) summary.totalValue = parseFloat(total[1].replace(/,/g,''));
  return summary;
}

function dedupHoldings(holdings) {
  const map = {};
  for (const h of holdings) {
    if (map[h.isin]) map[h.isin].quantity += h.quantity;
    else map[h.isin] = { ...h };
  }
  return Object.values(map);
}

function parseCAS(text) {
  if (!text) return { type: 'UNKNOWN', holdings: [], summary: {} };
  const type    = detectCASType(text);
  const summary = parseCASummary(text);

  let holdings = parseNSDLCAS(text);
  // Always try CDSL too — some statements have both or NSDL misses some
  const cdslHoldings = parseCDSLCAS(text);
  // Merge: prefer NSDL parse if symbol is real, add any CDSL-only ISINs
  const nsdlIsins = new Set(holdings.map(h => h.isin));
  for (const h of cdslHoldings) {
    if (!nsdlIsins.has(h.isin)) holdings.push(h);
  }

  console.log(JSON.stringify({
    event: 'CAS_PARSE_RESULT', type,
    nsdlFound: parseNSDLCAS(text).length,
    cdslFound: cdslHoldings.length,
    totalFound: holdings.length,
    sample: holdings.slice(0,3).map(h => `${h.symbol}(${h.isin}):${h.quantity}@${h.market_price}`)
  }));

  return { type, holdings: dedupHoldings(holdings), summary };
}

module.exports = { parseCAS, parseCDSLCAS, parseNSDLCAS, detectCASType, ISIN_TO_SYMBOL };
