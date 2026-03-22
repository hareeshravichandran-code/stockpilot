const { google } = require('googleapis');
const { resolvePDFPasswordSmart } = require('./geminiPasswordResolver');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(userId) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state: userId,
    prompt: 'consent'
  });
}

async function exchangeCode(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Generate all possible PDF passwords for Indian brokers
function generatePdfPasswords(pan, dob) {
  const passwords = [];
  if (!pan && !dob) return passwords;

  const p = pan?.toUpperCase() || '';
  
  // Normalize DOB to DDMMYYYY regardless of input format
  // Supabase DATE returns YYYY-MM-DD, we need DDMMYYYY
  let d = '';
  if (dob) {
    if (dob.includes('-') && dob.length === 10) {
      // YYYY-MM-DD format from Supabase
      const [yyyy, mm, dd] = dob.split('-');
      d = dd + mm + yyyy;
    } else {
      d = dob; // Already DDMMYYYY
    }
  }
  const dd = d.slice(0, 2);
  const mm = d.slice(2, 4);
  const yyyy = d.slice(4, 8);
  const yy = yyyy.slice(2, 4);

  if (p) {
    passwords.push(p);
    passwords.push(p.toLowerCase());
  }
  if (p && d) {
    passwords.push(p + d);
    passwords.push(p.toLowerCase() + d);
    passwords.push(p + dd + '/' + mm + '/' + yyyy);
    passwords.push(p + dd + mm + yyyy);
    passwords.push(p + dd + mm + yy);
    passwords.push(p.toLowerCase() + dd + mm + yyyy);
    passwords.push(dd + mm + yyyy);
    passwords.push(yyyy + mm + dd);
    passwords.push(dd + '-' + mm + '-' + yyyy);
  }
  if (d) {
    passwords.push(d);
    passwords.push(dd + mm + yyyy);
  }

  return [...new Set(passwords)].filter(Boolean);
}

// Extract text from PDF using pdfjs-dist (supports password-protected PDFs natively)
async function parsePdfWithPasswords(pdfBuffer, passwords = [], filename = '') {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const allPasswords = ['', ...passwords].filter((v, i, a) => a.indexOf(v) === i);

  for (const password of allPasswords) {
    try {
      const loadingTask = pdfjsLib.getDocument({ 
        data: new Uint8Array(pdfBuffer),
        password: password || ''
      });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(' ') + '\n';
      }
      const textLen = fullText.trim().length;
      // Require >500 chars for passwordless - nomination page alone is ~200 chars, full CAS is 5000+
      const minLen = password ? 100 : 500;
      if (textLen > minLen) {
        console.log(JSON.stringify({ event: 'PDF_UNLOCKED', filename, password: password ? '***' : 'none', chars: textLen, preview: fullText.slice(0,150).replace(/\n/g,' ') }));
        return { text: fullText, passwordUsed: password || null };
      } else {
        console.log(JSON.stringify({ event: 'PDF_TOO_SHORT', filename, password: password ? '***' : 'none', chars: textLen, minLen }));
      }
    } catch (e) {
      if (e.name === 'PasswordException') {
        // Wrong password, try next
      } else {
        console.log(JSON.stringify({ event: 'PDF_ERROR', filename, error: e.message }));
      }
    }
  }

  console.log(JSON.stringify({ event: 'PDF_ALL_PASSWORDS_FAILED', filename, tried: allPasswords.length, sample: allPasswords.slice(0,3) }));

  // ── Gemini Vision OCR fallback for image-based PDFs ──────────────
  // When pdfjs extracts no text (scanned/image PDF), send to Gemini for OCR
  if (process.env.GEMINI_API_KEY && pdfBuffer.length > 0) {
    try {
      console.log(JSON.stringify({ event: 'PDF_GEMINI_OCR_START', filename, bytes: pdfBuffer.length }));
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const result = await model.generateContent([
        { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
        'Extract ALL text from this financial document. Preserve every number exactly as printed. Focus especially on: PRAN number, Subscriber Name, statement period dates, Investment Summary table (Holdings value, Total Contribution, Notional Gain/Loss, XIRR %), and Scheme-wise breakdown (Scheme E/C/G values, units, NAV). Return plain text only, no formatting.'
      ]);
      const ocrText = result.response.text();
      if (ocrText && ocrText.trim().length > 100) {
        console.log(JSON.stringify({ event: 'PDF_GEMINI_OCR_SUCCESS', filename, chars: ocrText.length, preview: ocrText.slice(0, 200) }));
        return { text: ocrText, passwordUsed: 'gemini-vision-ocr', geminiOCR: true };
      }
    } catch (gemErr) {
      console.error(JSON.stringify({ event: 'PDF_GEMINI_OCR_FAILED', filename, error: gemErr.message }));
    }
  }

  return { text: '', passwordUsed: null, failed: true };
}

// Extract text from all parts of an email (body + PDF attachments)
async function extractEmailContent(gmail, messageId, payload, pdfPasswords = [], userProfile = {}, emailFrom = '', emailSubject = '') {
  let body = '';
  let pdfTexts = [];
  let pdfCount = 0;
  let pdfFailed = 0;

  async function processPart(part) {
    const mime = part.mimeType || '';

    if (mime === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }

    if (mime === 'text/html' && part.body?.data && !body) {
      const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
      body += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }

    // PDF attachment
    if (mime === 'application/pdf' || (part.filename && part.filename.toLowerCase().endsWith('.pdf'))) {
      pdfCount++;
      console.log(JSON.stringify({ 
        event: 'PDF_PART_FOUND', 
        mime, 
        filename: part.filename, 
        hasData: !!part.body?.data, 
        hasAttachmentId: !!part.body?.attachmentId,
        bodySize: part.body?.size,
        partId: part.partId
      }));
      try {
        let pdfData;

        if (part.body?.data) {
          pdfData = Buffer.from(part.body.data, 'base64');
          console.log(JSON.stringify({ event: 'PDF_INLINE', filename: part.filename, bytes: pdfData.length }));
        } else if (part.body?.attachmentId) {
          console.log(JSON.stringify({ event: 'PDF_FETCHING_ATTACHMENT', filename: part.filename, attachmentId: part.body.attachmentId }));
          try {
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId,
              id: part.body.attachmentId
            });
            if (attachment.data?.data) {
              pdfData = Buffer.from(attachment.data.data, 'base64');
              console.log(JSON.stringify({ event: 'PDF_ATTACHMENT_FETCHED', filename: part.filename, bytes: pdfData.length }));
            } else {
              console.log(JSON.stringify({ event: 'PDF_ATTACHMENT_EMPTY', filename: part.filename }));
            }
          } catch (fetchErr) {
            console.log(JSON.stringify({ event: 'PDF_ATTACHMENT_FETCH_ERROR', filename: part.filename, error: fetchErr.message }));
          }
        } else {
          console.log(JSON.stringify({ event: 'PDF_NO_DATA', filename: part.filename, bodyKeys: Object.keys(part.body || {}) }));
        }

        if (pdfData) {
          try {
            const { text } = await parsePdfWithPasswords(
              pdfData,
              pdfPasswords,
              part.filename || 'attachment'
            );
            if (text && text.trim().length > 50) {
              console.log(JSON.stringify({ event: 'PDF_UNLOCKED_GEMINI', filename: part.filename, chars: text.length }));
              pdfTexts.push(text);
            } else {
              pdfFailed++;
              pdfTexts.push(`[PDF: ${part.filename || 'attachment'} could not be unlocked. Please check your PAN/DOB in Profile settings.]`);
            }
          } catch (geminiErr) {
            console.log(JSON.stringify({ event: 'PDF_GEMINI_FAILED', filename: part.filename, error: geminiErr.message }));
            pdfFailed++;
            pdfTexts.push(`[PDF: ${part.filename || 'attachment'} could not be unlocked. Please check your PAN/DOB in Profile settings.]`);
          }
        }
      } catch (e) {
        console.error('PDF error:', part.filename, e.message);
        pdfFailed++;
      }
    }

    if (part.parts?.length > 0) {
      for (const subpart of part.parts) {
        await processPart(subpart);
      }
    }
  }

  if (payload.parts?.length > 0) {
    for (const part of payload.parts) {
      await processPart(part);
    }
  } else if (payload.body?.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  const combinedText = [body, ...pdfTexts].join('\n\n--- PDF ATTACHMENT ---\n\n');
  console.log(JSON.stringify({ event: 'EMAIL_ASSEMBLED', pdfCount, pdfTextsCount: pdfTexts.length, pdfFailed, bodyLen: body?.length || 0, combinedLen: combinedText.length, hasMarker: combinedText.includes('--- PDF ATTACHMENT ---'), pdfPreview: pdfTexts[0]?.slice(0,150) || 'EMPTY' }));
  return { body: combinedText, hasPdf: pdfCount > 0, pdfFailed };
}

