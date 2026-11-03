import { useState, useEffect, useMemo, useRef } from 'react';
import { blueprintAPI } from '../lib/api';
import {
  LINK_TYPES, ASSET_TYPES, assetTypeLabel, GOAL_COLORS, WEEKDAYS, MONTHS,
  fmtINR, fmtDate, num, progressTone, colorHex, nextDue, dueDate, daysUntil, relTime, scheduleText,
  LANE_PRESETS, laneWindow, laneWindowText, laneInsertIndex,
} from './geom';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

function Field({ label, children, hint }) {
  return (
    <label className="bp-field">
      <span className="bp-field-label">{label}</span>
      {children}
      {hint && <span className="bp-field-hint">{hint}</span>}
    </label>
  );
}

// Two-step delete inside the panel — no browser pop-up
function ConfirmDelete({ label, detail, onConfirm }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`bp-confirm ${open ? 'open' : ''}`}>
      {!open
        ? <button className="bp-btn danger ghost" onClick={() => setOpen(true)}>{label}</button>
        : (
          <div className="bp-confirm-box" role="alertdialog" aria-label={label}>
            <div className="bp-confirm-text">{detail}</div>
            <div className="bp-row-end">
              <button className="bp-btn ghost sm" onClick={() => setOpen(false)} autoFocus>Keep it</button>
              <button className="bp-btn sm bp-btn-delete" onClick={onConfirm}>{label}</button>
            </div>
          </div>
        )}
    </div>
  );
}

function PanelShell({ title, eyebrow, onClose, children, footer, accent }) {
  return (
    <aside className="bp-panel" onPointerDown={e => e.stopPropagation()} style={accent ? { '--accent-c': accent } : undefined}>
      <header className="bp-panel-head">
        <div>
          {eyebrow && <div className="bp-eyebrow">{eyebrow}</div>}
          <h2 className="bp-panel-title">{title}</h2>
        </div>
        <button className="bp-icon-btn" onClick={onClose} aria-label="Close panel">✕</button>
      </header>
      <div className="bp-panel-body">{children}</div>
      {footer && <footer className="bp-panel-foot">{footer}</footer>}
    </aside>
  );
}

function Tabs({ value, onChange, items }) {
  return (
    <div className="bp-tabs" role="tablist">
      {items.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id}
          className={`bp-tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className="bp-tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Goal bucket
// ═══════════════════════════════════════════════════════════════════
export function BucketPanel({ bucket, boardsById, links, bucketsById, onReload, onClose, notify, onSelect, onDelete, editing, onEdit }) {
  const [tab, setTab] = useState('details');
  const board = bucket.board_id ? boardsById[bucket.board_id] : null;
  const layer = board ? board.layers.find(l => l.id === bucket.layer_id) : null;
  const tone = progressTone(bucket);
  const myLinks = links.filter(l => l.from_bucket_id === bucket.id || l.to_bucket_id === bucket.id);
  const due = dueDate(bucket);
  const days = daysUntil(due);
  const hex = colorHex(bucket.color);

  return (
    <PanelShell
      eyebrow={board ? `${board.name}, ${layer?.label || ''}` : 'Goal outside the plan'}
      title={bucket.name}
      accent={hex}
      onClose={onClose}
    >
      <div className={`bp-hero tone-${tone}`}>
        <div className="bp-hero-row">
          <div>
            <div className="bp-hero-value">{fmtINR(bucket.current_value, { compact: false })}</div>
            <div className="bp-hero-sub">of {num(bucket.target_amount) > 0 ? fmtINR(bucket.target_amount, { compact: false }) : 'no target set'}</div>
          </div>
          <div className="bp-hero-pct">{num(bucket.target_amount) > 0 ? `${Math.round(num(bucket.progress))}%` : '—'}</div>
        </div>
        <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${Math.min(100, num(bucket.progress))}%` }} /></div>
        <div className="bp-hero-meta">
          {due && <span className={days < 0 && bucket.status !== 'completed' ? 'overdue' : ''}>{bucket.recurrence !== 'none' ? 'Next due' : 'Target'} {fmtDate(due)} ({relTime(days)})</span>}
          {bucket.recurrence !== 'none' && <span>↻ {scheduleText(bucket)}</span>}
          {bucket.status === 'completed' && <span>✓ Completed {fmtDate(bucket.completed_at)}</span>}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { id: 'details', label: 'Details' },
        { id: 'assets', label: 'Funding', count: bucket.assets.length },
        { id: 'links', label: 'Links', count: myLinks.length },
        { id: 'notes', label: 'Notes', count: bucket.comment_count + bucket.attachment_count },
      ]} />

      {tab === 'details' && (editing
        ? <BucketDetails key={bucket.id} bucket={bucket} onReload={onReload} notify={notify} onDelete={onDelete} />
        : <BucketSummary bucket={bucket} onEdit={onEdit} />)}
      {tab === 'assets'  && <AssetsTab bucket={bucket} onReload={onReload} notify={notify} editing={editing} />}
      {tab === 'links'   && <LinksList bucket={bucket} links={myLinks} bucketsById={bucketsById} boardsById={boardsById} onSelect={onSelect} />}
      {tab === 'notes'   && <NotesTab bucket={bucket} onReload={onReload} notify={notify} />}
    </PanelShell>
  );
}

