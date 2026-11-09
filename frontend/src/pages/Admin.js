import { useNavigate, useParams } from 'react-router-dom';
import AdminSupport from './AdminSupport';
import AdminSmsIssues from './AdminSmsIssues';
import './Support.css';

// Administration: support inbox (messages, screenshots, diagnostics) and SMS reading issues
const TABS = [['support', 'Support inbox'], ['sms', 'SMS issues']];

export default function Admin() {
  const nav = useNavigate();
  const { tab = 'support' } = useParams();
  return (
    <div className="ad-page">
      <header className="ad-top">
        <button className="sp-back" onClick={() => nav('/dashboard')}>←</button>
        <h1>Administration</h1>
        <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => nav(`/admin/${k}`)}>{l}</button>)}</nav>
      </header>
      {tab === 'sms' ? <AdminSmsIssues /> : <AdminSupport embedded />}
    </div>
  );
}
