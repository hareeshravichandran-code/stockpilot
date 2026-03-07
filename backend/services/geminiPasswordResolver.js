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

  const prompt = `You are an expert at determining PDF passwords for Indian broker and depository documents.

Read the email below carefully. Find the password instructions. Generate the exact password.

EMAIL FROM: ${emailFrom}
EMAIL SUBJECT: ${emailSubject}
EMAIL BODY:
---
${emailBody.slice(0, 1500)}
---

USER DATA:
- Full Name: ${name || 'not provided'}
- PAN: ${pan ? pan.toUpperCase() : 'not provided'}
- Date of Birth: ${dobFormatted} (DD/MM/YYYY format)
- DD=${dd}, MM=${mm}, YYYY=${yyyy}
- Mobile: ${mobile || 'not provided'}
- Client Code: ${clientCode || 'not provided'}

COMMON INDIAN BROKER PASSWORD PATTERNS:
- CDSL/NSDL CAS: PAN in uppercase (e.g. ABCDE1234F)
- ICICI Direct contract note: first 4 letters of name in lowercase + DDMM (e.g. hare0115)
- HDFC Sec: PAN + DDMMYYYY (e.g. ABCDE1234F01011980)
- Angel One: first 4 letters of name uppercase + DDMMYYYY
- Zerodha: client ID (e.g. ZX1234)
- 5paisa: last 4 digits of mobile + DDMMYYYY

RULES:
1. Read the email for EXPLICIT password instructions first
2. If no instructions found, use the broker-specific pattern above
3. For name-based passwords: remove spaces/dots/special chars first, then take first N letters
4. Return ONLY valid JSON, no markdown, no explanation outside JSON

Return this exact JSON:
{"password":"generated_password","logic":"brief explanation","confidence":"high/medium/low"}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Parse JSON — strip any markdown if present
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    
    if (parsed.password) {
      console.log(`Gemini resolved password (${parsed.confidence}): ${parsed.logic}`);
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

  // Step 2: Ask Gemini for password
  const aiPassword = await resolvePasswordWithGemini(emailBody, emailFrom, emailSubject, userProfile);

  // Step 3: Try Gemini password — decrypt then parse
  if (aiPassword) {
    const passwords = [aiPassword, aiPassword.toUpperCase(), aiPassword.toLowerCase()];
    for (const pwd of passwords) {
      // Try pdf-parse directly with password
      try {
        const result = await pdfParse(pdfBuffer, { password: pwd });
        if (result.text && result.text.trim().length > 100) {
          console.log(`PDF unlocked with Gemini password`);
          return result.text;
        }
      } catch (e) {}

      // Try qpdf decrypt + pdf-parse
      const decrypted = await decryptPDF(pdfBuffer, pwd);
      if (decrypted) {
        try {
          const result = await pdfParse(decrypted);
          if (result.text && result.text.trim().length > 100) {
            console.log(`PDF unlocked via qpdf + Gemini password`);
            return result.text;
          }
        } catch (e) {}
      }
    }
    console.log('Gemini password did not work, trying rule-based...');
  }

  // Step 4: Rule-based fallback
  const { resolvePDFPassword } = require('./pdfPasswordResolver');
  return await resolvePDFPassword(pdfBuffer, emailBody, emailFrom, emailSubject, userProfile);
}

module.exports = { resolvePDFPasswordSmart, resolvePasswordWithGemini };
