/**
 * StockPilot Price Service
 *
 * PROOF: Yahoo v8/finance/chart works from Railway — dividendFetcher.js
 * uses the exact same host (query1.finance.yahoo.com) and it successfully
 * fetches dividends. The previous price attempts failed because they used
 * crumb+cookie auth which Railway blocks. Plain User-Agent works fine.
 *
 * LAYERS:
 *   1. Yahoo Finance v8/chart  — PROVEN to work from Railway, no crumb needed
 *   2. DB cache (fresh)        — < 15 min during market, < 6 hrs off-market  
 *   3. Stooq CSV               — free, unlimited, no key
 *   4. Twelve Data             — free 800/day (optional key)
 *   5. Stale DB cache          — last known price, never blank
 */

const axios = require('axios');

// ── Exact headers that work — same as dividendFetcher.js ──────────────
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const YAHOO_TIMEOUT = 10000;

// ── Symbol maps ────────────────────────────────────────────────────────
const SYMBOL_MAP = {
  'AMARAJ':'AMARAJABAT', 'EXIIND':'EXIDEIND',  'MOTSUM':'MOTHERSON',
  'BAAUTO':'BAJAJ-AUTO', 'EICMOT':'EICHERMOT', 'HERHON':'HEROMOTOCO',
  'HYUMOT':'HYUNDAI',    'TATCOV':'TATAMOTORS', 'TATMOT':'TATAMTRDVR',
  'EQUSMA':'EQUITASBNK', 'HDFBAN':'HDFCBANK',  'TAMMER':'TMB',
  'CASIND':'CASTROLIND', 'VEDFAS':'MANYAVAR',  'BANBEE':'BANKBEES',
  'HINLEV':'HINDUNILVR', 'BAJFI':'BAJFINANCE', 'HDFAMC':'HDFCAMC',
  'POWINF':'POWERGRIDINVIT','HCLTEC':'HCLTECH','INFTEC':'INFY',
  'CADHEA':'ZYDUSLIFE',  'DRREDD':'DRREDDY',
  // Strip .NSE / .BSE from NSDL CAS symbols
  'HDFCBANK.NSE':'HDFCBANK', 'TMB.NSE':'TMB',       'TCS.NSE':'TCS',
  'INFY.NSE':'INFY',         'RELIANCE.NSE':'RELIANCE','ICICIBANK.NSE':'ICICIBANK',
  'AXISBANK.NSE':'AXISBANK', 'BAJAJ-AUTO.NSE':'BAJAJ-AUTO',
  'BAJFINANCE.NSE':'BAJFINANCE','HINDUNILVR.NSE':'HINDUNILVR',
  'ITC.NSE':'ITC',           'WIPRO.NSE':'WIPRO',   'HCLTECH.NSE':'HCLTECH',
  'CIPLA.NSE':'CIPLA',       'DRREDDY.NSE':'DRREDDY','COLPAL.NSE':'COLPAL',
  'EICHERMOT.NSE':'EICHERMOT','HEROMOTOCO.NSE':'HEROMOTOCO',
  'TATAMOTORS.NSE':'TATAMOTORS','EXIDEIND.NSE':'EXIDEIND',
  'MOTHERSON.NSE':'MOTHERSON','POWERGRID.NSE':'POWERGRID',
};

function toNSE(symbol) {
  if (!symbol) return '';
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol];
  return symbol.replace(/\.(NSE|BSE|NS|BO)$/i, '');
}

function toYahooNS(symbol) {
  return toNSE(symbol) + '.NS';
}

// ── Static sector map ──────────────────────────────────────────────────
const SECTOR_MAP = {
  'HDFCBANK':'Banking',   'ICICIBANK':'Banking',  'AXISBANK':'Banking',
  'SBIN':'Banking',       'TMB':'Banking',         'EQUITASBNK':'Banking',
  'BANKBEES':'Banking',   'KOTAKBANK':'Banking',   'INDUSINDBK':'Banking',
  'FEDERALBNK':'Banking', 'CANBANK':'Banking',
  'TCS':'IT',             'INFY':'IT',             'WIPRO':'IT',
  'HCLTECH':'IT',         'COFORGE':'IT',          'TECHM':'IT',
  'RELIANCE':'Oil & Gas', 'BPCL':'Oil & Gas',      'CASTROLIND':'Oil & Gas',
  'BAJAJ-AUTO':'Auto',    'EICHERMOT':'Auto',      'HEROMOTOCO':'Auto',
  'TATAMOTORS':'Auto',    'MOTHERSON':'Auto',       'HYUNDAI':'Auto',
  'EXIDEIND':'Auto',      'AMARAJABAT':'Auto',
  'HDFCAMC':'Finance',    'BAJFINANCE':'Finance',  'BAJAJFINSV':'Finance',
  'HINDUNILVR':'FMCG',    'ITC':'FMCG',            'COLPAL':'FMCG',
  'TATACONSUMER':'FMCG',  'MANYAVAR':'FMCG',       'NESTLEIND':'FMCG',
  'DRREDDY':'Pharma',     'CIPLA':'Pharma',         'ZYDUSLIFE':'Pharma',
  'SUNPHARMA':'Pharma',   'DIVISLAB':'Pharma',
  'POWERGRID':'Infra',    'NTPC':'Infra',           'GRASIM':'Infra',
  'TATASTEEL':'Metal',    'HINDALCO':'Metal',       'JSWSTEEL':'Metal',
};

