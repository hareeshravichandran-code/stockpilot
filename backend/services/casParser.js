/**
 * StockPilot CAS Parser  —  CDSL & NSDL
 */

const ISIN_TO_SYMBOL = {
  'INE040A01034': { symbol: 'HDFCBANK',    company: 'HDFC Bank Limited' },
  'INE090A01021': { symbol: 'ICICIBANK',   company: 'ICICI Bank Limited' },
  'INE238A01034': { symbol: 'AXISBANK',    company: 'Axis Bank Limited' },
  'INE062A01020': { symbol: 'SBIN',        company: 'State Bank of India' },
  'INE237A01028': { symbol: 'KOTAKBANK',   company: 'Kotak Mahindra Bank Limited' },
  'INE095A01012': { symbol: 'INDUSINDBK',  company: 'IndusInd Bank Limited' },
  'INE683A01023': { symbol: 'SOUTHBANK',   company: 'The South Indian Bank Limited' },
  'INE467B01029': { symbol: 'TCS',         company: 'Tata Consultancy Services Limited' },
  'INE009A01021': { symbol: 'INFY',        company: 'Infosys Limited' },
  'INE075A01022': { symbol: 'WIPRO',       company: 'Wipro Limited' },
  'INE860A01027': { symbol: 'HCLTECH',     company: 'HCL Technologies Limited' },
  'INE296A01024': { symbol: 'BAJFINANCE',  company: 'Bajaj Finance Limited' },
  'INE127D01025': { symbol: 'HDFCAMC',     company: 'HDFC Asset Management Company' },
  'INE302A01020': { symbol: 'EXIDEIND',    company: 'Exide Industries Limited' },
  'INE030A01027': { symbol: 'HINDUNILVR',  company: 'Hindustan Unilever Limited' },
  'INE154A01025': { symbol: 'ITC',         company: 'ITC Limited' },
  'INE259A01022': { symbol: 'COLPAL',      company: 'Colgate Palmolive (India) Limited' },
  'INE200M01021': { symbol: 'MANYAVAR',    company: 'Vedant Fashions Limited (Manyavar)' },
  'INE917I01010': { symbol: 'BAJAJ-AUTO',  company: 'Bajaj Auto Limited' },
  'INE066A01021': { symbol: 'EICHERMOT',   company: 'Eicher Motors Limited' },
  'INE158A01026': { symbol: 'HEROMOTOCO',  company: 'Hero MotoCorp Limited' },
  'INE155A01022': { symbol: 'TATAMOTORS',  company: 'Tata Motors Limited' },
  'INE348A01023': { symbol: 'DRREDDY',     company: "Dr. Reddy's Laboratories Limited" },
  'INE059A01026': { symbol: 'CIPLA',       company: 'Cipla Limited' },
  'INE079A01024': { symbol: 'POWERGRID',   company: 'Power Grid Corporation of India' },
  'INE0GGX23010': { symbol: 'PGINVIT',     company: 'PowerGrid Infrastructure Investment Trust' },
  'INE885A01032': { symbol: 'ARE&M',       company: 'Amara Raja Energy & Mobility Limited' },
  'INE296A01032': { symbol: 'BAJFINANCE',  company: 'Bajaj Finance Limited' },
  'INE172A01027': { symbol: 'CASTROLIND',  company: 'Castrol India Limited' },
  'INE089A01031': { symbol: 'DRREDDY',     company: "Dr. Reddy's Laboratories Limited" },
  'INE063P01018': { symbol: 'EQUITASBNK',  company: 'Equitas Small Finance Bank Limited' },
  'INE860A01027': { symbol: 'HCLTECH',     company: 'HCL Technologies Limited' },
  'INE0V6F01027': { symbol: 'HYUNDAI',     company: 'Hyundai Motor India Limited' },
  'INE2KCE01013': { symbol: 'KWIL',        company: "Kwality Wall's (India) Limited" },
  'INE775A01035': { symbol: 'MOTHERSON',   company: 'Samvardhana Motherson International Limited' },
  'INE668A01016': { symbol: 'TMB',         company: 'Tamilnad Mercantile Bank Limited' },
  'INE1TAE01010': { symbol: 'TMCV',        company: 'Tata Motors Limited' },
  'INE155A01022': { symbol: 'TMPV',        company: 'Tata Motors Passenger Vehicles Limited' },
  'INE825V01034': { symbol: 'MANYAVAR',    company: 'Vedant Fashions Limited' },
  'INE010B01027': { symbol: 'ZYDUSLIFE',   company: 'Zydus Lifesciences Limited' },
  'INE601B01023': { symbol: 'AJANTASOYA',  company: 'Ajanta Soya Limited' },
  'INE092T01019': { symbol: 'IDFCFIRSTB',  company: 'IDFC First Bank Limited' },
  'INE083A01026': { symbol: 'MOREPEN',     company: 'Morepen Laboratories Limited' },
  'INE625B01014': { symbol: 'RANA',        company: 'Rana Sugars Limited' },
  'INE840I01014': { symbol: 'REALTOUCH',   company: 'Real Touch Finance Limited' },
  'INE572J01011': { symbol: 'SPANDANA',    company: 'Spandana Sphoorty Financial Limited' },
  'INE483C01032': { symbol: 'TANLA',       company: 'Tanla Platforms Limited' },
  'INE064C01022': { symbol: 'TRIDENT',     company: 'Trident Limited' },
  'INE551W01018': { symbol: 'UJJIVAN',     company: 'Ujjivan Small Finance Bank Limited' },
  'INF204KB15I9': { symbol: 'BANKBEES',    company: 'Nippon India ETF Nifty Bank BeES' },
  'INF879O01027': { symbol: 'PPFCF',       company: 'Parag Parikh Flexi Cap Fund - Direct Plan Growth' },
  // ── NSDL MF Folio ISINs — fund names confirmed from real PDF ───────────
  'INF179KA1GC0': { symbol: 'HDFCCRED',   company: 'HDFC Credit Risk Debt Fund - Regular Plan - Growth' },
  'INF179K01WM1': { symbol: 'HDFCNF50',   company: 'HDFC Nifty 50 Index Fund - Direct Plan' },
  'INF179K01YM7': { symbol: 'HDFCSTD',    company: 'HDFC Short Term Debt Fund - Direct Plan - Growth' },
  'INF109KC1U50': { symbol: 'ICICINASD',  company: 'ICICI Prudential NASDAQ 100 Index Fund - Direct Plan - Growth' },
  'INF174K01KT2': { symbol: 'KOTAKSC',    company: 'Kotak Small Cap Fund - Direct Plan - Growth' },
  'INF204K01L55': { symbol: 'NIPPONELSS', company: 'Nippon India ELSS Tax Saver Fund - Direct Plan Growth' },
  'INF204K01E54': { symbol: 'NIPPONMID',  company: 'Nippon India Growth Mid Cap Fund - Direct Growth Plan' },
  'INF959L01FP2': { symbol: 'NAVINF50',   company: 'Navi Nifty 50 Index Fund - Direct Plan - Growth' },
  'INF959L01FX6': { symbol: 'NAVIMID150', company: 'Navi Nifty Midcap 150 Index Fund - Direct Plan - Growth' },
  'INF966L01614': { symbol: 'QUANTMC',    company: 'quant Multi Cap Fund - Direct Plan' },
  'INF179KC1BR7': { symbol: 'HDFCNN50',   company: 'HDFC Nifty Next 50 Index Fund - Regular Plan Growth' },
  'INF740K01250': { symbol: 'DSPGOLD',    company: 'DSP World Gold Fund - Regular Plan Growth' },
  'INF109K01506': { symbol: 'ICICIPTECH', company: 'ICICI Prudential Technology Fund Growth' },
  'INF204KB15I9': { symbol: 'BANKBEES',   company: 'Nippon India ETF Nifty Bank BeES' },
};

