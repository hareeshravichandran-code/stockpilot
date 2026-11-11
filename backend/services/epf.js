/**
 * EPFO: passbook PDF reader, SMS entries and the balance the rest of Kanalyst uses.
 *
 * Passbook (passbook.epfindia.gov.in, one PDF per member id and year) rows look like:
 *   Apr-2024 15-05-2024 CR Cont. For Due-Month 052024 15,000 15,000 1,800 550 1,250
 *   OB Int. Updated upto 31/03/2024 1,23,456 45,678 67,890
 *   Int. Updated upto 31/03/2025 12,345 4,567 0
 *   Closing Balance as on 31/03/2025 2,34,567 89,012 1,23,456
 * Columns for money: employee share, employer share, pension (EPS). EPF balance = employee + employer.
 */
const supabase = require('./supabase');
const crypto = require('crypto');

const num = (s) => { const x = parseFloat(String(s ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
const dmy = (s) => { const m = String(s || '').match(/(\d{2})[-/](\d{2})[-/](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** "Apr-2024", "042024", "04-2024", "Apr 24" -> "2024-04" */
function wageMonth(s) {
  const t = String(s || '').trim();
  let m = t.match(/^([A-Za-z]{3})[-\s]?(\d{2,4})$/);
  if (m && MON[m[1].toLowerCase()]) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${MON[m[1].toLowerCase()]}`;
  m = t.match(/^(\d{2})[-/]?(\d{4})$/); if (m) return `${m[2]}-${m[1]}`;
  return null;
}
const fp = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
const last4 = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
const AMT = '([\\d,]+(?:\\.\\d+)?)';

function parsePassbook(text) {
  const t = String(text || '').replace(/\r/g, '');
  const uan = (t.match(/\bUAN\b\s*[:\-|]?\s*(\d{12})/i) || [])[1] || null;
  const memberId = (t.match(/Member\s*Id(?:\/Name)?\s*[:\-|]?\s*([A-Z]{5}\d{10,17}|[A-Z]{2}[A-Z0-9]{13,20})/i) || [])[1] || null;
  const estab = ((t.match(/Establishment\s*(?:ID\s*\/\s*Name|Name)\s*[:\-|]?\s*(?:[A-Z]{5}\d{7}\s*\/\s*)?([^\n]{3,80})/i) || [])[1] || '').trim() || null;
  const entries = [];
  const lines = t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const l of lines) {
    let m;
    if ((m = l.match(new RegExp(`^OB\\s*Int\\.?\\s*Updated\\s*up\\s*to\\s*(\\d{2}/\\d{2}/\\d{4})\\s+${AMT}\\s+${AMT}\\s+${AMT}`, 'i')))) {
      entries.push({ kind: 'opening', txn_date: dmy(m[1]), employee: num(m[2]), employer: num(m[3]), pension: num(m[4]), particulars: 'Opening balance' });
    } else if ((m = l.match(new RegExp(`Int\\.?\\s*Updated\\s*up\\s*to\\s*(\\d{2}/\\d{2}/\\d{4})\\s+${AMT}\\s+${AMT}\\s+${AMT}`, 'i')))) {
      entries.push({ kind: 'interest', txn_date: dmy(m[1]), employee: num(m[2]), employer: num(m[3]), pension: num(m[4]), particulars: `Interest up to ${m[1]}` });
    } else if ((m = l.match(new RegExp(`Closing\\s*Balance\\s*as\\s*on\\s*(\\d{2}/\\d{2}/\\d{4})\\s+${AMT}\\s+${AMT}\\s+${AMT}`, 'i')))) {
      entries.push({ kind: 'closing', txn_date: dmy(m[1]), employee: num(m[2]), employer: num(m[3]), pension: num(m[4]), particulars: `Closing balance ${m[1]}` });
    } else if ((m = l.match(/^([A-Za-z]{3}-\d{4}|\d{6})\s+(\d{2}[-/]\d{2}[-/]\d{4})\s+(CR|DR)\s+(.*)$/i))) {
      // last five numbers: EPF wages, EPS wages, employee, employer, pension (older layouts: only the last three)
      const nums = (m[4].match(/[\d,]+(?:\.\d+)?/g) || []).map(num);
      const tail = nums.slice(-3);
      if (tail.length < 3) continue;
      const particulars = m[4].replace(/(\s*[\d,]+(?:\.\d+)?){3,5}\s*$/, '').trim().slice(0, 120);
      const dr = m[3].toUpperCase() === 'DR';
      const kind = dr ? (/transfer/i.test(particulars) ? 'transfer' : 'withdrawal') : (/transfer/i.test(particulars) ? 'transfer' : 'contribution');
      entries.push({ kind, wage_month: wageMonth(m[1]) || wageMonth((particulars.match(/Due-?Month\s*(\d{6})/i) || [])[1]), txn_date: dmy(m[2]),
        employee: (dr ? -1 : 1) * tail[0], employer: (dr ? -1 : 1) * tail[1], pension: (dr ? -1 : 1) * tail[2], particulars });
    }
  }
  return { uan, memberId, establishment: estab, entries };
}

/** EPF balance (employee + employer, without pension) from entries: last closing + what came after. */
function balanceFrom(entries) {
  const rows = entries.filter(e => e.txn_date).slice().sort((a, b) => a.txn_date.localeCompare(b.txn_date));
  const closing = rows.filter(e => e.kind === 'closing').pop();
  const opening = rows.filter(e => e.kind === 'opening').pop();
  const base = closing || opening;
  let emp = base ? num(base.employee) : 0, er = base ? num(base.employer) : 0, pen = base ? num(base.pension) : 0;
  const from = base ? base.txn_date : '0000';
  for (const e of rows) {
    if (e.txn_date <= from && base) continue;
    if (['contribution', 'withdrawal', 'transfer', 'interest'].includes(e.kind) && e.source !== 'sms') { emp += num(e.employee); er += num(e.employer); pen += num(e.pension); }
  }
  const smsBal = rows.filter(e => e.kind === 'balance' && e.balance != null).pop();
  const lastPass = rows.filter(e => e.source !== 'sms').pop();
  // A newer SMS balance (EPFO's own figure) wins over the passbook total
  if (smsBal && (!lastPass || smsBal.txn_date >= lastPass.txn_date)) return { balance: num(smsBal.balance), pension: pen, at: smsBal.txn_date, employee: emp, employer: er };
  return { balance: emp + er, pension: pen, at: lastPass ? lastPass.txn_date : null, employee: emp, employer: er };
}

/** Recompute an account's totals from its entries. */
async function refreshAccount(uid, accountId) {
  const { data: rows } = await supabase.from('epf_entries').select('kind, txn_date, employee, employer, pension, balance, source, wage_month, amount').eq('user_id', uid).eq('account_id', accountId);
  const b = balanceFrom(rows || []);
  const contr = (rows || []).filter(e => e.kind === 'contribution').sort((a, x) => String(x.txn_date).localeCompare(String(a.txn_date)));
  const interest = (rows || []).filter(e => e.kind === 'interest').reduce((t, e) => t + num(e.employee) + num(e.employer), 0);
  const lastC = contr[0];
  await supabase.from('epf_accounts').update({
    balance: Math.round(b.balance), pension: Math.round(b.pension), employee_total: Math.round(b.employee), employer_total: Math.round(b.employer),
    interest_total: Math.round(interest), balance_at: b.at, monthly: lastC ? Math.round(num(lastC.employee) + num(lastC.employer) || num(lastC.amount)) : null,
    last_wage_month: lastC?.wage_month || null, updated_at: new Date().toISOString(),
  }).eq('id', accountId).eq('user_id', uid);
}

/** Total EPF across accounts (for net worth and retirement). null when the module has no data. */
async function epfTotal(uid) {
  const { data } = await supabase.from('epf_accounts').select('balance, status').eq('user_id', uid);
  const live = (data || []).filter(a => a.status !== 'closed' && a.balance != null);
  return live.length ? live.reduce((t, a) => t + num(a.balance), 0) : null;
}

module.exports = { parsePassbook, balanceFrom, refreshAccount, epfTotal, wageMonth, fp, last4, num };
