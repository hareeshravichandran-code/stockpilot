const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// Node 18's native fetch (undici) has a well-documented bug where it
// reuses a stale keep-alive socket, causing intermittent
// "TypeError: fetch failed" on POST/insert requests specifically —
// GET/select requests are far less likely to hit a stale socket since
// they're typically the first request in a sequence. Disabling keepalive
// forces a fresh connection per request, which avoids this entirely.
const noKeepAliveFetch = (url, options = {}) =>
  fetch(url, { ...options, keepalive: false });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: {
      transport: ws,
    },
    global: {
      fetch: noKeepAliveFetch,
    },
  }
);

module.exports = supabase;
