const { google } = require('googleapis');

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

async function fetchEmails(accessToken, refreshToken, query = '') {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Search for broker + dividend emails
  const searchQuery = query ||
    'from:(zerodha.com OR groww.in OR angelbroking.com OR upstox.com OR cdsl.com OR nsdl.co.in) OR subject:(dividend OR "contract note" OR "trade confirmation")';

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,
    maxResults: 100
  });

  const messages = listRes.data.messages || [];
  const emails = [];

  for (const msg of messages.slice(0, 50)) { // process latest 50
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

      // Extract body
      let body = '';
      const parts = detail.data.payload?.parts || [];
      if (parts.length > 0) {
        const textPart = parts.find(p => p.mimeType === 'text/plain') || parts[0];
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (detail.data.payload?.body?.data) {
        body = Buffer.from(detail.data.payload.body.data, 'base64').toString('utf-8');
      }

      emails.push({ id: msg.id, subject, from, date, body });
    } catch (e) {
      console.error('Error fetching email:', msg.id, e.message);
    }
  }

  return emails;
}

module.exports = { getAuthUrl, exchangeCode, fetchEmails };