function getSectorLocal(symbol) {
  return SECTOR_MAP[toNSE(symbol)] || 'Other';
}

// ── Cache TTL logic ────────────────────────────────────────────────────
function isMarketOpen() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes(), day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930; // 9:15 AM to 3:30 PM IST
}

function isCacheFresh(holding) {
  if (!holding?.last_price || holding.last_price <= 0) return false;
  if (!holding?.price_updated_at) return false;
  const age = Date.now() - new Date(holding.price_updated_at).getTime();
  const ttl = isMarketOpen() ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000;
  return age < ttl;
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 1: Yahoo Finance v8/chart — PROVEN to work from Railway
// Same endpoint + headers as dividendFetcher.js which already works
// ══════════════════════════════════════════════════════════════════════
async function fetchYahooPrice(symbol) {
  const yahooSym = toYahooNS(symbol);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1d`;
    const res = await axios.get(url, {
      headers: YAHOO_HEADERS,
      timeout: YAHOO_TIMEOUT
    });
    const meta = res.data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose || meta.previousClose || price;
    return {
      price,
      change:        parseFloat((price - prev).toFixed(2)),
      changePct:     parseFloat(((price - prev) / prev * 100).toFixed(2)),
      previousClose: prev,
      high:          meta.regularMarketDayHigh  || price,
      low:           meta.regularMarketDayLow   || price,
      volume:        meta.regularMarketVolume   || 0,
      currency:      meta.currency || 'INR',
      source: 'Yahoo'
    };
  } catch(e) {
    console.warn(JSON.stringify({ event:'YAHOO_PRICE_ERROR', symbol: yahooSym, error: e.message }));
    return null;
  }
}

// Batch Yahoo — parallel with concurrency limit to avoid rate limiting
async function fetchYahooBatch(symbols) {
  const CONCURRENCY = 5; // max parallel Yahoo calls
  const results = {};

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async s => ({ sym: s, data: await fetchYahooPrice(s) }))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) {
        results[r.value.sym] = r.value.data;
      }
    }
    // Small delay between batches to be polite to Yahoo
    if (i + CONCURRENCY < symbols.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const hitCount = Object.keys(results).length;
  console.log(JSON.stringify({
    event: 'PRICE_SOURCE', source: 'Yahoo_v8',
    hit: hitCount, total: symbols.length,
    missed: symbols.filter(s => !results[s])
  }));
  return results;
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 3: Stooq — free, unlimited, no key needed
// ══════════════════════════════════════════════════════════════════════
async function fetchStooq(symbol) {
  try {
    const s   = toNSE(symbol).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const url = `https://stooq.com/q/l/?s=${s}.ns&f=sd2t2ohlcv&h&e=json`;
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const q = res.data?.symbols?.[0];
    if (!q?.Close || q.Close === 'N/D' || parseFloat(q.Close) <= 0) return null;
    return { price: parseFloat(q.Close), source: 'Stooq' };
  } catch(e) { return null; }
}

