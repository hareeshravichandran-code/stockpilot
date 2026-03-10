const axios = require('axios');

// ── Yahoo v7 — no crumb needed, more reliable on Railway ─────────────
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

// ── Map broker/CAS symbols → Yahoo .NS symbols ────────────────────────
const SYMBOL_MAP = {
  // Broker short codes from CAS
  'AMARAJ':   'AMARAJABAT.NS', 'EXIIND':  'EXIDEIND.NS',
  'MOTSUM':   'MOTHERSON.NS',  'BAAUTO':  'BAJAJ-AUTO.NS',
  'EICMOT':   'EICHERMOT.NS',  'HERHON':  'HEROMOTOCO.NS',
  'HYUMOT':   'HYUNDAI.NS',    'TATCOV':  'TATAMOTORS.NS',
  'TATMOT':   'TATAMTRDVR.NS', 'EQUSMA':  'EQUITASBNK.NS',
  'HDFBAN':   'HDFCBANK.NS',   'TAMMER':  'TMB.NS',
  'CASIND':   'CASTROLIND.NS', 'VEDFAS':  'MANYAVAR.NS',
  'BANBEE':   'BANKBEES.NS',   'HINLEV':  'HINDUNILVR.NS',
  'BAJFI':    'BAJFINANCE.NS', 'HDFAMC':  'HDFCAMC.NS',
  'POWINF':   'POWERGRIDINVIT.NS', 'HCLTEC': 'HCLTECH.NS',
  'INFTEC':   'INFY.NS',       'CADHEA':  'ZYDUSLIFE.NS',
  'DRREDD':   'DRREDDY.NS',
  // Full NSE symbols (already correct, just append .NS)
  'HDFCBANK':'HDFCBANK.NS', 'TMB':'TMB.NS',
  'ICICIBANK':'ICICIBANK.NS', 'AXISBANK':'AXISBANK.NS',
  'SBIN':'SBIN.NS', 'BAJAJ-AUTO':'BAJAJ-AUTO.NS',
  'BAJFINANCE':'BAJFINANCE.NS', 'BAJAJFINSV':'BAJAJFINSV.NS',
  'HINDUNILVR':'HINDUNILVR.NS', 'AMARAJABAT':'AMARAJABAT.NS',
  'EQUITASBNK':'EQUITASBNK.NS', 'BANKBEES':'BANKBEES.NS',
  'CASTROLIND':'CASTROLIND.NS', 'MANYAVAR':'MANYAVAR.NS',
  'HDFCAMC':'HDFCAMC.NS', 'HCLTECH':'HCLTECH.NS',
  'INFY':'INFY.NS', 'TCS':'TCS.NS', 'WIPRO':'WIPRO.NS',
  'ZYDUSLIFE':'ZYDUSLIFE.NS', 'DRREDDY':'DRREDDY.NS',
  'CIPLA':'CIPLA.NS', 'ITC':'ITC.NS', 'COLPAL':'COLPAL.NS',
  'EICHERMOT':'EICHERMOT.NS', 'HEROMOTOCO':'HEROMOTOCO.NS',
  'HYUNDAI':'HYUNDAI.NS', 'TATAMOTORS':'TATAMOTORS.NS',
  'MOTHERSON':'MOTHERSON.NS', 'EXIDEIND':'EXIDEIND.NS',
  'POWERGRID':'POWERGRID.NS', 'RELIANCE':'RELIANCE.NS',
  'TATASTEEL':'TATASTEEL.NS', 'GRASIM':'GRASIM.NS',
  'BPCL':'BPCL.NS', 'COFORGE':'COFORGE.NS',
};

function toYahooSymbol(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol];
  // Already has .NS or .BO suffix
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return symbol;
  return `${symbol}.NS`;
}