function BucketSummary({ bucket, onEdit }) {
  const rows = [
    ['Target', num(bucket.target_amount) > 0 ? fmtINR(bucket.target_amount, { compact: false }) : 'Not set'],
    [bucket.recurrence !== 'none' ? 'Runs until' : 'Achieve by', bucket.target_date ? fmtDate(bucket.target_date) : (bucket.recurrence !== 'none' ? 'No end date' : 'Not set')],
    ['Repeats', bucket.recurrence !== 'none' ? scheduleText(bucket) : 'One-time goal'],
    ['Set aside outside Kanalyst', num(bucket.manual_value) > 0 ? fmtINR(bucket.manual_value, { compact: false }) : 'Nothing'],
  ];
  return (
    <div className="bp-stack">
      <dl className="bp-summary">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <button className="bp-btn" onClick={onEdit}>✎ Edit this goal</button>
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="bp-swatches" role="radiogroup" aria-label="Goal colour">
      <button type="button" role="radio" aria-checked={!value} className={`bp-swatch none ${!value ? 'on' : ''}`}
        onClick={() => onChange(null)} title="No colour" aria-label="No colour" />
      {GOAL_COLORS.map(c => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id}
          className={`bp-swatch ${value === c.id ? 'on' : ''}`} style={{ '--sw': c.hex }}
          onClick={() => onChange(c.id)} title={c.label} aria-label={c.label} />
      ))}
    </div>
  );
}

