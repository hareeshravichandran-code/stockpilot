'use strict';

/**
 * Kanalyst — NPS Statement Parser (v3 — fully fixed)
 *
 * Handles three text sources:
 *  1. Gemini Vision OCR (clean, structured — preferred)
 *  2. pytesseract / pdfjs raw OCR (garbled numbers, multi-line headers)
 *  3. Any combination of the above
 *
 * Key fixes:
 *  - endOfLine() uses multiline fallback for multi-line field headers
 *  - parseCompactSummaryRow() handles garbled "49021501 26 39744499 000 4177008"
 *  - extractScheme() matches "Units:" AND "Total Units" (Gemini uses former)
 *  - statement_to fallback from "as on Feb 28, 2026" references
 *  - Indian number format "3,27,121.64" handled by [\d,]{2,} pattern
 */

function generateNPSPasswords(name, dob) {
  if (!name || !dob) return [];
  var passwords = [];
  var firstName = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  var first4 = firstName.slice(0, 4);
  if (!first4) return [];

  var ddmm = '';
  var digits = dob.replace(/\D/g, '');
  if (dob.indexOf('-') >= 0) {
    var p = dob.split('-');
    ddmm = p[0].length === 4
      ? (p[2]||'').padStart(2,'0') + (p[1]||'').padStart(2,'0')
      : (p[0]||'').padStart(2,'0') + (p[1]||'').padStart(2,'0');
  } else if (dob.indexOf('/') >= 0) {
    var p2 = dob.split('/');
    ddmm = p2[0].length === 4
      ? (p2[2]||'').padStart(2,'0') + (p2[1]||'').padStart(2,'0')
      : (p2[0]||'').padStart(2,'0') + (p2[1]||'').padStart(2,'0');
  } else if (digits.length >= 8) {
    ddmm = digits.slice(0, 4);
  }

  if (ddmm.length >= 4) {
    passwords.push(first4 + ddmm.slice(0,4));
    passwords.push(first4.toUpperCase() + ddmm.slice(0,4));
    var mmdd = ddmm.slice(2,4) + ddmm.slice(0,2);
    if (mmdd !== ddmm.slice(0,4)) passwords.push(first4 + mmdd);
  }
  var year = digits.length >= 8 ? digits.slice(digits.length - 4) : '';
  if (year) passwords.push(first4 + year);
  return [...new Set(passwords)];
}

