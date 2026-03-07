/**
 * StockPilot CAS Parser
 * Parses CDSL and NSDL Consolidated Account Statements (PDF text)
 * CAS is the PRIMARY source of truth for holdings in StockPilot.
 * 
 * CAS gives us:
 * - All holdings across ALL brokers
 * - ISIN, company name, quantity, market value
 * - Dividend history
 * - Corporate actions (bonus, splits)
 */

// ISIN to NSE symbol mapping for live price lookup
// We'll try to derive symbol from company name if ISIN not in map
const ISIN_TO_SYMBOL = {
  'INE040A01034': 'HDFCBANK',
  'INE009A01021': 'INFOSYS',
  'INE002A01018': 'RELIANCE',
  'INE467B01029': 'TCS',
  'INE062A01020': 'SBIN',
  'INE030A01027': 'BAJFINANCE',
  'INE021A01026': 'LT',
  'INE397D01024': 'POWERGRID',
  'INE066A01021': 'WIPRO',
  'INE154A01025': 'ITC',
  'INE001A01036': 'ADANIPORTS',
  'INE090A01021': 'ICICIBANK',
  'INE018A01030': 'AXISBANK',
  'INE585B01010': 'TITAN',
  'INE117A01022': 'DIVISLAB',
  'INE214T01019': 'NIFTY_BEES',
  'INE245A01021': 'NESTLEIND',
  'INE860A01027': 'HINDUNILVR',
  'INE356A01018': 'INDUSINDBK',
  'INE361B01024': 'MARUTI',
  'INE192A01025': 'BHARTIARTL',
  'INE326A01037': 'BAJAJ_AUTO',
  'INE040A01034': 'HDFCBANK',
  'INE029A01011': 'HEROMOTOCO',
  'INE881D01027': 'TATAMOTORS',
  'INE155A01022': 'ASIANPAINT',
  'INE203A01020': 'SUNPHARMA',
  'INE028A01039': 'KOTAKBANK',
  'INE066F01020': 'POWERGRIDINVIT',
};

/**
 * Derive NSE symbol from company name (best effort)
 */
function deriveSymbol(companyName) {
  if (!companyName) return null;
  const name = companyName.toUpperCase().trim();
  
  // Clean common suffixes
  const cleaned = name
    .replace(/\s+LIMITED$/i, '')
    .replace(/\s+LTD\.?$/i, '')
    .replace(/\s+INDUSTRIES$/i, '')
    .replace(/\s+CORPORATION$/i, '')
    .replace(/\s+BANK$/i, 'BANK')
    .replace(/[^A-Z0-9]/g, '');
  
  return cleaned.slice(0, 15); // NSE symbols max 15 chars
}

/**
 * Parse CDSL CAS PDF text
 * CDSL format has ISIN, company, quantity in tabular format
 */
function parseCDSLCAS(text) {
  const holdings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match ISIN pattern
    const isinMatch = line.match(/\b(INE[A-Z0-9]{9})\b/);
    if (!isinMatch) continue;
    
    const isin = isinMatch[1];
    
    // Look in surrounding lines for company name and quantity
    const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join(' ');
    
    // Extract quantity - look for a standalone number (not price/value)
    // CDSL format: ISIN | Company | Qty | Value
    const qtyPatterns = [
      /\b(\d{1,6})\s+(?:[\d,]+\.\d{2})\b/,  // qty followed by value with decimals
      new RegExp(isin + '[^\\d]+(\\d{1,6})'),  // qty after ISIN
      /\|\s*(\d{1,6})\s*\|/,                    // qty between pipes
    ];
    
    let quantity = null;
    for (const pattern of qtyPatterns) {
      const m = context.match(pattern);
      if (m && parseInt(m[1]) > 0 && parseInt(m[1]) < 10000000) {
        quantity = parseInt(m[1]);
        break;
      }
    }
    
    // Extract company name - usually on same line as ISIN or line before
    let company = null;
    const companyLine = lines[i - 1] || line;
    const companyMatch = companyLine.match(/([A-Z][A-Z0-9\s&\.\-]{3,50}(?:LIMITED|LTD|BANK|INDUSTRIES|FINANCE|TECHNOLOGIES|INFRA|ENERGY|POWER)?)/i);
    if (companyMatch) company = companyMatch[1].trim();
    
    // Get market value if available
    const valueMatch = context.match(/[\d,]+\.\d{2}/g);
    const marketValue = valueMatch ? parseFloat(valueMatch[valueMatch.length - 1].replace(/,/g, '')) : null;
    
    if (quantity && quantity > 0) {
      holdings.push({
        isin,
        company: company || isin,
        symbol: ISIN_TO_SYMBOL[isin] || deriveSymbol(company),
        quantity,
        marketValue,
        source: 'CDSL CAS'
      });
    }
  }
  
  return dedupHoldings(holdings);
}

