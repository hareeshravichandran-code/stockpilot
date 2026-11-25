/** K-203: family net worth counts EPF from the EPF module (epf_accounts), never twice. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { db, uid } = H;
let api;
before(async () => { api = await H.server([['/api/blueprint', 'blueprint.js']]); });
after(async () => { await api.close(); });
beforeEach(() => H.reset());

test('EPF account balance is part of net worth; the old zero EPF figure does not hide it', async () => {
  db._seed('epf_accounts', [{ id: 'e1', user_id: uid, member_key: '5230', status: 'active', balance: 975138 }]);
  db._seed('asset_balances', [{ user_id: uid, asset_type: 'EPF', balance: 0 }]);
  const r = await api.call('GET', '/api/blueprint/networth');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.parts.find(p => p.name === 'EPF')?.value, 975138);
  assert.equal(r.body.total, 975138);
});
test('closed EPF accounts are left out; no double count with the old EPF figure', async () => {
  db._seed('epf_accounts', [{ id: 'e1', user_id: uid, status: 'active', balance: 500000 }, { id: 'e2', user_id: uid, status: 'closed', balance: 90000 }]);
  db._seed('asset_balances', [{ user_id: uid, asset_type: 'EPF', balance: 480000 }]);
  const r = await api.call('GET', '/api/blueprint/networth');
  assert.equal(r.body.parts.find(p => p.name === 'EPF')?.value, 500000);
});

test('K-204: investments block — funds and stocks against what was put in, dividends this FY', async () => {
  db._seed('mf_holdings', [{ id: 1, user_id: uid, fund_name: 'Index fund', units: 100, current_value: 120000, invested_value: 100000 }]);
  db._seed('holdings', [{ user_id: uid, symbol: 'TCS', quantity: 10, avg_cost: 3000, last_price: 3500 }]);
  const ist = new Date(Date.now() + 330 * 60000);
  db._seed('dividend_income', [{ user_id: uid, total_dividend: 250, ex_date: ist.toISOString().slice(0, 10) }]);
  const r = await api.call('GET', '/api/blueprint/networth');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.invest.mf, { value: 120000, invested: 100000, count: 1 });
  assert.equal(r.body.invest.stocks.value, 35000); assert.equal(r.body.invest.stocks.invested, 30000);
  assert.equal(r.body.invest.dividends.fy, 250); assert.match(r.body.invest.dividends.fy_label, /^FY \d{4}-\d{2}$/);
});
