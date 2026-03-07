/**
 * StockPilot Email Parser
 * Parses broker emails from Zerodha, Groww, Angel One, Upstox,
 * CDSL/NSDL statements, and dividend credit alerts.
 */

// ── Broker email patterns ──
const PATTERNS = {
  // Zerodha contract note
  zerodha: {
    from: ['no-reply@zerodha.com', 'support@zerodha.com'],
    subject: /contract note|trade confirmation/i,
    parseTrade: (text) => {
      const trades = [];
      // Pattern: BUY/SELL SYMBOL QTY @ PRICE
      const regex = /(BUY|SELL)\s+([A-Z]+)\s+(\d+)\s+(?:shares?\s+)?(?:@|at)\s+Rs\.?\s*([\d,]+\.?\d*)/gi;
      let match;
      while ((match = regex.exec(text)) !== null) {
        trades.push({
          type: match[1].toUpperCase(),
          symbol: match[2],
          quantity: parseInt(match[3].replace(/,/g, '')),
          price: parseFloat(match[4].replace(/,/g, '')),
          broker: 'Zerodha'
        });
      }
      return trades;
    }
  },

  // Groww contract note
  groww: {
    from: ['noreply@groww.in', 'support@groww.in'],
    subject: /contract note|trade confirmation|order executed/i,
    parseTrade: (text) => {
      const trades = [];
      const regex = /(BUY|SELL)\s+([A-Z\s]+?)\s+(\d+)\s+(?:unit|share)s?\s+(?:at|@)\s+₹?([\d,]+\.?\d*)/gi;
      let match;
      while ((match = regex.exec(text)) !== null) {
        trades.push({
          type: match[1].toUpperCase(),
          symbol: match[2].trim(),
          quantity: parseInt(match[3].replace(/,/g, '')),
          price: parseFloat(match[4].replace(/,/g, '')),
          broker: 'Groww'
        });
      }
      return trades;
    }
  },

  // Angel One
  angelone: {
    from: ['noreply@angelbroking.com', 'support@angelone.in'],
    subject: /contract note|trade confirmation/i,
    parseTrade: (text) => {
      const trades = [];
      const regex = /(BUY|SELL)\s+([A-Z]+(?:-[A-Z]+)?)\s+(\d+)\s+[\d,]+\.?\d*\s+([\d,]+\.?\d*)/gi;
      let match;
      while ((match = regex.exec(text)) !== null) {
        trades.push({
          type: match[1].toUpperCase(),
          symbol: match[2],
          quantity: parseInt(match[3].replace(/,/g, '')),
          price: parseFloat(match[4].replace(/,/g, '')),
          broker: 'Angel One'
        });
      }
      return trades;
    }
  },

  // Upstox
  upstox: {
    from: ['noreply@upstox.com', 'support@upstox.com'],
    subject: /contract note|trade confirmation/i,
    parseTrade: (text) => {
      const trades = [];
      const regex = /(BUY|SELL)\s+([A-Z]+)\s+Qty[:\s]+(\d+)\s+Price[:\s]+Rs\.?\s*([\d,]+\.?\d*)/gi;
      let match;
      while ((match = regex.exec(text)) !== null) {
        trades.push({
          type: match[1].toUpperCase(),
          symbol: match[2],
          quantity: parseInt(match[3].replace(/,/g, '')),
          price: parseFloat(match[4].replace(/,/g, '')),
          broker: 'Upstox'
        });
      }
      return trades;
    }
  }
};

// ── Dividend alert parser ──
function parseDividendEmail(subject, body, from) {
  const dividends = [];

  // CDSL/NSDL dividend credit alerts
  // "Dividend credited for HDFC Bank - Rs 27 per share for 226 shares"
  const cdslPattern = /dividend.*?(?:for|of|from)\s+([A-Z\s&]+?)\s*[-–]\s*(?:Rs\.?|₹)\s*([\d,]+\.?\d*)\s*per\s*share.*?(\d+)\s*shares?/gi;
  let match;
  while ((match = cdslPattern.exec(body)) !== null) {
    dividends.push({
      company: match[1].trim(),
      dividendPerShare: parseFloat(match[2].replace(/,/g, '')),
      quantity: parseInt(match[3].replace(/,/g, '')),
      totalAmount: parseFloat(match[2].replace(/,/g, '')) * parseInt(match[3].replace(/,/g, '')),
      source: 'CDSL/NSDL'
    });
  }

  // Bank credit SMS / email: "Dividend of Rs 6102 credited from HDFC Bank"
  const bankPattern = /dividend\s+(?:of\s+)?(?:Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:has been\s+)?credited\s+(?:from|by|for)\s+([A-Z\s&]+?)(?:\.|,|$)/gi;
  while ((match = bankPattern.exec(body)) !== null) {
    dividends.push({
      company: match[2].trim(),
      totalAmount: parseFloat(match[1].replace(/,/g, '')),
      source: 'Bank Credit'
    });
  }

  return dividends;
}

// ── CDSL holding statement parser ──
function parseCDSLStatement(body) {
  const holdings = [];
  // Pattern in CDSL statements: ISIN, Company, Quantity
  const lines = body.split('\n');
  const isinPattern = /INE[A-Z0-9]{9}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isinMatch = line.match(isinPattern);
    if (isinMatch) {
      const parts = line.split(/\s{2,}|\t/);
      if (parts.length >= 3) {
        const qty = parts.find(p => /^\d+$/.test(p.trim()));
        holdings.push({
          isin: isinMatch[0],
          company: parts[1]?.trim(),
          quantity: qty ? parseInt(qty) : null,
          source: 'CDSL Statement'
        });
      }
    }
  }
  return holdings;
}

// ── Main parser function ──
function parseEmail({ subject, body, from, date }) {
  const result = {
    date: date || new Date().toISOString(),
    type: null,
    data: []
  };

  const subjectLower = subject?.toLowerCase() || '';
  const bodyText = body || '';
  const fromLower = from?.toLowerCase() || '';

  // Detect email type
  if (/dividend/i.test(subjectLower) || /dividend/i.test(bodyText.slice(0, 500))) {
    result.type = 'DIVIDEND';
    result.data = parseDividendEmail(subject, bodyText, from);
  } else if (/contract note|trade confirmation|order executed/i.test(subjectLower)) {
    result.type = 'TRADE';
    // Try each broker parser
    for (const [broker, config] of Object.entries(PATTERNS)) {
      if (config.from.some(f => fromLower.includes(f.toLowerCase())) ||
          config.subject.test(subjectLower)) {
        result.broker = broker;
        result.data = config.parseTrade(bodyText);
        if (result.data.length > 0) break;
      }
    }
    // Generic fallback
    if (result.data.length === 0) {
      result.data = PATTERNS.zerodha.parseTrade(bodyText);
    }
  } else if (/cdsl|nsdl|demat|holding statement/i.test(subjectLower)) {
    result.type = 'STATEMENT';
    result.data = parseCDSLStatement(bodyText);
  } else if (/corporate action|bonus|split|rights/i.test(subjectLower)) {
    result.type = 'CORPORATE_ACTION';
    result.data = [{ raw: subject, body: bodyText.slice(0, 500) }];
  }

  return result;
}

module.exports = { parseEmail, parseDividendEmail, parseCDSLStatement };
