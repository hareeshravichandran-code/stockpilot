import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { blueprintAPI } from '../lib/api';
import {
  HEADER_H, GUTTER_W, MIN_LAYER_H, BUCKET_W, BUCKET_H, INCOME_W, INCOME_H, MIN_BOARD_W,
  fmtINR, fmtDate, num, clamp, progressTone, isOverdue,
  computeLayout, bucketRect, dropTarget, linkPath, contentBounds, avoidOverlap,
  colorHex, dueDate, daysUntil, relTime, attention, layerHorizon, scheduleText,
  LANE_PRESETS, DEFAULT_LANES, laneWindow, laneInsertIndex, nextRowSlot, outsideLane,
} from '../blueprint/geom';
import { BucketPanel, IncomePanel, BoardPanel, LinkPanel, CompletedPanel, LanePicker } from '../blueprint/Panels';
import './Blueprint.css';

// Starting lanes for a new plan box — soonest on top, further future below
const DEFAULT_LAYERS = DEFAULT_LANES.map(id => {
  const p = LANE_PRESETS.find(x => x.id === id);
  return { label: p.label, horizon: id, period: laneWindow({ horizon: id })?.period || 'year' };
});
const LEAVE_MS = 260;
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
  const [leaving, setLeaving] = useState(() => new Set());   // ids fading out before removal
  const [laneFor, setLaneFor] = useState(null);              // board id with the lane picker open
  const [keyOpen, setKeyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditingRaw] = useState(() => { try { return localStorage.getItem('bp_editing') === '1'; } catch (e) { return false; } });
  const setEditing = useCallback((v) => {
    setEditingRaw(v);
    try { localStorage.setItem('bp_editing', v ? '1' : '0'); } catch (e) {}
  }, []);
  const [glide, setGlide] = useState(false);   // smooth camera move for Fit / zoom buttons
  const glideTo = useCallback((next) => {
    setGlide(true);
    setView(next);
    setTimeout(() => setGlide(false), 520);
  }, []);

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
    glideTo({ z, x: (W - bounds.w * z) / 2 - bounds.x * z, y: (H - 90 - bounds.h * z) / 2 - bounds.y * z });
  }, [boards, layout, rects, glideTo]);

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
    const z = clamp(view.z * f, 0.3, 1.8);
    glideTo({ z, x: W / 2 - (W / 2 - view.x) * (z / view.z), y: H / 2 - (H / 2 - view.y) * (z / view.z) });
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
          const bw = num(boardsById[patch.board_id]?.w);
          const tried = avoidOverlap(patch, d.w, d.h, sibs, bw);
          const clash = sibs.some(o => tried.x < o.x + o.w + 8 && tried.x + d.w + 8 > o.x && tried.y < o.y + o.h + 8 && tried.y + d.h + 8 > o.y);
          // No room in this row: add it to the end of the row and widen the box
          patch = (clash || tried.y > patch.y + d.h / 2) ? { ...patch, ...nextRowSlot(sibs, d.w) } : tried;
          delete patch.needW;
          if (patch.x + d.w + 20 > bw) growBoard(patch.board_id, patch.x + d.w + 24);
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
    if (!editing) { e.stopPropagation(); setSel({ type: 'bucket', id: b.id }); return; }
    const r = rects[b.id];
    beginDrag(e, { kind: 'bucket', id: b.id, isIncome: b.kind === 'income', ox: r.x, oy: r.y, w: r.w, h: r.h, x: r.x, y: r.y });
  };
  const startBoard = (e, bd) => {
    if (e.target.closest('button, input')) { e.stopPropagation(); return; }
    if (!editing) { e.stopPropagation(); setSel({ type: 'board', id: bd.id }); return; }
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

  // Widen a box; goals sitting just right of it slide over by the same amount
  const growBoard = (boardId, w) => {
    const bd = data.boards.find(x => x.id === boardId);
    const nw = Math.round(w);
    if (!bd || num(bd.w) >= nw) return;
    const oldRight = num(bd.x) + num(bd.w), delta = nw - num(bd.w);
    const top = num(bd.y), bottom = top + (layout[bd.id]?.totalH || 600);
    const shift = data.buckets.filter(b => !b.board_id && num(b.x) >= oldRight - 40 && num(b.y) < bottom && num(b.y) + num(b.h || BUCKET_H) > top)
      .map(b => ({ id: b.id, x: Math.round(num(b.x) + delta), y: num(b.y) }));
    const moved = Object.fromEntries(shift.map(m => [m.id, m.x]));
    setData(st => ({
      ...st,
      boards: st.boards.map(x => x.id === boardId ? { ...x, w: nw } : x),
      buckets: st.buckets.map(b => moved[b.id] !== undefined ? { ...b, x: moved[b.id] } : b),
    }));
    blueprintAPI.saveLayout({ boards: [{ id: boardId, w: nw }], buckets: shift }).catch(err => notify(errMsg(err), 'error'));
  };

  // Opening the lane picker glides the view so the picker is fully visible
  const openLanes = (bd) => {
    if (laneFor === bd.id) { setLaneFor(null); return; }
    setLaneFor(bd.id);
    const el = canvasRef.current;
    if (!el) return;
    const H = el.clientHeight;
    const pickerBottom = num(bd.y) + (layout[bd.id]?.totalH || 0) + 52 + 380;
    const needY = H - 110 - pickerBottom * view.z;
    if (needY < view.y) glideTo({ ...view, y: needY });
  };

  const addLane = (board, lane) => guard(async () => {
    const index = laneInsertIndex(board.layers, lane);
    await blueprintAPI.createLayer({ board_id: board.id, ...lane, index });
    setLaneFor(null);
    await reload();
    notify(`Lane “${lane.label}” added`);
  });

  const addGoalAt = (board, layer, rel) => guard(async () => {
    const sibs = data.buckets.filter(b => b.layer_id === layer.id && (showCompleted || b.status !== 'completed'))
      .map(b => ({ x: num(b.x), y: num(b.y), w: num(b.w) || BUCKET_W, h: num(b.h) || BUCKET_H }));
    // Double-click places it where you clicked; the button adds it to the end of the row
    let spot = rel ? avoidOverlap({ x: Math.round(rel.x), y: Math.round(rel.y) }, BUCKET_W, BUCKET_H, sibs, num(board.w)) : nextRowSlot(sibs);
    if (rel && spot.y > rel.y + BUCKET_H / 2) spot = nextRowSlot(sibs);
    if (spot.x + BUCKET_W + 20 > num(board.w)) growBoard(board.id, spot.x + BUCKET_W + 24);
    const win = laneWindow(layer);
    const r = await blueprintAPI.createBucket({
      kind: 'goal', name: 'New goal', board_id: board.id, layer_id: layer.id,
      x: spot.x, y: spot.y, w: BUCKET_W, h: BUCKET_H,
      recurrence: 'none',
      target_date: win?.to && win.to.getFullYear() < 9999 ? `${win.to.getFullYear()}-${String(win.to.getMonth() + 1).padStart(2, '0')}-${String(win.to.getDate()).padStart(2, '0')}` : null,
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
      goal('Car', 2, 0), goal('Renovation', 3, 0), goal('Property', 3, 1),
      goal('Child education', 4, 0), goal('Retirement', 4, 1, { w: 240 }),
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
  const fadeOut = (ids, after) => {
    setLeaving(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); return n; });
    setTimeout(after, LEAVE_MS);
  };
  const forget = (ids) => setLeaving(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n; });

  const deleteBucket = (b) => {
    setSel(null);
    const linkIds = data.links.filter(l => l.from_bucket_id === b.id || l.to_bucket_id === b.id).map(l => l.id);
    fadeOut([b.id, ...linkIds], async () => {
      setData(st => ({ ...st, buckets: st.buckets.filter(x => x.id !== b.id), links: st.links.filter(l => !linkIds.includes(l.id)) }));
      forget([b.id, ...linkIds]);
      try { await blueprintAPI.deleteBucket(b.id); notify(`Deleted “${b.name}”`); }
      catch (e) { notify(errMsg(e), 'error'); reload(); }
    });
  };
  const deleteLink = (l) => {
    setSel(null);
    fadeOut([l.id], async () => {
      setData(st => ({ ...st, links: st.links.filter(x => x.id !== l.id) }));
      forget([l.id]);
      try { await blueprintAPI.deleteLink(l.id); notify('Link removed'); }
      catch (e) { notify(errMsg(e), 'error'); reload(); }
    });
  };
  const deleteBoard = (bd) => {
    setSel(null);
    const inner = data.buckets.filter(b => b.board_id === bd.id).map(b => b.id);
    fadeOut([bd.id, ...inner], async () => {
      setData(st => ({ ...st, boards: st.boards.filter(x => x.id !== bd.id), buckets: st.buckets.filter(b => b.board_id !== bd.id) }));
      forget([bd.id, ...inner]);
      try { await blueprintAPI.deleteBoard(bd.id); notify(`Deleted plan box “${bd.name}”`); await reload(); }
      catch (e) { notify(errMsg(e), 'error'); reload(); }
    });
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
      id: l.id, link: l, mid, on,
      line: (
        <g key={l.id} className={`bp-link lt-${l.link_type} ${on ? 'on' : ''} ${related ? 'related' : ''} ${leaving.has(l.id) ? 'leaving' : ''}`}>
          <path d={d} className="bp-link-hit" onPointerDown={pick} />
          <path d={d} className="bp-link-line" markerEnd={`url(#bp-arrow-${l.link_type})`} />
          {l.link_type !== 'related' && <path d={d} className="bp-link-flow" />}
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
    <div className={`bp-root ${panelOpen ? 'with-panel' : ''} ${editing ? 'is-editing' : 'is-viewing'}`}>
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
          <div className={`bp-world ${glide ? 'glide' : ''}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {boards.map(bd => (
              <Board key={bd.id} board={bd} L={layout[bd.id]} buckets={visible}
                selected={sel?.type === 'board' && sel.id === bd.id}
                dropLayer={dropHint?.board_id === bd.id ? dropHint.layer_id : null}
                linkTarget={drag?.kind === 'link'}
                onHeaderDown={(e) => startBoard(e, bd)}
                onResizeW={(e) => startBoardW(e, bd)}
                onResizeLayer={(e, l) => startLayer(e, bd, l)}
                onAddGoal={(l, rel) => addGoalAt(bd, l, rel)}
                editing={editing}
                leaving={leaving.has(bd.id)}
                lanePicker={laneFor === bd.id}
                onToggleLanes={() => openLanes(bd)}
                onAddLane={(lane) => addLane(bd, lane)}
                busy={busy}
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
                editing={editing}
                leaving={leaving.has(b.id)}
                stray={b.layer_id && boardsById[b.board_id] ? outsideLane(b, boardsById[b.board_id].layers.find(l => l.id === b.layer_id) || {}) : false}
              />
            ))}

            <svg className="bp-links labels" width="1" height="1">{linkEls.map(x => x.label)}</svg>
            {editing && linkEls.filter(x => x.on && !leaving.has(x.id)).map(x => (
              <button key={`rm-${x.id}`} className="bp-link-remove bp-pop" style={{ left: x.mid.x, top: x.mid.y + 16 }}
                onPointerDown={e => e.stopPropagation()} onClick={() => deleteLink(x.link)}>Remove link</button>
            ))}
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
            <button className={`bp-mode ${editing ? 'on' : ''}`} aria-pressed={editing}
              onClick={() => { setEditing(!editing); setLaneFor(null); notify(editing ? 'Plan locked — view mode' : 'Edit mode — drag, add and link freely'); }}>
              <span className="bp-mode-icon" aria-hidden="true">{editing ? '✓' : '✎'}</span>
              {editing ? 'Done' : 'Edit plan'}
            </button>
            <div className="bp-dock-edit" aria-hidden={!editing}>
              <button className="bp-dock-btn" tabIndex={editing ? 0 : -1} disabled={busy} onClick={addBoard}><span>▦</span>Plan box</button>
              <button className="bp-dock-btn" tabIndex={editing ? 0 : -1} disabled={busy} onClick={addExternal}><span>▢</span>Goal outside</button>
              <button className="bp-dock-btn" tabIndex={editing ? 0 : -1} disabled={busy} onClick={addIncome}><span>₹</span>Income</button>
              <div className="bp-dock-sep" />
            </div>
            <button className="bp-dock-btn icon" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
            <button className="bp-dock-zoom" onClick={() => zoomBy(1 / view.z)}>{Math.round(view.z * 100)}%</button>
            <button className="bp-dock-btn icon" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
            <button className="bp-dock-btn" onClick={fit}><span>⤢</span>Fit</button>
          </div>
        )}



        {status === 'ready' && !isEmpty && (
          <div className={`bp-legend ${keyOpen ? 'open' : ''}`} onPointerDown={e => e.stopPropagation()}>
            <button className="bp-key-btn" aria-expanded={keyOpen} onClick={() => setKeyOpen(o => !o)}>
              <span className="bp-key-dots" aria-hidden="true"><i className="tone-coral" /><i className="tone-gold" /><i className="tone-mint" /></span>
              {keyOpen ? 'Hide key' : 'Key'}
            </button>
            <div className="bp-legend-body">
              <div className="bp-legend-inner">
                <div className="bp-legend-row">
                  <span className="dot tone-coral" />Below 25%<span className="dot tone-gold" />25–60%<span className="dot tone-lime" />60–99%<span className="dot tone-mint" />Reached
                </div>
                <div className="bp-legend-row">
                  <span className="ln lt-funds" />Funds<span className="ln lt-backup" />Backup<span className="ln lt-related" />Related
                </div>
                <div className="bp-legend-row">
                  <span className="pulse-dot soon" />Due in 7 days<span className="pulse-dot overdue" />Overdue<span className="pulse-dot reached" />Target reached
                </div>
                <div className="bp-legend-hint">{editing
                  ? 'Drag goals between lanes. Drag the ● on a goal onto another goal to link them.'
                  : 'Click any goal to see its details. Press Edit plan to change things.'}</div>
              </div>
            </div>
          </div>
        )}

        {toast && <div key={toast.k} className={`bp-toast ${toast.tone}`} role="status">{toast.text}</div>}
      </div>

      {/* ── Side panel ──────────────────────────────────────── */}
      {selected && selected.kind === 'goal' && (
        <BucketPanel key={selected.id} bucket={selected} boardsById={boardsById} links={data.links} bucketsById={bucketsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onSelect={setSel} onDelete={() => deleteBucket(selected)}
          editing={editing} onEdit={() => setEditing(true)} />
      )}
      {selected && selected.kind === 'income' && (
        <IncomePanel key={selected.id} bucket={selected} links={data.links} bucketsById={bucketsById} boardsById={boardsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onSelect={setSel} onDelete={() => deleteBucket(selected)}
          editing={editing} onEdit={() => setEditing(true)} />
      )}
      {selectedBoard && (
        <BoardPanel key={selectedBoard.id} board={selectedBoard} buckets={data.buckets}
          onReload={reload} onClose={() => setSel(null)} notify={notify} onDelete={() => deleteBoard(selectedBoard)}
          editing={editing} onEdit={() => setEditing(true)} />
      )}
      {selectedLink && (
        <LinkPanel key={selectedLink.id} link={selectedLink} bucketsById={bucketsById} boardsById={boardsById}
          onReload={reload} onClose={() => setSel(null)} notify={notify} editing={editing} onEdit={() => setEditing(true)}
          onDelete={() => deleteLink(selectedLink)} />
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
function Board({ board, L, buckets, selected, dropLayer, linkTarget, onHeaderDown, onResizeW, onResizeLayer, onAddGoal, toWorld, onOpen, editing, leaving, lanePicker, onToggleLanes, onAddLane, busy }) {
  if (!L) return null;
  const inside = buckets.filter(b => b.board_id === board.id && b.kind === 'goal' && b.status !== 'completed');
  const target = inside.reduce((s, b) => s + num(b.target_amount), 0);
  const funded = inside.reduce((s, b) => s + Math.min(num(b.current_value), num(b.target_amount) || 0), 0);
  const pct = target > 0 ? Math.round(funded / target * 100) : 0;

  const dbl = (e, l, i) => {
    if (!editing || e.target.closest('button')) return;
    const w = toWorld(e.clientX, e.clientY);
    const rel = {
      x: clamp(w.x - num(board.x) - BUCKET_W / 2, GUTTER_W + 8, num(board.w) - BUCKET_W - 10),
      y: clamp(w.y - num(board.y) - HEADER_H - L.tops[i] - BUCKET_H / 2, 10, Math.max(10, L.heights[i] - BUCKET_H - 10)),
    };
    onAddGoal(l, rel);
  };

  return (
    <div data-board-id={board.id}
      className={`bp-board ${selected ? 'selected' : ''} ${linkTarget ? 'link-target' : ''} ${leaving ? 'leaving' : ''}`}
      style={{ left: num(board.x), top: num(board.y), width: num(board.w), height: L.totalH }}>
      <div className="bp-board-head" style={{ height: HEADER_H }} onPointerDown={onHeaderDown}>
        <div className="bp-board-title">
          <span className="bp-board-name">{board.name}</span>
          {board.description && <span className="bp-board-desc">{board.description}</span>}
        </div>
        <div className="bp-board-meta">
          <span className="mono">{fmtINR(funded)} of {fmtINR(target)}</span>
          <span className="bp-mini-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
          <span className="mono strong">{pct}%</span>
          <button className="bp-icon-btn sm" onClick={onOpen} aria-label="Plan box details" title="Plan box details">⋯</button>
        </div>
      </div>

      {board.layers.map((l, i) => {
        const goals = inside.filter(b => b.layer_id === l.id);
        const hz = layerHorizon(l, goals);
        return (
          <div key={l.id} className={`bp-layer ${dropLayer === l.id ? 'drop' : ''} ${i % 2 ? 'alt' : ''}`}
            style={{ top: HEADER_H + L.tops[i], height: L.heights[i] }}
            onDoubleClick={(e) => dbl(e, l, i)}>
            <div className="bp-gutter" style={{ width: GUTTER_W }}>
              <span className={`bp-period p-${hz.period}`} title={hz.range ? 'Worked out from the goal dates in this layer' : 'Set target dates to work this out'}>{hz.chip}</span>
              <span className="bp-layer-label">{l.label}</span>
              {hz.range
                ? <span className="bp-horizon"><b>{hz.range}</b><span>{hz.rel}</span></span>
                : <span className="bp-horizon empty">{goals.length ? 'Add target dates to see this timeline' : 'No open goals'}</span>}
              {editing && <button className="bp-add-goal bp-pop" onPointerDown={e => e.stopPropagation()} onClick={() => onAddGoal(l)} title={`Add a goal to ${l.label}`}>+ Add goal</button>}
            </div>
            {editing && <div className="bp-layer-resize" onPointerDown={(e) => onResizeLayer(e, l)} title="Drag to resize layer" />}
          </div>
        );
      })}
      {editing && <div className="bp-board-resize" onPointerDown={onResizeW} title="Drag to resize width" />}
      {editing && (
        <div className="bp-lane-dock" style={{ top: L.totalH + 8 }} onPointerDown={e => e.stopPropagation()}>
          <button className={`bp-add-layer-strip bp-pop ${lanePicker ? 'on' : ''}`} onClick={onToggleLanes}>
            {lanePicker ? 'Close' : '+ Add lane'}
          </button>
          {lanePicker && <div className="bp-lanepick-wrap"><LanePicker layers={board.layers} busy={busy} onAdd={onAddLane} onCancel={onToggleLanes} /></div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Bucket card (goal or income)
// ═══════════════════════════════════════════════════════════════════
function BucketCard({ bucket: b, rect, selected, dragging, linkTarget, external, onDown, onLinkDown, editing, leaving, stray }) {
  if (!rect) return null;
  const hex = colorHex(b.color);
  const style = { left: rect.x, top: rect.y, width: rect.w, height: rect.h, ...(hex ? { '--goal': hex } : {}) };
  const handle = editing
    ? <button className="bp-handle" onPointerDown={onLinkDown} aria-label={`Link ${b.name} to another goal`} title="Drag onto another goal to link" />
    : null;

  if (b.kind === 'income') {
    return (
      <div data-bucket-id={b.id} className={`bp-bucket income ${leaving ? 'leaving' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${linkTarget ? 'link-target' : ''}`}
        style={style} onPointerDown={onDown}>
        <div className="bp-income-icon">₹</div>
        <div className="bp-income-main">
          <div className="bp-bucket-name">{b.name}</div>
          <div className="bp-income-val">{fmtINR(b.inflow?.monthly)}<em>/mo</em></div>
          <div className="bp-income-src">{b.income_source === 'dividends' ? 'From your dividends' : b.income_source === 'income_category' ? (b.income_category || 'Pick a category') : 'Entered manually'}</div>
        </div>
        {handle}
      </div>
    );
  }

  const tone = progressTone(b);
  const pct = num(b.progress);
  const done = b.status === 'completed';
  const att = attention(b);
  const due = dueDate(b);
  const days = daysUntil(due);
  const overdue = isOverdue(b) || att === 'overdue';

  return (
    <div data-bucket-id={b.id}
      className={`bp-bucket goal tone-${tone} ${leaving ? 'leaving' : ''} ${hex ? 'colored' : ''} ${att ? `att-${att}` : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${done ? 'done' : ''} ${external ? 'external' : ''} ${linkTarget ? 'link-target' : ''}`}
      style={style} onPointerDown={onDown}>
      <div className="bp-bucket-top">
        <span className="bp-bucket-name" title={b.name}>{done && '✓ '}{b.name}</span>
        {b.recurrence !== 'none' && <span className="bp-rec" title={scheduleText(b)}>↻ {b.recurrence === 'weekly' ? 'Wk' : b.recurrence === 'monthly' ? 'Mo' : 'Yr'}</span>}
      </div>
      <div className="bp-bucket-amt">
        <span className="mono strong">{fmtINR(b.current_value)}</span>
        <span className="mono muted">of {num(b.target_amount) > 0 ? fmtINR(b.target_amount) : '—'}</span>
        <span className="bp-pct mono">{num(b.target_amount) > 0 ? `${Math.round(pct)}%` : ''}</span>
      </div>
      <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="bp-bucket-foot">
        <span className={overdue ? 'overdue' : att === 'soon' ? 'soon' : ''} title={stray ? 'This date is outside the lane it sits in' : undefined}>
          {stray && <span className="bp-stray" aria-label="Date outside this lane">⇅ </span>}
          {due ? `${b.recurrence !== 'none' ? 'Next ' : ''}${fmtDate(due)}, ${relTime(days)}` : 'No date set'}
        </span>
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