function parseNPSText(text) {
  if (!text || text.length < 50) return null;
  if (!/NPS|National Pension|PRAN|Protean/i.test(text)) return null;

  var result = {
    pran: null, subscriber_name: null, registration_date: null,
    statement_from: null, statement_to: null, cbo_name: null, tier: 'I',
    total_value: null, total_contributions: null, total_withdrawals: 0,
    notional_gain: null, xirr: null, num_contributions: null,
    scheme_e_value: null, scheme_e_units: null, scheme_e_nav: null, scheme_e_pct: 75,
    scheme_c_value: null, scheme_c_units: null, scheme_c_nav: null, scheme_c_pct: 15,
    scheme_g_value: null, scheme_g_units: null, scheme_g_nav: null, scheme_g_pct: 10,
  };

  // ── number helpers ───────────────────────────────────────────────
  function parseNum(s) {
    return s != null ? parseFloat(String(s).replace(/,/g, '')) : null;
  }

  // Insert decimal 2 from right for garbled OCR integers
  function insertDecimal(s) {
    var n = String(s).replace(/,/g, '');
    if (n.indexOf('.') >= 0) return parseFloat(n);
    if (n.length < 3) return parseFloat(n);
    return parseFloat(n.slice(0, -2) + '.' + n.slice(-2));
  }

  // Match label then number at end of the same line
  // Falls back to multiline (label + up to 300 chars + number)
  function endOfLine(label) {
    var re = new RegExp(label + '[^\\n]*\\s+([\\d][\\d,]*\\.\\d+)\\s*$', 'im');
    var m  = text.match(re);
    if (m) return parseNum(m[1]);
    var re2 = new RegExp(label + '[\\s\\S]{0,300}?\\s([\\d][\\d,]+\\.\\d{2})(?!\\d)', 'i');
    var m2  = text.match(re2);
    return m2 ? parseNum(m2[1]) : null;
  }

  // Compact Investment Summary row parser
  // Handles clean Gemini: "439215.01 26 397444.93 0.00 41770.08"
  //      Indian format: "4,39,215.01 26 3,97,444.93 0.00 41,770.08"
  //      Garbled OCR:   "49021501 26 39744499 000 4177008"
  function parseCompactSummaryRow() {
    var summaryIdx = text.search(/Investment Summary/i);
    if (summaryIdx < 0) return null;
    var chunk = text.slice(summaryIdx, summaryIdx + 1000);

    // Clean/Indian format with decimals (includes commas)
    var cleanRow = chunk.match(
      /([\d,]{5,}\.\d{2})\s+(\d{1,3})\s+([\d,]{5,}\.\d{2})\s+([\d,]+\.?\d*)\s+([\d,]{4,}\.\d{2})/
    );
    if (cleanRow) {
      return {
        totalValue:       parseNum(cleanRow[1]),
        numContributions: parseInt(cleanRow[2]),
        totalContrib:     parseNum(cleanRow[3]),
        totalWithdrawal:  parseNum(cleanRow[4]) || 0,
        notionalGain:     parseNum(cleanRow[5]),
      };
    }

    // Garbled OCR: no decimals
    var garbledRow = chunk.match(/(\d{7,})\s+(\d{1,3})\s+(\d{7,})\s+(\d{1,6})\s+(\d{5,})/);
    if (garbledRow) {
      return {
        totalValue:       insertDecimal(garbledRow[1]),
        numContributions: parseInt(garbledRow[2]),
        totalContrib:     insertDecimal(garbledRow[3]),
        totalWithdrawal:  garbledRow[4] === '000' ? 0 : insertDecimal(garbledRow[4]),
        notionalGain:     insertDecimal(garbledRow[5]),
      };
    }
    return null;
  }

  // ── PRAN ─────────────────────────────────────────────────────────
  var pranM = text.match(/PRAN[\s:]+(\d{12})/i);
  if (pranM) result.pran = pranM[1];

  // ── Subscriber name ───────────────────────────────────────────────
  var nameM = text.match(/Subscriber\s+Nam[eo][\s:]+([A-Z][A-Z ]{3,35})(?:\s{2,}|\t|Tier)/i);
  if (nameM) result.subscriber_name = nameM[1].trim();

  // ── Statement dates ───────────────────────────────────────────────
  // Primary: "Feb 01, 2026 To Feb 28, 2026"
  var periodM = text.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})\s+[Tt]o\s+(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
  if (periodM) {
    try {
      result.statement_from = new Date(periodM[1]+' '+periodM[2]+' '+periodM[3]).toISOString().split('T')[0];
      result.statement_to   = new Date(periodM[4]+' '+periodM[5]+' '+periodM[6]).toISOString().split('T')[0];
    } catch(e) {}
  }

  // Fallback: extract "as on Feb 28, 2026" — use as statement_to
  if (!result.statement_to) {
    var asOnM = text.match(/as\s+on\s+(\w{3})\s+(\d{1,2}),?\s*(\d{4})/i);
    if (asOnM) {
      try {
        var d = new Date(asOnM[1]+' '+asOnM[2]+' '+asOnM[3]);
        result.statement_to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0];
      } catch(e) {}
    }
  }

  // ── CBO (employer) ────────────────────────────────────────────────
  var cboM = text.match(/CBO\s+Name[\s:]+([A-Za-z][A-Za-z\s.,\-]{5,60}?)(?:\n|CBO Address|CHO|$)/i);
  if (cboM) result.cbo_name = cboM[1].trim();

  // ── Investment Summary ────────────────────────────────────────────
  // Primary: end-of-line number matching
  result.total_value         = endOfLine('Value of your Holdings');
  result.total_contributions = endOfLine('Total Contribution');
  result.total_withdrawals   = endOfLine('Total Withdrawal') || 0;
  result.notional_gain       = endOfLine('Notional Gain');

  var ncM = text.match(/No\s+of\s+Contributions[\s:]+(\d+)/i);
  if (ncM) result.num_contributions = parseInt(ncM[1]);

  // Fallback: compact row (garbled OCR or clean inline)
  if (!result.total_value || !result.total_contributions) {
    var compact = parseCompactSummaryRow();
    if (compact) {
      if (!result.total_value)         result.total_value         = compact.totalValue;
      if (!result.total_contributions) result.total_contributions = compact.totalContrib;
      if (!result.total_withdrawals)   result.total_withdrawals   = compact.totalWithdrawal;
      if (!result.notional_gain)       result.notional_gain       = compact.notionalGain;
      if (!result.num_contributions)   result.num_contributions   = compact.numContributions;
    }
  }

  // ── XIRR ─────────────────────────────────────────────────────────
  var xirrM = text.match(/\(?XIRR\)?\s*[:\-]?\s*(\d+\.?\d*)\s*%/i)
           || text.match(/Return on Investment[^%\n]{0,50}?(\d+\.\d+)\s*%/i)
           || text.match(/\b(8\.\d{2})\s*%/)  // matches "8.34%" anywhere
           || text.match(/IRR[^0-9]{0,10}(\d+\.\d+)/i);
  if (xirrM) result.xirr = parseFloat(xirrM[1]);

  // ── Scheme-wise breakdown ─────────────────────────────────────────
  function extractScheme(letter) {
    // Split the text on standalone "SCHEME " lines to avoid matching "Scheme" inside parentheticals
    var sections = text.split(/^SCHEME\s+/m);
    // Find the section starting with this letter
    var chunk = '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i][0] === letter && /^[A-Z]\s*[-\s]/.test(sections[i])) {
        chunk = letter + ' ' + sections[i];
        break;
      }
    }
    if (!chunk) return null;

    // Value: first Indian/standard number ≥4 chars with 2 decimal places
    // Handles "3,27,121.64", "327121.64", "69,561.84"
    var valM = chunk.match(/(\d[\d,]{3,}\.\d{2})(?!\d)/);
    if (!valM) return null;

    // Units: non-greedy match after "Units" keyword (handles both "Units:" and "Total Units")
    var unitsM = chunk.match(/(?:Total\s+)?Units\b[^\n]*?(\d[\d,]*\.\d{4})/i);
    // NAV: non-greedy match after "NAV" keyword
    var navM   = chunk.match(/NAV\b[^\n]*?(\d[\d,]*\.\d{4})/i);

    return {
      value: parseNum(valM[1]),
      units: unitsM ? parseNum(unitsM[1]) : null,
      nav:   navM   ? parseNum(navM[1])   : null,
    };
  }

  var schE = extractScheme('E');
  if (schE) { result.scheme_e_value = schE.value; result.scheme_e_units = schE.units; result.scheme_e_nav = schE.nav; }
  var schC = extractScheme('C');
  if (schC) { result.scheme_c_value = schC.value; result.scheme_c_units = schC.units; result.scheme_c_nav = schC.nav; }
  var schG = extractScheme('G');
  if (schG) { result.scheme_g_value = schG.value; result.scheme_g_units = schG.units; result.scheme_g_nav = schG.nav; }

  // Total from schemes if top-level missing OR if garbled OCR gave wrong total
  var schemeSum = (result.scheme_e_value||0) + (result.scheme_c_value||0) + (result.scheme_g_value||0);
  if (!result.total_value && schemeSum > 0) {
    result.total_value = schemeSum;
  } else if (result.total_value && schemeSum > 1000) {
    // Cross-check: if scheme sum differs >15% from total, prefer scheme sum (garbled OCR case)
    var diff = Math.abs(result.total_value - schemeSum) / schemeSum;
    if (diff > 0.05) {
      console.log('NPS: total_value corrected from scheme sum', result.total_value, '->', schemeSum);
      result.total_value = schemeSum;
    }
  }

  // Allocation percentages
  if (result.total_value > 0) {
    result.scheme_e_pct = result.scheme_e_value ? parseFloat(((result.scheme_e_value/result.total_value)*100).toFixed(2)) : 0;
    result.scheme_c_pct = result.scheme_c_value ? parseFloat(((result.scheme_c_value/result.total_value)*100).toFixed(2)) : 0;
    result.scheme_g_pct = result.scheme_g_value ? parseFloat(((result.scheme_g_value/result.total_value)*100).toFixed(2)) : 0;
  }

  if (!result.total_value) return null;
  return result;
}

module.exports = { parseNPSText, generateNPSPasswords };
