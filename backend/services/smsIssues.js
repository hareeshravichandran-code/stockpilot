// Groups SMS the reader struggled with into "issues": one per message format.
// The format is the sender's code plus the body with every value blanked out (amounts, dates, numbers,
// shop and person names in capitals, links), so the same bank message seen by 100 people with 100
// different amounts is one issue with many hits.
const crypto = require('crypto');

const KEEP_CAPS = new Set(['RS', 'INR', 'UPI', 'NEFT', 'IMPS', 'RTGS', 'ATM', 'POS', 'NACH', 'ACH', 'ECS', 'EMI', 'SI', 'OTP', 'A/C', 'AC',
  'CARD', 'BANK', 'DR', 'CR', 'REF', 'TXN', 'AVL', 'BAL', 'ICICI', 'HDFC', 'SBI', 'AXIS', 'KOTAK', 'IDFC', 'YES', 'PNB', 'BOB', 'IDBI', 'AU',
  'RBL', 'IOB', 'UCO', 'CUB', 'KVB', 'TMB', 'NA', 'MF', 'SIP', 'NAV', 'EPF', 'PF', 'NPS', 'PRAN', 'GST', 'IST', 'AM', 'PM', 'VPA']);
const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi;

function senderCode(sender) {
  const parts = String(sender || '').toUpperCase().split('-').filter(Boolean);
  const p = parts.find(x => x.length >= 5 && /[A-Z]/.test(x)) || parts[parts.length - 1] || '';
  return /^\+?\d[\d ]{6,}$/.test(p) ? 'PHONE' : p.slice(0, 12);
}