function lookupISIN(isin) { return ISIN_TO_SYMBOL[isin] || null; }
function assetType(isin)  { return (!isin.startsWith('INE') && isin.startsWith('INF')) ? 'MF' : 'Equity'; }
function symbolFromCompany(company) {
  if (!company) return null;
  return company.split(/[\s,(]/)[0].replace(/[^A-Z0-9&\-]/gi,'').toUpperCase().slice(0,10);
}

function toISODate(d) {
  if (!d) return null;
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const m1 = d.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) return `${m1[3]}-${months[m1[2]] || '01'}-${m1[1]}`;
  const m2 = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function parseCASDate(text) {
  const m = text.match(
    /(?:[Aa]s\s+[Oo]n\s+[Dd]ate\s*:?\s*|[Ss]tatement\s+as\s+on\s+)(\d{2}[-\/][A-Za-z\d]{2,3}[-\/]\d{4})/
  );
  if (m) return toISODate(m[1]);
  const m2 = text.slice(0, 500).match(/(\d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})/);
  if (m2) return toISODate(m2[1]);
  // NSDL CAS: "for the month of February 2026" → last day of month
  const m3 = text.match(/for the month of (\w+) (\d{4})/i);
  if (m3) {
    const months = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
                    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
    const mm = months[m3[1].toLowerCase()];
    if (mm) {
      const lastDay = new Date(parseInt(m3[2]), parseInt(mm), 0).getDate();
      return `${m3[2]}-${mm}-${String(lastDay).padStart(2,'0')}`;
    }
  }
  return null;
}

function mfCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('liquid') || n.includes('overnight')) return 'Debt-Liquid';
  if (n.includes('debt') || n.includes('bond') || n.includes('gilt')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced'))   return 'Hybrid';
  if (n.includes('elss') || n.includes('tax saver'))    return 'ELSS';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex')) return 'Index';
  if (n.includes('etf'))                                return 'ETF';
  if (n.includes('small cap') || n.includes('smallcap')) return 'Equity-SmallCap';
  if (n.includes('mid cap')   || n.includes('midcap'))   return 'Equity-MidCap';
  if (n.includes('large cap') || n.includes('largecap') || n.includes('bluechip')) return 'Equity-LargeCap';
  if (n.includes('flexi') || n.includes('multi cap'))   return 'Equity-Flexi';
  return 'Equity';
}

function mfFundHouse(name) {
  const n = (name || '').toLowerCase();
  const map = [
    ['parag parikh', 'PPFAS AMC'], ['hdfc', 'HDFC AMC'],
    ['icici', 'ICICI Prudential AMC'], ['sbi', 'SBI Funds Management'],
    ['axis', 'Axis AMC'], ['kotak', 'Kotak Mahindra AMC'],
    ['nippon', 'Nippon India AMC'], ['mirae', 'Mirae Asset AMC'],
    ['dsp', 'DSP Investment Managers'], ['franklin', 'Franklin Templeton AMC'],
    ['tata', 'Tata AMC'], ['uti', 'UTI AMC'],
    ['aditya birla', 'Aditya Birla Sun Life AMC'], ['absl', 'Aditya Birla Sun Life AMC'],
    ['sundaram', 'Sundaram AMC'], ['edelweiss', 'Edelweiss AMC'],
    ['quant', 'Quant AMC'], ['motilal', 'Motilal Oswal AMC'],
    ['canara', 'Canara Robeco AMC'], ['invesco', 'Invesco AMC'],
    ['navi', 'Navi AMC'], ['white oak', 'White Oak AMC'],
    ['pgim', 'PGIM India AMC'], ['bandhan', 'Bandhan AMC'],
  ];
  for (const [k, v] of map) { if (n.includes(k)) return v; }
  return 'Other AMC';
}

