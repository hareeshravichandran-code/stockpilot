/**
 * NSE Client — fetches data from NSE India APIs
 * Handles session/cookie management required by NSE
 */
const axios = require('axios');

const BASE_URL = 'https://www.nseindia.com';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
  'Connection': 'keep-alive',
};

let cookieCache = null;
let cookieExpiry = 0;

async function getNSESession() {
  if (cookieCache && Date.now() < cookieExpiry) return cookieCache;
  const resp = await axios.get(BASE_URL, { headers, timeout: 10000 });
  const cookies = resp.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ') || '';
  cookieCache = cookies;
  cookieExpiry = Date.now() + 5 * 60 * 1000; // 5 min cache
  return cookies;
}

async function nseGet(url) {
  const cookies = await getNSESession();
  const resp = await axios.get(url, {
    headers: { ...headers, Cookie: cookies },
    timeout: 15000
  });
  return resp.data;
}

module.exports = { nseGet };
