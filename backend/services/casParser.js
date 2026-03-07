/**
 * StockPilot CAS Parser — NSDL & CDSL
 *
 * Actual NSDL PDF text structure (from pdf-parse output):
 *   Line i:   "INE885A01032"                                    ← ISIN alone
 *   Line i+1: "ARE&M.NSE\tAMARA RAJA ENERGY &"                 ← SYMBOL\tCOMPANY_START
 *   Line i+2: "MOBILITY LIMITED\t1.00\t37\t839.40\t31,057.80"  ← COMPANY_END\tNUMBERS
 * OR (single-line company):
 *   Line i+1: "BAJAJ-AUTO.NSE\tBAJAJ AUTO LIMITED\t10.00\t3\t9,597.50\t28,792.50"
 */

function parseNSDLCAS(text) {
  const holdings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    // NSDL: ISIN on its own line
    if (!/^INE[A-Z0-9]{9}$/.test(lines[i])) continue;

    const isin = lines[i];
    const line1 = lines[i + 1] || ''; // symbol + company start + maybe numbers
    const line2 = lines[i + 2] || ''; // company end + numbers (if company wrapped)

    // Extract symbol (before first tab)
    const parts1 = line1.split('\t');
    const symbol = parts1[0].replace(/\.(NSE|BSE)$/, '').trim();

    // All tab-separated parts across line1 + line2
    const allParts = [...parts1, ...line2.split('\t')].map(p => p.trim()).filter(Boolean);

    // Extract numbers: face_value, quantity, market_price, total_value
    const numbers = allParts
      .map(p => parseFloat(p.replace(/,/g, '')))
      .filter(n => !isNaN(n) && n > 0);

    // Company name: everything between symbol and first number
    let company = '';
    for (let pi = 1; pi < allParts.length; pi++) {
      const p = allParts[pi];
      if (!isNaN(parseFloat(p.replace(/,/g, '')))) break; // hit numbers
      company += (company ? ' ' : '') + p;
    }
    company = company.replace(/\s+/g, ' ').trim();

    // Identify quantity: skip first small integer (face value), then first integer is quantity
    let quantity = null, marketValue = null;
    let faceValueSkipped = false;

    for (const n of numbers) {
      // Skip face value (first small integer: 1, 2, 5, 10)
      if (!faceValueSkipped && n <= 10 && Number.isInteger(n)) {
        faceValueSkipped = true;
        continue;
      }
      // Quantity: first integer after face value
      if (Number.isInteger(n) && n >= 1 && n <= 999999 && quantity === null) {
        quantity = n;
        continue;
      }
      // Market value: largest decimal
      if (n > 100) marketValue = n;
    }

    if (quantity && quantity > 0) {
      holdings.push({
        isin,
        symbol:      symbol || cleanSymbol(company),
        company:     company || isin,
        quantity,
        marketValue: marketValue || null,
        source:      'NSDL CAS'
      });
    }
  }

  return dedupHoldings(holdings);
}

function parseCDSLCAS(text) {
  const holdings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const isinMatch = lines[i].match(/\b(INE[A-Z0-9]{9})\b/);
    if (!isinMatch) continue;

    const isin = isinMatch[1];
    const context = lines.slice(i, Math.min(lines.length, i + 4)).join('\t');
    const parts = context.split('\t').map(p => p.trim());

    const numbers = parts
      .map(p => parseFloat(p.replace(/,/g, '')))
      .filter(n => !isNaN(n) && n > 0);

    const isinDigits = isin.match(/\d+/g)?.map(Number) || [];
    let quantity = null, marketValue = null;
    for (const n of numbers) {
      if (isinDigits.includes(n)) continue;
      if (n <= 10 && Number.isInteger(n)) continue;
      if (Number.isInteger(n) && n >= 1 && n <= 999999 && quantity === null) { quantity = n; continue; }
      if (n > 100) marketValue = n;
    }

    let company = '';
    for (const p of parts) {
      if (p === isin) continue;
      if (!isNaN(parseFloat(p.replace(/,/g, '')))) continue;
      if (/[A-Z]{2,}/.test(p)) { company += (company ? ' ' : '') + p; }
    }

    if (quantity) {
      holdings.push({ isin, symbol: cleanSymbol(company), company: company.trim() || isin, quantity, marketValue: marketValue || null, source: 'CDSL CAS' });
    }
  }

  return dedupHoldings(holdings);
}

function cleanSymbol(name) {
  if (!name) return null;
  return name.toUpperCase()
    .replace(/\s+LIMITED$/i,'').replace(/\s+LTD\.?$/i,'')
    .replace(/\s+INDUSTRIES?$/i,'').replace(/\s+CORPORATION$/i,'')
    .replace(/[^A-Z0-9]/g,'').slice(0, 15);
}

function detectCASType(text) {
  if (!text) return 'UNKNOWN';
  if (/CDSL|Central Depository Services/i.test(text)) return 'CDSL';
  if (/NSDL|National Securities Depository/i.test(text)) return 'NSDL';
  if (/Equities\s*\(E\)|DP ID.*IN3/i.test(text)) return 'NSDL';
  return 'UNKNOWN';
}

function parseCASummary(text) {
  const summary = {};
  const total = text.match(/TOTAL\s+([\d,]+\.?\d*)/i);
  if (total) summary.totalValue = parseFloat(total[1].replace(/,/g,''));
  const date = text.match(/(?:as\s+on|Statement|Date)[:\s]+(\d{1,2}[\-\/]\w+[\-\/]\d{2,4})/i);
  if (date) summary.statementDate = date[1];
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
  let holdings  = parseNSDLCAS(text);
  if (holdings.length === 0) holdings = parseCDSLCAS(text);
  return { type, holdings, summary };
}

module.exports = { parseCAS, parseCDSLCAS, parseNSDLCAS, detectCASType };