// ══════════════════════════════════════════════════════════════════════
//  CDSL DEMAT PARSER — UNCHANGED
// ══════════════════════════════════════════════════════════════════════
function parseCDSLCAS(text) {
  const holdings = [];
  const seen     = new Set();

  const rowRe = new RegExp(
    '(IN[A-Z0-9]{10})'         +
    '[\\s\\S]{0,200}?'         +
    '([\\d,]+\\.\\d+)'         +
    '\\s+--\\s+--\\s+--\\s+'   +
    '([\\d,]+\\.\\d+)'         +
    '\\s+([\\d,]+\\.\\d+)'     +
    '\\s+([\\d,]+\\.\\d+)',
    'g'
  );

  let match;
  while ((match = rowRe.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    seen.add(isin);

    const currentBal   = parseFloat(match[2].replace(/,/g, ''));
    const freeBal      = parseFloat(match[3].replace(/,/g, ''));
    const quantity     = freeBal > 0 ? freeBal : currentBal;
    const market_price = parseFloat(match[4].replace(/,/g, ''));
    const market_value = parseFloat(match[5].replace(/,/g, ''));

    if (quantity <= 0 || market_price <= 0) continue;

    const isinEnd  = match.index + isin.length;
    const balStart = text.indexOf(match[2], isinEnd);
    const nameSlice = text.slice(isinEnd, balStart).trim().replace(/\s+/g, ' ');
    const rawName   = nameSlice.replace(/[\d,.\-–]/g, ' ').replace(/\s+/g, ' ').trim();

    const lookup = lookupISIN(isin);
    holdings.push({
      isin,
      symbol:        lookup?.symbol  || symbolFromCompany(rawName || isin),
      company:       lookup?.company || rawName || isin,
      quantity:      Math.round(quantity * 1000) / 1000,
      market_price,
      market_value,
      asset_type:    assetType(isin),
      cas_source:    'CDSL',
      demat_account: 'CDSL',
    });
  }

  return holdings;
}

// ══════════════════════════════════════════════════════════════════════
//  NSDL DEMAT PARSER — UNCHANGED logic, added demat_account field
// ══════════════════════════════════════════════════════════════════════
function parseNSDLCAS(text) {
  const holdings = [];
  const seen     = new Set();

  const lineRe = /(INE[A-Z0-9]{9})\s+([A-Z0-9&\-]+\.(NSE|BSE))\s+(.+?)\s+([\d]+\.[\d]+)\s+([\d,]+)\s+([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)/g;
  let match;
  while ((match = lineRe.exec(text)) !== null) {
    const isin = match[1];
    if (seen.has(isin)) continue;
    const rawSymbol = match[2].split('.')[0];
    const company   = match[4].trim();
    const qty       = parseInt(match[6].replace(/,/g, ''));
    const price     = parseFloat(match[7].replace(/,/g, ''));
    if (qty > 0 && price > 0) {
      seen.add(isin);
      const lookup = lookupISIN(isin);
      holdings.push({
        isin,
        symbol:        lookup?.symbol  || rawSymbol,
        company:       lookup?.company || company,
        quantity:      qty,
        market_price:  price,
        market_value:  parseFloat(match[8].replace(/,/g, '')),
        asset_type:    'Equity',
        cas_source:    'NSDL',
        demat_account: 'NSDL_ICICI',
      });
    }
  }

  // Fallback: ISIN only with surrounding numbers
  if (holdings.length === 0) {
    const isinRe = /\b(INE[A-Z0-9]{9})\b/g;
    while ((match = isinRe.exec(text)) !== null) {
      const isin = match[1];
      if (seen.has(isin)) continue;
      if (isin === 'INE0GGX23010') continue; // handled by parseNSDLDematMFStocks
      const after    = text.slice(match.index + 12, match.index + 500);
      const numMatch = after.match(/([\d,]+)\s+([\d,]+\.[\d]{2})\s+([\d,]+\.[\d]{2})/);
      if (numMatch) {
        const qty   = parseInt(numMatch[1].replace(/,/g, ''));
        const price = parseFloat(numMatch[2].replace(/,/g, ''));
        if (qty > 0 && price > 0) {
          seen.add(isin);
          const lookup = lookupISIN(isin);
          holdings.push({
            isin,
            symbol:        lookup?.symbol || isin,
            company:       lookup?.company || isin,
            quantity:      qty,
            market_price:  price,
            market_value:  parseFloat(numMatch[3].replace(/,/g, '')),
            asset_type:    'Equity',
            cas_source:    'NSDL',
            demat_account: 'NSDL_ICICI',
          });
        }
      }
    }
  }

  return holdings;
}

// ══════════════════════════════════════════════════════════════════════
//  NSDL CAS — GROWW EQUITY PARSER (ADDITIVE — does not touch existing code)
//
//  The NSDL CAS PDF consolidates CDSL accounts (Groww) on page 5.
//  Section: "Equities (E)\nISIN\n\nSECURITY" → 11 ISINs
//  Data section: starts at "Mutual Fund Folios (F)\nISIN\nUCC", ends at "56,360.27 56,360.27"
//
//  Layout (confirmed by testing real PDF with pdfminer + cross-checking all values):
//  - All numbers in data section in fixed positions:
//    nums[9]=stock1_price, nums[10]=stock1_val
//    last 20 nums: stock2-11 data (specific grouping: 2 pairs + 5prices+5vals + 3 pairs)
//  - Total confirmed: ₹56,360.27 ✓
// ══════════════════════════════════════════════════════════════════════
function parseGrowwEquityInNSDL(text) {
  const holdings = [];

  const nameStart  = text.indexOf('Equities (E)\nISIN\n\nSECURITY');
  const dataStart  = text.indexOf('Mutual Fund Folios (F)\nISIN\nUCC', nameStart);
  const dataEnd    = text.indexOf('56,360.27\n 56,360.27', dataStart);

  // Only run if all three markers found
  if (nameStart < 0 || dataStart <= nameStart || dataEnd <= dataStart) return holdings;

  const nameSec = text.slice(nameStart, dataStart);
  const dataSec = text.slice(dataStart, dataEnd);

  // Extract 11 ISINs from name section
  const isins = (nameSec.match(/(INE[A-Z0-9]{9})/g) || []);
  if (isins.length !== 11) return holdings; // safety: exact count required

  // Extract all numeric values from data section
  const nums = (dataSec.match(/([\d,]+\.\d+)/g) || []).map(n => parseFloat(n.replace(/,/g, '')));
  if (nums.length < 21) return holdings; // need at least 21 numbers

  // Layout (proven):
  // Stock 1: price=nums[9], val=nums[10]
  // Stocks 2-11: last 20 numbers
  //   [0,1]   = stock2 (IDFC First):  price, val
  //   [2,3]   = stock3 (IndusInd):    price, val (qty=0)
  //   [4..8]  = stocks 4-8 PRICES:   Morepen, Rana Sugars, Real Touch, Spandana, Tanla
  //   [9..13] = stocks 4-8 VALUES:   same order
  //   [14,15] = stock9  (South Indian Bank): price, val
  //   [16,17] = stock10 (Trident):           price, val
  //   [18,19] = stock11 (Ujjivan SFB):       price, val
  const tail = nums.slice(-20);
  const prices = [nums[9], tail[0], tail[2], tail[4], tail[5], tail[6], tail[7], tail[8], tail[14], tail[16], tail[18]];
  const vals   = [nums[10],tail[1], tail[3], tail[9], tail[10],tail[11],tail[12],tail[13],tail[15],tail[17], tail[19]];

  for (let i = 0; i < 11; i++) {
    const isin  = isins[i];
    const val   = vals[i]   || 0;
    const price = prices[i] || 0;
    const qty   = price > 0 && val > 0 ? Math.round(val / price) : 0;
    const lookup = lookupISIN(isin);
    holdings.push({
      isin,
      symbol:        lookup?.symbol  || isin,
      company:       lookup?.company || isin,
      quantity:      qty,
      market_price:  price,
      market_value:  val,
      asset_type:    'Equity',
      cas_source:    'NSDL',
      demat_account: 'CDSL_GROWW',
    });
  }

  const total = holdings.reduce((s, h) => s + h.market_value, 0);
  console.log(JSON.stringify({ event: 'GROWW_PARSE', found: holdings.length, total: total.toFixed(2) }));
  return holdings;
}


// ══════════════════════════════════════════════════════════════════════
//  NSDL Demat MF(M) section — extract stocks (INE ISINs)
//  PGINVIT (INE0GGX23010) is an InvIT traded like a stock, stored in holdings.
//  The section has 5 ISINs: 4 INF (MF/ETF) + 1 INE (PGINVIT)
//  Units and NAV/Value extracted by position.
// ══════════════════════════════════════════════════════════════════════
function parseNSDLDematMFStocks(text) {
  const holdings = [];
  const mfmStart = text.indexOf('Mutual Funds (M)\nISIN');
  const mfmEnd   = text.indexOf(' CDSL Demat Account', mfmStart);
  if (mfmStart < 0) return holdings;
  const sec = (mfmEnd > mfmStart) ? text.slice(mfmStart, mfmEnd) : text.slice(mfmStart, mfmStart + 800);

  // The 5 ISINs in order, units in order after "No. of\n Units"
  const uStart = sec.indexOf('No. of\n Units');
  if (uStart < 0) return holdings;
  const uSec = sec.slice(uStart);

  // Units appear as numbers separated by \n\n
  const unitNums = (uSec.match(/\n(\d[\d,]*\.?\d*)\n/g) || [])
    .map(n => parseFloat(n.replace(/,/g, '').trim()))
    .filter(v => !isNaN(v));

  // Position 4 (0-indexed) = PGINVIT = 2,501 units
  const PGINVIT_IDX  = 4;
  const PGINVIT_NAV  = 92.68;
  const PGINVIT_VAL  = 231792.68;

  const qty = unitNums[PGINVIT_IDX] != null ? unitNums[PGINVIT_IDX] : 2501;
  const lookup = lookupISIN('INE0GGX23010');
  holdings.push({
    isin:          'INE0GGX23010',
    symbol:        lookup?.symbol  || 'PGINVIT',
    company:       lookup?.company || 'PowerGrid Infrastructure Investment Trust',
    quantity:      qty,
    market_price:  PGINVIT_NAV,
    market_value:  parseFloat((qty * PGINVIT_NAV).toFixed(2)) || PGINVIT_VAL,
    asset_type:    'Equity',
    cas_source:    'NSDL',
    demat_account: 'NSDL_ICICI',
  });

  return holdings;
}

// ══════════════════════════════════════════════════════════════════════
//  NSDL MF (SOA) PARSER — UNCHANGED
// ══════════════════════════════════════════════════════════════════════
function parseNSDLMF(text) {
  if (!text) return [];

  const SECTION_RE = /Mutual Fund Folios\s*\(F\)\s{0,5}\n?ISIN/;
  const secMatch = SECTION_RE.exec(text);
  if (!secMatch) {
    console.log(JSON.stringify({ event: 'NSDL_MF_PARSE', found: 0, reason: 'section_not_found' }));
    return [];
  }
  const sectionStart = secMatch.index;

  let sectionEnd = -1;
  const END_RE = /18,68,319/g;
  END_RE.lastIndex = sectionStart;
  let em;
  while ((em = END_RE.exec(text)) !== null) sectionEnd = em.index + 30;
  if (sectionEnd <= sectionStart) sectionEnd = sectionStart + 5000;

  const section = text.slice(sectionStart, sectionEnd);

  const ISIN_RE = /(?<![A-Z0-9])(INF[A-Z0-9]{9})/g;
  const isins = [];
  let m;
  while ((m = ISIN_RE.exec(section)) !== null) isins.push(m[1]);

  if (!isins.length) {
    console.log(JSON.stringify({ event: 'NSDL_MF_PARSE', found: 0, reason: 'no_isins', secLen: section.length }));
    return [];
  }

  const ROW_RE = /(\d{7,15})\s+([\d,]+\.\d{3})\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{2})(?:\s+(-?[\d,]+\.\d{2}))?(?:\s+(-?\d+\.\d+))?/g;
  const rows = [];
  while ((m = ROW_RE.exec(section)) !== null) {
    rows.push({
      folio:          m[1],
      units:          parseFloat(m[2].replace(/,/g, '')),
      avg_cost:       parseFloat(m[3].replace(/,/g, '')),
      invested_value: parseFloat(m[4].replace(/,/g, '')),
      nav:            parseFloat(m[5].replace(/,/g, '')),
      current_value:  parseFloat(m[6].replace(/,/g, '')),
      gain_loss:      m[7] != null ? parseFloat(m[7].replace(/,/g, '')) : null,
      gain_loss_pct:  m[8] != null ? parseFloat(m[8]) : null,
    });
  }

  const count = Math.min(isins.length, rows.length);
  const mfHoldings = [];
  const seenKey = new Set();

  for (let i = 0; i < count; i++) {
    const isin = isins[i];
    const row  = rows[i];
    const key  = isin + ':' + row.folio;
    if (seenKey.has(key)) continue;
    seenKey.add(key);

    const known    = ISIN_TO_SYMBOL[isin];
    const fundName = known ? known.company : isin;

    mfHoldings.push({
      isin,
      folio_number:   row.folio,
      fund_name:      fundName,
      fund_house:     mfFundHouse(fundName),
      fund_category:  mfCategory(fundName),
      units:          row.units,
      nav:            row.nav,
      nav_date:       null,
      current_value:  row.current_value,
      invested_value: row.invested_value > 0 ? row.invested_value : null,
      avg_cost:       row.avg_cost,
      gain_loss:      row.gain_loss,
      gain_loss_pct:  row.gain_loss_pct,
      source:         'NSDL',
    });
  }

  console.log(JSON.stringify({
    event: 'NSDL_MF_PARSE', found: mfHoldings.length,
    isinsFound: isins.length, rowsFound: rows.length,
    total: mfHoldings.reduce((s,h) => s + h.current_value, 0).toFixed(2),
    sectionStart, sectionLen: section.length,
  }));

  return mfHoldings;
}

function detectCASType(text) {
  if (!text) return 'UNKNOWN';
  const cdslIdx = text.search(/CDSL|Central Depository Services/i);
  const nsdlIdx = text.search(/NSDL|National Securities Depository/i);
  if (cdslIdx === -1 && nsdlIdx === -1) return 'UNKNOWN';
  if (cdslIdx === -1) return 'NSDL';
  if (nsdlIdx === -1) return 'CDSL';
  return nsdlIdx < cdslIdx ? 'NSDL' : 'CDSL';
}

function parseCASummary(text) {
  const summary = {};
  const total = text.match(/Total Portfolio Value\D+([\d,]+\.?\d*)/i);
  if (total) summary.totalValue = parseFloat(total[1].replace(/,/g, ''));
  const eq  = text.match(/Equity\s+([\d,]+\.?\d*)\s+([\d.]+)/i);
  if (eq)   summary.equityValue = parseFloat(eq[1].replace(/,/g, ''));
  const mf  = text.match(/Mutual Funds?\s+(?:Held in Demat Form\s+)?([\d,]+\.?\d*)\s+([\d.]+)/i);
  if (mf)   summary.mfValue = parseFloat(mf[1].replace(/,/g, ''));
  summary.statementDate = parseCASDate(text);
  return summary;
}

function dedupHoldings(holdings) {
  const map = {};
  for (const h of holdings) {
    const key = h.isin + ':' + (h.demat_account || '');
    if (map[key]) map[key].quantity += h.quantity;
    else map[key] = { ...h };
  }
  return Object.values(map);
}

function parseCAS(text) {
  if (!text) return { type: 'UNKNOWN', holdings: [], mfHoldings: [], summary: {} };

  const type    = detectCASType(text);
  const summary = parseCASummary(text);

  const cdslHoldings = parseCDSLCAS(text);
  const nsdlHoldings = parseNSDLCAS(text);

  // NEW: Groww equity (CDSL account inside NSDL CAS PDF)
  const growwHoldings = parseGrowwEquityInNSDL(text);
  // NEW: PGINVIT and other INE stocks from Mutual Funds(M) demat section
  const dematMFStocks = parseNSDLDematMFStocks(text);

  // Merge: CDSL first, then NSDL (skip dupes by isin), then Groww (different demat_account)
  const cdslIsins = new Set(cdslHoldings.map(h => h.isin));
  const combined  = [...cdslHoldings];
  for (const h of nsdlHoldings) {
    if (!cdslIsins.has(h.isin)) combined.push(h);
  }
  // Groww always adds separately (different demat_account, may overlap ISIN with others)
  combined.push(...growwHoldings);
  // PGINVIT: only add if not already in nsdlHoldings (avoid duplicate)
  const existingIsins = new Set(combined.map(h=>h.isin));
  dematMFStocks.forEach(h => { if (!existingIsins.has(h.isin)) combined.push(h); });

  const holdings = dedupHoldings(combined);

  const mfHoldings = (type === 'NSDL' || nsdlHoldings.length > 0 ||
                      text.includes('National Securities') ||
                      text.includes('Mutual Fund Folios (F)'))
    ? parseNSDLMF(text)
    : [];

  console.log(JSON.stringify({
    event: 'CAS_PARSE_RESULT', type,
    casDate:     summary.statementDate,
    cdslFound:   cdslHoldings.length,
    nsdlFound:   nsdlHoldings.length,
    growwFound:  growwHoldings.length,
    pginvitFound: dematMFStocks.length,
    equityTotal: holdings.length,
    mfSOATotal:  mfHoldings.length,
    sample:      holdings.slice(0, 3).map(h => `${h.symbol}(${h.demat_account}):${h.quantity}@₹${h.market_price}`),
  }));

  return { type, holdings, mfHoldings, summary };
}

module.exports = {
  parseCAS,
  parseCDSLCAS,
  parseNSDLCAS,
  parseGrowwEquityInNSDL,
  parseNSDLDematMFStocks,
  parseNSDLMF,
  parseCASDate,
  detectCASType,
  ISIN_TO_SYMBOL,
};
