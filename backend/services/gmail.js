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

// Try to parse a PDF buffer, attempting multiple passwords if needed
async function parsePdfWithPasswords(pdfBuffer, passwords = [], filename = '') {
  const pdfParse = require('pdf-parse');

  // Try without password first
  try {
    const result = await pdfParse(pdfBuffer);
    if (result.text?.trim().length > 50) {
      console.log(JSON.stringify({ event: 'PDF_NO_PASSWORD', filename, chars: result.text.length, preview: result.text.slice(0,100) }));
      return { text: result.text, passwordUsed: null };
    } else {
      console.log(JSON.stringify({ event: 'PDF_EMPTY_NO_PASSWORD', filename, chars: result.text?.length || 0 }));
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'PDF_NEEDS_PASSWORD', filename, error: e.message }));
  }

  // Try each password
  for (const password of passwords) {
    try {
      const result = await pdfParse(pdfBuffer, { password });
      if (result.text?.trim().length > 50) {
        console.log(`PDF unlocked with password for: ${filename}`);
        return { text: result.text, passwordUsed: password };
      }
    } catch (e) {
      // Wrong password, try next
    }
  }

  console.log(JSON.stringify({ 
    event: 'PDF_ALL_PASSWORDS_FAILED', 
    filename, 
    tried: passwords.length,
    passwords: passwords.slice(0, 5) // log first 5 for debugging
  }));
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
      try {
        let pdfData;

        if (part.body?.data) {
          pdfData = Buffer.from(part.body.data, 'base64');
        } else if (part.body?.attachmentId) {
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: part.body.attachmentId
          });
          if (attachment.data?.data) {
            pdfData = Buffer.from(attachment.data.data, 'base64');
          }
        }

        if (pdfData) {
          try {
            const text = await resolvePDFPasswordSmart(
              pdfData,
              body || '',        // email body for Gemini context
              emailFrom || '',
              emailSubject || '',
              userProfile || {}
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
  return { body: combinedText, hasPdf: pdfCount > 0, pdfFailed };
}

async function fetchEmails(accessToken, refreshToken, query = '', userProfile = {}) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Generate PDF passwords from user's PAN + DOB
  const pdfPasswords = generatePdfPasswords(userProfile.pan, userProfile.dob);
  if (pdfPasswords.length > 0) {
    console.log(JSON.stringify({ event: 'PDF_PASSWORDS', count: pdfPasswords.length, first3: pdfPasswords.slice(0,3) }));
  }

  const searchQuery = query ||
    'from:(zerodha.com OR groww.in OR angelbroking.com OR angelone.in OR upstox.com OR icicidirect.com OR hdfcsec.com OR kotaksecurities.com OR sbisec.co.in OR motilaloswal.com OR sharekhan.com OR 5paisa.com OR axisdirect.in OR indiainfoline.com OR iifl.com OR paytmmoney.com OR dhan.co OR fyers.in OR cdsl.com OR nsdl.co.in OR cdslindia.com OR cvlindia.com OR nsdl.org.in) OR subject:(dividend OR "contract note" OR "trade confirmation" OR "order executed" OR "trade executed" OR "contract note cum bill" OR "CAS statement" OR "consolidated account statement" OR "holding statement" OR "demat account")';

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,
    maxResults: 200
  });

  const messages = listRes.data.messages || [];
  const emails = [];

  console.log(`Found ${messages.length} matching emails`);

  for (const msg of messages.slice(0, 100)) {
    try {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      const headers = detail.data.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      const { body, hasPdf, pdfFailed } = await extractEmailContent(
        gmail, msg.id, detail.data.payload || {}, pdfPasswords, userProfile, from, subject
      );

      emails.push({ id: msg.id, subject, from, date, body, hasPdf, pdfFailed });

    } catch (e) {
      console.error('Error fetching email:', msg.id, e.message);
    }
  }

  return emails;
}

module.exports = { getAuthUrl, exchangeCode, fetchEmails, generatePdfPasswords };