function ScheduleFields({ d, setD }) {
  const on = d.recurrence !== 'none';
  const setRec = (r) => setD(s => ({
    ...s, recurrence: r,
    recurrence_day: r === 'weekly' ? (s.recurrence === 'weekly' ? s.recurrence_day : 1) : (s.recurrence === 'weekly' || !s.recurrence_day ? 1 : s.recurrence_day),
    recurrence_month: r === 'yearly' ? (s.recurrence_month || new Date().getMonth() + 1) : null,
  }));
  return (
    <div className="bp-schedule">
      <label className="bp-switch-row">
        <span>
          <span className="bp-field-label">Repeating goal</span>
          <span className="bp-field-hint">{on ? 'Resets every cycle — close the cycle when it is paid.' : 'Turn on for fees, premiums, SIPs, bills.'}</span>
        </span>
        <span className="bp-toggle">
          <input type="checkbox" checked={on} onChange={e => setRec(e.target.checked ? 'monthly' : 'none')} />
          <span className="bp-toggle-track" />
        </span>
      </label>
      <div className={`bp-reveal ${on ? 'open' : ''}`}>
        <div className="bp-reveal-inner">
          <div className="bp-seg">
            {[['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([id, lbl]) => (
              <button key={id} type="button" className={d.recurrence === id ? 'on' : ''} onClick={() => setRec(id)}>{lbl}</button>
            ))}
          </div>
          {d.recurrence === 'weekly' && (
            <Field label="Day of the week">
              <div className="bp-days">
                {WEEKDAYS.map((w, i) => (
                  <button key={w} type="button" className={Number(d.recurrence_day) === i ? 'on' : ''}
                    onClick={() => setD(s => ({ ...s, recurrence_day: i }))} aria-label={w}>{w.slice(0, 2)}</button>
                ))}
              </div>
            </Field>
          )}
          {d.recurrence === 'monthly' && (
            <Field label="Day of the month" hint={Number(d.recurrence_day) > 28 ? 'Shorter months use their last day.' : undefined}>
              <select className="bp-input" value={d.recurrence_day || 1} onChange={e => setD(s => ({ ...s, recurrence_day: Number(e.target.value) }))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          )}
          {d.recurrence === 'yearly' && (
            <div className="bp-grid2">
              <Field label="Month">
                <select className="bp-input" value={d.recurrence_month || 1} onChange={e => setD(s => ({ ...s, recurrence_month: Number(e.target.value) }))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <select className="bp-input" value={d.recurrence_day || 1} onChange={e => setD(s => ({ ...s, recurrence_day: Number(e.target.value) }))}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BucketDetails({ bucket, onReload, notify, onDelete }) {
  const init = () => ({
    name: bucket.name || '',
    target_amount: bucket.target_amount ?? '',
    target_date: bucket.target_date || '',
    recurrence: bucket.recurrence || 'none',
    recurrence_day: bucket.recurrence_day ?? null,
    recurrence_month: bucket.recurrence_month ?? null,
    manual_value: bucket.manual_value ?? '',
    color: bucket.color || null,
  });
  const [d, setD] = useState(init);
  const [base] = useState(init);
  const [busy, setBusy] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleNote, setCycleNote] = useState('');
  const set = (k) => (e) => setD(s => ({ ...s, [k]: e.target.value }));
  const dirty = Object.keys(d).some(k => String(d[k] ?? '') !== String(base[k] ?? ''));

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); await onReload(); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };

  const save = () => run(() => blueprintAPI.updateBucket(bucket.id, d), 'Saved');
  const reached = num(bucket.target_amount) > 0 && num(bucket.progress) >= 100;
  const preview = nextDue({ ...bucket, ...d });

  return (
    <div className="bp-stack">
      <Field label="Goal name"><input className="bp-input" value={d.name} onChange={set('name')} maxLength={80} /></Field>
      <Field label="Colour"><ColorPicker value={d.color} onChange={(c) => setD(s => ({ ...s, color: c }))} /></Field>
      <div className="bp-grid2">
        <Field label={d.recurrence === 'none' ? 'Target amount (₹)' : 'Amount per cycle (₹)'}>
          <input className="bp-input mono" type="number" min="0" value={d.target_amount} onChange={set('target_amount')} />
        </Field>
        <Field label={d.recurrence === 'none' ? 'Achieve by' : 'Run until (optional)'}>
          <input className="bp-input" type="date" value={d.target_date} onChange={set('target_date')} />
        </Field>
      </div>
      <ScheduleFields d={d} setD={setD} />
      {d.recurrence !== 'none' && preview && <div className="bp-field-hint">Next due {fmtDate(preview)} ({relTime(daysUntil(preview))}).</div>}
      <Field label="Cash set aside outside Kanalyst (₹)" hint="Added to the mapped funds — savings account money, cash, anything not tracked here.">
        <input className="bp-input mono" type="number" min="0" value={d.manual_value} onChange={set('manual_value')} />
      </Field>

      <div className={`bp-savebar ${dirty ? 'show' : ''}`}>
        <span>Unsaved changes</span>
        <span className="bp-row-end">
          <button className="bp-btn ghost sm" onClick={() => setD(base)}>Discard</button>
          <button className="bp-btn primary sm" disabled={busy || !d.name.trim()} onClick={save}>Save changes</button>
        </span>
      </div>

      <div className="bp-divider" />

      {bucket.status !== 'completed' ? (
        <div className="bp-actions">
          {reached && <div className="bp-callout good">Target reached — ready to mark it done.</div>}
          {bucket.recurrence !== 'none' && (
            cycleOpen ? (
              <div className="bp-callout">
                <div className="bp-callout-title">Close this cycle at {fmtINR(bucket.current_value, { compact: false })}?</div>
                <input className="bp-input" placeholder="Note (optional)" value={cycleNote} onChange={e => setCycleNote(e.target.value)} />
                <div className="bp-row-end">
                  <button className="bp-btn ghost" onClick={() => setCycleOpen(false)}>Cancel</button>
                  <button className="bp-btn primary" disabled={busy}
                    onClick={() => run(() => blueprintAPI.closeCycle(bucket.id, { achieved: bucket.current_value, note: cycleNote }), 'Cycle closed — next one started')}>
                    Close cycle
                  </button>
                </div>
              </div>
            ) : (
              <button className="bp-btn" onClick={() => setCycleOpen(true)}>↻ Close current cycle and start the next</button>
            )
          )}
          <button className="bp-btn good" disabled={busy} onClick={() => run(() => blueprintAPI.complete(bucket.id), 'Moved to completed goals')}>✓ Mark goal completed</button>
        </div>
      ) : (
        <button className="bp-btn" disabled={busy} onClick={() => run(() => blueprintAPI.reopen(bucket.id), 'Goal reopened')}>Reopen goal</button>
      )}
      <ConfirmDelete label="Delete goal" detail={`“${bucket.name}” goes, with its links, notes and files. Its mapped funds are released for other goals.`} onConfirm={onDelete} />
    </div>
  );
}

// ── Funding: map stocks / brokers / MF / FD / RD / NPS ─────────────
function AssetsTab({ bucket, onReload, notify, editing }) {
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const unmap = async (a) => {
    setBusyId(a.id);
    try { await blueprintAPI.unmapAsset(bucket.id, a.id); await onReload(); notify('Unmapped'); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusyId(null); }
  };

  const assetTotal = bucket.assets.reduce((s, a) => s + num(a.value), 0);

  return (
    <div className="bp-stack">
      {bucket.assets.length === 0 && !picking && (
        <div className="bp-empty-small">
          Nothing funds this goal yet. Map a broker account, a single stock, an MF folio, FD, RD or NPS — each one can fund only one goal.
        </div>
      )}
      {bucket.assets.length > 0 && (
        <ul className="bp-asset-list">
          {bucket.assets.map(a => (
            <li key={a.id} className={`bp-asset ${a.missing ? 'missing' : ''}`}>
              <span className={`bp-asset-type t-${a.asset_type}`}>{assetTypeLabel(a.asset_type)}</span>
              <div className="bp-asset-main">
                <div className="bp-asset-name">{a.label}</div>
                <div className="bp-asset-sub">{a.sub}</div>
              </div>
              <div className="bp-asset-val">{fmtINR(a.value)}</div>
              {editing && <button className="bp-icon-btn sm" disabled={busyId === a.id} onClick={() => unmap(a)} aria-label={`Unmap ${a.label}`}>✕</button>}
            </li>
          ))}
          <li className="bp-asset total">
            <div className="bp-asset-main"><div className="bp-asset-name">Mapped total</div></div>
            <div className="bp-asset-val">{fmtINR(assetTotal, { compact: false })}</div>
          </li>
        </ul>
      )}
      {editing && (picking
        ? <AssetPicker bucket={bucket} onDone={() => setPicking(false)} onReload={onReload} notify={notify} />
        : <button className="bp-btn primary" onClick={() => setPicking(true)}>+ Map an asset</button>)}
    </div>
  );
}

function AssetPicker({ bucket, onDone, onReload, notify }) {
  const [assets, setAssets] = useState(null);
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    blueprintAPI.assets().then(r => { if (alive) setAssets(r.data.assets || []); })
      .catch(e => { if (alive) { setAssets([]); notify(errMsg(e), 'error'); } });
    inputRef.current?.focus();
    return () => { alive = false; };
  }, [notify]);

  const list = useMemo(() => {
    if (!assets) return [];
    const s = q.trim().toLowerCase();
    return assets
      .filter(a => type === 'all' || a.asset_type === type)
      .filter(a => !s || `${a.label} ${a.sub}`.toLowerCase().includes(s))
      .sort((a, b) => (!!a.owner_bucket_id - !!b.owner_bucket_id) || b.value - a.value);
  }, [assets, type, q]);

  const counts = useMemo(() => {
    const c = {};
    (assets || []).forEach(a => { c[a.asset_type] = (c[a.asset_type] || 0) + 1; });
    return c;
  }, [assets]);

  const map = async (a) => {
    setBusy(a.asset_ref);
    try {
      const r = await blueprintAPI.mapAsset(bucket.id, { asset_type: a.asset_type, asset_ref: a.asset_ref, asset_label: a.label });
      notify(r.data.absorbed ? `Mapped — ${r.data.absorbed} single stock(s) folded into the broker` : `Mapped ${a.label}`);
      await onReload();
      setAssets(prev => prev.map(x => x === a ? { ...x, owner_bucket_id: bucket.id, owner_bucket_name: bucket.name } : x));
    } catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="bp-picker">
      <div className="bp-picker-head">
        <input ref={inputRef} className="bp-input" placeholder="Search stock, fund, bank…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="bp-btn ghost" onClick={onDone}>Done</button>
      </div>
      <div className="bp-chips">
        {ASSET_TYPES.filter(t => t.id === 'all' || counts[t.id]).map(t => (
          <button key={t.id} className={`bp-chip ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>
            {t.label}{t.id !== 'all' && <span>{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      {!assets && <div className="bp-empty-small">Loading your holdings…</div>}
      {assets && list.length === 0 && <div className="bp-empty-small">No matching assets. Sync your CAS / add FDs in Kanalyst first.</div>}
      <ul className="bp-asset-list pick">
        {list.map(a => {
          const mine = a.owner_bucket_id === bucket.id;
          const taken = a.owner_bucket_id && !mine;
          return (
            <li key={`${a.asset_type}:${a.asset_ref}`} className={`bp-asset ${taken ? 'taken' : ''} ${mine ? 'mine' : ''}`}>
              <span className={`bp-asset-type t-${a.asset_type}`}>{assetTypeLabel(a.asset_type)}</span>
              <div className="bp-asset-main">
                <div className="bp-asset-name">{a.label}</div>
                <div className="bp-asset-sub">
                  {taken ? `In "${a.owner_bucket_name}"${a.owned_via === 'broker' ? ' via broker' : ''}` : a.sub}
                </div>
              </div>
              <div className="bp-asset-val">{fmtINR(a.value)}</div>
              {mine ? <span className="bp-tag">Mapped</span>
                : <button className="bp-btn sm" disabled={!!taken || busy === a.asset_ref} onClick={() => map(a)}>{busy === a.asset_ref ? '…' : 'Map'}</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LinksList({ bucket, links, bucketsById, boardsById, onSelect }) {
  if (!links.length) return (
    <div className="bp-empty-small">
      No links yet. Drag the small ● handle on any bucket onto another bucket (or onto a plan box) to connect them — e.g. a liquid-fund bucket as backup for Retirement.
    </div>
  );
  return (
    <ul className="bp-link-list">
      {links.map(l => {
        const out = l.from_bucket_id === bucket.id;
        const other = out ? (l.to_bucket_id ? bucketsById[l.to_bucket_id]?.name : `Box: ${boardsById[l.to_board_id]?.name || '—'}`) : bucketsById[l.from_bucket_id]?.name;
        return (
          <li key={l.id}>
            <button className="bp-link-row" onClick={() => onSelect({ type: 'link', id: l.id })}>
              <span className={`bp-link-pill lt-${l.link_type}`}>{l.link_type}</span>
              <span>{out ? '→' : '←'} {other || 'Unknown'}</span>
              {l.amount ? <span className="mono muted">{fmtINR(l.amount)}</span> : null}
              {l.label ? <span className="muted">· {l.label}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Notes: comments + attachments ──────────────────────────────────
function NotesTab({ bucket, onReload, notify }) {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try { const r = await blueprintAPI.notes(bucket.id); setNotes(r.data); }
    catch (e) { setNotes({ comments: [], attachments: [] }); notify(errMsg(e), 'error'); }
  };
  useEffect(() => { load(); }, [bucket.id]); // load is stable per bucket

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await blueprintAPI.addComment(bucket.id, text.trim()); setText(''); await load(); onReload(); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { notify('Max file size is 10 MB', 'error'); return; }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try { await blueprintAPI.upload(bucket.id, form); await load(); onReload(); notify('Attached ' + file.name); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const open = async (a) => {
    try { const r = await blueprintAPI.fileUrl(a.id); window.open(r.data.url, '_blank', 'noopener'); }
    catch (e) { notify(errMsg(e), 'error'); }
  };
  const removeFile = async (a) => {
    if (!window.confirm(`Delete ${a.file_name}?`)) return;
    try { await blueprintAPI.deleteFile(a.id); await load(); onReload(); } catch (e) { notify(errMsg(e), 'error'); }
  };
  const removeComment = async (c) => {
    try { await blueprintAPI.deleteComment(c.id); await load(); onReload(); } catch (e) { notify(errMsg(e), 'error'); }
  };

  return (
    <div className="bp-stack">
      <div className="bp-compose">
        <textarea className="bp-input" rows={3} placeholder="Add a note — why this goal, what's changed, decisions…" value={text}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
        <div className="bp-row-between">
          <button className="bp-btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>📎 Attach file</button>
          <input ref={fileRef} type="file" hidden onChange={e => upload(e.target.files?.[0])} />
          <button className="bp-btn primary" disabled={busy || !text.trim()} onClick={post}>Add note</button>
        </div>
      </div>

      {!notes && <div className="bp-empty-small">Loading…</div>}
      {notes?.attachments?.length > 0 && (
        <ul className="bp-files">
          {notes.attachments.map(a => (
            <li key={a.id}>
              <button className="bp-file" onClick={() => open(a)}>
                <span className="bp-file-icon">{(a.mime_type || '').includes('pdf') ? 'PDF' : (a.mime_type || '').startsWith('image') ? 'IMG' : 'FILE'}</span>
                <span className="bp-file-name">{a.file_name}</span>
                <span className="muted">{Math.max(1, Math.round(num(a.size_bytes) / 1024))} KB</span>
              </button>
              <button className="bp-icon-btn sm" onClick={() => removeFile(a)} aria-label="Delete file">✕</button>
            </li>
          ))}
        </ul>
      )}
      {notes?.comments?.length > 0 && (
        <ul className="bp-comments">
          {notes.comments.map(c => (
            <li key={c.id} className={c.is_system ? 'system' : ''}>
              <div className="bp-comment-body">{c.body}</div>
              <div className="bp-comment-meta">
                {new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {!c.is_system && <button className="bp-link-btn" onClick={() => removeComment(c)}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Income bucket
// ═══════════════════════════════════════════════════════════════════
export function IncomePanel({ bucket, links, bucketsById, boardsById, onReload, onClose, notify, onSelect, onDelete, editing, onEdit }) {
  const [d, setD] = useState({
    name: bucket.name || '',
    income_source: bucket.income_source || 'manual',
    income_category: bucket.income_category || '',
    expected_amount: bucket.expected_amount ?? '',
  });
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD(s => ({ ...s, [k]: e.target.value }));
  const myLinks = links.filter(l => l.from_bucket_id === bucket.id);

  useEffect(() => {
    let alive = true;
    blueprintAPI.assets().then(r => { if (alive) setCats(r.data.incomeCategories || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    try { await blueprintAPI.updateBucket(bucket.id, d); await onReload(); notify('Saved'); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };

  const allocated = myLinks.reduce((s, l) => s + num(l.amount), 0);
  const inflow = num(bucket.inflow?.monthly);

  return (
    <PanelShell eyebrow="Income source" title={bucket.name} onClose={onClose}>
      <div className="bp-hero tone-indigo">
        <div className="bp-hero-row">
          <div>
            <div className="bp-hero-value">{fmtINR(inflow, { compact: false })}<span className="bp-hero-unit">/mo</span></div>
            <div className="bp-hero-sub">{bucket.inflow?.basis || 'Expected'}</div>
          </div>
        </div>
        {allocated > 0 && (
          <div className="bp-hero-meta">
            <span>Allocated {fmtINR(allocated)} / mo</span>
            <span className={allocated > inflow && inflow > 0 ? 'overdue' : ''}>
              {inflow > 0 ? `${fmtINR(Math.max(0, inflow - allocated))} unallocated` : ''}
            </span>
          </div>
        )}
      </div>
      <div className="bp-stack">
        {!editing && (
          <>
            <dl className="bp-summary">
              <div><dt>Source</dt><dd>{{ manual: 'Entered manually', income_category: `Income tracker: ${bucket.income_category || 'no category picked'}`, dividends: 'Your dividends' }[bucket.income_source || 'manual']}</dd></div>
            </dl>
            <div className="bp-section-title">Funds</div>
            {myLinks.length === 0 ? <div className="bp-empty-small">Not funding anything yet.</div>
              : <LinksList bucket={bucket} links={myLinks} bucketsById={bucketsById} boardsById={boardsById} onSelect={onSelect} />}
            <button className="bp-btn" onClick={onEdit}>✎ Edit this income</button>
          </>
        )}
        {editing && <>
        <Field label="Name"><input className="bp-input" value={d.name} onChange={set('name')} /></Field>
        <Field label="Where the amount comes from">
          <div className="bp-seg">
            {[['manual', 'Manual'], ['income_category', 'Income tracker'], ['dividends', 'Dividends']].map(([id, lbl]) => (
              <button key={id} type="button" className={d.income_source === id ? 'on' : ''} onClick={() => setD(s => ({ ...s, income_source: id }))}>{lbl}</button>
            ))}
          </div>
        </Field>
        {d.income_source === 'income_category' && (
          <Field label="Income category" hint="Monthly average of credits in this category over the last 90 days.">
            <select className="bp-input" value={d.income_category} onChange={set('income_category')}>
              <option value="">Select…</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}
        {d.income_source === 'dividends' && <div className="bp-field-hint">Uses your actual dividends credited in the last 12 months ÷ 12.</div>}
        <Field label="Expected per month (₹)" hint={d.income_source === 'manual' ? undefined : 'Used only as a fallback note; live figures come from the source above.'}>
          <input className="bp-input mono" type="number" min="0" value={d.expected_amount} onChange={set('expected_amount')} />
        </Field>
        <div className="bp-row-end"><button className="bp-btn primary" disabled={busy || !d.name.trim()} onClick={save}>Save</button></div>

        <div className="bp-divider" />
        <div className="bp-section-title">Funds</div>
        {myLinks.length === 0
          ? <div className="bp-empty-small">Drag the ● handle onto a goal bucket — or onto a plan box's title bar to fund the whole plan.</div>
          : <LinksList bucket={bucket} links={myLinks} bucketsById={bucketsById} boardsById={boardsById} onSelect={onSelect} />}
        <ConfirmDelete label="Delete income" detail={`“${bucket.name}” and its funding links will be removed.`} onConfirm={onDelete} />
        </>}
      </div>
    </PanelShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Board (plan box) + its layers
// ═══════════════════════════════════════════════════════════════════
export function BoardPanel({ board, buckets, onReload, onClose, notify, onDelete, editing, onEdit }) {
  const [name, setName] = useState(board.name);
  const [desc, setDesc] = useState(board.description || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(board.name); setDesc(board.description || ''); }, [board.id, board.name, board.description]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await onReload(); if (ok) notify(ok); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };

  const inside = buckets.filter(b => b.board_id === board.id && b.kind === 'goal');
  const open = inside.filter(b => b.status !== 'completed');
  const target = open.reduce((s, b) => s + num(b.target_amount), 0);
  const current = open.reduce((s, b) => s + Math.min(num(b.current_value), num(b.target_amount) || Infinity), 0);

  return (
    <PanelShell eyebrow="Plan box" title={board.name} onClose={onClose}>
      <div className="bp-hero tone-lime">
        <div className="bp-hero-row">
          <div>
            <div className="bp-hero-value">{fmtINR(current, { compact: false })}</div>
            <div className="bp-hero-sub">funded of {fmtINR(target, { compact: false })} across {open.length} open goals</div>
          </div>
          <div className="bp-hero-pct">{target > 0 ? `${Math.round(current / target * 100)}%` : '—'}</div>
        </div>
        <div className="bp-bar"><div className="bp-bar-fill" style={{ width: `${target > 0 ? Math.min(100, current / target * 100) : 0}%` }} /></div>
      </div>
      {!editing && (
        <div className="bp-stack">
          {board.description && <p className="bp-desc">{board.description}</p>}
          <div className="bp-section-title">Lanes, soonest on top</div>
          <ul className="bp-layer-read">
            {board.layers.map(l => <li key={l.id}><span>{l.label}<em>{laneWindowText(laneWindow(l)) || ''}</em></span><span className="muted">{inside.filter(b => b.layer_id === l.id && b.status !== 'completed').length} goals</span></li>)}
          </ul>
          <button className="bp-btn" onClick={onEdit}>✎ Edit this plan box</button>
        </div>
      )}
      {editing && <div className="bp-stack">
        <Field label="Name"><input className="bp-input" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Description"><textarea className="bp-input" rows={2} value={desc} onChange={e => setDesc(e.target.value)} /></Field>
        <div className="bp-row-end">
          <button className="bp-btn primary" disabled={busy || !name.trim() || (name === board.name && desc === (board.description || ''))}
            onClick={() => run(() => blueprintAPI.updateBoard(board.id, { name, description: desc }), 'Saved')}>Save</button>
        </div>

        <div className="bp-divider" />
        <div className="bp-section-title">Lanes, soonest on top</div>
        <ul className="bp-layer-list">
          {board.layers.map((l, i) => (
            <LayerRow key={l.id} layer={l} index={i} count={board.layers.length}
              bucketCount={inside.filter(b => b.layer_id === l.id).length}
              onSave={(data) => run(() => blueprintAPI.updateLayer(l.id, data), 'Lane updated')}
              onMove={(dir) => {
                const j = i + dir;
                const other = board.layers[j];
                if (!other) return;
                run(() => Promise.all([
                  blueprintAPI.updateLayer(l.id, { sort_order: other.sort_order }),
                  blueprintAPI.updateLayer(other.id, { sort_order: l.sort_order }),
                ]));
              }}
              onDelete={() => run(() => blueprintAPI.deleteLayer(l.id), 'Lane removed')}
            />
          ))}
        </ul>
        <LanePicker layers={board.layers} busy={busy}
          onAdd={(lane) => run(() => blueprintAPI.createLayer({ board_id: board.id, ...lane, index: laneInsertIndex(board.layers, lane) }), 'Lane added')} />

        <div className="bp-divider" />
        <ConfirmDelete label="Delete plan box" detail={`“${board.name}” and the ${inside.length} goal(s) inside it will be removed. This can't be undone.`} onConfirm={onDelete} />
      </div>}
    </PanelShell>
  );
}

function LayerRow({ layer, index, count, bucketCount, onSave, onMove, onDelete }) {
  const [label, setLabel] = useState(layer.label);
  const [horizon, setHorizon] = useState(layer.horizon || '');
  useEffect(() => { setLabel(layer.label); setHorizon(layer.horizon || ''); }, [layer.label, layer.horizon]);
  const dirty = label !== layer.label || horizon !== (layer.horizon || '');
  const win = laneWindow({ ...layer, horizon });
  return (
    <li className="bp-layer-row">
      <div className="bp-layer-move">
        <button className="bp-icon-btn sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button className="bp-icon-btn sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
      </div>
      <input className="bp-input" value={label} onChange={e => setLabel(e.target.value)} title={laneWindowText(win) || ''} />
      <select className="bp-input" value={horizon} onChange={e => setHorizon(e.target.value)}>
        {!layer.horizon && <option value="">No time window</option>}
        {LANE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        {layer.horizon === 'custom' && <option value="custom">Custom: {laneWindowText(laneWindow(layer))}</option>}
      </select>
      {dirty
        ? <button className="bp-btn sm primary" disabled={!label.trim()} onClick={() => onSave({ label, horizon: horizon || null, period: win?.period || layer.period })}>Save</button>
        : <button className="bp-icon-btn sm" disabled={bucketCount > 0} title={bucketCount ? 'Move its goals out first' : 'Delete lane'} onClick={onDelete} aria-label="Delete lane">🗑</button>}
    </li>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Link
// ═══════════════════════════════════════════════════════════════════
export function LinkPanel({ link, bucketsById, boardsById, onReload, onClose, notify, editing, onEdit, onDelete }) {
  const [d, setD] = useState({ link_type: link.link_type, label: link.label || '', amount: link.amount ?? '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD({ link_type: link.link_type, label: link.label || '', amount: link.amount ?? '' }); }, [link.id, link.link_type, link.label, link.amount]);
  const from = bucketsById[link.from_bucket_id];
  const to = link.to_bucket_id ? bucketsById[link.to_bucket_id]?.name : `Plan box: ${boardsById[link.to_board_id]?.name || ''}`;

  const run = async (fn, ok, close) => {
    setBusy(true);
    try { await fn(); await onReload(); notify(ok); if (close) onClose(); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <PanelShell eyebrow="Connection" title={`${from?.name || '?'} → ${to || '?'}`} onClose={onClose}>
      {!editing && (
        <div className="bp-stack">
          <dl className="bp-summary">
            <div><dt>Type</dt><dd>{LINK_TYPES.find(t => t.id === link.link_type)?.label}: {LINK_TYPES.find(t => t.id === link.link_type)?.hint}</dd></div>
            {link.label && <div><dt>Label</dt><dd>{link.label}</dd></div>}
            {link.amount ? <div><dt>Per month</dt><dd>{fmtINR(link.amount, { compact: false })}</dd></div> : null}
          </dl>
          <button className="bp-btn" onClick={onEdit}>✎ Edit this link</button>
        </div>
      )}
      {editing && <div className="bp-stack">
        <Field label="Type">
          <div className="bp-seg">
            {LINK_TYPES.map(t => (
              <button key={t.id} type="button" className={d.link_type === t.id ? 'on' : ''} onClick={() => setD(s => ({ ...s, link_type: t.id }))}>{t.label}</button>
            ))}
          </div>
          <span className="bp-field-hint">{LINK_TYPES.find(t => t.id === d.link_type)?.hint}</span>
        </Field>
        <Field label="Label (shown on the line)">
          <input className="bp-input" placeholder="e.g. Refill during crash" value={d.label} onChange={e => setD(s => ({ ...s, label: e.target.value }))} maxLength={40} />
        </Field>
        <Field label="Amount per month (₹, optional)">
          <input className="bp-input mono" type="number" min="0" value={d.amount} onChange={e => setD(s => ({ ...s, amount: e.target.value }))} />
        </Field>
        <div className="bp-row-between">
          <button className="bp-btn danger ghost" disabled={busy} onClick={onDelete}>Remove link</button>
          <button className="bp-btn primary" disabled={busy} onClick={() => run(() => blueprintAPI.updateLink(link.id, d), 'Saved')}>Save</button>
        </div>
      </div>}
    </PanelShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Completed goals drawer
// ═══════════════════════════════════════════════════════════════════
export function CompletedPanel({ buckets, boardsById, onClose, onOpen, onReload, notify }) {
  const done = buckets.filter(b => b.kind === 'goal' && b.status === 'completed')
    .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
  const [busy, setBusy] = useState(null);
  const reopen = async (b) => {
    setBusy(b.id);
    try { await blueprintAPI.reopen(b.id); await onReload(); notify(`${b.name} reopened`); }
    catch (e) { notify(errMsg(e), 'error'); }
    finally { setBusy(null); }
  };
  return (
    <PanelShell eyebrow="Archive" title={`Completed goals (${done.length})`} onClose={onClose}>
      {done.length === 0 && <div className="bp-empty-small">Nothing completed yet. Open a goal and choose “Mark goal completed” when it's done.</div>}
      <ul className="bp-done-list">
        {done.map(b => (
          <li key={b.id}>
            <button className="bp-done-main" onClick={() => onOpen(b)}>
              <span className="bp-done-check">✓</span>
              <span>
                <span className="bp-done-name">{b.name}</span>
                <span className="bp-done-sub">
                  {fmtINR(b.target_amount)} · {b.board_id ? boardsById[b.board_id]?.name : 'External'} · {fmtDate(b.completed_at)}
                </span>
              </span>
            </button>
            <button className="bp-btn sm" disabled={busy === b.id} onClick={() => reopen(b)}>Reopen</button>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  Lane picker — presets or a custom month range
// ═══════════════════════════════════════════════════════════════════
const monthVal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function LanePicker({ layers, onAdd, onCancel, busy }) {
  const used = new Set(layers.map(l => l.horizon).filter(Boolean));
  const now = new Date();
  const [pick, setPick] = useState(() => (LANE_PRESETS.find(p => !used.has(p.id) && p.id !== 'this_week') || LANE_PRESETS[0]).id);
  const [from, setFrom] = useState(monthVal(new Date(now.getFullYear() + 1, 0, 1)));
  const [to, setTo] = useState(monthVal(new Date(now.getFullYear() + 2, 11, 1)));
  const preset = LANE_PRESETS.find(p => p.id === pick);
  const [name, setName] = useState(preset?.label || '');
  const [touched, setTouched] = useState(false);

  const lane = (() => {
    if (pick !== 'custom') return { horizon: pick };
    const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    const end = new Date(ty, tm, 0);
    return { horizon: 'custom', horizon_from: `${from}-01`, horizon_to: `${to}-${String(end.getDate()).padStart(2, '0')}`, _bad: !fy || !ty || new Date(fy, fm - 1, 1) > end };
  })();
  const win = laneWindow(lane);
  const autoName = pick === 'custom' ? (laneWindowText(win) || 'Custom') : preset?.label;
  const choose = (id) => { setPick(id); if (!touched) setName(id === 'custom' ? '' : (LANE_PRESETS.find(p => p.id === id)?.label || '')); };

  return (
    <div className="bp-lanepick" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <div className="bp-lanepick-title">Add a lane</div>
      <div className="bp-chips">
        {LANE_PRESETS.map(p => (
          <button key={p.id} type="button" className={`bp-chip ${pick === p.id ? 'on' : ''}`} onClick={() => choose(p.id)}
            title={laneWindowText(laneWindow({ horizon: p.id }))}>
            {p.label}{used.has(p.id) && <span>added</span>}
          </button>
        ))}
        <button type="button" className={`bp-chip ${pick === 'custom' ? 'on' : ''}`} onClick={() => choose('custom')}>Custom range…</button>
      </div>
      {pick === 'custom' && (
        <div className="bp-grid2">
          <Field label="From"><input className="bp-input" type="month" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="bp-input" type="month" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Lane name" hint={win ? `Covers ${laneWindowText(win)}. Lanes stay in time order, soonest on top.` : undefined}>
        <input className="bp-input" value={name} placeholder={autoName} onChange={e => { setName(e.target.value); setTouched(true); }} maxLength={40} />
      </Field>
      <div className="bp-row-end">
        {onCancel && <button type="button" className="bp-btn ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="bp-btn primary" disabled={busy || lane._bad}
          onClick={() => onAdd({ label: (name.trim() || autoName), period: win?.period || 'year', horizon: lane.horizon, horizon_from: lane.horizon_from || null, horizon_to: lane.horizon_to || null })}>
          Add lane
        </button>
      </div>
    </div>
  );
}
