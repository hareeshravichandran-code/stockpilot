'use strict';

function generateNPSPasswords(name, dob) {
  if (!name || !dob) return [];
  var passwords = [];
  var firstName = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  var first4 = firstName.slice(0, 4);
  if (!first4) return [];

  var ddmm = '';
  var digits = dob.replace(/\D/g, '');

  if (dob.indexOf('-') >= 0) {
    var parts = dob.split('-');
    if (parts[0].length === 4) {
      ddmm = (parts[2] || '').padStart(2,'0') + (parts[1] || '').padStart(2,'0');
    } else {
      ddmm = (parts[0] || '').padStart(2,'0') + (parts[1] || '').padStart(2,'0');
    }
  } else if (dob.indexOf('/') >= 0) {
    var parts2 = dob.split('/');
    if (parts2[0].length === 4) {
      ddmm = (parts2[2] || '').padStart(2,'0') + (parts2[1] || '').padStart(2,'0');
    } else {
      ddmm = (parts2[0] || '').padStart(2,'0') + (parts2[1] || '').padStart(2,'0');
    }
  } else if (digits.length >= 8) {
    ddmm = digits.slice(0, 4);
  }

  if (ddmm.length >= 4) {
    passwords.push(first4 + ddmm.slice(0, 4));
    passwords.push(first4.toUpperCase() + ddmm.slice(0, 4));
    var mmdd = ddmm.slice(2, 4) + ddmm.slice(0, 2);
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

  function parseNum(s) {
    return s ? parseFloat(String(s).replace(/,/g, '')) : null;
  }

  // End-of-line number: find label, then number at end of that line
  function endOfLine(label) {
    var re = new RegExp(label + '[^\\n]*\\s+([\\d][\\d,]*\\.?\\d*)\\s*$', 'im');
    var m = text.match(re);
    return m ? parseNum(m[1]) : null;
  }

  // PRAN
  var pranM = text.match(/PRAN\s+(\d{12})/i);
  if (pranM) result.pran = pranM[1];

  // Subscriber name
  var nameM = text.match(/Subscriber\s+Nam[eo]\s+([A-Z][A-Z ]{3,35})(?:\s{2,}|\t|Tier)/i);
  if (nameM) result.subscriber_name = nameM[1].trim();

  // Statement dates: "Feb 01, 2026 To Feb 28, 2026"
  var periodM = text.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})\s+[Tt]o\s+(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
  if (periodM) {
    try {
      result.statement_from = new Date(periodM[1]+' '+periodM[2]+' '+periodM[3]).toISOString().split('T')[0];
      result.statement_to   = new Date(periodM[4]+' '+periodM[5]+' '+periodM[6]).toISOString().split('T')[0];
    } catch(e) {}
  }

  // CBO name
  var cboM = text.match(/CBO\s+Name\s+([A-Za-z][A-Za-z\s.,\-]{5,60}?)(?:\n|CBO Address|CHO)/i);
  if (cboM) result.cbo_name = cboM[1].trim();

  // Investment summary — end-of-line matching handles dates in lines
  result.total_value         = endOfLine('Value of your Holdings');
  result.total_contributions = endOfLine('Total Contribution');
  result.total_withdrawals   = endOfLine('Total Withdrawal') || 0;
  result.notional_gain       = endOfLine('Notional Gain');

  // No of contributions
  var ncM = text.match(/No\s+of\s+Contributions\s+(\d+)/i);
  if (ncM) result.num_contributions = parseInt(ncM[1]);

  // XIRR
  var xirrM = text.match(/\(?XIRR\)?\s+(\d+\.?\d*)\s*%/i)
           || text.match(/Return on Investment[^%]*?(\d+\.\d+)\s*%/i);
  if (xirrM) result.xirr = parseFloat(xirrM[1]);

  // Schemes: find section, extract first 6-digit.2dec value, then units and NAV
  function extractScheme(letter) {
    // Pattern: "SCHEME E" or "SCHEME E -" until next "SCHEME X" or end
    var schPat = 'SCHEME\\s+' + letter + '(?:\\s*[-\u2013])?[\\s\\S]*?(?=SCHEME\\s+[A-Z](?:\\s*[-\u2013])|$)';
    var schRe  = new RegExp(schPat, 'i');
    var schM   = text.match(schRe);
    var chunk  = schM ? schM[0] : '';
    if (!chunk) return null;

    // Find all numbers with exactly 2 decimal places (values like 327121.64)
    var valMatch = chunk.match(/(\d{4,}(?:,\d{3})*\.\d{2})(?!\d)/);
    // Units: number with 4 decimal places after "Total Units"
    var unitsM  = chunk.match(/Total\s+Units[^\n]*?([\d,]+\.\d{4})/i);
    // NAV: number with 4 decimal places after "NAV"
    var navM    = chunk.match(/NAV[^\n]*?([\d,]+\.\d{4})/i);

    if (!valMatch) return null;
    return {
      value: parseNum(valMatch[1]),
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

  // Fallback total from schemes
  if (!result.total_value && (result.scheme_e_value || result.scheme_c_value || result.scheme_g_value)) {
    result.total_value = (result.scheme_e_value||0) + (result.scheme_c_value||0) + (result.scheme_g_value||0);
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
