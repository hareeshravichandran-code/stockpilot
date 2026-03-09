/**
 * StockPilot CAS Parser — NSDL & CDSL
 * Actual format from pdf-parse:
 * INE885A01032 ARE&M.NSE   AMARA RAJA ENERGY & MOBILITY LIMITED   1.00   37   951.90   35,220.30
 * INE917I01010 BAJAJ-AUTO.NSE   BAJAJ AUTO LIMITED   10.00   3   9,073.50   27,220.50
 */

function parseNSDLCAS(text) {
  const holdings = [];
  const seen = new Set();

  // Match: ISIN SYMBOL.NSE/BSE   COMPANY NAME   FaceVal   Qty   Price   Value
  // All on one line
  const lineRegex = /(INE[A-Z0-9]{9})\s+([A-Z0-9&\-]+\.(NSE|BSE))\s+(.+?)\s+([\d]+\.[\d]+)\s+([\d,]+)\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)/g;
  let match;

  while ((match = lineRegex.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;

    const symbol = match[2].split('.')[0];
    const company = match[4].trim();
    const qty = parseInt(match[6].replace(/,/g, ''));
    const price = parseFloat(match[7].replace(/,/g, ''));

    if (qty > 0 && price > 0) {
      seen.add(isin);
      holdings.push({ isin, symbol, company, quantity: qty, market_price: price, cas_source: 'NSDL' });
    }
  }

  // Fallback: simpler pattern — just ISIN followed by numbers somewhere nearby
  if (holdings.length === 0) {
    const simpleRegex = /(INE[A-Z0-9]{9})[\s\S]{0,200}?([\d,]+\.[\d]{2})\s+([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/g;
    while ((match = simpleRegex.exec(text)) !== null) {
      const isin = match[1];
      if (seen.has(isin)) continue;
      const qty = parseInt(match[3].replace(/,/g, ''));
      const price = parseFloat(match[4].replace(/,/g, ''));
      if (qty > 0 && price > 0) {
        seen.add(isin);
        holdings.push({ isin, symbol: isin, company: isin, quantity: qty, market_price: price, cas_source: 'NSDL' });
      }
    }
  }

  return holdings;
}

function parseCDSLCAS(text) {
  const holdings = [];
  const seen = new Set();
  const isinRegex = /\b(INE[A-Z0-9]{9})\b/g;
  let match;

  while ((match = isinRegex.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    const after = text.slice(match.index + isin.length, match.index + isin.length + 300);
    const numMatch = after.match(/([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/);
    if (numMatch) {
      const qty = parseInt(numMatch[1].replace(/,/g, ''));
      const price = parseFloat(numMatch[2].replace(/,/g, ''));
      if (qty > 0 && price > 0) {
        seen.add(isin);
        holdings.push({ isin, symbol: isin, company: isin, quantity: qty, market_price: price, cas_source: 'CDSL' });
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
  const type = detectCASType(text);
  const summary = parseCASummary(text);
  let holdings = parseNSDLCAS(text);
  if (holdings.length === 0) holdings = parseCDSLCAS(text);
  console.log(JSON.stringify({ event: 'CAS_PARSE_RESULT', type, holdingsFound: holdings.length, sample: holdings.slice(0,2).map(h=>h.isin+':'+h.quantity) }));
  return { type, holdings: dedupHoldings(holdings), summary };
}

module.exports = { parseCAS, parseCDSLCAS, parseNSDLCAS, detectCASType };
