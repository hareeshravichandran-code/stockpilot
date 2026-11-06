/**
 * Alert levels for money events.
 *   very_high  EMI, card bill        blink red from 5 days before, and when overdue
 *   high       insurance premium     blink amber from 7 days before
 *   medium     subscriptions, rent, SIP, RD, bills   blink from 2 days before
 *   low        expected income       never blinks
 * A user-set level on the event (or policy) overrides the default for its kind.
 */
const LEVELS = ['very_high', 'high', 'medium', 'low'];
const DEFAULT = {
  emi: 'very_high', card_due: 'very_high',
  premium: 'high', cover_end: 'high',
  subscription: 'medium', rent: 'medium', school_fee: 'medium', bill: 'medium', sip: 'medium', rd_instalment: 'medium', instalment: 'medium',
  salary: 'low', income: 'low', dividend: 'low', rental: 'low', maturity: 'low',
};
const WINDOW = { very_high: 5, high: 7, medium: 2, low: -1 };
const RANK = { very_high: 0, high: 1, medium: 2, low: 3 };

const levelOf = (kind, override) => (LEVELS.includes(override) ? override : DEFAULT[kind] || 'medium');

/** daysUntil: 0 = today, negative = past. overdue: past and not paid. */
function alertOf(kind, override, daysUntil, overdue) {
  const level = levelOf(kind, override);
  const blink = level !== 'low' && (overdue || (daysUntil >= 0 && daysUntil <= WINDOW[level]));
  return { level, blink };
}

module.exports = { LEVELS, DEFAULT, WINDOW, RANK, levelOf, alertOf };
