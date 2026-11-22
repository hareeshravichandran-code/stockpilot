// One payment, two copies: the phone's SMS copy keeps seconds, the cloud copy was saved to the minute,
// so the same payment can arrive twice up to a minute apart. These helpers tell copies from real repeats.
const WINDOW_MS = 120 * 1000;

const same = (a, b) => a == null || b == null || a === '' || b === '' || String(a) === String(b);

/** True when a and b are the same payment: same amount and direction, close in time, no reference or account that differs. */
function isTwin(a, b) {
  return Number(a.amount) === Number(b.amount) && a.type === b.type
    && Math.abs(Number(a.date_time) - Number(b.date_time)) <= WINDOW_MS
    && same(a.reference_no, b.reference_no) && same(a.account_last4, b.account_last4);
}

/** The closest twin of row among candidates, or null. */
function nearestTwin(row, candidates) {
  let best = null;
  for (const c of candidates || []) {
    if (!isTwin(row, c)) continue;
    if (!best || Math.abs(c.date_time - row.date_time) < Math.abs(best.date_time - row.date_time)) best = c;
  }
  return best;
}

/**
 * Extra copies among a user's rows, to hide (never delete outright). Only SMS rows are compared: a payment typed
 * by hand twice is the user's call. In each set of copies the one kept has a category, then a note, then is the oldest.
 */
function extraCopies(rows) {
  const sms = (rows || []).filter(r => !r.is_deleted && (r.source || 'SMS') === 'SMS')
    .sort((a, b) => a.type.localeCompare(b.type) || Number(a.amount) - Number(b.amount) || a.date_time - b.date_time);
  const rank = r => (r.category_id ? 0 : 2) + (r.note ? 0 : 1);
  const extra = [];
  const used = new Set();
  for (let i = 0; i < sms.length; i++) {
    if (used.has(sms[i].id)) continue;
    const group = [sms[i]];
    for (let j = i + 1; j < sms.length && sms[j].type === sms[i].type && Number(sms[j].amount) === Number(sms[i].amount)
      && sms[j].date_time - sms[i].date_time <= WINDOW_MS; j++) {
      if (!used.has(sms[j].id) && group.every(g => isTwin(g, sms[j]))) group.push(sms[j]);
    }
    if (group.length < 2) continue;
    // Two different references inside the window are two payments; isTwin already keeps those apart
    group.sort((a, b) => rank(a) - rank(b) || (a.created_at || 0) - (b.created_at || 0));
    group.forEach((g, k) => { used.add(g.id); if (k > 0) extra.push({ id: g.id, keep: group[0].id }); });
  }
  return extra;
}

module.exports = { WINDOW_MS, isTwin, nearestTwin, extraCopies };
