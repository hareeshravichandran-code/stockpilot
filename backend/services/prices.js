const axios = require('axios');

// Map your broker symbols to Yahoo Finance symbols (NSE)
const SYMBOL_MAP = {
  'AMARAJ': 'AMARAJABAT.NS',
  'EXIIND': 'EXIDEIND.NS',
  'MOTSUM': 'MOTHERSON.NS',
  'BAAUTO': 'BAJAJ-AUTO.NS',
  'EICMOT': 'EICHERMOT.NS',
  'HERHON': 'HEROMOTOCO.NS',
  'HYUMOT': 'HYUNDAI.NS',
  'TATCOV': 'TATAMOTORS.NS',
  'TATMOT': 'TATAMTRDVR.NS',
  'EQUSMA': 'EQUITASBNK.NS',
  'HDFBAN': 'HDFCBANK.NS',
  'TAMMER': 'TMB.NS',
  'CASIND': 'CASTROLIND.NS',
  'VEDFAS': 'MANYAVAR.NS',
  'BANBEE': 'BANKBEES.NS',
  'COLPAL': 'COLPAL.NS',
  'HINLEV': 'HINDUNILVR.NS',
  'BAJFI': 'BAJFINANCE.NS',
  'HDFAMC': 'HDFCAMC.NS',
  'POWINF': 'POWERGRIDINVIT.NS',
  'HCLTEC': 'HCLTECH.NS',
  'INFTEC': 'INFY.NS',
  'TCS': 'TCS.NS',
  'WIPRO': 'WIPRO.NS',
  'CADHEA': 'ZYDUSLIFE.NS',
  'CIPLA': 'CIPLA.NS',
  'DRREDD': 'DRREDDY.NS',
  'ITC': 'ITC.NS'
};

async function getPrice(symbol) {
  const yahooSymbol = SYMBOL_MAP[symbol] || `${symbol}.NS`;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    return {
      symbol,
      price: meta.regularMarketPrice,
      change: meta.regularMarketPrice - meta.previousClose,
      changePct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
      previousClose: meta.previousClose,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      timestamp: new Date(meta.regularMarketTime * 1000).toISOString()
    };
  } catch (err) {
    console.error(`Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

async function getPrices(symbols) {
  const results = await Promise.allSettled(symbols.map(s => getPrice(s)));
  const prices = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      prices[symbols[i]] = r.value;
    }
  });
  return prices;
}

module.exports = { getPrice, getPrices, SYMBOL_MAP };