/**
 * Parse NSDL CAS PDF text
 * NSDL format is slightly different - company name comes before ISIN
 */
function parseNSDLCAS(text) {
  const holdings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isinMatch = line.match(/\b(INE[A-Z0-9]{9})\b/);
    if (!isinMatch) continue;
    
    const isin = isinMatch[1];
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' ');
    
    // NSDL format: Company Name on previous line, then ISIN, then Qty
    let company = lines[i - 1] || null;
    if (company && /INE|ISIN|\d{10}/.test(company)) company = null;
    
    // Quantity patterns for NSDL
    const qtyPatterns = [
      /\b(\d{1,6})\s+(?:EQ|BE|N[1-9])\b/i,  // qty with series type
      /Balance.*?(\d{1,6})/i,                   // "Balance: 100"
      new RegExp(isin + '\\s+(?:EQ|BE)?\\s*(\\d{1,6})'),
    ];
    
    let quantity = null;
    for (const pattern of qtyPatterns) {
      const m = context.match(pattern);
      if (m && parseInt(m[1]) > 0) {
        quantity = parseInt(m[1]);
        break;
      }
    }
    
    // Fallback: find first reasonable standalone number after ISIN
    if (!quantity) {
      const afterIsin = context.split(isin)[1] || '';
      const numMatch = afterIsin.match(/\b(\d{1,6})\b/);
      if (numMatch && parseInt(numMatch[1]) > 0 && parseInt(numMatch[1]) < 10000000) {
        quantity = parseInt(numMatch[1]);
      }
    }
    
    const valueMatch = context.match(/[\d,]+\.\d{2}/g);
    const marketValue = valueMatch ? parseFloat(valueMatch[valueMatch.length - 1].replace(/,/g, '')) : null;
    
    if (quantity && quantity > 0) {
      holdings.push({
        isin,
        company: company || isin,
        symbol: ISIN_TO_SYMBOL[isin] || deriveSymbol(company),
        quantity,
        marketValue,
        source: 'NSDL CAS'
      });
    }
  }
  
  return dedupHoldings(holdings);
}

/**
 * Parse CAS summary section - total portfolio value etc.
 */
function parseCASummary(text) {
  const summary = {};
  
  // Total portfolio value
  const totalMatch = text.match(/total\s+(?:market\s+)?value[:\s]+(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
  if (totalMatch) summary.totalValue = parseFloat(totalMatch[1].replace(/,/g, ''));
  
  // Statement date
  const dateMatch = text.match(/(?:statement|as\s+on|date)[:\s]+(\d{1,2}[-\/]\w+[-\/]\d{2,4})/i);
  if (dateMatch) summary.statementDate = dateMatch[1];
  
  // DP ID / Client ID
  const dpMatch = text.match(/(?:DP\s+ID|DPID)[:\s]+([A-Z0-9]+)/i);
  if (dpMatch) summary.dpId = dpMatch[1];
  
  return summary;
}

/**
 * Detect if text is from CDSL or NSDL
 */
function detectCASType(text) {
  if (/CDSL|Central Depository Services/i.test(text)) return 'CDSL';
  if (/NSDL|National Securities Depository/i.test(text)) return 'NSDL';
  return 'UNKNOWN';
}

/**
 * Main CAS parser - auto-detects CDSL vs NSDL
 */
function parseCAS(text) {
  const type = detectCASType(text);
  const summary = parseCASummary(text);
  
  let holdings = [];
  if (type === 'NSDL') {
    holdings = parseNSDLCAS(text);
  } else {
    // Default to CDSL parser (also works for unknown)
    holdings = parseCDSLCAS(text);
    // If CDSL parser finds nothing, try NSDL parser
    if (holdings.length === 0) holdings = parseNSDLCAS(text);
  }
  
  return { type, holdings, summary };
}

/**
 * Deduplicate holdings by ISIN, summing quantities
 */
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

module.exports = { parseCAS, parseCDSLCAS, parseNSDLCAS, detectCASType, ISIN_TO_SYMBOL };
