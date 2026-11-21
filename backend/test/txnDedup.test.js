const test = require('node:test');
const assert = require('node:assert');
const { isTwin, nearestTwin, extraCopies } = require('../services/txnDedup');

const at = (h, m, s = 0) => Date.UTC(2026, 10, 21, h, m, s);
const row = (id, amount, t, extra = {}) => ({ id, amount, type: 'DEBIT', date_time: t, source: 'SMS', ...extra });

test('the SMS copy (with seconds) and the cloud copy (to the minute) are one payment', () => {
  assert.ok(isTwin(row('a', 250, at(10, 23, 47)), row('b', 250, at(10, 23, 0))));
});

test('different references, accounts, amounts or directions are different payments', () => {
  assert.ok(!isTwin(row('a', 10, at(9, 0), { reference_no: '111' }), row('b', 10, at(9, 0), { reference_no: '222' })));
  assert.ok(!isTwin(row('a', 10, at(9, 0), { account_last4: '0467' }), row('b', 10, at(9, 0), { account_last4: '3542' })));
  assert.ok(!isTwin(row('a', 10, at(9, 0)), row('b', 11, at(9, 0))));
  assert.ok(!isTwin(row('a', 10, at(9, 0)), { ...row('b', 10, at(9, 0)), type: 'CREDIT' }));
  assert.ok(!isTwin(row('a', 10, at(9, 0)), row('b', 10, at(9, 5))));
});

test('nearestTwin picks the closest copy', () => {
  const t = nearestTwin(row('x', 99, at(8, 0, 30)), [row('far', 99, at(8, 1, 50)), row('near', 99, at(8, 0))]);
  assert.strictEqual(t.id, 'near');
});

test('extraCopies hides the copy without a category and keeps real repeats', () => {
  const rows = [
    row('sms', 9580, at(12, 4, 41)),
    row('cloud', 9580, at(12, 4), { category_id: 'cc_bill' }),
    row('tea1', 20, at(16, 0), { reference_no: 'r1' }),
    row('tea2', 20, at(16, 1), { reference_no: 'r2' }),
    row('manual', 500, at(18, 0), { source: 'MANUAL' }),
    row('manual2', 500, at(18, 0), { source: 'MANUAL' })
  ];
  assert.deepStrictEqual(extraCopies(rows), [{ id: 'sms', keep: 'cloud' }]);
});