function template(body) {
  let t = String(body || '')
    .replace(/https?:\/\/\S+|\b\w+\.(?:in|com|co|io|me|ly)\/\S*/gi, '<url>')
    .replace(/\b[\w.-]+@[\w.-]+\b/g, '<id>');
  // Shop / person names written in capitals ("at WINTEL MOBILES", "to ARUN D")
  t = t.replace(/\b[A-Z][A-Z&.'\-]{1,}(?:\s+[A-Z][A-Z&.'\-]*)*\b/g, m => {
    const words = m.split(/\s+/);
    return words.every(w => KEEP_CAPS.has(w.replace(/[.']/g, ''))) ? m : '<name>';
  });
  // Names in ordinary case after to / from / by / at ("To Arun D On", "from Ravi Kumar.")
  t = t.replace(/\b([Tt]o|[Ff]rom|[Bb]y|[Aa]t|[Tt]owards|[Ff]or)\s+((?:[A-Z][A-Za-z&.'\-]*\s?){1,5})(?=\s*(?:on\b|On\b|ref|Ref|REF|via|using|UPI|\.|,|$))/g,
    (m, k, name) => name.trim().split(/\s+/).every(w => KEEP_CAPS.has(w.toUpperCase().replace(/[.']/g, ''))) ? m : k + ' <name> ');
  t = t.toLowerCase()
    .replace(MONTHS, '<mon>')
    .replace(/[x*#]*\d[\d,.:/x*\-]*/g, '#')
    .replace(/(?:<name>\s*)+/g, '<name> ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 600);
}

function fingerprint(sender, body) {
  const code = senderCode(sender);
  return { code, template: template(body), fp: crypto.createHash('sha1').update(code + '|' + template(body)).digest('hex') };
}

function amountOf(body) {
  const m = String(body || '').match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const vnum = (v) => String(v || '0').split('.').map(n => +n || 0);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Files items into issues. items: [{ sender, body (masked), at, kind, parsed }]. Returns per-item { fp, status }. */
async function report(supabase, userId, items, appVersion) {
  const now = new Date().toISOString();
  const rows = items.map(it => {
    const body = String(it.body || '').slice(0, 2000);
    if (body.length < 10) return null;
    const f = fingerprint(it.sender, body);
    return { ...f, body, it, hash: crypto.createHash('sha1').update(body).digest('hex'), kind: ['missed', 'unsure', 'corrected'].includes(it.kind) ? it.kind : 'missed' };
  });
  const valid = rows.filter(Boolean);
  if (!valid.length) return rows.map(() => null);
  const fps = [...new Set(valid.map(r => r.fp))];

  // Existing issues, then create the new ones in one go
  const byFp = {};
  for (let i = 0; i < fps.length; i += 200) {
    const { data } = await supabase.from('sms_issues').select('*').in('fingerprint', fps.slice(i, i + 200));
    (data || []).forEach(x => { byFp[x.fingerprint] = x; });
  }
  const fresh = fps.filter(fp => !byFp[fp]).map(fp => { const r = valid.find(v => v.fp === fp);
    return { fingerprint: fp, sender_code: r.code, template: r.template, sample: r.body, kind: r.kind, hits: 0, users: 0, first_seen: now, last_seen: now }; });
  if (fresh.length) {
    const { data, error } = await supabase.from('sms_issues').upsert(fresh, { onConflict: 'fingerprint', ignoreDuplicates: true }).select('*');
    if (error) throw error;
    (data || []).forEach(x => { byFp[x.fingerprint] = x; });
    const missing = fresh.filter(f => !byFp[f.fingerprint]).map(f => f.fingerprint);
    if (missing.length) { const { data: again } = await supabase.from('sms_issues').select('*').in('fingerprint', missing); (again || []).forEach(x => { byFp[x.fingerprint] = x; }); }
  }

  // Who has seen each issue (one row per user; repeats are ignored)
  const ids = [...new Set(Object.values(byFp).map(x => x.id))];
  const { data: seenBefore } = await supabase.from('sms_issue_users').select('issue_id').eq('user_id', userId).in('issue_id', ids);
  const known = new Set((seenBefore || []).map(r => r.issue_id));
  const newUsers = ids.filter(id => !known.has(id));
  if (newUsers.length) await supabase.from('sms_issue_users').upsert(newUsers.map(issue_id => ({ issue_id, user_id: userId })), { onConflict: 'issue_id,user_id', ignoreDuplicates: true });

  // Counts, amounts seen, and reopening an issue that was "fixed" but still shows up on that version or later
  const status = {};
  await pool(fps, 8, async (fp) => {
    const issue = byFp[fp]; if (!issue) return;
    const mine = valid.filter(v => v.fp === fp);
    const amts = mine.map(v => amountOf(v.body)).filter(a => a != null);
    const patch = { hits: (issue.hits || 0) + mine.length, last_seen: now, updated_at: now,
      amounts: [...new Set([...amts, ...(issue.amounts || [])])].slice(0, 20) };
    if (!known.has(issue.id)) patch.users = (issue.users || 0) + 1;
    if (issue.status === 'included' && issue.fixed_in && appVersion && !newer(issue.fixed_in, appVersion)) { patch.status = 'pending'; patch.reopened = true; }
    await supabase.from('sms_issues').update(patch).eq('id', issue.id);
    status[fp] = patch.status || issue.status;
  });

  // Up to 12 distinct samples per issue; the same message is never stored twice
  const samples = [];
  await pool(fps, 8, async (fp) => {
    const issue = byFp[fp]; if (!issue) return;
    const { count } = await supabase.from('sms_issue_samples').select('id', { count: 'exact', head: true }).eq('issue_id', issue.id);
    const room = Math.max(0, 12 - (count || 0));
    const seen = new Set();
    valid.filter(v => v.fp === fp && !seen.has(v.hash) && seen.add(v.hash)).slice(0, room).forEach(v => samples.push({
      issue_id: issue.id, user_id: userId, body: v.body, body_hash: v.hash, sender: String(v.it.sender || '').slice(0, 40),
      sms_at: v.it.at ? new Date(+v.it.at).toISOString() : null, parsed: v.it.parsed || null, app_version: appVersion || null }));
  });
  if (samples.length) await supabase.from('sms_issue_samples').upsert(samples, { onConflict: 'issue_id,body_hash', ignoreDuplicates: true });

  return rows.map(r => r && { fp: r.fp, status: status[r.fp] || 'pending' });
}

module.exports = { report, fingerprint, template, senderCode, newer };
