/**
 * In-memory stand-in for the Supabase client, strict like production:
 *   - at most 1000 rows per response (PostgREST max-rows)
 *   - NOT NULL columns, column defaults and unique keys from the live schema (SCHEMA below)
 * Enough of the query builder for the backend's own queries. Used only by tests.
 */
const crypto = require('crypto');

const now = () => Date.now();
const uuid = () => crypto.randomUUID();
// Mirrors the live tables (see backend/migrations). Keep in step when the schema changes.
const SCHEMA = {
  user_sms_rules: {
    defaults: { id: () => uuid(), is_deleted: false, source: 'manual', match_count: 1, user_confirmed: false, created_at: now, updated_at: now },
    notNull: ['id', 'user_id', 'category_id'],
    unique: [['user_id', 'merchant_pattern']],
  },
  event_payments: { defaults: { id: () => uuid(), created_at: () => new Date().toISOString() }, notNull: ['event_id', 'period', 'status'], unique: [['event_id', 'period']] },
  recurring_events: {
    defaults: { id: () => uuid(), status: 'active', buffer_days: 2, remind_days: 3, pay_mode: 'auto', amount_mode: 'about', rules_seeded: false, direction: 'out', source: 'manual', created_at: () => new Date().toISOString() },
    notNull: ['owner_id', 'master_table', 'master_id', 'title', 'remind_days'],
  },
  expense_transactions: { defaults: { id: () => uuid(), is_deleted: false }, notNull: ['user_id', 'amount', 'type', 'date_time'] },
  money_masters: { defaults: { id: () => uuid(), status: 'active', created_at: () => new Date().toISOString() }, notNull: ['owner_id', 'kind'] },
  sms_groups: { defaults: { id: () => uuid(), status: 'open', count: 0 }, notNull: ['owner_id', 'key'], unique: [['owner_id', 'key']] },
};
const MAX_ROWS = 1000;

