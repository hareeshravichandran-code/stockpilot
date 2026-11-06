import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { householdAPI } from '../lib/api';
import { errMsg } from '../family/shared';
import FamilyHome from '../family/Home';
import People from '../family/People';
import Insurance from '../family/Insurance';
import Documents from '../family/Documents';
import CalendarView from '../family/Calendar';
import Masters from '../family/Masters';
import './Family.css';

const TABS = [
  ['home', 'Home', 'var(--fo-marigold)'],
  ['people', 'People', 'var(--fo-ink)'],
  ['insurance', 'Insurance', 'var(--fo-prussian)'],
  ['documents', 'Documents', 'var(--fo-mulberry)'],
  ['calendar', 'Calendar', 'var(--fo-moss)'],
  ['masters', 'Masters', 'var(--fo-terracotta)'],
];

export default function Family() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t[0] === params.get('tab')) ? params.get('tab') : 'home';
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);

  const loadMembers = useCallback(async () => {
    try { const r = await householdAPI.members.list(); setMembers(r.data.items); setErr(''); }
    catch (e) { setErr(errMsg(e)); setMembers([]); }
  }, []);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { document.title = 'Family · Kanalyst'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((text, kind = 'ok') => setToast({ text, kind, k: Date.now() }), []);
  const go = useCallback((t) => setParams(t === 'home' ? {} : { tab: t }), [setParams]);
  const shared = { members: members || [], reloadMembers: loadMembers, notify, go };

  return (
    <div className="fo">
      <header className="fo-top">
        <button type="button" className="fo-back" onClick={() => nav('/dashboard')} aria-label="Back to dashboard">‹</button>
        <div className="fo-brand">
          <span className="fo-mark" aria-hidden="true" />
          <span>Family</span>
        </div>
        <nav className="fo-tabs" aria-label="Family sections">
          {TABS.map(([id, label, c]) => (
            <button key={id} type="button" className={tab === id ? 'on' : ''} style={{ '--c': c }} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
      </header>
      <main className="fo-main">
        {err && <div className="fo-banner">{err}</div>}
        {members === null ? <div className="fo-loading"><span className="fo-spin" /> Gathering your family…</div> : (
          <>
            {tab === 'home' && <FamilyHome {...shared} />}
            {tab === 'people' && <People {...shared} />}
            {tab === 'insurance' && <Insurance {...shared} />}
            {tab === 'documents' && <Documents {...shared} />}
            {tab === 'calendar' && <CalendarView {...shared} />}
            {tab === 'masters' && <Masters {...shared} />}
          </>
        )}
      </main>
      {toast && <div key={toast.k} className={`fo-toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
