/**
 * StockPilot - Gemini Flash Password Resolver
 * FREE: 1500 requests/day on Google AI Studio free tier
 * 
 * Reads email body + user profile → generates PDF password intelligently
 * Falls back to rule-based resolver if Gemini unavailable
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function resolvePasswordWithGemini(emailBody, emailFrom, emailSubject, userProfile) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('No GEMINI_API_KEY — using rule-based resolver');
    return null;
  }

  const { name, pan, dob, mobile, clientCode } = userProfile || {};

  // Format DOB for prompt
  let dobFormatted = 'not provided';
  let dd = '', mm = '', yyyy = '';
  if (dob) {
    const d = new Date(dob);
    if (!isNaN(d)) {
      dd = String(d.getDate()).padStart(2, '0');
      mm = String(d.getMonth() + 1).padStart(2, '0');
      yyyy = String(d.getFullYear());
      dobFormatted = `${dd}/${mm}/${yyyy}`;
    }
  }

  // Derive name variants for prompt
  const cleanName = (name || '').replace(/[^a-zA-Z ]/g, '').trim();
  const nameParts = cleanName.split(' ').filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  const fullNameNoSpaces = nameParts.join('').toUpperCase();

  const prompt = `You are an expert at determining PDF passwords for Indian broker and depository documents.

Read the email below carefully. Find password instructions. Generate the EXACT password.

EMAIL FROM: ${emailFrom}
EMAIL SUBJECT: ${emailSubject}
EMAIL BODY:
---
${emailBody.slice(0, 2000)}
---

USER PROFILE:
- Full Name: ${name || 'not provided'}
- First Name: ${firstName || 'not provided'}
- Last Name: ${lastName || 'not provided'}
- Full Name (no spaces, uppercase): ${fullNameNoSpaces || 'not provided'}
- PAN: ${pan ? pan.toUpperCase() : 'not provided'}
- Date of Birth: ${dobFormatted} (DD/MM/YYYY)
- DD=${dd}, MM=${mm}, YYYY=${yyyy}, YY=${yy}
- Mobile: ${mobile || 'not provided'}
- Mobile last 4: ${mobile ? mobile.slice(-4) : 'not provided'}
- Client Code: ${clientCode || 'not provided'}

COMMON INDIAN PASSWORD PATTERNS (try in this order):
1. NSDL/CDSL CAS: PAN uppercase → ${pan ? pan.toUpperCase() : '?'}
2. NSDL eCAS: PAN uppercase (most common)
3. ICICI Direct: first 4 of name lowercase + DDMM → ${firstName.slice(0,4).toLowerCase()}${dd}${mm}
4. HDFC Sec: PAN + DDMMYYYY → ${pan ? pan.toUpperCase() : '?'}${dd}${mm}${yyyy}
5. Angel One: first 4 of name uppercase + DDMMYYYY → ${firstName.slice(0,4).toUpperCase()}${dd}${mm}${yyyy}
6. Zerodha: client code → ${clientCode || '?'}
7. 5paisa: mobile last 4 + DDMMYYYY → ${mobile ? mobile.slice(-4) : '?'}${dd}${mm}${yyyy}
8. Motilal Oswal: PAN uppercase
9. Kotak: client code or PAN
10. Groww: PAN uppercase
11. Name-based: first 4-6 letters of full name (no spaces) in various cases
12. DOB only: DDMMYYYY → ${dd}${mm}${yyyy}

RULES:
1. Search email body for EXPLICIT password hint text first — highest priority
2. If sender is nsdl.co.in or cdslindia.com → password is almost always PAN uppercase
3. For name passwords: strip spaces/dots/special chars, take first N letters
4. Generate up to 3 candidate passwords ranked by confidence
5. Return ONLY valid JSON

Return this exact JSON:
{"password":"best_candidate","alternatives":["pwd2","pwd3"],"logic":"brief explanation","confidence":"high/medium/low"}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Parse JSON — strip any markdown if present
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    
    if (parsed.password) {
      // Add alternatives to try list
      if (parsed.alternatives) {
        parsed._allPasswords = [parsed.password, ...parsed.alternatives].filter(Boolean);
      }
      console.log(JSON.stringify({ event: 'GEMINI_PASSWORD', password: parsed.password, alternatives: parsed.alternatives, confidence: parsed.confidence, logic: parsed.logic }));
      return parsed.password;
    }
    return null;
  } catch (err) {
    console.error('Gemini resolver error:', err.message);
    return null;
  }
}

/**
 * Decrypt password-protected PDF using qpdf via child process
 * qpdf is available on Railway (Linux) as a system package
 */