// ── Yahoo v7 quote — no crumb, no cookie needed ────────────────────
async function getYahooPrice(yahooSymbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume`;
    const res = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 8000 });
    const q = res.data?.quoteResponse?.result?.[0];
    if (!q || !q.regularMarketPrice) return null;
    return {
      price:         q.regularMarketPrice,
      change:        parseFloat((q.regularMarketChange || 0).toFixed(2)),
      changePct:     parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
      previousClose: q.regularMarketPreviousClose,
      high:          q.regularMarketDayHigh,
      low:           q.regularMarketDayLow,
      volume:        q.regularMarketVolume,
      source: 'Yahoo'
    };
  } catch(e) {
    return null;
  }
}

// ── Yahoo v7 bulk — fetch up to 20 symbols in one call ───────────────
async function getYahooPricesBulk(yahooSymbols) {
  try {
    const joined = yahooSymbols.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume`;
    const res = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 12000 });
    const results = res.data?.quoteResponse?.result || [];
    const map = {};
    for (const q of results) {
      if (q.regularMarketPrice) {
        map[q.symbol] = {
          price:         q.regularMarketPrice,
          change:        parseFloat((q.regularMarketChange || 0).toFixed(2)),
          changePct:     parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
          previousClose: q.regularMarketPreviousClose,
          high:          q.regularMarketDayHigh,
          low:           q.regularMarketDayLow,
          source: 'Yahoo'
        };
      }
    }
    return map;
  } catch(e) {
    console.warn('Yahoo bulk failed:', e.message);
    return {};
  }
}

// ── NSE direct fallback ───────────────────────────────────────────────
const { nseGet } = require('./nseClient');
async function getNSEPrice(nseSymbol) {
  try {
    const data = await nseGet(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`);
    const q = data?.priceInfo;
    if (!q?.lastPrice) return null;
    return {
      price:         q.lastPrice,
      change:        q.change,
      changePct:     parseFloat((q.pChange || 0).toFixed(2)),
      previousClose: q.previousClose,
      high:          q.intraDayHighLow?.max,
      low:           q.intraDayHighLow?.min,
      sector:        data?.metadata?.industry || null,
      source: 'NSE'
    };
  } catch(e) { return null; }
}

// ── Sector from Yahoo quoteSummary ────────────────────────────────────
async function getSectorFromYahoo(yahooSymbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${yahooSymbol}?modules=assetProfile`;
    const res = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 8000 });
    return res.data?.quoteSummary?.result?.[0]?.assetProfile?.sector || null;
  } catch(e) { return null; }
}

// ── Single price with NSE fallback ────────────────────────────────────
async function getPrice(symbol) {
  const yahooSym = toYahooSymbol(symbol);
  const nseSym   = yahooSym.replace('.NS','').replace('.BO','');

  const yahoo = await getYahooPrice(yahooSym);
  if (yahoo) return { symbol, yahooSymbol: yahooSym, ...yahoo };

  console.warn(`Yahoo failed for ${symbol} (${yahooSym}) — trying NSE`);
  const nse = await getNSEPrice(nseSym);
  if (nse) return { symbol, yahooSymbol: yahooSym, ...nse };

  console.error(`All price sources failed for ${symbol}`);
  return null;
}

// ── Bulk prices — batches of 20 via Yahoo v7, fallback per-stock ──────
async function getPrices(symbols) {
  const prices = {};

  // Batch into groups of 20
  for (let i = 0; i < symbols.length; i += 20) {
    const batch  = symbols.slice(i, i + 20);
    const yahoos = batch.map(toYahooSymbol);
    const bulk   = await getYahooPricesBulk(yahoos);

    for (let j = 0; j < batch.length; j++) {
      const sym      = batch[j];
      const yahooSym = yahoos[j];
      if (bulk[yahooSym]) {
        prices[sym] = { symbol: sym, yahooSymbol: yahooSym, ...bulk[yahooSym] };
      } else {
        // Individual fallback for this symbol
        const single = await getPrice(sym);
        if (single) prices[sym] = single;
      }
    }
    // Brief pause between batches
    if (i + 20 < symbols.length) await new Promise(r => setTimeout(r, 300));
  }

  return prices;
}

module.exports = { getPrice, getPrices, getSectorFromYahoo, SYMBOL_MAP, toYahooSymbol };
