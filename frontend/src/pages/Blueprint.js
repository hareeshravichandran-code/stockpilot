import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { blueprintAPI } from '../lib/api';
import {
  HEADER_H, GUTTER_W, MIN_LAYER_H, BUCKET_W, BUCKET_H, INCOME_W, INCOME_H, MIN_BOARD_W,
  periodShort, fmtINR, fmtDate, num, clamp, progressTone, isOverdue,
  computeLayout, bucketRect, dropTarget, linkPath, contentBounds, avoidOverlap,
} from '../blueprint/geom';
import { BucketPanel, IncomePanel, BoardPanel, LinkPanel, CompletedPanel } from '../blueprint/Panels';
import './Blueprint.css';

const DEFAULT_LAYERS = [
  { label: 'This month',  period: 'month' },
  { label: 'This year',   period: 'year' },
  { label: '1 – 5 years', period: 'multi_year' },
  { label: '5+ years',    period: 'multi_year' },
];
const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const DRAG_THRESHOLD = 4;

export default function Blueprint() {
  const nav = useNavigate();
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const fittedRef = useRef(false);

  const [data, setData] = useState({ boards: [], buckets: [], links: [] });
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState({ x: 40, y: 24, z: 1 });
  const [sel, setSel] = useState(null);            // {type:'bucket'|'board'|'link', id}
  const [showCompleted, setShowCompleted] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [drag, setDrag] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const r = await blueprintAPI.get();
      setData(r.data);
      setStatus('ready');
    } catch (e) {
      if (e?.response?.data?.needsMigration) setStatus('migration');
      else { setStatus(s => (s === 'ready' ? 'ready' : 'error')); setLoadError(errMsg(e)); }
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const notify = useCallback((text, tone = 'ok') => {
    setToast({ text, tone, k: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 5200 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Derived geometry (with live drag overrides) ───────────────────
  const boards = useMemo(() => data.boards.map(bd => {
    let b = bd;
    if (drag?.kind === 'board' && drag.id === bd.id && drag.moved) b = { ...b, x: drag.x, y: drag.y };
    if (drag?.kind === 'boardW' && drag.id === bd.id) b = { ...b, w: drag.w };
    if (drag?.kind === 'layer' && drag.boardId === bd.id) b = { ...b, layers: b.layers.map(l => l.id === drag.id ? { ...l, height: drag.h } : l) };
    return b;
  }), [data.boards, drag]);
  const boardsById = useMemo(() => Object.fromEntries(boards.map(b => [b.id, b])), [boards]);

  const visible = useMemo(
    () => data.buckets.filter(b => showCompleted || b.status !== 'completed'),
    [data.buckets, showCompleted]
  );
  const layoutBuckets = useMemo(
    () => (drag?.kind === 'bucket' && drag.moved ? visible.filter(b => b.id !== drag.id) : visible),
    [visible, drag]
  );
  const layout = useMemo(() => computeLayout(boards, layoutBuckets), [boards, layoutBuckets]);

  const rects = useMemo(() => {
    const out = {};
    for (const b of visible) {
      if (drag?.kind === 'bucket' && drag.id === b.id && drag.moved) out[b.id] = { x: drag.x, y: drag.y, w: drag.w, h: drag.h };
      else out[b.id] = bucketRect(b, boardsById, layout);
    }
    return out;
  }, [visible, boardsById, layout, drag]);

  const bucketsById = useMemo(() => Object.fromEntries(data.buckets.map(b => [b.id, b])), [data.buckets]);

  // ── Screen ↔ world ────────────────────────────────────────────────
  const toWorld = useCallback((clientX, clientY) => {
    const r = canvasRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }, [view]);

  const viewportCenter = useCallback(() => {
    const r = canvasRef.current?.getBoundingClientRect() || { width: 1200, height: 800 };
    return { x: (r.width / 2 - view.x) / view.z, y: (r.height / 2 - view.y) / view.z };
  }, [view]);

  const fit = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const bounds = contentBounds(
      boards.map(bd => ({ x: num(bd.x), y: num(bd.y), w: num(bd.w), h: layout[bd.id]?.totalH || HEADER_H })),
      Object.values(rects)
    );
    if (!bounds) return;
    const W = el.clientWidth, H = el.clientHeight;
    const z = clamp(Math.min((W - 96) / bounds.w, (H - 150) / bounds.h), 0.3, 1.1);
    setView({ z, x: (W - bounds.w * z) / 2 - bounds.x * z, y: (H - 90 - bounds.h * z) / 2 - bounds.y * z });
  }, [boards, layout, rects]);

  useEffect(() => {
    if (status === 'ready' && !fittedRef.current && (data.boards.length || data.buckets.length)) {
      fittedRef.current = true;
      requestAnimationFrame(fit);
    }
  }, [status, data, fit]);

  // Wheel: pan, ctrl/⌘ + wheel or pinch: zoom around the cursor
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.target.closest && e.target.closest('.bp-panel')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView(v => {
          const z = clamp(v.z * Math.exp(-e.deltaY * 0.0022), 0.3, 1.8);
          return { z, x: mx - (mx - v.x) * (z / v.z), y: my - (my - v.y) * (z / v.z) };
        });
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  const zoomBy = (f) => {
    const el = canvasRef.current;
    const W = el?.clientWidth || 1000, H = el?.clientHeight || 700;
    setView(v => {
      const z = clamp(v.z * f, 0.3, 1.8);
      return { z, x: W / 2 - (W / 2 - v.x) * (z / v.z), y: H / 2 - (H / 2 - v.y) * (z / v.z) };
    });
  };

  // ── Drag engine (window-level pointer listeners) ──────────────────
  const beginDrag = (e, payload) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    const d = { ...payload, sx: e.clientX, sy: e.clientY, moved: false };
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dxs = e.clientX - d.sx, dys = e.clientY - d.sy;
      const moved = d.moved || Math.abs(dxs) + Math.abs(dys) > DRAG_THRESHOLD;
      const dx = dxs / view.z, dy = dys / view.z;
      let next = { ...d, moved };
      if (d.kind === 'pan') next = { ...next, vx: d.ox + dxs, vy: d.oy + dys };
      if (d.kind === 'bucket') {
        next.x = d.ox + dx; next.y = d.oy + dy;
        next.target = d.isIncome ? null : dropTarget(next.x, next.y, d.w, d.h, boards, layout);
      }
      if (d.kind === 'board') { next.x = Math.round(d.ox + dx); next.y = Math.round(d.oy + dy); }
      if (d.kind === 'boardW') next.w = Math.round(Math.max(d.minW, d.ow + dx));
      if (d.kind === 'layer') next.h = Math.round(Math.max(d.minH, d.oh + dy));
      if (d.kind === 'link') { const w = toWorld(e.clientX, e.clientY); next.x = w.x; next.y = w.y; }
      dragRef.current = next;
      if (d.kind === 'pan') setView(v => ({ ...v, x: next.vx, y: next.vy }));
      setDrag(next);
    };

    const up = async (e) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;

      if (d.kind === 'pan') { if (!d.moved) setSel(null); return; }

      if (d.kind === 'bucket') {
        if (!d.moved) { setSel({ type: 'bucket', id: d.id }); return; }
        let patch = d.isIncome
          ? { board_id: null, layer_id: null, x: Math.round(d.x), y: Math.round(d.y) }
          : dropTarget(d.x, d.y, d.w, d.h, boards, layout);
        if (patch.layer_id) {
          const sibs = visible.filter(b => b.id !== d.id && b.layer_id === patch.layer_id)
            .map(b => ({ x: num(b.x), y: num(b.y), w: num(b.w) || BUCKET_W, h: num(b.h) || BUCKET_H }));
          patch = avoidOverlap(patch, d.w, d.h, sibs, num(boardsById[patch.board_id]?.w));
        }
        setData(s => ({ ...s, buckets: s.buckets.map(b => b.id === d.id ? { ...b, ...patch } : b) }));
        try { await blueprintAPI.saveLayout({ buckets: [{ id: d.id, ...patch }] }); }
        catch (err) { notify(errMsg(err), 'error'); reload(); }
        return;
      }

      if (d.kind === 'board') {
        if (!d.moved) { setSel({ type: 'board', id: d.id }); return; }
        setData(s => ({ ...s, boards: s.boards.map(b => b.id === d.id ? { ...b, x: d.x, y: d.y } : b) }));
        blueprintAPI.saveLayout({ boards: [{ id: d.id, x: d.x, y: d.y }] }).catch(err => notify(errMsg(err), 'error'));
        return;
      }

      if (d.kind === 'boardW') {
        if (!d.moved) return;
        setData(s => ({ ...s, boards: s.boards.map(b => b.id === d.id ? { ...b, w: d.w } : b) }));
        blueprintAPI.saveLayout({ boards: [{ id: d.id, w: d.w }] }).catch(err => notify(errMsg(err), 'error'));
        return;
      }

      if (d.kind === 'layer') {
        if (!d.moved) return;
        setData(s => ({ ...s, boards: s.boards.map(b => b.id === d.boardId ? { ...b, layers: b.layers.map(l => l.id === d.id ? { ...l, height: d.h } : l) } : b) }));
        blueprintAPI.saveLayout({ layers: [{ id: d.id, height: d.h }] }).catch(err => notify(errMsg(err), 'error'));
        return;
      }

      if (d.kind === 'link') {
        if (!d.moved) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const bucketEl = el?.closest?.('[data-bucket-id]');
        const boardEl = el?.closest?.('[data-board-id]');
        const toBucket = bucketEl?.getAttribute('data-bucket-id');
        const toBoard = !toBucket ? boardEl?.getAttribute('data-board-id') : null;
        if (!toBucket && !toBoard) return;
        if (toBucket === d.id) return;
        try {
          const r = await blueprintAPI.createLink({ from_bucket_id: d.id, to_bucket_id: toBucket || null, to_board_id: toBoard || null });
          await reload();
          setSel({ type: 'link', id: r.data.id });
          notify('Linked — set the type and amount on the right');
        } catch (err) { notify(errMsg(err), 'error'); }
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // Only re-bind when a drag starts/ends, not on every move
  }, [drag !== null]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSel(null); setDrawer(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Drag starters ─────────────────────────────────────────────────
  const startPan = (e) => beginDrag(e, { kind: 'pan', ox: view.x, oy: view.y });
  const startBucket = (e, b) => {
    const r = rects[b.id];
    beginDrag(e, { kind: 'bucket', id: b.id, isIncome: b.kind === 'income', ox: r.x, oy: r.y, w: r.w, h: r.h, x: r.x, y: r.y });
  };
  const startBoard = (e, bd) => {
    if (e.target.closest('button, input')) { e.stopPropagation(); return; }
    beginDrag(e, { kind: 'board', id: bd.id, ox: num(bd.x), oy: num(bd.y), x: num(bd.x), y: num(bd.y) });
  };
  const startBoardW = (e, bd) => {
    const inside = visible.filter(b => b.board_id === bd.id);
    const minW = Math.max(MIN_BOARD_W, ...inside.map(b => num(b.x) + num(b.w || BUCKET_W) + 12));
    beginDrag(e, { kind: 'boardW', id: bd.id, ow: num(bd.w), w: num(bd.w), minW });
  };
  const startLayer = (e, bd, l) => {
    const inside = visible.filter(b => b.layer_id === l.id);
    const minH = Math.max(MIN_LAYER_H, ...inside.map(b => num(b.y) + num(b.h || BUCKET_H) + 14));
    const cur = layout[bd.id]?.heights[bd.layers.indexOf(l)] || num(l.height);
    beginDrag(e, { kind: 'layer', id: l.id, boardId: bd.id, oh: cur, h: cur, minH });
  };
  const startLink = (e, b) => {
    const w = toWorld(e.clientX, e.clientY);
    beginDrag(e, { kind: 'link', id: b.id, x: w.x, y: w.y });
  };

  // ── Creation ──────────────────────────────────────────────────────
  const guard = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { notify(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  const addBoard = () => guard(async () => {
    const right = data.boards.reduce((m, b) => Math.max(m, num(b.x) + num(b.w)), -Infinity);
    const c = viewportCenter();
    const pos = Number.isFinite(right) ? { x: right + 120, y: num(data.boards[0]?.y) || 200 } : { x: Math.round(c.x - 450), y: Math.round(c.y - 260) };
    const r = await blueprintAPI.createBoard({ name: 'New plan', w: 920, ...pos, layers: DEFAULT_LAYERS });
    await reload();
    setSel({ type: 'board', id: r.data.id });
    notify('Plan box created — rename it and adjust layers on the right');
  });

  const addGoalAt = (board, layer, rel) => guard(async () => {
    const r = await blueprintAPI.createBucket({
      kind: 'goal', name: 'New goal', board_id: board.id, layer_id: layer.id,
      x: Math.round(rel?.x ?? GUTTER_W + 20), y: Math.round(rel?.y ?? 18), w: BUCKET_W, h: BUCKET_H,
      recurrence: layer.period === 'week' ? 'weekly' : layer.period === 'month' ? 'monthly' : 'none',
    });
    await reload();
    setSel({ type: 'bucket', id: r.data.id });
  });

  const addExternal = () => guard(async () => {
    const c = viewportCenter();
    const r = await blueprintAPI.createBucket({ kind: 'goal', name: 'New goal', x: Math.round(c.x - BUCKET_W / 2), y: Math.round(c.y - BUCKET_H / 2), w: BUCKET_W, h: BUCKET_H });
    await reload();
    setSel({ type: 'bucket', id: r.data.id });
  });

  const addIncome = () => guard(async () => {
    const c = viewportCenter();
    const top = data.boards.length ? Math.min(...data.boards.map(b => num(b.y))) - INCOME_H - 70 : c.y - 200;
    const r = await blueprintAPI.createBucket({ kind: 'income', name: 'New income', income_source: 'manual', x: Math.round(c.x - INCOME_W / 2), y: Math.round(top), w: INCOME_W, h: INCOME_H });
    await reload();
    setSel({ type: 'bucket', id: r.data.id });
  });

  // The sample plan mirrors the hand-drawn sketch: 4 layers of goals,
  // Salary & Dividends above, Backup fund linked to Retirement, Kid future outside.
  const createSample = () => guard(async () => {
    const bx = 80, by = 220, bw = 1000;
    const { data: board } = await blueprintAPI.createBoard({ name: 'Family plan', x: bx, y: by, w: bw, layers: DEFAULT_LAYERS });
    const L = board.layers;
    const col = (i) => GUTTER_W + 24 + i * 228;
    const goal = (name, li, i, extra = {}) => blueprintAPI.createBucket({ kind: 'goal', name, board_id: board.id, layer_id: L[li].id, x: col(i), y: 18, w: BUCKET_W, h: BUCKET_H, ...extra });
    const yearly = { recurrence: 'yearly' };
    const results = await Promise.all([
      goal('TV', 0, 0), goal('Fridge', 0, 1), goal('Home maintenance', 0, 2, { recurrence: 'monthly' }),
      goal('School fee', 1, 0, yearly), goal('Insurance premium', 1, 1, yearly), goal('Family trip', 1, 2, yearly),
      goal('Car', 2, 0), goal('Renovation', 2, 1), goal('Property', 2, 2),
      goal('Child education', 3, 0), goal('Retirement', 3, 1, { w: 240 }),
      blueprintAPI.createBucket({ kind: 'goal', name: 'Backup fund', x: bx + bw + 60, y: by + HEADER_H + MIN_LAYER_H + 20, w: BUCKET_W, h: BUCKET_H }),
      blueprintAPI.createBucket({ kind: 'goal', name: 'Kid future', x: bx + bw + 340, y: by + HEADER_H + 40, w: 240, h: BUCKET_H }),
      blueprintAPI.createBucket({ kind: 'income', name: 'Salary', income_source: 'income_category', income_category: 'Salary', x: bx + 160, y: by - 150, w: INCOME_W, h: INCOME_H }),
      blueprintAPI.createBucket({ kind: 'income', name: 'Dividends', income_source: 'dividends', x: bx + 520, y: by - 150, w: INCOME_W, h: INCOME_H }),
    ]);
    const byName = Object.fromEntries(results.map(r => [r.data.name, r.data.id]));
    await Promise.all([
      blueprintAPI.createLink({ from_bucket_id: byName['Backup fund'], to_bucket_id: byName.Retirement, link_type: 'backup', label: 'Refills during a crash' }),
      blueprintAPI.createLink({ from_bucket_id: byName.Salary, to_board_id: board.id, link_type: 'funds' }),
      blueprintAPI.createLink({ from_bucket_id: byName.Dividends, to_bucket_id: byName.Retirement, link_type: 'funds' }),
    ]);
    fittedRef.current = false;
    await reload();
    notify('Sample plan ready — click any bucket to set targets and map funds');
  });

  // ── Deletion ──────────────────────────────────────────────────────
  const deleteBucket = (b) => {
    if (!window.confirm(`Delete "${b.name}"? Its links, notes and attachments go with it. Mapped assets are released.`)) return;
    guard(async () => { await blueprintAPI.deleteBucket(b.id); setSel(null); await reload(); notify('Deleted'); });
  };
  const deleteBoard = (bd) => {
    const n = data.buckets.filter(b => b.board_id === bd.id).length;
    if (!window.confirm(`Delete plan box "${bd.name}" and the ${n} goal(s) inside it? This can't be undone.`)) return;
    guard(async () => { await blueprintAPI.deleteBoard(bd.id); setSel(null); await reload(); notify('Plan box deleted'); });
  };

  // ── Stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const goals = data.buckets.filter(b => b.kind === 'goal');
    const open = goals.filter(b => b.status !== 'completed');
    const target = open.reduce((s, b) => s + num(b.target_amount), 0);
    const funded = open.reduce((s, b) => s + Math.min(num(b.current_value), num(b.target_amount) || 0), 0);
    const income = data.buckets.filter(b => b.kind === 'income').reduce((s, b) => s + num(b.inflow?.monthly), 0);
    return {
      open: open.length, completed: goals.length - open.length, target, funded, income,
      overdue: open.filter(isOverdue).length,
      pct: target > 0 ? Math.round(funded / target * 100) : 0,
    };
  }, [data.buckets]);

  // ── Render helpers ────────────────────────────────────────────────
  const selected = sel?.type === 'bucket' ? bucketsById[sel.id] : null;
  const selectedBoard = sel?.type === 'board' ? boardsById[sel.id] : null;
  const selectedLink = sel?.type === 'link' ? data.links.find(l => l.id === sel.id) : null;
  const panelOpen = !!(selected || selectedBoard || selectedLink || drawer);

  const linkEls = data.links.map(l => {
    const a = rects[l.from_bucket_id];
    let b = null;
    if (l.to_bucket_id) b = rects[l.to_bucket_id];
    else if (l.to_board_id && boardsById[l.to_board_id] && a) {
      // Land on the plan box's top edge, right below the source where possible
      const bd = boardsById[l.to_board_id];
      const tx = clamp(a.x + a.w / 2, num(bd.x) + 60, num(bd.x) + num(bd.w) - 60);
      b = { x: tx - 1, y: num(bd.y) - 2, w: 2, h: 2 };
    }
    if (!a || !b) return null;
    const { d, mid } = linkPath(a, b);
    const on = sel?.type === 'link' && sel.id === l.id;
    const related = sel?.type === 'bucket' && (l.from_bucket_id === sel.id || l.to_bucket_id === sel.id);
    const text = l.label || (l.amount ? `${fmtINR(l.amount)}/mo` : l.link_type === 'backup' ? 'backup' : '');
    const pick = (e) => { e.stopPropagation(); setSel({ type: 'link', id: l.id }); };
    return {
      line: (
        <g key={l.id} className={`bp-link lt-${l.link_type} ${on ? 'on' : ''} ${related ? 'related' : ''}`}>
          <path d={d} className="bp-link-hit" onPointerDown={pick} />
          <path d={d} className="bp-link-line" markerEnd={`url(#bp-arrow-${l.link_type})`} />
        </g>
      ),
      label: text ? (
        <g key={l.id} transform={`translate(${mid.x}, ${mid.y})`} className={`bp-link-label lt-${l.link_type} ${on ? 'on' : ''}`} onPointerDown={pick}>
          <rect x={-(text.length * 3.5 + 10)} y={-11} width={text.length * 7 + 20} height={22} rx={11} />
          <text textAnchor="middle" dy="4">{text}</text>
        </g>
      ) : null,
    };
  }).filter(Boolean);

  let ghost = null;
  if (drag?.kind === 'link' && drag.moved && rects[drag.id]) {
    const a = rects[drag.id];
    ghost = <path className="bp-link-ghost" d={linkPath(a, { x: drag.x - 1, y: drag.y - 1, w: 2, h: 2 }).d} />;
  }

  const dropHint = drag?.kind === 'bucket' && drag.moved ? drag.target : null;
  const isEmpty = status === 'ready' && data.boards.length === 0 && data.buckets.length === 0;

  return (
    <div className={`bp-root ${panelOpen ? 'with-panel' : ''}`}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="bp-top">
        <div className="bp-brand">
          <button className="bp-back" onClick={() => nav('/dashboard')} aria-label="Back to Kanalyst dashboard">‹</button>
          <div>
            <div className="bp-brand-name">Blueprint</div>
            <div className="bp-brand-sub">Kanalyst · goal planner</div>
          </div>
        </div>

        {status === 'ready' && !isEmpty && (
          <div className="bp-stats">
            <div className="bp-stat"><span className="bp-stat-k">Open goals</span><span className="bp-stat-v">{stats.open}</span></div>
            <div className="bp-stat"><span className="bp-stat-k">Funded</span><span className="bp-stat-v">{fmtINR(stats.funded)} <em>/ {fmtINR(stats.target)}</em></span></div>
            <div className="bp-stat wide">
              <span className="bp-stat-k">Overall</span>
              <span className="bp-stat-bar"><span style={{ width: `${Math.min(100, stats.pct)}%` }} /></span>
              <span className="bp-stat-v">{stats.pct}%</span>
            </div>
            <div className="bp-stat"><span className="bp-stat-k">Income</span><span className="bp-stat-v">{fmtINR(stats.income)}<em>/mo</em></span></div>
            {stats.overdue > 0 && <div className="bp-stat warn"><span className="bp-stat-k">Overdue</span><span className="bp-stat-v">{stats.overdue}</span></div>}
          </div>
        )}

        <div className="bp-top-actions">
          <label className="bp-toggle">
            <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
            <span className="bp-toggle-track" /> Show completed
          </label>
          <button className="bp-btn ghost" onClick={() => { setSel(null); setDrawer(true); }}>✓ Completed <span className="bp-count">{stats.completed}</span></button>
        </div>
      </header>

      {/* ── Canvas ──────────────────────────────────────────── */}
      <div ref={canvasRef} className={`bp-canvas ${drag?.kind === 'pan' ? 'panning' : ''} ${drag ? 'dragging' : ''}`}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.z}px ${24 * view.z}px` }}
        onPointerDown={startPan}>

        {status === 'ready' && !isEmpty && (
          <div className="bp-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {boards.map(bd => (
              <Board key={bd.id} board={bd} L={layout[bd.id]} buckets={visible}
                selected={sel?.type === 'board' && sel.id === bd.id}
                dropLayer={dropHint?.board_id === bd.id ? dropHint.layer_id : null}
                linkTarget={drag?.kind === 'link'}
                onHeaderDown={(e) => startBoard(e, bd)}
                onResizeW={(e) => startBoardW(e, bd)}
                onResizeLayer={(e, l) => startLayer(e, bd, l)}
                onAddGoal={(l, rel) => addGoalAt(bd, l, rel)}
                toWorld={toWorld}
                onOpen={() => setSel({ type: 'board', id: bd.id })}
              />
            ))}

            <svg className="bp-links" width="1" height="1">
              <defs>
                {['funds', 'backup', 'related'].map(t => (
                  <marker key={t} id={`bp-arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className={`bp-arrow lt-${t}`} />
                  </marker>
                ))}
              </defs>
              {linkEls.map(x => x.line)}
              {ghost}
            </svg>

            {visible.map(b => (
              <BucketCard key={b.id} bucket={b} rect={rects[b.id]}
                selected={sel?.type === 'bucket' && sel.id === b.id}
                dragging={drag?.kind === 'bucket' && drag.id === b.id && drag.moved}
                linkTarget={drag?.kind === 'link' && drag.id !== b.id}
                external={b.kind === 'goal' && !b.board_id}
                onDown={(e) => startBucket(e, b)}
                onLinkDown={(e) => startLink(e, b)}
              />
            ))}

            <svg className="bp-links labels" width="1" height="1">{linkEls.map(x => x.label)}</svg>
          </div>
        )}

        {status === 'loading' && <div className="bp-center"><div className="bp-spinner" /> Loading your blueprint…</div>}
        {status === 'error' && (
          <div className="bp-center card" onPointerDown={e => e.stopPropagation()}>
            <h3>Couldn't load Blueprint</h3>
            <p>{loadError}</p>
            <button className="bp-btn primary" onClick={() => { setStatus('loading'); reload(); }}>Try again</button>
          </div>
        )}
        {status === 'migration' && (
          <div className="bp-center card" onPointerDown={e => e.stopPropagation()}>
            <div className="bp-eyebrow">One-time setup</div>
            <h3>Blueprint tables aren't in the database yet</h3>
            <p>Run <code>backend/migrations/2026-11-03_blueprint.sql</code> in Supabase → SQL Editor, then reload this page.</p>
            <button className="bp-btn primary" onClick={() => { setStatus('loading'); reload(); }}>I've run it — reload</button>
          </div>
        )}
        {isEmpty && (
          <div className="bp-center card hero" onPointerDown={e => e.stopPropagation()}>
            <div className="bp-eyebrow">New in Kanalyst</div>
            <h3>Draw your money blueprint</h3>
            <p>Make a plan box with time layers, drop goal buckets into them, map the stocks, folios, FDs and RDs that fund each goal, and wire your income and backup funds together.</p>
            <div className="bp-row-center">
              <button className="bp-btn primary lg" disabled={busy} onClick={createSample}>Start with a sample plan</button>
              <button className="bp-btn lg" disabled={busy} onClick={addBoard}>Blank plan box</button>
            </div>
          </div>
        )}

        {/* Toolbar */}
        {status === 'ready' && !isEmpty && (
          <div className="bp-dock" onPointerDown={e => e.stopPropagation()}>
            <button className="bp-dock-btn" disabled={busy} onClick={addBoard}><span>▦</span>Plan box</button>
            <button className="bp-dock-btn" disabled={busy} onClick={addExternal}><span>▢</span>Goal outside</button>
            <button className="bp-dock-btn" disabled={busy} onClick={addIncome}><span>₹</span>Income</button>
            <div className="bp-dock-sep" />
            <button className="bp-dock-btn icon" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
            <button className="bp-dock-zoom" onClick={() => setView(v => ({ ...v, z: 1 }))}>{Math.round(view.z * 100)}%</button>
            <button className="bp-dock-btn icon" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
            <button className="bp-dock-btn" onClick={fit}><span>⤢</span>Fit</button>
          </div>
        )}

        {status === 'ready' && !isEmpty && (
          <div className="bp-legend" onPointerDown={e => e.stopPropagation()}>
            <div className="bp-legend-row">
              <span className="dot tone-coral" />&lt;25%<span className="dot tone-gold" />25–60%<span className="dot tone-lime" />60–99%<span className="dot tone-mint" />Reached
            </div>
            <div className="bp-legend-row">
              <span className="ln lt-funds" />Funds<span className="ln lt-backup" />Backup<span className="ln lt-related" />Related
            </div>
            <div className="bp-legend-hint">Drag buckets between layers · drag ● to link · double-click a layer to add a goal · ⌘/Ctrl + scroll to zoom</div>
          </div>
        )}

        {toast && <div key={toast.k} className={`bp-toast ${toast.tone}`} role="status">{toast.text}</div>}
      </div>

      {/* ── Side panel ──────────────────────────────────────── */}
      {selected && selected.kind === 'goal' && (
        <BucketPanel key={selected.id} bucket={selected} boardsById={boardsById} links={data.links} bucketsById={bucketsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onSelect={setSel} onDelete={() => deleteBucket(selected)} />
      )}
      {selected && selected.kind === 'income' && (
        <IncomePanel key={selected.id} bucket={selected} links={data.links} bucketsById={bucketsById} boardsById={boardsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onSelect={setSel} onDelete={() => deleteBucket(selected)} />
      )}
      {selectedBoard && (
        <BoardPanel key={selectedBoard.id} board={selectedBoard} buckets={data.buckets}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onDelete={() => deleteBoard(selectedBoard)} />
      )}
      {selectedLink && (
        <LinkPanel key={selectedLink.id} link={selectedLink} bucketsById={bucketsById} boardsById={boardsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} />
      )}
      {drawer && !sel && (
        <CompletedPanel buckets={data.buckets} boardsById={boardsById} onClose={() => setDrawer(false)} notify={notify} onReload={reload}
          onOpen={(b) => { setShowCompleted(true); setDrawer(false); setSel({ type: 'bucket', id: b.id }); }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Board (plan box)
// ═══════════════════════════════════════════════════════════════════
function Board({ board, L, buckets, selected, dropLayer, linkTarget, onHeaderDown, onResizeW, onResizeLayer, onAddGoal, toWorld, onOpen }) {
  if (!L) return null;
  const inside = buckets.filter(b => b.board_id === board.id && b.kind === 'goal' && b.status !== 'completed');
  const target = inside.reduce((s, b) => s + num(b.target_amount), 0);
  const funded = inside.reduce((s, b) => s + Math.min(num(b.current_value), num(b.target_amount) || 0), 0);
  const pct = target > 0 ? Math.round(funded / target * 100) : 0;

  const dbl = (e, l, i) => {
    if (e.target.closest('button')) return;
    const w = toWorld(e.clientX, e.clientY);
    const rel = {
      x: clamp(w.x - num(board.x) - BUCKET_W / 2, GUTTER_W + 8, num(board.w) - BUCKET_W - 10),
      y: clamp(w.y - num(board.y) - HEADER_H - L.tops[i] - BUCKET_H / 2, 10, Math.max(10, L.heights[i] - BUCKET_H - 10)),
    };
    onAddGoal(l, rel);
  };

  return (
    <div data-board-id={board.id}
      className={`bp-board ${selected ? 'selected' : ''} ${linkTarget ? 'link-target' : ''}`}
      style={{ left: num(board.x), top: num(board.y), width: num(board.w), height: L.totalH }}>
      <div className="bp-board-head" style={{ height: HEADER_H }} onPointerDown={onHeaderDown}>
        <div className="bp-board-title">
          <span className="bp-board-name">{board.name}</span>
          {board.description && <span className="bp-board-desc">{board.description}</span>}
        </div>
        <div className="bp-board-meta">
          <span className="mono">{fmtINR(funded)} / {fmtINR(target)}</span>
          <span className="bp-mini-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
          <span className="mono">{pct}%</span>
          <button className="bp-icon-btn sm" onClick={onOpen} aria-label="Plan box settings">⋯</button>
        </div>
      </div>

      {board.layers.map((l, i) => (
        <div key={l.id} className={`bp-layer ${dropLayer === l.id ? 'drop' : ''} ${i % 2 ? 'alt' : ''}`}
          style={{ top: HEADER_H + L.tops[i], height: L.heights[i] }}
          onDoubleClick={(e) => dbl(e, l, i)}>
          <div className="bp-gutter" style={{ width: GUTTER_W }}>
            <span className={`bp-period p-${l.period}`}>{periodShort(l.period)}</span>
            <span className="bp-layer-label">{l.label}</span>
            <button className="bp-add-goal" onPointerDown={e => e.stopPropagation()} onClick={() => onAddGoal(l)}>+ Goal</button>
          </div>
          <div className="bp-layer-resize" onPointerDown={(e) => onResizeLayer(e, l)} title="Drag to resize layer" />
        </div>
      ))}
      <div className="bp-board-resize" onPointerDown={onResizeW} title="Drag to resize width" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Bucket card (goal or income)
// ═══════════════════════════════════════════════════════════════════
function BucketCard({ bucket: b, rect, selected, dragging, linkTarget, external, onDown, onLinkDown }) {
  if (!rect) return null;
  const style = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  const handle = (
    <button className="bp-handle" onPointerDown={onLinkDown} aria-label={`Link ${b.name} to another bucket`} title="Drag to link" />
  );

  if (b.kind === 'income') {
    return (
      <div data-bucket-id={b.id} className={`bp-bucket income ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${linkTarget ? 'link-target' : ''}`}
        style={style} onPointerDown={onDown}>
        <div className="bp-income-icon">₹</div>
        <div className="bp-income-main">
          <div className="bp-bucket-name">{b.name}</div>
          <div className="bp-income-val">{fmtINR(b.inflow?.monthly)}<em>/mo</em></div>
          <div className="bp-income-src">{b.income_source === 'dividends' ? 'Dividends · live' : b.income_source === 'income_category' ? (b.income_category || 'Pick a category') : 'Manual'}</div>
        </div>
        {handle}
      </div>
    );
  }

  const tone = progressTone(b);
  const pct = num(b.progress);
  const done = b.status === 'completed';
  const overdue = isOverdue(b);

  return (
    <div data-bucket-id={b.id}
      className={`bp-bucket goal tone-${tone} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${done ? 'done' : ''} ${external ? 'external' : ''} ${linkTarget ? 'link-target' : ''}`}
      style={style} onPointerDown={onDown}>
      <div className="bp-bucket-top">
        <span className="bp-bucket-name" title={b.name}>{done && '✓ '}{b.name}</span>
        {b.recurrence !== 'none' && <span className="bp-rec" title={`Repeats ${b.recurrence}`}>↻ {b.recurrence[0].toUpperCase()}</span>}
      </div>
      <div className="bp-bucket-amt">
        <span className="mono strong">{fmtINR(b.current_value)}</span>
        <span className="mono muted">/ {num(b.target_amount) > 0 ? fmtINR(b.target_amount) : '—'}</span>
        <span className="bp-pct mono">{num(b.target_amount) > 0 ? `${Math.round(pct)}%` : ''}</span>
      </div>
      <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="bp-bucket-foot">
        <span className={overdue ? 'overdue' : ''}>{b.target_date ? fmtDate(b.target_date) : 'No date'}</span>
        <span className="bp-badges">
          {b.assets.length > 0 && <span title="Mapped assets">◉ {b.assets.length}</span>}
          {b.comment_count > 0 && <span title="Notes">✎ {b.comment_count}</span>}
          {b.attachment_count > 0 && <span title="Attachments">📎 {b.attachment_count}</span>}
        </span>
      </div>
      {handle}
    </div>
  );
}
