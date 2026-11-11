import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { householdAPI } from '../lib/api';
import { errMsg } from '../family/shared';
import People from '../family/People';
import Insurance from '../family/Insurance';
import Documents from '../family/Documents';
import CalendarView from '../family/Calendar';
import Masters from '../family/Masters';
import Events from '../family/Events';
import LogoLoader from './LogoLoader';
import '../pages/Family.css';

// Family and Masters screens inside the main app (same side menu everywhere).
export const PANEL_TAB = { people: 'm-people', insurance: 'm-insurance', documents: 'm-documents', calendar: 'calendar', masters: 'm-all', events: 'm-events', home: 'dashboard' };

export default function FamilyPanel({ panel, kind }) {
  const nav = useNavigate();
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);
  const loadMembers = useCallback(async () => {
    try { const r = await householdAPI.members.list(); setMembers(r.data.items); setErr(''); }
    catch (e) { setErr(errMsg(e)); setMembers([]); }
  }, []);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  const notify = useCallback((text, k = 'ok') => setToast({ text, kind: k, k: Date.now() }), []);
  const go = useCallback((t) => nav(`/dashboard?tab=${PANEL_TAB[t] || 'dashboard'}`), [nav]);
  const shared = { members: members || [], reloadMembers: loadMembers, notify, go };
  return (
    <div className="fo fo-embed">
      {err && <div className="fo-banner">{err}</div>}
      {members === null ? <LogoLoader label="Gathering your family…" /> : (
        <>
          {panel === 'people' && <People {...shared} />}
          {panel === 'insurance' && <Insurance {...shared} />}
          {panel === 'documents' && <Documents {...shared} />}
          {panel === 'calendar' && <CalendarView {...shared} />}
          {panel === 'masters' && <Masters {...shared} kind={kind} />}
          {panel === 'events' && <Events {...shared} />}
        </>
      )}
      {toast && <div key={toast.k} className={`fo-toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