async function decryptPDF(pdfBuffer, password) {
  const { execSync, spawnSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `sp_input_${Date.now()}.pdf`);
  const outputPath = path.join(tmpDir, `sp_output_${Date.now()}.pdf`);

  try {
    fs.writeFileSync(inputPath, pdfBuffer);
    
    // Try qpdf to decrypt
    const result = spawnSync('qpdf', [
      '--password=' + password,
      '--decrypt',
      inputPath,
      outputPath
    ], { timeout: 15000 });

    if (result.status === 0 && fs.existsSync(outputPath)) {
      const decrypted = fs.readFileSync(outputPath);
      return decrypted;
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(inputPath); } catch(e) {}
    try { fs.unlinkSync(outputPath); } catch(e) {}
  }
}

/**
 * Main smart PDF resolver:
 * 1. Try without password
 * 2. Ask Gemini to read email and generate password
 * 3. Decrypt PDF with qpdf
 * 4. Parse decrypted PDF with pdf-parse
 * 5. Fall back to rule-based resolver
 */
async function resolvePDFPasswordSmart(pdfBuffer, emailBody, emailFrom, emailSubject, userProfile) {
  const pdfParse = require('pdf-parse');

  // Step 1: Try without password
  try {
    const result = await pdfParse(pdfBuffer);
    if (result.text && result.text.trim().length > 100) {
      console.log('PDF opened without password');
      return result.text;
    }
  } catch (e) {
    console.log('PDF is password protected');
  }

  // Step 2: Ask Gemini for password (returns main + alternatives)
  const aiResult = await resolvePasswordWithGemini(emailBody, emailFrom, emailSubject, userProfile);

  // Step 3: Try ALL Gemini passwords (main + alternatives)
  if (aiResult) {
    const mainPwd = typeof aiResult === 'string' ? aiResult : aiResult.password;
    const alternatives = aiResult._allPasswords || [mainPwd];
    
    // Build full candidate list including case variants
    const candidates = [];
    for (const pwd of alternatives) {
      if (pwd) {
        candidates.push(pwd);
        candidates.push(pwd.toUpperCase());
        candidates.push(pwd.toLowerCase());
      }
    }
    const uniqueCandidates = [...new Set(candidates)].filter(Boolean);
    
    console.log(JSON.stringify({ event: 'TRYING_PASSWORDS', count: uniqueCandidates.length, passwords: uniqueCandidates }));

    for (const pwd of uniqueCandidates) {
      // Try pdf-parse directly with password
      try {
        const result = await pdfParse(pdfBuffer, { password: pwd });
        if (result.text && result.text.trim().length > 100) {
          console.log(JSON.stringify({ event: 'PDF_UNLOCKED', method: 'pdf-parse', password: pwd }));
          return result.text;
        }
      } catch (e) {}

      // Try qpdf decrypt + pdf-parse
      const decrypted = await decryptPDF(pdfBuffer, pwd);
      if (decrypted) {
        try {
          const result = await pdfParse(decrypted);
          if (result.text && result.text.trim().length > 100) {
            console.log(JSON.stringify({ event: 'PDF_UNLOCKED', method: 'qpdf', password: pwd }));
            return result.text;
          }
        } catch (e) {}
      }
    }
    console.log(JSON.stringify({ event: 'ALL_GEMINI_PASSWORDS_FAILED', tried: uniqueCandidates }));
  }

  // Step 4: Rule-based fallback
  const { resolvePDFPassword } = require('./pdfPasswordResolver');
  return await resolvePDFPassword(pdfBuffer, emailBody, emailFrom, emailSubject, userProfile);
}

module.exports = { resolvePDFPasswordSmart, resolvePasswordWithGemini };