function makeDb() {
  const tables = {};
  const t = (name) => (tables[name] = tables[name] || []);

  function splitTop(s) {               // "a.eq.1,b.in.(x,y)" -> ['a.eq.1', 'b.in.(x,y)']
    const out = []; let depth = 0, cur = '';
    for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; }
    if (cur) out.push(cur);
    return out;
  }
  function orTest(expr) {
    const parts = splitTop(expr).map(p => {
      const [col, op, ...rest] = p.split('.'); const val = rest.join('.');
      if (op === 'is') return (r) => (val === 'null' ? r[col] == null : String(r[col]) === val);
      if (op === 'eq') return (r) => String(r[col]) === val;
      if (op === 'neq') return (r) => String(r[col]) !== val;
      if (op === 'in') { const vs = val.replace(/^\(|\)$/g, '').split(','); return (r) => vs.includes(String(r[col])); }
      throw new Error('fake or(): unsupported ' + p);
    });
    return (r) => parts.some(f => f(r));
  }

  class Q {
    constructor(table) { this.table = table; this.f = []; this.ord = []; this.op = 'select'; this.lim = null; this.rng = null; this.one = null; this.want = false; this.opts = {}; }
    select(_cols, opts) { if (this.op === 'select') this.opts = opts || {}; else this.want = true; return this; }
    eq(c, v) { this.f.push(r => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return this; }
    neq(c, v) { this.f.push(r => String(r[c]) !== String(v)); return this; }
    gt(c, v) { this.f.push(r => r[c] > v); return this; }
    gte(c, v) { this.f.push(r => r[c] >= v); return this; }
    lt(c, v) { this.f.push(r => r[c] < v); return this; }
    lte(c, v) { this.f.push(r => r[c] <= v); return this; }
    in(c, vs) { const s = (vs || []).map(String); this.f.push(r => s.includes(String(r[c]))); return this; }
    is(c, v) { this.f.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('fake not(): only is null'); this.f.push(r => r[c] != null); return this; }
    or(expr) { this.f.push(orTest(expr)); return this; }
    contains(c, arr) { this.f.push(r => Array.isArray(r[c]) && arr.every(x => r[c].includes(x))); return this; }
    ilike(c, pat) { const rx = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); this.f.push(r => r[c] != null && rx.test(String(r[c]))); return this; }
    order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.op = 'update'; this.patch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)); return this; }   // JSON drops undefined
    upsert(rows, o = {}) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.uo = o; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }

    match(r) { return this.f.every(f => f(r)); }
    check(row, ignoreId) {
      const s = SCHEMA[this.table] || {};
      for (const c of s.notNull || []) if (row[c] == null) return `null value in column "${c}" of relation "${this.table}" violates not-null constraint`;
      for (const key of s.unique || []) {
        if (key.some(c => row[c] == null)) continue;           // NULLs are distinct
        if (t(this.table).some(o => o !== ignoreId && key.every(c => String(o[c]) === String(row[c])))) return `duplicate key value violates unique constraint (${key.join(',')})`;
      }
      return null;
    }
    fill(row) {
      const s = SCHEMA[this.table] || { defaults: { id: () => uuid() } };
      const out = { ...row };
      for (const [c, d] of Object.entries(s.defaults || {})) if (out[c] === undefined) out[c] = typeof d === 'function' ? d() : d;
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
      return out;
    }
    shape(rows) {
      let out = rows;
      if (this.op === 'select') {
        for (const [c, asc] of [...this.ord].reverse()) out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        const [a, b] = this.rng || [0, Infinity];
        out = out.slice(a, Math.min(b + 1, a + MAX_ROWS));
        if (this.lim != null) out = out.slice(0, Math.min(this.lim, MAX_ROWS));
      }
      out = out.map(r => ({ ...r }));
      if (this.one) {
        if (out.length > 1) return { data: null, error: { message: 'multiple rows' } };
        if (!out.length) return this.one === 'single' ? { data: null, error: { message: 'no rows' } } : { data: null, error: null };
        return { data: out[0], error: null };
      }
      return { data: out, error: null };
    }
    run() {
      const rows = t(this.table);
      if (this.op === 'select') {
        const hit = rows.filter(r => this.match(r));
        if (this.opts.head) return { data: null, count: hit.length, error: null };
        return { ...this.shape(hit), count: this.opts.count ? hit.length : undefined };
      }
      if (this.op === 'insert') {
        const made = [];
        for (const r of this.rows) { const row = this.fill(r); const err = this.check(row); if (err) return { data: null, error: { message: err } }; rows.push(row); made.push(row); }
        return this.want ? this.shape(made) : { data: null, error: null };
      }
      if (this.op === 'upsert') {
        const key = (this.uo.onConflict || 'id').split(',').map(s => s.trim());
        const made = [];
        for (const r of this.rows) {
          const ex = rows.find(o => key.every(c => o[c] != null && String(o[c]) === String(r[c])));
          if (ex) { if (!this.uo.ignoreDuplicates) { Object.assign(ex, r); made.push(ex); } continue; }
          const row = this.fill(r); const err = this.check(row); if (err) return { data: null, error: { message: err } };
          rows.push(row); made.push(row);
        }
        return this.want ? this.shape(made) : { data: null, error: null };
      }
      if (this.op === 'update') {
        const hit = rows.filter(r => this.match(r));
        for (const r of hit) { const next = { ...r, ...this.patch }; const err = this.check(next, r); if (err) return { data: null, error: { message: err } }; }
        for (const r of hit) Object.assign(r, this.patch);
        return this.want ? this.shape(hit) : { data: null, error: null };
      }
      if (this.op === 'delete') { tables[this.table] = rows.filter(r => !this.match(r)); return { data: null, error: null }; }
      throw new Error('fake: unknown op');
    }
  }
  return { from: (name) => new Q(name), rpc: async () => ({ data: null, error: null }), _tables: tables, _seed: (name, list) => { for (const r of list) t(name).push(new Q(name).fill(r)); } };
}

module.exports = { makeDb, SCHEMA, MAX_ROWS };