async function fetchEmails(accessToken, refreshToken, query = '', userProfile = {}, options = {}) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Generate PDF passwords from user's PAN + DOB
  // CAS passwords (NSDL/CDSL format)
  const pdfPasswords = generatePdfPasswords(userProfile.pan, userProfile.dob);
  
  // NPS passwords (first4name + DDMM) - prepend so they're tried first for NPS PDFs
  if (userProfile.npsPasswords && Array.isArray(userProfile.npsPasswords)) {
    pdfPasswords.unshift(...userProfile.npsPasswords);
  }
  if (pdfPasswords.length > 0) {
    console.log(JSON.stringify({ event: 'PDF_PASSWORDS_READY', count: pdfPasswords.length, panSet: !!userProfile.pan, dobSet: !!userProfile.dob }));
  } else {
    console.log(JSON.stringify({ event: 'PDF_PASSWORDS_MISSING', warning: 'PAN and DOB not set — password-protected PDFs will fail. Ask user to set in Profile & PAN settings.' }));
  }

  // Use the passed query directly — caller is responsible for building correct query
  const searchQuery = query || 'from:(nsdl.co.in OR cdslindia.com OR cvlindia.com)';
  console.log(JSON.stringify({ event: 'GMAIL_QUERY', query: searchQuery }));

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,
    maxResults: options.maxResults || 5
  });

  const messages = listRes.data.messages || [];
  const emails = [];

  console.log(JSON.stringify({ event: 'GMAIL_MESSAGES_FOUND', count: messages.length }));

  for (const msg of messages.slice(0, options.maxResults || 5)) {
    try {
      // Fetch full message with hard 15s per-email timeout (prevents Railway timeout)
      const detail = await Promise.race([
        gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Email fetch timed out after 15s')), 15000))
      ]);

      const headers = detail.data.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from    = headers.find(h => h.name === 'From')?.value    || '';
      const date    = headers.find(h => h.name === 'Date')?.value    || '';

      console.log(JSON.stringify({ event: 'EMAIL_PROCESSING', subject, from, date }));

      const { body, hasPdf, pdfFailed } = await extractEmailContent(
        gmail, msg.id, detail.data.payload || {}, pdfPasswords, userProfile, from, subject
      );

      emails.push({ id: msg.id, subject, from, date, body, hasPdf, pdfFailed });

    } catch (e) {
      console.error(JSON.stringify({ event: 'EMAIL_FETCH_ERROR', msgId: msg.id, error: e.message }));
    }
  }

  return emails;
}

module.exports = { getAuthUrl, exchangeCode, fetchEmails, generatePdfPasswords };
