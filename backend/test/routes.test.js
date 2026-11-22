/**
 * HTTP routes behind the web and the phone: events + SMS rules, opening / sorting a payment, month totals.
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { db, uid, txn, ist, istToday } = H;
const rows = (name) => db._tables[name] || [];
let api;

before(async () => { api = await H.server([['/api/events', 'events.js'], ['/api/expense', 'expenseTransactions.js'], ['/api/moneyflow', 'moneyflow.js'], ['/api/expense', 'expenseSync.js'], ['/api/expense', 'expenseSmsRules.js'], ['/api', 'appReports.js']]); });
after(async () => { await api.close(); });
beforeEach(() => H.reset());

describe('events and SMS rules API', () => {
  test('a rule needs a category', async () => {
    const r = await api.call('POST', '/api/events/rules', { sender_key: 'ICICIT', amount_min: 100, amount_max: 200 });
    assert.equal(r.status, 400);
  });
  test('K-145: a rule on card digits alone is allowed (card bills change amount)', async () => {
    const r = await api.call('POST', '/api/events/rules', { account_ref: 'XX6007', category_id: 'cc_bill' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(rows('user_sms_rules')[0].account_ref, '6007');
    assert.equal(rows('user_sms_rules')[0].ref_kind, 'card');
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

describe('K-150: open due dates and picking any payment', () => {
  const shiftD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  test('inbox lists the overdue premium with the payment most likely to settle it; candidates list every nearby payment', async () => {
    const today = istToday();
    const due = shiftD(today, -9);
    db._seed('recurring_events', [{ owner_id: uid, master_table: 'manual', master_id: 'm-1', title: 'Care Health premium', kind: 'premium', frequency: 'yearly', due_day: +due.slice(8, 10), due_month: +due.slice(5, 7),
      amount: 20324, category_id: 'p_insurance', buffer_days: 2, remind_days: 7, status: 'active', created_at: '2025-01-01T00:00:00Z', rules_seeded: true }]);
    const ev = rows('recurring_events')[0];
    db._seed('expense_transactions', [
      txn({ amount: 29964.7, category_id: 'health_insurance', date_time: ist(shiftD(today, -2)), event_skip: [ev.id] }),   // "not this payment" said once
      txn({ amount: 31000, category_id: null, date_time: ist(shiftD(today, -3)) }),
      txn({ amount: 450, category_id: 'p_food', date_time: ist(shiftD(today, -1)) }),
    ]);
    const inbox = await api.call('GET', '/api/events/inbox');
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.equal(inbox.body.items.length, 1);
    assert.equal(inbox.body.items[0].state, 'overdue');
    assert.equal(inbox.body.items[0].suggestion.amount, 31000, 'a 52% higher premium is still suggested for a yearly event');
    const c = await api.call('GET', `/api/events/${ev.id}/candidates?period=${due}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.payments.length, 3, 'any amount near the due date');
    assert.equal(c.body.payments[0].cat_match, true, 'the health-insurance debit comes first');
    const q = await api.call('GET', `/api/events/${ev.id}/candidates?period=${due}&q=450`);
    assert.equal(q.body.payments.length, 1);
  });
});

describe('Sort tab: repeating payments', () => {
  test('Track as due makes an event + rule; Not a bill and Undo work; the list reply has event null for open groups', async () => {
    db._seed('sms_groups', [{ owner_id: uid, key: 'netflix', name: 'Netflix', count: 6, avg_amount: 649, min_amount: 649, max_amount: 649, cadence: 'monthly', due_day: 12, sender_key: 'HDFCBK' },
                            { owner_id: uid, key: 'zerodha', name: 'Zerodha', count: 6, avg_amount: 5000, cadence: 'monthly', due_day: 5 }]);
    const list = await api.call('GET', '/api/events/groups');
    assert.equal(list.status, 200);
    assert.equal(list.body.groups[0].event, null, 'open groups come with event: null (the phone must handle it)');
    const [net, zer] = rows('sms_groups');
    const t = await api.call('POST', `/api/events/groups/${net.id}`, { action: 'event', kind: 'subscription', category_id: 'p_membership', due_day: 12, frequency: 'monthly' });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(rows('sms_groups').find(g => g.id === net.id).status, 'event');
    assert.ok(rows('recurring_events').some(e => e.id === t.body.event_id && e.due_day === 12));
    assert.ok(rows('user_sms_rules').some(r => r.event_id === t.body.event_id));
    assert.equal((await api.call('POST', `/api/events/groups/${zer.id}`, { action: 'ignore' })).status, 200);
    assert.equal(rows('sms_groups').find(g => g.id === zer.id).status, 'ignored');
    assert.equal((await api.call('POST', `/api/events/groups/${zer.id}`, { action: 'reopen' })).status, 200);
    assert.equal(rows('sms_groups').find(g => g.id === zer.id).status, 'open');
    const after = await api.call('GET', '/api/events/groups');
    assert.equal(after.body.groups.find(g => g.id === net.id).event.title, 'Netflix');
  });
});

describe('crash reports from the app', () => {
  test('saved with numbers masked; works without login', async () => {
    const r = await api.call('POST', '/api/app-reports', { reports: [{ kind: 'crash', app_version: '1.13.3', version_code: 27, screen: 'sort',
      error: 'ClassCastException at amount 1982.40 for 9876543210', stack: 'at com.kanalyst.app.ui.screens.manage.SmsGroupsViewModel.load(SmsGroups.kt:97)' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = rows('app_reports')[0];
    assert.equal(row.kind, 'crash');
    assert.ok(!/9876543210|1982/.test(row.error), row.error);
    assert.ok(row.stack.includes('SmsGroupsViewModel'));
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
  test('a category set on the phone after upload reaches the server (re-sent payment updates the category)', async () => {
    const body = { amount: 200, type: 'DEBIT', date_time: ist(istToday()), reference_no: 'UTR777', category_id: null };
    assert.equal((await api.call('POST', '/api/expense/transactions', body)).status, 201);
    const again = await api.call('POST', '/api/expense/transactions', { ...body, category_id: 'food_dining', note: 'lunch' });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const t = rows('expense_transactions').find(x => x.reference_no === 'UTR777');
    assert.equal(t.category_id, 'food_dining');
    assert.equal(t.note, 'lunch');
  });
  test('a rule re-sent with the same id and new words updates that rule', async () => {
    const a = await api.call('POST', '/api/expense/sms-rules', { id: 'r-1', merchant_pattern: 'swiggy', category_id: 'food_online' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await api.call('POST', '/api/expense/sms-rules', { id: 'r-1', merchant_pattern: 'swiggy instamart', category_id: 'grocery_online' });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(rows('user_sms_rules').length, 1);
    assert.equal(rows('user_sms_rules')[0].merchant_pattern, 'swiggy instamart');
  });
  test('an Ignore rule from the phone (no category) is stored and listed for the web', async () => {
    const r = await api.call('POST', '/api/expense/sms-rules', { id: 'ig-1', merchant_pattern: 'otp', is_ignored: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(rows('user_sms_rules')[0].is_ignored, true);
    const list = await api.call('GET', '/api/events/rules');
    assert.equal(list.body.rules.find(x => x.id === 'ig-1').is_ignored, true);
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

describe('Money flow sheet and list', () => {
  test('12 months, items and a category x month grid', async () => {
    const month = istToday().slice(0, 7);
    db._seed('expense_transactions', [
      txn({ amount: 500, category_id: 'food_dining', merchant: 'Lunch', date_time: ist(`${month}-01`, '13:00') }),
      txn({ amount: 700, category_id: 'food_dining', merchant: 'Dinner', date_time: ist(`${month}-01`, '20:00') - 40 * 864e5 }),
    ]);
    const r = await api.call('GET', `/api/moneyflow?month=${month}&span=12&items=1&grid=1`);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.months.length, 12);
    assert.ok(r.body.items.some(i => i.amount === 500));
    const exp = r.body.grid.find(g => g.section === 'expense');
    const food = exp.rows.find(x => x.values[month] === 500);
    assert.ok(food, 'food row has this month');
    assert.equal(Object.values(food.values).reduce((a, b) => a + b, 0), 1200);
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

describe('K-199 / K-201: rule windows, deletions and duplicate decisions survive a reinstall', () => {
  const EM = require('../services/eventMatch');
  test('day window: plain, wrapping the month end, and short months', () => {
    const r = { day_from: 3, day_to: 7 };
    assert.equal(EM.dayOk(r, { date_time: ist('2026-10-05') }), true);
    assert.equal(EM.dayOk(r, { date_time: ist('2026-10-09') }), false);
    const wrap = { day_from: 28, day_to: 4 };
    assert.equal(EM.dayOk(wrap, { date_time: ist('2026-10-30') }), true);
    assert.equal(EM.dayOk(wrap, { date_time: ist('2026-11-02') }), true);
    assert.equal(EM.dayOk(wrap, { date_time: ist('2026-11-15') }), false);
    assert.equal(EM.dayOk({ day_from: 29, day_to: 31 }, { date_time: ist('2026-02-28') }), true, 'Feb 28 stands in for 29-31');
    assert.equal(EM.dayOk({}, { date_time: ist('2026-02-28') }), true, 'no window: any day');
  });
  test('phone rule keeps its mode, window and the payment it came from; merchant-only clears the window', async () => {
    const a = await api.call('POST', '/api/expense/sms-rules', { id: 'm-1', merchant_pattern: 'landlord', category_id: 'rent_house',
      match_mode: 'merchant_date_amount', day_from: 1, day_to: 7, amount_min: 23750, amount_max: 26250, sample_amount: 25000, sample_day: 3 });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    let r = rows('user_sms_rules')[0];
    assert.equal(r.match_mode, 'merchant_date_amount'); assert.equal(r.day_from, 1); assert.equal(r.amount_max, 26250); assert.equal(r.sample_day, 3);
    await api.call('PUT', '/api/events/rules/m-1', { match_mode: 'merchant' });
    r = rows('user_sms_rules')[0];
    assert.equal(r.match_mode, 'merchant'); assert.equal(r.day_from, null); assert.equal(r.amount_min, null);
    assert.equal(r.sample_amount, 25000, 'the sample stays for next time');
  });
  test('merchant + date needs the days', async () => {
    await api.call('POST', '/api/expense/sms-rules', { id: 'm-2', merchant_pattern: 'school', category_id: 'school_fees' });
    const bad = await api.call('PUT', '/api/events/rules/m-2', { match_mode: 'merchant_date' });
    assert.equal(bad.status, 400);
  });
  test('account rule from the phone (no merchant in the SMS) matches on account, days and amount only', () => {
    const rule = { merchant_pattern: 'ev1:opaque', ref_kind: 'acct', account_ref: '4821', match_mode: 'merchant_date_amount', day_from: 3, day_to: 7, amount_min: 31000, amount_max: 34000 };
    const t = { amount: 32786, date_time: ist('2026-11-05'), account_last4: '4821', sms_body: 'Rs 32786 debited from a/c XX4821' };
    assert.ok(EM.ruleScore(rule, t) > 0);
    assert.equal(EM.ruleScore(rule, { ...t, amount: 500 }), 0);
    assert.equal(EM.ruleScore(rule, { ...t, date_time: ist('2026-11-20') }), 0);
  });
  test('a deleted payment is sent to the phone as a marker, and the same SMS read again stays deleted', async () => {
    const body = { amount: 640, type: 'DEBIT', date_time: ist(istToday()), reference_no: 'UTR640', category_id: 'food_dining' };
    const made = await api.call('POST', '/api/expense/transactions', body);
    await api.call('DELETE', `/api/expense/transactions/${made.body.id}`);
    const again = await api.call('POST', '/api/expense/transactions', { ...body, id: undefined });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.deleted, true);
    assert.equal(rows('expense_transactions').length, 1);
    assert.equal(rows('expense_transactions')[0].is_deleted, true, 'not brought back');
    const live = await api.call('GET', '/api/expense/transactions?page=1&limit=100');
    assert.equal(live.body.data.length, 0);
    const all = await api.call('GET', '/api/expense/transactions?page=1&limit=100&include_deleted=1');
    assert.equal(all.body.data.length, 1); assert.equal(all.body.data[0].is_deleted, true);
  });
  test('a payment deleted on the phone before upload is kept as a marker; separate-payment decision is saved', async () => {
    const dead = await api.call('POST', '/api/expense/transactions', { amount: 99, type: 'DEBIT', date_time: ist(istToday()), reference_no: 'UTR99', is_deleted: true });
    assert.equal(dead.status, 201); assert.equal(rows('expense_transactions')[0].is_deleted, true);
    const body = { amount: 300, type: 'DEBIT', date_time: ist(istToday()), reference_no: 'UTR300' };
    await api.call('POST', '/api/expense/transactions', body);
    await api.call('POST', '/api/expense/transactions', { ...body, dup_state: 'separate' });
    assert.equal(rows('expense_transactions').find(x => x.reference_no === 'UTR300').dup_state, 'separate');
  });
});
