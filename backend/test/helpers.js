/**
 * Test wiring: every require of services/supabase gets the strict in-memory database, and the HTTP
 * routes run in a real Express app with a real signed token. Load this before any route or service.
 */
const path = require('path');
const crypto = require('crypto');
const { makeDb } = require('./fakeSupabase');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'fake';

const db = makeDb();
const supaPath = path.join(__dirname, '..', 'services', 'supabase.js');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: db };

const uid = crypto.randomUUID();
const token = require('jsonwebtoken').sign({ id: uid, userId: uid, sub: uid }, process.env.JWT_SECRET);

/** Milliseconds for an India date + time ("2026-11-07", "10:30"). */
const ist = (d, time = '10:00') => Date.parse(`${d}T${time}:00+05:30`);
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function txn(o) {
  return { user_id: uid, type: 'DEBIT', is_deleted: false, category_id: null, merchant: null, sms_sender: 'JX-ICICIT-S', bank_name: 'ICICI Bank', ...o };
}

/** Express app with the given routers mounted, listening on a random port. */
async function server(mounts) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const [at, file] of mounts) app.use(at, require(path.join(__dirname, '..', 'routes', file)));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, close: () => new Promise(r => srv.close(r)) };
}

function reset() { for (const k of Object.keys(db._tables)) delete db._tables[k]; }

module.exports = { db, uid, token, ist, istToday, shift, txn, server, reset };
