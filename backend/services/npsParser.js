/**
 * Kanalyst — NPS Statement Parser
 * Extracts holdings data from Protean NPS Transaction Statement PDFs
 * Password: first4(firstName).toLowerCase() + first4(DOB digits e.g. DDMM)
 */

'use strict';

/**
 * Generate NPS PDF passwords from PAN + DOB
 * NPS password = first4(firstName) + first4(DOB digits)
 * DOB format stored as DD/MM/YYYY → extract DDMM
 */
function generateNPSPasswords(name, dob) {
  const passwords = [];
  if (!name || !dob) return passwords;

  // Extract first name (first word before space)
  const firstName = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  const first4Name = firstName.slice(0, 4).padEnd(4, firstName[firstName.length - 1] || 'x');

  // Extract digits from DOB — handle DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const dobDigits = dob.replace(/\D/g, '');
  let ddmm = '';
  if (dob.includes('-') && dobDigits.length === 8) {
    // YYYY-MM-DD → take last 4 as MMDD, but NPS uses DDMM
    const parts = dob.split('-');
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      ddmm = parts[2] + parts[1]; // DDMM
    } else {
      // DD-MM-YYYY
      ddmm = parts[0] + parts[1]; // DDMM
    }
  } else if (dob.includes('/')) {
    const parts = dob.split('/');
    ddmm = parts[0].padStart(2,'0') + parts[1].padStart(2,'0');
  } else if (dobDigits.length >= 8) {
    ddmm = dobDigits.slice(0, 4); // take first 4 digits
  }

  const first4DOB = ddmm.slice(0, 4);

  // Primary password
  if (first4Name && first4DOB) {
    passwords.push(first4Name + first4DOB);
    passwords.push(first4Name.toUpperCase() + first4DOB);
    // Also try YYYY (year) variant
    const year = dobDigits.length >= 8 ? dobDigits.slice(-4) : '';
    if (year) {
      passwords.push(first4Name + year.slice(0, 4));
    }
  }

  return [...new Set(passwords)];
}

/**
 * Clean OCR number: remove commas/spaces, handle Indian formatting
 * "4,39,215.01" → 439215.01
 * "49021501" (OCR glitch) → need smart parsing
 */
