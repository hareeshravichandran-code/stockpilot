/**
 * The main loop: an SMS arrives -> a rule of an event catches it -> that due date is done and its alert stops.
 * Run: npm test (from backend/)
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const EM = require('../services/eventMatch');

const { db, uid, txn, ist, istToday, shift } = H;
const rows = (name) => db._tables[name] || [];

// A date with day 7 in last month: the payment; its event is due on the 9th
const today = istToday();
const lastMonth = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const monthBefore = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 7); };
const PAY = `${lastMonth}-07`, DUE = `${lastMonth}-09`;

function claudeEvent(extra = {}) {
  return { owner_id: uid, master_table: 'manual', master_id: 'm-claude', title: 'Claude', kind: 'subscription', frequency: 'monthly', due_day: 9,
    amount: 1982.4, category_id: 'p_membership', buffer_days: 2, remind_days: 3, created_at: '2025-01-01T00:00:00Z', status: 'active', rules_seeded: true, ...extra };
}

describe('pure rules', () => {
  test('sender key drops operator prefix and type suffix', () => {
    assert.equal(EM.senderKey('JX-ICICIT-S'), 'ICICIT');
    assert.equal(EM.senderKey('BP-ICICIT-T'), 'ICICIT');
    assert.equal(EM.senderKey('HDFCBK'), 'HDFCBK');
    assert.equal(EM.senderKey(null), null);
  });
  test('due dates clamp to the month and follow yearly anchors', () => {
    assert.deepEqual(EM.periods({ frequency: 'monthly', due_day: 31 }, '2026-02-01', '2026-02-28'), ['2026-02-28']);
    assert.deepEqual(EM.periods({ frequency: 'yearly', due_day: 15, due_month: 3 }, '2026-01-01', '2027-12-31'), ['2026-03-15', '2027-03-15']);
  });
  test('a payment picks on time, early or late', () => {
    const ev = { frequency: 'monthly', due_day: 9, buffer_days: 2 };
    assert.deepEqual(EM.pickPeriod(ev, '2026-11-07', new Set()), { period: '2026-11-09', timing: 'on_time' });
    assert.deepEqual(EM.pickPeriod(ev, '2026-11-03', new Set(['2026-10-09'])), { period: '2026-11-09', timing: 'early' });
    assert.deepEqual(EM.pickPeriod(ev, '2026-11-15', new Set(['2026-10-09'])), { period: '2026-11-09', timing: 'late' });
  });
  test('done never alerts; due and overdue alert; missed and untracked do not', () => {
    const ev = { kind: 'subscription', frequency: 'monthly', due_day: 9, buffer_days: 2, remind_days: 3, created_at: '2026-01-01T00:00:00Z' };
    assert.equal(EM.stateOf(ev, '2026-11-09', { status: 'paid' }, '2026-11-09').alert, false);
    assert.deepEqual([EM.stateOf(ev, '2026-11-09', null, '2026-11-07').state, EM.stateOf(ev, '2026-11-09', null, '2026-11-07').alert], ['due', true]);
    assert.deepEqual([EM.stateOf(ev, '2026-11-09', null, '2026-11-14').state, EM.stateOf(ev, '2026-11-09', null, '2026-11-14').alert], ['overdue', true]);
    assert.equal(EM.stateOf(ev, '2026-11-09', null, '2026-12-08').state, 'missed');
    assert.equal(EM.stateOf({ ...ev, created_at: '2026-12-01T00:00:00Z' }, '2026-11-09', null, '2026-11-14').state, 'untracked');
  });
});

describe('matching through rules only', () => {
  beforeEach(() => H.reset());

  test('a rule (sender + amount, no words) settles the due date and files the payment', async () => {
    db._seed('recurring_events', [claudeEvent()]);
    const ev = rows('recurring_events')[0];
    db._seed('user_sms_rules', [{ user_id: uid, event_id: ev.id, category_id: 'p_membership', sender_key: 'ICICIT', amount_min: 1880, amount_max: 2080, merchant_pattern: null }]);
    db._seed('expense_transactions', [txn({ amount: 1982.4, sms_sender: 'BP-ICICIT-T', category_id: 'nach', date_time: ist(PAY) })]);
    await EM.runMatching(uid, { force: true });
    const pay = rows('event_payments').find(p => p.event_id === ev.id && p.period === DUE);
    assert.ok(pay, 'due date is marked paid');
    assert.equal(pay.match_source, 'rule');
    assert.equal(pay.timing, 'on_time');
    const t = rows('expense_transactions')[0];
    assert.equal(t.event_id, ev.id);
    assert.equal(t.category_id, 'p_membership', 'NACH payment takes the event category');
  });

  test('no rule, no match (the master or a lookalike amount alone never settles an event)', async () => {
    db._seed('recurring_events', [claudeEvent({ master_table: 'money_masters', master_id: 'x' })]);
    db._seed('expense_transactions', [txn({ amount: 1982.4, date_time: ist(PAY) })]);
    await EM.runMatching(uid, { force: true });
    assert.equal(rows('event_payments').length, 0);
  });

  test('"not this payment" is respected', async () => {
    db._seed('recurring_events', [claudeEvent()]);
    const ev = rows('recurring_events')[0];
    db._seed('user_sms_rules', [{ user_id: uid, event_id: ev.id, category_id: 'p_membership', sender_key: 'ICICIT', amount_min: 1880, amount_max: 2080 }]);
    db._seed('expense_transactions', [txn({ amount: 1982.4, date_time: ist(PAY), event_skip: [ev.id] })]);
    await EM.runMatching(uid, { force: true });
    assert.equal(rows('event_payments').length, 0);
  });

  test('accounts with more than 1000 transactions: the newest SMS is still matched', async () => {
    db._seed('recurring_events', [claudeEvent()]);
    const ev = rows('recurring_events')[0];
    db._seed('user_sms_rules', [{ user_id: uid, event_id: ev.id, category_id: 'p_membership', sender_key: 'ICICIT', amount_min: 1880, amount_max: 2080 }]);
    const old = ist(shift(today, -300));
    db._seed('expense_transactions', Array.from({ length: 1500 }, (_, i) => txn({ amount: 100 + (i % 50), sms_sender: 'VM-HDFCBK', date_time: old + i * 60000 })));
    db._seed('expense_transactions', [txn({ amount: 1982.4, date_time: ist(PAY) })]);
    await EM.runMatching(uid, { force: true });
    assert.ok(rows('event_payments').some(p => p.period === DUE), 'the newest payment past row 1000 was read');
  });
});

describe('rules made for events that have none', () => {
  beforeEach(() => H.reset());

  test('from earlier payments: sender + amount range, saved as a visible rule, then used', async () => {
    db._seed('recurring_events', [claudeEvent({ rules_seeded: false, category_id: null })]);
    const ev = rows('recurring_events')[0];
    const [m1, m2] = [monthBefore(lastMonth, 2), monthBefore(lastMonth, 1)];
    db._seed('expense_transactions', [
      txn({ amount: 1982.4, sms_sender: 'JX-ICICIT-S', date_time: ist(`${m1}-08`) }),
      txn({ amount: 1982.4, sms_sender: 'JD-ICICIT-S', date_time: ist(`${m2}-08`) }),
    ]);
    const [a, b] = rows('expense_transactions');
    db._seed('event_payments', [
      { owner_id: uid, event_id: ev.id, period: `${m1}-09`, status: 'paid', txn_ref: a.id, amount: 1982.4 },
      { owner_id: uid, event_id: ev.id, period: `${m2}-09`, status: 'paid', txn_ref: b.id, amount: 1982.4 },
    ]);
    db._seed('expense_transactions', [txn({ amount: 1982.4, sms_sender: 'BP-ICICIT-T', date_time: ist(PAY) })]);
    await EM.runMatching(uid, { force: true });
    const rules = rows('user_sms_rules').filter(r => r.event_id === ev.id);
    assert.equal(rules.length, 1, 'one rule made');
    assert.equal(rules[0].source, 'from_payments');
    assert.equal(rules[0].sender_key, 'ICICIT');
    assert.equal(rules[0].merchant_pattern, null, 'rules without words are allowed by the database');
    assert.ok(rules[0].id, 'database gives the rule an id');
    assert.equal(rules[0].category_id, 'p_membership', 'event got the default category for its type');
    assert.equal(rows('recurring_events')[0].rules_seeded, true);
    assert.ok(rows('event_payments').some(p => p.period === DUE && p.match_source === 'rule'), 'the new payment was settled by that rule');
  });

  test('from the master keywords', async () => {
    db._seed('money_masters', [{ owner_id: uid, kind: 'subscription', title: 'Netflix', amount: 649, match: { keywords: ['netflix'] } }]);
    const m = rows('money_masters')[0];
    db._seed('recurring_events', [claudeEvent({ title: 'Netflix', master_table: 'money_masters', master_id: m.id, amount: 649, due_day: 12, rules_seeded: false })]);
    await EM.runMatching(uid, { force: true });
    const r = rows('user_sms_rules')[0];
    assert.equal(r.merchant_pattern, 'netflix');
    assert.equal(r.source, 'from_master');
  });

  test('card bills with changing amounts get no sender-only rule (it would catch every SMS of the bank)', async () => {
    db._seed('recurring_events', [claudeEvent({ kind: 'card_due', title: 'Card bill', rules_seeded: false, category_id: null, amount: null, amount_mode: 'any' })]);
    const ev = rows('recurring_events')[0];
    db._seed('expense_transactions', [txn({ amount: 5000, date_time: ist(`${monthBefore(lastMonth, 1)}-08`), event_id: ev.id }), txn({ amount: 24000, date_time: ist(`${lastMonth}-08`), event_id: ev.id })]);
    await EM.runMatching(uid, { force: true });
    assert.equal(rows('user_sms_rules').length, 0);
    assert.equal(rows('recurring_events')[0].category_id, 'cc_bill');
  });

  test('a failed save is retried next run, never marked done', async () => {
    db._seed('recurring_events', [claudeEvent({ rules_seeded: false })]);
    const ev = rows('recurring_events')[0];
    const a = txn({ amount: 1982.4, date_time: ist(`${monthBefore(lastMonth, 1)}-08`) });
    db._seed('expense_transactions', [a]);
    db._seed('event_payments', [{ owner_id: uid, event_id: ev.id, period: `${monthBefore(lastMonth, 1)}-09`, status: 'paid', txn_ref: rows('expense_transactions')[0].id }]);
    const insert = db.from('x').constructor.prototype.insert;
    db.from('x').constructor.prototype.insert = function (r) { if (this.table === 'user_sms_rules') { this.op = 'insert'; this.rows = [{ ...r, category_id: null }]; return this; } return insert.call(this, r); };
    try { await EM.runMatching(uid, { force: true }); } finally { db.from('x').constructor.prototype.insert = insert; }
    assert.equal(rows('recurring_events')[0].rules_seeded, false);
  });
});