async function fetchStooqBatch(symbols) {
  const settled = await Promise.allSettled(
    symbols.map(async s => ({ sym: s, data: await fetchStooq(s) }))
  );
  const results = {};
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.data) {
      results[r.value.sym] = r.value.data;
    }
  }
  const hitCount = Object.keys(results).length;
  if (symbols.length > 0) {
    console.log(JSON.stringify({
      event: 'PRICE_SOURCE', source: 'Stooq',
      hit: hitCount, total: symbols.length
    }));
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 4: Twelve Data — free 800/day (optional TWELVE_DATA_API_KEY)
// ══════════════════════════════════════════════════════════════════════
let tdCallsToday = 0, tdCallsDate = '';
function tdBudgetOk() {
  const today = new Date().toISOString().slice(0, 10);
  if (tdCallsDate !== today) { tdCallsToday = 0; tdCallsDate = today; }
  return tdCallsToday < 780;
}

async function fetchTwelveData(symbols) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key || key === 'your_key_here' || !tdBudgetOk()) return {};
  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols.join(','))}&exchange=NSE&apikey=${key}`;
    const res = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': 'StockPilot/1.0' } });
    tdCallsToday++;
    const data = res.data;
    const results = {};
    if (symbols.length === 1 && data.price && data.status !== 'error') {
      results[symbols[0]] = { price: parseFloat(data.price), source: 'TwelveData' };
      return results;
    }
    for (const sym of symbols) {
      const q = data[sym];
      if (q?.price && q.status !== 'error') {
        results[sym] = { price: parseFloat(q.price), source: 'TwelveData' };
      }
    }
    console.log(JSON.stringify({ event:'PRICE_SOURCE', source:'TwelveData', hit: Object.keys(results).length, callsToday: tdCallsToday }));
    return results;
  } catch(e) {
    console.warn(JSON.stringify({ event:'TWELVE_DATA_ERROR', error: e.message }));
    return {};
  }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN: getPrices — full 5-layer fallback chain
// ══════════════════════════════════════════════════════════════════════
async function getPrices(rawSymbols, dbHoldings = []) {
  if (!rawSymbols?.length) return {};

  const symbols = rawSymbols.map(toNSE);
  const prices  = {};

  // Build DB map
  const dbMap = {};
  for (const h of dbHoldings) dbMap[toNSE(h.symbol)] = h;

  // ── Layer 0: Fresh DB cache — skip API entirely ─────────────────
  const needsFetch = [];
  for (const sym of symbols) {
    if (isCacheFresh(dbMap[sym])) {
      prices[sym] = { price: dbMap[sym].last_price, source: 'DB_cache' };
    } else {
      needsFetch.push(sym);
    }
  }
  if (needsFetch.length === 0) {
    console.log(JSON.stringify({ event:'PRICE_SOURCE', source:'DB_cache_all', symbols: symbols.length }));
    return buildResult(rawSymbols, symbols, prices);
  }

  // ── Layer 1: Yahoo v8/chart (same as dividendFetcher — proven) ──
  const yahooPrices = await fetchYahooBatch(needsFetch);
  for (const sym of needsFetch) {
    if (yahooPrices[sym]) prices[sym] = yahooPrices[sym];
  }

  // ── Layer 2: Stooq for Yahoo misses ────────────────────────────
  const afterYahoo = needsFetch.filter(s => !prices[s]);
  if (afterYahoo.length > 0) {
    const stooqPrices = await fetchStooqBatch(afterYahoo);
    for (const sym of afterYahoo) {
      if (stooqPrices[sym]) prices[sym] = stooqPrices[sym];
    }
  }

  // ── Layer 3: Twelve Data for remaining (if key set) ────────────
  const afterStooq = needsFetch.filter(s => !prices[s]);
  if (afterStooq.length > 0) {
    const tdPrices = await fetchTwelveData(afterStooq);
    for (const sym of afterStooq) {
      if (tdPrices[sym]) prices[sym] = tdPrices[sym];
    }
  }

  // ── Layer 4: Stale DB cache — never show blank ─────────────────
  const stillMissing = needsFetch.filter(s => !prices[s]);
  for (const sym of stillMissing) {
    const h = dbMap[sym];
    if (h?.last_price > 0) {
      prices[sym] = { price: h.last_price, source: 'stale_cache' };
    }
  }

  const totalMissed = needsFetch.filter(s => !prices[s]);
  if (totalMissed.length > 0) {
    console.warn(JSON.stringify({ event:'PRICE_ALL_SOURCES_FAILED', symbols: totalMissed }));
  }

  return buildResult(rawSymbols, symbols, prices);
}

function buildResult(rawSymbols, cleanSymbols, prices) {
  const result = {};
  for (let i = 0; i < rawSymbols.length; i++) {
    const raw = rawSymbols[i];
    const sym = cleanSymbols[i];
    if (prices[sym]) {
      result[raw] = { ...prices[sym], symbol: raw, sector: getSectorLocal(sym) };
    }
  }
  return result;
}

async function getPrice(symbol) {
  const r = await getPrices([symbol]);
  return r[symbol] || null;
}

async function getSectorFromYahoo(symbol) {
  return getSectorLocal(symbol);
}

module.exports = {
  getPrice, getPrices, getSectorFromYahoo, getSectorLocal,
  SYMBOL_MAP, toNSE, toYahooNS, isMarketOpen
};
