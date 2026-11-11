import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supportAPI } from '../lib/api';
import { Bubbles, Composer } from './supportChat';
import './Support.css';

import LogoLoader from '../components/LogoLoader';
export default function Support() {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState(null);
  const [err, setErr] = useState('');
  const end = useRef(null);
  const load = useCallback(() => supportAPI.messages().then(r => setMsgs(r.data.messages)).catch(e => setErr(e.response?.data?.error || e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  return (
    <div className="sp-page">
      <header className="sp-head">
        <button className="sp-back" onClick={() => nav('/dashboard')}>←</button>
        <div><h1>Help & support</h1><p>Tell us what went wrong or what you'd like. Screenshots help a lot. We reply here.</p></div>
      </header>
      <main className="sp-chat">
        {err && <div className="sp-err">{err}</div>}
        {msgs ? <Bubbles messages={msgs} mine={m => !m.from_admin} /> : <LogoLoader />}
        <div ref={end} />
      </main>
      <Composer placeholder="Describe the problem or idea…" onSend={async (d) => { await supportAPI.send(d); await load(); }} />
      <p className="sp-foot">To send SMS and app logs for a reading problem, use Settings → Help & support → Send diagnostics in the Android app.</p>
    </div>
  );
}
