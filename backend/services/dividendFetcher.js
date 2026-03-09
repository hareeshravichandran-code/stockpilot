/**
 * Fetches dividend data from NSE and calculates per-user dividend income
 */
const { nseGet } = require('./nseClient');

// Parse dividend amount from NSE purpose string
// e.g. "Interim Dividend - Rs 7.50 Per Share" → 7.50
// "Final Dividend - Re 1/- Per Share" → 1.00
// "Special Dividend Rs.5 Per Share" → 5.00
function parseDividendAmount(purpose) {
  if (!purpose) return null;
  // Match Rs/Re followed by number
  const match = purpose.match(/(?:Rs\.?|Re\.?|INR)\s*([\d,]+(?:\.\d+)?)/i);
  if (match) return parseFloat(match[1].replace(/,/g, ''));
  // Match number/- pattern like "Re 1/-"
  const match2 = purpose.match(/([\d,]+(?:\.\d+)?)\s*\/-/);
  if (match2) return parseFloat(match2[1].replace(/,/g, ''));
  return null;
}

// Determine dividend type from purpose string
function getDividendType(purpose) {
  const p = purpose.toLowerCase();
  if (p.includes('interim')) return 'Interim';
  if (p.includes('final')) return 'Final';
  if (p.includes('special')) return 'Special';
  if (p.includes('annual')) return 'Annual';
  return 'Dividend';
}

// Fetch all dividends from NSE for a given date range
async function fetchNSEDividends(fromDate, toDate) {
  try {
    const url = `https://www.nseindia.com/api/corporate-actions?index=equities&from_date=${fromDate}&to_date=${toDate}`;
    const data = await nseGet(url);
    if (!data?.data) return [];

    const dividends = [];
    for (const item of data.data) {
      const purpose = item.purpose || '';
      if (!purpose.toLowerCase().includes('dividend')) continue;

      const amount = parseDividendAmount(purpose);
      dividends.push({
        symbol: item.symbol,
        company: item.companyName || item.symbol,
        isin: item.isin || null,
        ex_date: item.exDate || null,
        record_date: item.recordDate || null,
        board_meeting_date: item.boardMeetingDate || null,
        purpose: purpose,
        dividend_type: getDividendType(purpose),
        dividend_per_share: amount,
      });
    }
    return dividends;
  } catch (err) {
    console.error('NSE dividend fetch error:', err.message);
    return [];
  }
}

// Fetch dividends for all financial years from FY2020 onwards
async function fetchAllDividends() {
  const ranges = [
    { from: '01-04-2020', to: '31-03-2021', fy: 'FY2021' },
    { from: '01-04-2021', to: '31-03-2022', fy: 'FY2022' },
    { from: '01-04-2022', to: '31-03-2023', fy: 'FY2023' },
    { from: '01-04-2023', to: '31-03-2024', fy: 'FY2024' },
    { from: '01-04-2024', to: '31-03-2025', fy: 'FY2025' },
    { from: '01-04-2025', to: '31-03-2026', fy: 'FY2026' },
  ];

  const all = [];
  for (const r of ranges) {
    const divs = await fetchNSEDividends(r.from, r.to);
    divs.forEach(d => { d.fy = r.fy; });
    all.push(...divs);
    await new Promise(res => setTimeout(res, 500)); // rate limit
  }
  return all;
}

// Calculate user's dividend income by matching holdings
function calculateUserDividends(allDividends, holdings) {
  const holdingMap = {};
  for (const h of holdings) {
    holdingMap[h.symbol?.toUpperCase()] = h;
    if (h.isin) holdingMap[h.isin] = h;
  }

  const income = [];
  for (const div of allDividends) {
    if (!div.dividend_per_share) continue;
    const holding = holdingMap[div.symbol?.toUpperCase()] || holdingMap[div.isin];
    if (!holding) continue;

    income.push({
      ...div,
      quantity: holding.quantity,
      total_dividend: parseFloat((holding.quantity * div.dividend_per_share).toFixed(2)),
      company: holding.company || div.company,
    });
  }

  // Sort by ex_date descending
  income.sort((a, b) => new Date(b.ex_date) - new Date(a.ex_date));
  return income;
}

module.exports = { fetchNSEDividends, fetchAllDividends, calculateUserDividends, parseDividendAmount };
