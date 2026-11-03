// Kanalyst Blueprint — layout math & formatting helpers (pure functions)

export const HEADER_H    = 58;   // board title bar
export const GUTTER_W    = 132;  // layer label column on the left of a board
export const MIN_LAYER_H = 128;
export const BUCKET_W    = 200;
export const BUCKET_H    = 112;
export const INCOME_W    = 210;
export const INCOME_H    = 78;
export const MIN_BOARD_W = 520;

export const PERIODS = [
  { id: 'week',       label: 'Weekly',     short: 'WK' },
  { id: 'month',      label: 'Monthly',    short: 'MO' },
  { id: 'year',       label: 'Yearly',     short: 'YR' },
  { id: 'multi_year', label: 'Multi-year', short: 'YRS' },
];
export const periodLabel = (p) => (PERIODS.find(x => x.id === p) || PERIODS[2]).label;
export const periodShort = (p) => (PERIODS.find(x => x.id === p) || PERIODS[2]).short;

export const RECURRENCE = [
  { id: 'none',    label: 'One-time' },
  { id: 'weekly',  label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
  { id: 'yearly',  label: 'Every year' },
];

export const LINK_TYPES = [
  { id: 'funds',   label: 'Funds',   hint: 'Money flows from the source into the target' },
  { id: 'backup',  label: 'Backup',  hint: 'Source is the reserve that refills the target (e.g. during a crash)' },
  { id: 'related', label: 'Related', hint: 'Just connected — no money flow implied' },
];

export const ASSET_TYPES = [
  { id: 'all',    label: 'All' },
  { id: 'broker', label: 'Brokers' },
  { id: 'stock',  label: 'Stocks' },
  { id: 'mf',     label: 'Mutual funds' },
  { id: 'fd',     label: 'FD' },
  { id: 'rd',     label: 'RD' },
  { id: 'nps',    label: 'NPS' },
];
export const assetTypeLabel = (t) => ({ stock: 'Stock', broker: 'Broker', mf: 'MF', fd: 'FD', rd: 'RD', nps: 'NPS' }[t] || t);

export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function fmtINR(v, { compact = true } = {}) {
  const n = num(v);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (!compact) return sign + '₹' + Math.round(a).toLocaleString('en-IN');
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(a)}`;
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Progress → tone. Returned value is a CSS variable name from kanalyst-tokens.css
export function progressTone(bucket) {
  if (bucket.status === 'completed') return 'mint';
  const p = num(bucket.progress);
  if (num(bucket.target_amount) <= 0) return 'muted';
  if (p >= 100) return 'mint';
  if (p >= 60)  return 'lime';
  if (p >= 25)  return 'gold';
  return 'coral';
}

export function isOverdue(bucket) {
  if (!bucket.target_date || bucket.status === 'completed') return false;
  return new Date(bucket.target_date) < new Date(new Date().toDateString()) && num(bucket.progress) < 100;
}

// ── Board layout ────────────────────────────────────────────────────
// Layer heights grow automatically to fit the buckets inside them.
export function computeLayout(boards, buckets) {
  const out = {};
  for (const bd of boards) {
    const heights = bd.layers.map(l => {
      let h = Math.max(MIN_LAYER_H, num(l.height));
      for (const b of buckets) {
        if (b.board_id === bd.id && b.layer_id === l.id && !b.__hidden) {
          h = Math.max(h, num(b.y) + num(b.h || BUCKET_H) + 14);
        }
      }
      return h;
    });
    const tops = [];
    let t = 0;
    for (const h of heights) { tops.push(t); t += h; }
    out[bd.id] = { heights, tops, bodyH: t, totalH: HEADER_H + t };
  }
  return out;
}

export function bucketRect(b, boardsById, layout) {
  const w = num(b.w) || (b.kind === 'income' ? INCOME_W : BUCKET_W);
  const h = b.kind === 'income' ? INCOME_H : (num(b.h) || BUCKET_H);
  if (!b.board_id || !boardsById[b.board_id]) return { x: num(b.x), y: num(b.y), w, h };
  const bd = boardsById[b.board_id];
  const L = layout[bd.id];
  let i = bd.layers.findIndex(l => l.id === b.layer_id);
  if (i < 0) i = 0;
  return { x: num(bd.x) + num(b.x), y: num(bd.y) + HEADER_H + (L?.tops[i] || 0) + num(b.y), w, h };
}

// Where does a bucket land if its top-left is at world (wx, wy)?
export function dropTarget(wx, wy, w, h, boards, layout) {
  const cx = wx + w / 2;
  const cy = wy + h / 2;
  for (let k = boards.length - 1; k >= 0; k--) {
    const bd = boards[k];
    const L = layout[bd.id];
    if (!L || !bd.layers.length) continue;
    const bx = num(bd.x), by = num(bd.y) + HEADER_H, bw = num(bd.w);
    if (cx < bx || cx > bx + bw || cy < by || cy > by + L.bodyH) continue;
    const relY = cy - by;
    let i = L.tops.findIndex((t, idx) => relY >= t && relY < t + L.heights[idx]);
    if (i < 0) i = bd.layers.length - 1;
    return {
      board_id: bd.id,
      layer_id: bd.layers[i].id,
      x: Math.round(clamp(wx - bx, GUTTER_W + 8, Math.max(GUTTER_W + 8, bw - w - 10))),
      y: Math.round(clamp(wy - (by + L.tops[i]), 10, Math.max(10, L.heights[i] - h - 10))),
    };
  }
  return { board_id: null, layer_id: null, x: Math.round(wx), y: Math.round(wy) };
}

// Anchor points + curved path between two rects
function anchors(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  if (Math.abs(dx) * 0.7 > Math.abs(dy)) {
    const s = dx > 0 ? 1 : -1;
    return { p1: { x: s > 0 ? a.x + a.w : a.x, y: ac.y }, p2: { x: s > 0 ? b.x : b.x + b.w, y: bc.y }, horiz: true };
  }
  const s = dy > 0 ? 1 : -1;
  return { p1: { x: ac.x, y: s > 0 ? a.y + a.h : a.y }, p2: { x: bc.x, y: s > 0 ? b.y : b.y + b.h }, horiz: false };
}

export function linkPath(a, b) {
  const { p1, p2, horiz } = anchors(a, b);
  const k = 0.45;
  const c1 = horiz ? { x: p1.x + (p2.x - p1.x) * k, y: p1.y } : { x: p1.x, y: p1.y + (p2.y - p1.y) * k };
  const c2 = horiz ? { x: p2.x - (p2.x - p1.x) * k, y: p2.y } : { x: p2.x, y: p2.y - (p2.y - p1.y) * k };
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
  };
}

export function contentBounds(boards, rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); };
  boards.forEach(add);
  rects.forEach(add);
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Nudge a dropped bucket so it doesn't sit on top of a sibling in the same layer.
// Tries the drop spot first, then slides right, then wraps to a new row below.
export function avoidOverlap(pos, w, h, siblings, boardW) {
  const hit = (x, y) => siblings.some(s => x < s.x + s.w + 8 && x + w + 8 > s.x && y < s.y + s.h + 8 && y + h + 8 > s.y);
  if (!hit(pos.x, pos.y)) return pos;
  const maxX = Math.max(GUTTER_W + 8, boardW - w - 10);
  for (let row = 0; row < 8; row++) {
    const y = row === 0 ? pos.y : 10 + row * (h + 14);
    const xs = [];
    for (let x = GUTTER_W + 8; x <= maxX; x += 12) xs.push(x);
    xs.sort((a, b) => Math.abs(a - pos.x) - Math.abs(b - pos.x)); // nearest free slot first
    for (const x of xs) if (!hit(x, y)) return { ...pos, x: Math.round(x), y: Math.round(y) };
  }
  return pos;
}

// ── Goal colours (hues from the Kanalyst token set) ─────────────────
export const GOAL_COLORS = [
  { id: 'moss',       label: 'Moss',       hex: '#6b8e23' },
  { id: 'forest',     label: 'Forest',     hex: '#1f6b4a' },
  { id: 'teal',       label: 'Teal',       hex: '#2d6b6b' },
  { id: 'prussian',   label: 'Prussian',   hex: '#34487a' },
  { id: 'aubergine',  label: 'Aubergine',  hex: '#5d3b78' },
  { id: 'mulberry',   label: 'Mulberry',   hex: '#964062' },
  { id: 'madder',     label: 'Madder',     hex: '#a82c2c' },
  { id: 'terracotta', label: 'Terracotta', hex: '#b8551f' },
  { id: 'sienna',     label: 'Sienna',     hex: '#a8741a' },
  { id: 'slate',      label: 'Slate',      hex: '#5b6470' },
];
export const colorHex = (id) => (GOAL_COLORS.find(c => c.id === id) || {}).hex || null;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// Next date a repeating goal falls due (today counts). null when not scheduled.
export function nextDue(b, from = new Date()) {
  const today = startOfDay(from);
  const day = b.recurrence_day;
  if (b.recurrence === 'weekly') {
    if (day === null || day === undefined) return null;
    const d = new Date(today);
    d.setDate(d.getDate() + ((Number(day) - d.getDay() + 7) % 7));
    return d;
  }
  if (b.recurrence === 'monthly') {
    if (!day) return null;
    let y = today.getFullYear(), m = today.getMonth();
    let d = new Date(y, m, Math.min(day, daysInMonth(y, m)));
    if (d < today) { m += 1; if (m > 11) { m = 0; y += 1; } d = new Date(y, m, Math.min(day, daysInMonth(y, m))); }
    return d;
  }
  if (b.recurrence === 'yearly') {
    if (!day || !b.recurrence_month) return null;
    const m = b.recurrence_month - 1;
    let y = today.getFullYear();
    let d = new Date(y, m, Math.min(day, daysInMonth(y, m)));
    if (d < today) { y += 1; d = new Date(y, m, Math.min(day, daysInMonth(y, m))); }
    return d;
  }
  return null;
}

export function scheduleText(b) {
  if (b.recurrence === 'weekly' && b.recurrence_day !== null && b.recurrence_day !== undefined) return `Every ${WEEKDAYS[b.recurrence_day]}`;
  if (b.recurrence === 'monthly' && b.recurrence_day) return `Monthly on day ${b.recurrence_day}`;
  if (b.recurrence === 'yearly' && b.recurrence_day && b.recurrence_month) return `Every ${b.recurrence_day} ${MONTHS[b.recurrence_month - 1].slice(0, 3)}`;
  return { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' }[b.recurrence] || '';
}

// The date that matters for a goal: next due for repeating goals, else the target date
export function dueDate(b) {
  if (b.recurrence && b.recurrence !== 'none') return nextDue(b);
  if (!b.target_date) return null;
  const d = new Date(b.target_date);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

const DAY = 864e5;
export function daysUntil(d) { return d ? Math.round((startOfDay(d) - startOfDay(new Date())) / DAY) : null; }

export function relTime(days) {
  if (days === null) return '';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days < 14) return `in ${days}d`;
  if (days < 60) return `in ${Math.round(days / 7)}w`;
  if (days < 730) return `in ${Math.round(days / 30.4)} mo`;
  return `in ${(days / 365).toFixed(days < 3650 ? 1 : 0)} yrs`;
}

// What needs attention on a goal card: 'reached' | 'overdue' | 'soon' | null
export function attention(b) {
  if (b.kind !== 'goal' || b.status === 'completed') return null;
  if (num(b.target_amount) > 0 && num(b.progress) >= 100) return 'reached';
  const d = daysUntil(dueDate(b));
  if (d === null) return null;
  if (d < 0) return 'overdue';
  if (d <= 7) return 'soon';
  return null;
}

// Layer timeline derived from the due dates of the goals inside it.
// The chip reflects how long each goal runs: a repeating goal counts by its
// cycle (a yearly fee due next week is still a yearly goal), a one-time goal
// by how far away its target date is.
const RANK = ['week', 'month', 'year', 'multi_year'];
function goalPeriod(b) {
  if (b.recurrence === 'weekly') return 'week';
  if (b.recurrence === 'monthly') return 'month';
  if (b.recurrence === 'yearly') return 'year';
  const d = daysUntil(dueDate(b));
  if (d === null) return null;
  return d <= 7 ? 'week' : d <= 31 ? 'month' : d <= 366 ? 'year' : 'multi_year';
}
export function layerHorizon(layer, goals) {
  const win = laneWindow(layer);
  const dates = goals.map(dueDate).filter(Boolean).sort((a, z) => a - z);
  if (win) {
    const soon = dates.find(d => daysUntil(d) >= 0) || dates[0];
    return {
      chip: periodShort(win.period), period: win.period, range: laneWindowText(win),
      rel: dates.length ? `Soonest goal ${relTime(daysUntil(soon))}` : (goals.length ? 'Add target dates' : 'No open goals'),
      count: goals.length, fromLane: true,
    };
  }
  if (!dates.length) return { chip: periodShort(layer.period), period: layer.period, range: null, rel: null, count: goals.length };
  const period = goals.map(goalPeriod).filter(Boolean).sort((a, z) => RANK.indexOf(z) - RANK.indexOf(a))[0] || layer.period;
  const first = dates[0], last = dates[dates.length - 1];
  const mon = (d) => d.toLocaleDateString('en-IN', { month: 'short' });
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  const sameYear = first.getFullYear() === last.getFullYear();
  const range = sameMonth ? `${mon(first)} ${first.getFullYear()}`
    : sameYear ? `${mon(first)} – ${mon(last)} ${last.getFullYear()}`
    : `${mon(first)} ${first.getFullYear()} – ${mon(last)} ${last.getFullYear()}`;
  const soonest = relTime(daysUntil(first));
  return {
    period,
    chip: periodShort(period),
    range,
    rel: dates.length > 1 ? `Soonest ${soonest}` : soonest.charAt(0).toUpperCase() + soonest.slice(1),
    count: goals.length,
  };
}

// ── Lanes: each lane covers a time window, top = soonest ─────────────
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (v) => { if (!v) return null; const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return y ? new Date(y, (m || 1) - 1, d || 1) : null; };

export const LANE_PRESETS = [
  { id: 'this_week',  label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'this_year',  label: 'This year' },
  { id: 'next_year',  label: 'Next year' },
  { id: 'year_2',     label: 'In 2 years' },
  { id: 'year_3',     label: 'In 3 years' },
  { id: 'year_4',     label: 'In 4 years' },
  { id: 'year_5',     label: 'In 5 years' },
  { id: 'years_1_5',  label: '1 – 5 years' },
  { id: 'years_2_5',  label: '2 – 5 years' },
  { id: 'beyond_5',   label: '5+ years' },
];
export const DEFAULT_LANES = ['this_month', 'this_year', 'next_year', 'years_2_5', 'beyond_5'];

// Resolve a lane to real dates. Rolling presets move with today's date.
export function laneWindow(layer, now = new Date()) {
  const t = startOfDay(now), Y = t.getFullYear();
  const yr = (y) => [new Date(y, 0, 1), new Date(y, 11, 31)];
  let from = null, to = null;
  switch (layer.horizon) {
    case 'this_week': { from = t; to = new Date(t); to.setDate(t.getDate() + (6 - t.getDay())); break; }
    case 'this_month': from = t; to = new Date(Y, t.getMonth() + 1, 0); break;
    case 'this_year': from = t; to = new Date(Y, 11, 31); break;
    case 'next_year': [from, to] = yr(Y + 1); break;
    case 'year_2': [from, to] = yr(Y + 2); break;
    case 'year_3': [from, to] = yr(Y + 3); break;
    case 'year_4': [from, to] = yr(Y + 4); break;
    case 'year_5': [from, to] = yr(Y + 5); break;
    case 'years_1_5': from = new Date(Y + 1, 0, 1); to = new Date(Y + 5, 11, 31); break;
    case 'years_2_5': from = new Date(Y + 2, 0, 1); to = new Date(Y + 5, 11, 31); break;
    case 'beyond_5': from = new Date(Y + 6, 0, 1); to = null; break;
    case 'custom': from = parseYmd(layer.horizon_from); to = parseYmd(layer.horizon_to); break;
    default: return null;
  }
  if (!from && !to) return null;
  const span = (to && from) ? (to - from) / 864e5 : Infinity;
  const period = span <= 7 ? 'week' : span <= 31 ? 'month' : span <= 366 ? 'year' : 'multi_year';
  return { from, to, period };
}

export function laneWindowText(win) {
  if (!win) return null;
  const m = (d) => d.toLocaleDateString('en-IN', { month: 'short' });
  const { from, to } = win;
  if (from && !to) return `From ${m(from)} ${from.getFullYear()}`;
  if (!from && to) return `Until ${m(to)} ${to.getFullYear()}`;
  const fullYear = from.getMonth() === 0 && from.getDate() === 1 && to.getMonth() === 11 && to.getDate() === 31;
  if (fullYear) return from.getFullYear() === to.getFullYear() ? `${from.getFullYear()}` : `${from.getFullYear()} – ${to.getFullYear()}`;
  if (from.getFullYear() === to.getFullYear()) return from.getMonth() === to.getMonth() ? `${m(from)} ${from.getFullYear()}` : `${m(from)} – ${m(to)} ${to.getFullYear()}`;
  return `${m(from)} ${from.getFullYear()} – ${m(to)} ${to.getFullYear()}`;
}

// Where a new lane belongs so lanes stay in time order (by start, then end)
export function laneInsertIndex(layers, newLane) {
  const key = (l) => { const w = laneWindow(l); return w ? [ (w.from || w.to).getTime(), w.to ? w.to.getTime() : Infinity ] : null; };
  const k = key(newLane);
  if (!k) return layers.length;
  for (let i = 0; i < layers.length; i++) {
    const o = key(layers[i]);
    if (!o) continue;
    if (k[0] < o[0] || (k[0] === o[0] && k[1] < o[1])) return i;
  }
  return layers.length;
}

export const laneDates = { ymd };

// Is a goal's date inside its lane's window?
export function outsideLane(goal, layer) {
  const win = laneWindow(layer); const d = dueDate(goal);
  if (!win || !d) return false;
  return (win.from && d < startOfDay(win.from) && d >= startOfDay(new Date())) || (win.to && d > win.to);
}

// Next slot at the end of the first row of a lane — no fixed number per row
export function nextRowSlot(siblings, w = BUCKET_W) {
  const row = siblings.filter(s => s.y < BUCKET_H);
  const right = row.reduce((m, s) => Math.max(m, s.x + s.w), GUTTER_W + 4);
  return { x: Math.round(right + 20), y: 18, needW: Math.round(right + 20 + w + 20) };
}

// ── Grid inside a lane: up to 5 goals per row, tight rows ───────────
export const COLS = 5;
export const COL_GAP = 20;
export const ROW_GAP = 16;
export const LANE_PAD_Y = 16;
const colX = (c) => GUTTER_W + 22 + c * (BUCKET_W + COL_GAP);
const rowY = (r) => LANE_PAD_Y + r * (BUCKET_H + ROW_GAP);
export const gridWidth = (cols) => colX(Math.max(1, cols)) - COL_GAP + 22;   // board width that fits `cols` columns
export const FULL_W = gridWidth(COLS);

function cellOf(s) {
  return { c: Math.max(0, Math.round((s.x - colX(0)) / (BUCKET_W + COL_GAP))), r: Math.max(0, Math.round((s.y - LANE_PAD_Y) / (BUCKET_H + ROW_GAP))) };
}
// First free cell, reading left→right then top→bottom
export function nextGridSlot(siblings) {
  const taken = new Set(siblings.map(s => { const k = cellOf(s); return `${k.r}:${k.c}`; }));
  for (let r = 0; r < 50; r++) for (let c = 0; c < COLS; c++) {
    if (!taken.has(`${r}:${c}`)) return { x: colX(c), y: rowY(r), col: c };
  }
  return { x: colX(0), y: rowY(50), col: 0 };
}
// Nearest free cell to a dropped position
export function nearestGridSlot(x, y, siblings) {
  const taken = new Set(siblings.map(s => { const k = cellOf(s); return `${k.r}:${k.c}`; }));
  const want = cellOf({ x, y });
  let best = null;
  for (let r = 0; r < 50; r++) for (let c = 0; c < COLS; c++) {
    if (taken.has(`${r}:${c}`)) continue;
    const d = Math.abs(r - want.r) * 1.6 + Math.abs(c - Math.min(want.c, COLS - 1));
    if (!best || d < best.d) best = { d, x: colX(c), y: rowY(r), col: c };
  }
  return best || nextGridSlot(siblings);
}
// Place an ordered list of goals into the grid
export const gridPositions = (n) => Array.from({ length: n }, (_, i) => ({ x: colX(i % COLS), y: rowY(Math.floor(i / COLS)) }));

// ── Money needed per lane, for the milestone rail ───────────────────
function cyclesIn(b, from, to) {
  if (!to) return 1;
  let n = 0;
  const step = (d) => {
    const x = new Date(d);
    if (b.recurrence === 'weekly') x.setDate(x.getDate() + 7);
    else if (b.recurrence === 'monthly') x.setMonth(x.getMonth() + 1);
    else x.setFullYear(x.getFullYear() + 1);
    return x;
  };
  const start = from > new Date() ? from : new Date();
  // No day chosen yet: assume one payment per cycle, starting at the lane start
  let d = nextDue(b, start) || new Date(start);
  while (d && d <= to && n < 600) { n++; d = step(d); }
  return Math.max(n, 1);
}
export function laneMoney(layer, goals) {
  const win = laneWindow(layer);
  let need = 0, funded = 0;
  for (const g of goals) {
    const t = num(g.target_amount);
    if (t <= 0) continue;
    if (g.recurrence && g.recurrence !== 'none' && win) {
      const n = cyclesIn(g, win.from || new Date(), win.to);
      need += t * n;
      funded += Math.min(num(g.current_value), t);
    } else {
      need += t;
      funded += Math.min(num(g.current_value), t);
    }
  }
  return { need, funded, gap: Math.max(0, need - funded), win };
}
