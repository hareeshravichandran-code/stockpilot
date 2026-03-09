/**
 * Fetches dividend history from Yahoo Finance for NSE stocks
 * Uses direct HTTP like prices.js — no extra npm package needed
 */
const axios = require('axios');

function toYahooSymbol(symbol) {
  return symbol.toUpperCase()
    .replace('.NSE','').replace('.BSE','')
    .trim() + '.NS';
}

function getFY(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  return month >= 4 ? `FY${year + 1}` : `FY${year}`;
}

async function fetchStockDividends(symbol, isin, company) {
  const yahooSym = toYahooSymbol(symbol);
  try {
    const from = Math.floor(new Date('2020-04-01').getTime() / 1000);
    const to = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?period1=${from}&period2=${to}&interval=1d&events=div`;
    
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const events = resp.data?.chart?.result?.[0]?.events?.dividends;
    if (!events) return [];

    return Object.values(events).map(d => ({
      symbol: symbol.replace('.NSE','').replace('.BSE',''),
      isin,
      company,
      ex_date: new Date(d.date * 1000).toISOString().slice(0, 10),
      dividend_per_share: parseFloat(d.amount.toFixed(2)),
      dividend_type: 'Dividend',
      fy: getFY(new Date(d.date * 1000)),
      source: 'Yahoo Finance',
    }));
  } catch (e) {
    return [];
  }
}

async function fetchAllDividends(holdings) {
  const results = [];
  for (const h of holdings) {
    if (!h.symbol || h.symbol === h.isin) continue;
    const divs = await fetchStockDividends(h.symbol, h.isin, h.company);
    divs.forEach(d => {
      d.quantity = h.quantity;
      d.total_dividend = parseFloat((h.quantity * d.dividend_per_share).toFixed(2));
    });
    results.push(...divs);
    await new Promise(r => setTimeout(r, 80));
  }
  results.sort((a, b) => new Date(b.ex_date) - new Date(a.ex_date));
  return results;
}

module.exports = { fetchAllDividends };
