const axios = require('axios');

// ── Yahoo crumb/cookie cache ──────────────────────────────────────────
let _yahooCookie = null;
let _yahooCrumb  = null;
let _yahooExpiry = 0;

async function getYahooCreds() {
  if (_yahooCrumb && Date.now() < _yahooExpiry) return { cookie: _yahooCookie, crumb: _yahooCrumb };
  try {
    const r1 = await axios.get('https://fc.yahoo.com', { timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    _yahooCookie = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const r2 = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', { timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: _yahooCookie }
    });
    _yahooCrumb  = r2.data;
    _yahooExpiry = Date.now() + 50 * 60 * 1000; // 50 min
  } catch(e) {
    _yahooCrumb = ''; // will retry next call
  }
  return { cookie: _yahooCookie, crumb: _yahooCrumb };
}

// ── NSE direct price fetch (more reliable from Railway) ─────────────
const { nseGet } = require('./nseClient');

async function getNSEPrice(nseSymbol) {
  try {
    const data = await nseGet(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`);
    const q = data?.priceInfo;
    if (!q) return null;
    return {
      price: q.lastPrice,
      change: q.change,
      changePct: q.pChange?.toFixed(2),
      previousClose: q.previousClose,
      high: q.intraDayHighLow?.max,
      low: q.intraDayHighLow?.min,
      sector: data?.metadata?.industry || null,
      source: 'NSE'
    };
  } catch(e) {
    return null;
  }
}

// ── Sector fetch from Yahoo quoteSummary ─────────────────────────────
async function getSectorFromYahoo(yahooSymbol) {
  try {
    const { cookie, crumb } = await getYahooCreds();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${yahooSymbol}?modules=assetProfile${crumb ? '&crumb=' + crumb : ''}`;
    const res = await axios.get(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Cookie: cookie || '' }
    });
    return res.data?.quoteSummary?.result?.[0]?.assetProfile?.sector || null;
  } catch(e) { return null; }
}

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
  const nseSymbol   = yahooSymbol.replace('.NS', '');

  // ── Try Yahoo with crumb ──────────────────────────────────────────
  try {
    const { cookie, crumb } = await getYahooCreds();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d${crumb ? '&crumb=' + crumb : ''}`;
    const res = await axios.get(url, {
      timeout: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        Cookie: cookie || ''
      }
    });
    const result = res.data?.chart?.result?.[0];
    if (result?.meta?.regularMarketPrice) {
      const meta = result.meta;
      return {
        symbol, yahooSymbol,
        price: meta.regularMarketPrice,
        change: meta.regularMarketPrice - meta.previousClose,
        changePct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
        previousClose: meta.previousClose,
        high: meta.regularMarketDayHigh,
        low: meta.regularMarketDayLow,
        volume: meta.regularMarketVolume,
        timestamp: new Date(meta.regularMarketTime * 1000).toISOString(),
        source: 'Yahoo'
      };
    }
  } catch (err) {
    console.warn(`Yahoo failed for ${symbol}: ${err.message} — trying NSE`);
  }

  // ── Fallback: NSE direct ──────────────────────────────────────────
  const nse = await getNSEPrice(nseSymbol);
  if (nse) return { symbol, yahooSymbol, ...nse };

  console.error(`All price sources failed for ${symbol}`);
  return null;
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

module.exports = { getPrice, getPrices, getSectorFromYahoo, SYMBOL_MAP };
