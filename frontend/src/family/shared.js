import { useEffect, useRef } from 'react';

export const MODULE = {
  money:     { name: 'Money',     color: 'var(--fo-moss)' },
  goals:     { name: 'Goals',     color: 'var(--fo-aubergine)' },
  loans:     { name: 'Loans',     color: 'var(--fo-terracotta)' },
  insurance: { name: 'Insurance', color: 'var(--fo-prussian)' },
  documents: { name: 'Documents', color: 'var(--fo-mulberry)' },
  family:    { name: 'Family',    color: 'var(--fo-marigold)' },
};

export const MEMBER_COLORS = ['ink', 'mulberry', 'marigold', 'teal', 'prussian', 'moss', 'aubergine', 'terracotta'];
export const colorVar = (c) => `var(--fo-${MEMBER_COLORS.includes(c) ? c : 'ink'})`;
export const inkOn = (c) => (c === 'marigold' ? 'var(--fo-ink)' : 'var(--fo-paper)');

export const RELATIONS = [
  ['spouse', 'Spouse'], ['child', 'Child'], ['parent', 'Parent'], ['grandparent', 'Grandparent'],
  ['sibling', 'Sibling'], ['in_law', 'In-law'], ['other', 'Other'],
];
export const relLabel = (m) => (m.is_me ? 'You' : m.relation === 'self' ? 'Family account' : (RELATIONS.find(r => r[0] === m.relation)?.[1] || 'Family'));
export const shortName = (m) => (m?.is_me ? 'You' : m?.name || 'Someone');

export const POLICY_KINDS = [
  ['health', 'Health', '✚'], ['term', 'Term', '☂'], ['life', 'Life', '♥'], ['vehicle', 'Vehicle', '🚗'],
  ['home', 'Home', '⌂'], ['accident', 'Accident', '⚑'], ['travel', 'Travel', '✈'], ['other', 'Other', '◇'],
];
export const policyKind = (k) => POLICY_KINDS.find(x => x[0] === k) || POLICY_KINDS[7];
export const FREQS = [['monthly', 'Monthly', 12], ['quarterly', 'Quarterly', 4], ['half_yearly', 'Half-yearly', 2], ['yearly', 'Yearly', 1], ['single', 'One-time', 0]];

export const DOC_KINDS = [
  ['passport', 'Passport', 'expiry'], ['driving_licence', 'Driving licence', 'expiry'], ['vehicle_rc', 'Vehicle RC', 'expiry'],
  ['puc', 'PUC certificate', 'expiry'], ['pan', 'PAN card', 'id'], ['aadhaar', 'Aadhaar', 'id'], ['voter_id', 'Voter ID', 'expiry'],
  ['school_fees', 'School fees', 'payment'], ['property_tax', 'Property tax', 'payment'], ['subscription', 'Subscription', 'payment'], ['other', 'Other', 'expiry'],
];
export const docKind = (k) => DOC_KINDS.find(x => x[0] === k) || DOC_KINDS[DOC_KINDS.length - 1];
export const REPEATS = [['none', 'Once'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-yearly'], ['yearly', 'Yearly']];

// ── Numbers and dates ────────────────────────────────────────────────
const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
export const inr = (v) => {
  const a = Math.abs(n(v));
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `₹${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `₹${Math.round(a)}`;
};
export const inrFull = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysUntil = (s) => Math.round((parseDate(s) - parseDate(todayStr())) / 864e5);
export const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (s ? parseDate(s).toLocaleDateString('en-IN', opts) : '—');
export const fmtDay = (s) => fmtDate(s, { day: 'numeric', month: 'short' });
export function whenLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${-days} days overdue`;
  if (days < 60) return `In ${days} days`;
  if (days < 730) return `In ${Math.round(days / 30.4)} months`;
  return `In ${Math.round(days / 365)} years`;
}
export const urgency = (days) => (days < 0 ? 'over' : days <= 7 ? 'soon' : days <= 30 ? 'near' : 'later');
export function ageFrom(dob) {
  if (!dob) return null;
  const d = parseDate(dob), t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
}
export function nextBirthday(dob) {
  if (!dob) return null;
  const d = parseDate(dob), t = parseDate(todayStr());
  let nb = new Date(t.getFullYear(), d.getMonth(), d.getDate());
  if (nb < t) nb = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
  return { date: ymd(nb), days: Math.round((nb - t) / 864e5), turns: nb.getFullYear() - d.getFullYear() };
}
export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

// ── Small UI pieces ──────────────────────────────────────────────────
export function Avatar({ m, size = 40, ring }) {
  const c = m?.color || 'ink';
  return (
    <span className={`fo-av ${ring ? 'ring' : ''}`} title={m ? `${m.name} (${relLabel(m)})` : ''}
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorVar(c), color: inkOn(c) }}>
      {(m?.name || '?').trim()[0]?.toUpperCase()}
    </span>
  );
}
export function Faces({ ids, members, size = 26, max = 4 }) {
  const list = (ids || []).map(id => members.find(m => m.id === id)).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="fo-faces">
      {list.slice(0, max).map(m => <Avatar key={m.id} m={m} size={size} ring />)}
      {list.length > max && <span className="fo-faces-more">+{list.length - max}</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current?.querySelector('input, select, textarea, button');
    el?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fo-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`fo-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="fo-modal-head">
          <h2>{title}</h2>
          <button type="button" className="fo-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fo-modal-body">{children}</div>
        {footer && <div className="fo-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`fo-field ${wide ? 'wide' : ''}`}>
      <span className="fo-label">{label}</span>
      {children}
      {hint && <span className="fo-hint">{hint}</span>}
    </label>
  );
}

export function MemberPicker({ members, value, onChange, multi = true, allowNone }) {
  const sel = multi ? (value || []) : value ? [value] : [];
  const toggle = (id) => {
    if (multi) onChange(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
    else onChange(sel.includes(id) && allowNone ? null : id);
  };
  return (
    <div className="fo-mpick" role="group">
      {members.map(m => (
        <button key={m.id} type="button" className={sel.includes(m.id) ? 'on' : ''} aria-pressed={sel.includes(m.id)} onClick={() => toggle(m.id)}>
          <Avatar m={m} size={22} /> {shortName(m)}
        </button>
      ))}
      {multi && members.length > 1 && (
        <button type="button" className="fo-mpick-all" onClick={() => onChange(sel.length === members.length ? [] : members.map(m => m.id))}>
          {sel.length === members.length ? 'Clear' : 'Everyone'}
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="fo-empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="fo-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l, icon]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {icon && <span aria-hidden="true">{icon}</span>}{l}
        </button>
      ))}
    </div>
  );
}