function parseINRNumber(raw) {
  if (!raw) return null;
  // Remove currency symbols, commas, spaces
  const clean = String(raw).replace(/[₹Rs,\s]/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

/**
 * Parse NPS text into structured data
 * Handles OCR noise from image-based PDFs
 */
function parseNPSText(text) {
  if (!text || text.length < 50) return null;

  const result = {
    pran:              null,
    subscriber_name:   null,
    registration_date: null,
    statement_from:    null,
    statement_to:      null,
    cbo_name:          null,
    tier:              'I',

    total_value:       null,
    total_contributions: null,
    total_withdrawals: 0,
    notional_gain:     null,
    xirr:              null,
    num_contributions: null,

    scheme_e_value:    null,  scheme_e_units: null,  scheme_e_nav: null,  scheme_e_pct: 75,
    scheme_c_value:    null,  scheme_c_units: null,  scheme_c_nav: null,  scheme_c_pct: 15,
    scheme_g_value:    null,  scheme_g_units: null,  scheme_g_nav: null,  scheme_g_pct: 10,
  };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── PRAN ────────────────────────────────────────────────────────
  const pranMatch = text.match(/PRAN[\s:]+(\d{12})/i);
  if (pranMatch) result.pran = pranMatch[1];

  // ── Subscriber Name ─────────────────────────────────────────────
  const nameMatch = text.match(/Subscriber\s+Nam[eo][\s:]+([A-Z][A-Z\s]{3,40})/i);
  if (nameMatch) result.subscriber_name = nameMatch[1].trim();

  // ── Registration Date ────────────────────────────────────────────
  const regMatch = text.match(/Registration\s+Date[\s:]+(\d{1,2}[-\/]\w+[-\/]\d{2,4}|\d{2}[A-Za-z]{3}[-]\d{2,4})/i);
  if (regMatch) {
    try {
      result.registration_date = new Date(regMatch[1]).toISOString().split('T')[0];
    } catch(e) {}
  }

  // ── Statement Period ─────────────────────────────────────────────
  const periodMatch = text.match(/(\w+\s+\d{1,2},?\s*\d{4})\s+[Tt]o\s+(\w+\s+\d{1,2},?\s*\d{4})/);
  if (periodMatch) {
    try {
      result.statement_from = new Date(periodMatch[1]).toISOString().split('T')[0];
      result.statement_to   = new Date(periodMatch[2]).toISOString().split('T')[0];
    } catch(e) {}
  }
  // Fallback: "Feb 01, 2026 To Feb 28, 2026"
  if (!result.statement_to) {
    const alt = text.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})\s+[Tt]o\s+(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
    if (alt) {
      try {
        result.statement_from = new Date(`${alt[1]} ${alt[2]} ${alt[3]}`).toISOString().split('T')[0];
        result.statement_to   = new Date(`${alt[4]} ${alt[5]} ${alt[6]}`).toISOString().split('T')[0];
      } catch(e) {}
    }
  }

  // ── CBO Name (employer) ──────────────────────────────────────────
  const cboMatch = text.match(/CBO\s+Name[\s:]+([A-Za-z][A-Za-z\s\.,\-]{5,60})/i);
  if (cboMatch) result.cbo_name = cboMatch[1].trim();

  // ── Investment Summary ───────────────────────────────────────────
  // "Value of your Holdings ... Feb 28, 2026 ... 4,39,215.01" 
  // Pattern: look for the summary table row
  const holdingsMatch = text.match(/Value of your Holdings[^0-9]*([0-9][0-9,]+\.?\d{0,2})/i);
  if (holdingsMatch) result.total_value = parseINRNumber(holdingsMatch[1]);

  // Total Contributions
  const contribMatch = text.match(/Total\s+Contribution[^0-9]*([0-9][0-9,]+\.?\d{0,2})/i);
  if (contribMatch) result.total_contributions = parseINRNumber(contribMatch[1]);

  // No of Contributions
  const numContribMatch = text.match(/No\s+of\s+Contributions[\s:]*(\d+)/i);
  if (numContribMatch) result.num_contributions = parseInt(numContribMatch[1]);

  // Total Withdrawal
  const withMatch = text.match(/Total\s+Withdrawal[^0-9]*([0-9][0-9,]+\.?\d{0,2})/i);
  if (withMatch) result.total_withdrawals = parseINRNumber(withMatch[1]) || 0;

  // Notional Gain/Loss — look for D=(A-B)+C pattern or the value after "Gain/Loss"
  const gainMatch = text.match(/Notional\s+Gain[\/\s]+Loss[^0-9\-]*(-?[0-9][0-9,]+\.?\d{0,2})/i);
  if (gainMatch) result.notional_gain = parseINRNumber(gainMatch[1]);

  // XIRR
  const xirrMatch = text.match(/XIRR[\s:)]+([0-9]+\.?\d{0,2})\s*%/i)
                 || text.match(/([0-9]+\.\d{2})\s*%/);
  if (xirrMatch) result.xirr = parseFloat(xirrMatch[1]);

  // ── Scheme-wise ──────────────────────────────────────────────────
  // NPS has Scheme E (Equity), C (Corporate), G (Govt)
  // Pattern: "SCHEME E" or "SCHEME C" or "SCHEME G" followed by value, units, NAV

  // Helper: extract scheme data
  function extractScheme(schemeLabel) {
    // Match scheme section and grab value, units, nav
    const pattern = new RegExp(
      `SCHEME\\s*${schemeLabel}[^]*?([0-9][0-9,]+\\.\\d{2})[^]*?([0-9,]+\\.\\d{4})[^]*?([0-9]+\\.\\d{4})`,
      'i'
    );
    const m = text.match(pattern);
    if (m) {
      return {
        value: parseINRNumber(m[1]),
        units: parseFloat(m[2].replace(/,/g, '')),
        nav:   parseFloat(m[3].replace(/,/g, '')),
      };
    }
    return null;
  }

  const schemeE = extractScheme('E');
  if (schemeE) {
    result.scheme_e_value = schemeE.value;
    result.scheme_e_units = schemeE.units;
    result.scheme_e_nav   = schemeE.nav;
  }

  const schemeC = extractScheme('C');
  if (schemeC) {
    result.scheme_c_value = schemeC.value;
    result.scheme_c_units = schemeC.units;
    result.scheme_c_nav   = schemeC.nav;
  }

  const schemeG = extractScheme('G');
  if (schemeG) {
    result.scheme_g_value = schemeG.value;
    result.scheme_g_units = schemeG.units;
    result.scheme_g_nav   = schemeG.nav;
  }

  // Compute total_value from schemes if top-level not found
  if (!result.total_value && result.scheme_e_value !== null) {
    result.total_value = (result.scheme_e_value || 0)
                       + (result.scheme_c_value || 0)
                       + (result.scheme_g_value || 0);
  }

  // Compute allocation %
  if (result.total_value > 0) {
    result.scheme_e_pct = result.scheme_e_value ? parseFloat(((result.scheme_e_value / result.total_value) * 100).toFixed(2)) : 0;
    result.scheme_c_pct = result.scheme_c_value ? parseFloat(((result.scheme_c_value / result.total_value) * 100).toFixed(2)) : 0;
    result.scheme_g_pct = result.scheme_g_value ? parseFloat(((result.scheme_g_value / result.total_value) * 100).toFixed(2)) : 0;
  }

  // Quality check
  if (!result.total_value && !result.scheme_e_value) return null;

  return result;
}

/**
 * Unlock and parse NPS PDF buffer
 */
async function parseNPSPDF(pdfBuffer, passwords = []) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

  for (const password of passwords) {
    try {
      const loadingTask = pdfjs.getDocument({
        data:     new Uint8Array(pdfBuffer),
        password: password,
      });
      const pdf  = await loadingTask.promise;
      let fullText = '';

      for (let p = 1; p <= pdf.numPages; p++) {
        const page    = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map(i => i.str).join(' ');
        fullText += pageText + '\n';
      }

      if (fullText.trim().length > 100) {
        const parsed = parseNPSText(fullText);
        if (parsed) return { ...parsed, raw_text_snippet: fullText.slice(0, 500) };
      }
    } catch (e) {
      if (!e.message?.includes('password')) {
        console.error('NPS PDF parse error:', e.message);
      }
    }
  }

  return null;
}

module.exports = { parseNPSText, parseNPSPDF, generateNPSPasswords };
