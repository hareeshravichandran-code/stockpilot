/**
 * HTTP routes behind the web and the phone: events + SMS rules, opening / sorting a payment, month totals.
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { db, uid, txn, ist, istToday } = H;
const rows = (name) => db._tables[name] || [];
let api;

before(async () => { api = await H.server([['/api/events', 'events.js'], ['/api/expense', 'expenseTransactions.js'], ['/api/moneyflow', 'moneyflow.js'], ['/api/expense', 'expenseSync.js'], ['/api/expense', 'expenseSmsRules.js']]); });
after(async () => { await api.close(); });
beforeEach(() => H.reset());

describe('events and SMS rules API', () => {
  test('a rule needs a category', async () => {
    const r = await api.call('POST', '/api/events/rules', { sender_key: 'ICICIT', amount_min: 100, amount_max: 200 });
    assert.equal(r.status, 400);
  });
  test('a sender-only rule needs words or an amount', async () => {
    const r = await api.call('POST', '/api/events/rules', { sender_key: 'ICICIT', category_id: 'food_dining' });
    assert.equal(r.status, 400);
  });
  test('a rule with sender + amount and no words is saved (id from the database)', async () => {
    const r = await api.call('POST', '/api/events/rules', { sender_key: 'JX-ICICIT-S', amount_min: 100, amount_max: 200, category_id: 'food_dining' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(rows('user_sms_rules')[0].sender_key, 'ICICIT');
    assert.ok(rows('user_sms_rules')[0].id);
  });
  test('an event needs a name, a category and a due day', async () => {
    assert.equal((await api.call('POST', '/api/events', { title: 'Rent', kind: 'rent', frequency: 'monthly', due_day: 5 })).status, 400);
    const ok = await api.call('POST', '/api/events', { title: 'Rent', kind: 'rent', category_id: 'rent_house', frequency: 'monthly', due_day: 5, amount: 18000 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(rows('recurring_events')[0].remind_days >= 0, true, 'remind days always set (column is NOT NULL)');
  });
  test('picking the payment for a due date marks it done and always saves a rule', async () => {
    const ev = (await api.call('POST', '/api/events', { title: 'Claude', kind: 'subscription', category_id: 'p_membership', frequency: 'monthly', due_day: 9, amount: 1982.4 })).body.event;
    db._seed('expense_transactions', [txn({ amount: 1982.4, sms_sender: 'BP-ICICIT-T', category_id: 'nach', date_time: ist('2026-10-07') })]);
    const t = rows('expense_transactions')[0];
    const r = await api.call('POST', `/api/events/${ev.id}/occurrences/2026-10-09`, { action: 'match', txn_id: t.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.rule?.created, 'rule saved');
    const rule = rows('user_sms_rules').find(x => x.event_id === ev.id);
    assert.equal(rule.sender_key, 'ICICIT');
    assert.equal(rule.category_id, 'p_membership');
    assert.equal(rows('event_payments')[0].period, '2026-10-09');
    assert.equal(rows('expense_transactions')[0].category_id, 'p_membership');
    // "Not this payment": opens the date again and remembers it
    await api.call('DELETE', `/api/events/${ev.id}/occurrences/2026-10-09`);
    assert.equal(rows('event_payments').length, 0);
    assert.deepEqual(rows('expense_transactions')[0].event_skip, [ev.id]);
  });
});

describe('a payment opened on the phone', () => {
  test('GET by id returns it; assigning a category saves it and leaves the rest alone', async () => {
    db._seed('expense_transactions', [txn({ amount: 250, merchant: 'Chai Point', date_time: ist(istToday()) })]);
    const t = rows('expense_transactions')[0];
    const got = await api.call('GET', `/api/expense/transactions/${t.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.id, t.id);
    const put = await api.call('PUT', `/api/expense/transactions/${t.id}`, { category_id: 'food_beverages' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const after = rows('expense_transactions')[0];
    assert.equal(after.category_id, 'food_beverages');
    assert.equal(after.amount, 250, 'amount untouched');
    assert.equal((await api.call('GET', '/api/expense/transactions/00000000-0000-0000-0000-000000000000')).status, 404);
  });
});

describe('phone upload', () => {
  test('the same payment uploaded twice answers 200 with the saved row, not a 500', async () => {
    const body = { amount: 499, type: 'DEBIT', date_time: ist(istToday()), reference_no: 'UTR123', category_id: 'food_dining' };
    assert.equal((await api.call('POST', '/api/expense/transactions', body)).status, 201);
    const again = await api.call('POST', '/api/expense/transactions', body);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(rows('expense_transactions').length, 1);
  });
  test('an SMS rule without a category is refused with 400', async () => {
    assert.equal((await api.call('POST', '/api/expense/sms-rules', { merchant_pattern: 'swiggy' })).status, 400);
  });
});

describe('month totals (Overview "This month", Money flow)', () => {
  test('counted even when the account has more than 1000 transactions in the window', async () => {
    const month = istToday().slice(0, 7);
    const old = ist(`${month}-01`) - 150 * 864e5;
    db._seed('expense_transactions', Array.from({ length: 1500 }, (_, i) => txn({ amount: 10, category_id: 'food_dining', merchant: 'Old ' + (i % 30), date_time: old + i * 3600e3 })));
    db._seed('expense_transactions', [
      txn({ amount: 1234, category_id: 'food_dining', merchant: 'Dinner', date_time: ist(`${month}-01`, '20:00') }),
      txn({ type: 'CREDIT', amount: 50000, category_id: 'salary', merchant: 'Employer', date_time: ist(`${month}-01`, '09:00') }),
    ]);
    const r = await api.call('GET', `/api/moneyflow?month=${month}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.totals.expense.actual >= 1234, `spent this month should include 1234, got ${r.body.totals.expense.actual}`);
    assert.ok(r.body.totals.income.actual >= 50000, `came in should include 50000, got ${r.body.totals.income.actual}`);
  });
});

describe('phone sync', () => {
  test('a first pull brings every transaction, not just the first 1000', async () => {
    db._seed('expense_transactions', Array.from({ length: 1500 }, (_, i) => txn({ amount: i + 1, date_time: ist(istToday()) - i * 60000, updated_at: 1000 + i })));
    const r = await api.call('GET', '/api/expense/sync/pull?last_sync_at=0');
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal(r.body.transactions.length, 1500);
  });
});
