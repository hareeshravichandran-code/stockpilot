import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';

/* Kanalyst landing — a family home, not just a portfolio.
   Sample family below is illustrative (shown as a preview on the page). */

const MODULES = {
  money:     { name: 'Money',      color: 'var(--kl-moss)' },
  goals:     { name: 'Goals',      color: 'var(--kl-aubergine)' },
  loans:     { name: 'Loans',      color: 'var(--kl-terracotta)' },
  insurance: { name: 'Insurance',  color: 'var(--kl-prussian)' },
  documents: { name: 'Documents',  color: 'var(--kl-mulberry)' },
  calendar:  { name: 'Dates',      color: 'var(--kl-marigold)' },
};

const MEMBERS = [
  { id: 'arjun', name: 'Arjun', role: 'You',          x: 50, y: 25 },
  { id: 'meera', name: 'Meera', role: 'Partner',      x: 75, y: 50 },
  { id: 'diya',  name: 'Diya',  role: 'Daughter, 8',  x: 50, y: 75 },
  { id: 'paati', name: 'Paati', role: 'Grandmother',  x: 25, y: 50 },
];

// Positions are % of the square stage
const ITEMS = [
  { id: 'loan',   m: 'loans',     who: ['arjun', 'meera'], title: 'Home loan',        note: '₹28L left, ends 2043',      x: 76, y: 8 },
  { id: 'term',   m: 'insurance', who: ['arjun'],          title: 'Term cover',       note: '₹1.5Cr, renews in March',    x: 24, y: 8 },
  { id: 'sip',    m: 'money',     who: ['arjun', 'meera'], title: 'SIPs',             note: '₹35K a month, 6 funds',      x: 93, y: 30 },
  { id: 'retire', m: 'goals',     who: ['arjun', 'meera'], title: 'Retirement',       note: 'On track for 2045',          x: 93, y: 70 },
  { id: 'pass',   m: 'documents', who: ['meera'],          title: 'Passport',         note: 'Expires Feb 2027',           x: 76, y: 92 },
  { id: 'fees',   m: 'calendar',  who: ['diya'],           title: 'School fees',      note: 'Due 10 June',                x: 50, y: 97 },
  { id: 'ssy',    m: 'money',     who: ['diya'],           title: 'Sukanya account',  note: '₹3.2L saved',                x: 24, y: 92 },
  { id: 'floater',m: 'insurance', who: ['arjun', 'meera', 'diya'], title: 'Family health cover', note: '₹10L, renews 12 Aug', x: 66, y: 66 },
  { id: 'fd',     m: 'money',     who: ['paati'],          title: 'Senior citizen FD', note: 'Matures 1 June',            x: 7,  y: 70 },
  { id: 'senior', m: 'insurance', who: ['paati'],          title: 'Senior health plan', note: 'Premium due in July',      x: 7,  y: 30 },
  { id: 'puc',    m: 'documents', who: ['arjun'],          title: 'Car PUC',          note: 'Due in 9 days',  urgent: true, x: 34, y: 34 },
  { id: 'bday',   m: 'calendar',  who: ['paati'],          title: 'Paati turns 75',   note: '14 June',                    x: 32, y: 68 },
];

const JUNE = [
  { d: 1,  m: 'money',     t: 'Paati’s FD matures',      a: '₹2.1L back' },
  { d: 5,  m: 'money',     t: 'SIPs go out',             a: '₹35,000' },
  { d: 10, m: 'calendar',  t: 'Diya’s school fees',      a: '₹48,000' },
  { d: 12, m: 'insurance', t: 'Health premium',          a: '₹22,400' },
  { d: 14, m: 'calendar',  t: 'Paati’s 75th birthday',   a: '' },
  { d: 20, m: 'loans',     t: 'Home loan EMI',           a: '₹26,035' },
  { d: 24, m: 'documents', t: 'Car PUC expires',         a: 'Renew' },
];

function Constellation() {
  const [sel, setSel] = useState(null);
  const lit = (it) => !sel || it.who.includes(sel);
  const mine = sel ? ITEMS.filter(i => i.who.includes(sel)) : ITEMS.filter(i => i.urgent || ['fees', 'fd', 'floater'].includes(i.id));
  const person = MEMBERS.find(m => m.id === sel);
  return (
    <div className="kl-home">
      <div className="kl-stage" role="group" aria-label="A sample family home in Kanalyst">
        <svg className="kl-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {MEMBERS.map(m => <line key={m.id} x1="50" y1="50" x2={m.x} y2={m.y} className={`kl-spoke ${sel === m.id ? 'on' : ''}`} />)}
          {ITEMS.flatMap(it => it.who.map(w => {
            const m = MEMBERS.find(x => x.id === w);
            return <line key={it.id + w} x1={m.x} y1={m.y} x2={it.x} y2={it.y} className={`kl-thread ${lit(it) ? '' : 'dim'} ${sel && lit(it) ? 'on' : ''}`} style={{ stroke: MODULES[it.m].color }} />;
          }))}
        </svg>
        <div className="kl-house" aria-hidden="true">
          <svg viewBox="0 0 64 60"><path d="M6 28 L32 6 L58 28" /><path d="M13 23 V54 H51 V23" /><path d="M27 54 V38 H37 V54" /></svg>
          <span>Our home</span>
        </div>
        {MEMBERS.map((m, i) => (
          <button key={m.id} type="button" className={`kl-person ${sel === m.id ? 'on' : ''} ${sel && sel !== m.id ? 'dim' : ''}`}
            style={{ left: `${m.x}%`, top: `${m.y}%`, animationDelay: `${0.25 + i * 0.08}s` }}
            aria-pressed={sel === m.id} onClick={() => setSel(s => s === m.id ? null : m.id)}>
            <span className="kl-avatar">{m.name[0]}</span>
            <span className="kl-pname">{m.name}<small>{m.role}</small></span>
          </button>
        ))}
        {ITEMS.map((it, i) => (
          <div key={it.id} className={`kl-node ${lit(it) ? '' : 'dim'} ${it.urgent ? 'urgent' : ''}`}
            style={{ left: `${it.x}%`, top: `${it.y}%`, '--c': MODULES[it.m].color, animationDelay: `${0.6 + i * 0.05}s` }}>
            <i />
            <span>{it.title}</span>
          </div>
        ))}
      </div>
      <div className="kl-readout" aria-live="polite">
        <div className="kl-readout-head">
          {person ? <><b>{person.name}</b> has {mine.length} things to keep an eye on</> : <><b>This week</b> for the whole family</>}
        </div>
        <ul>
          {mine.map(it => (
            <li key={it.id} style={{ '--c': MODULES[it.m].color }}>
              <span className="kl-mod">{MODULES[it.m].name}</span>
              <span className="kl-what">{it.title}</span>
              <span className={`kl-note ${it.urgent ? 'urgent' : ''}`}>{it.note}</span>
            </li>
          ))}
        </ul>
        <div className="kl-pick">
          {MEMBERS.map(m => (
            <button key={m.id} type="button" className={sel === m.id ? 'on' : ''} aria-pressed={sel === m.id} onClick={() => setSel(s => s === m.id ? null : m.id)}>{m.name}</button>
          ))}
          <button type="button" className={!sel ? 'on' : ''} aria-pressed={!sel} onClick={() => setSel(null)}>Everyone</button>
        </div>
      </div>
    </div>
  );
}

/* ── Small infographics for the module blocks ─────────────────────── */
function MoneyBar() {
  const parts = [['Stocks', 38], ['Mutual funds', 31], ['FDs & RDs', 14], ['NPS', 10], ['EPF & PPF', 7]];
  return (
    <div className="kl-mbar">
      <div className="kl-mbar-track">{parts.map(([l, v], i) => <i key={l} style={{ flex: v, opacity: 1 - i * 0.15 }} title={`${l} ${v}%`} />)}</div>
      <div className="kl-mbar-legend">{parts.map(([l, v], i) => <span key={l}><i style={{ opacity: 1 - i * 0.15 }} />{l} {v}%</span>)}</div>
    </div>
  );
}
function GoalLanes() {
  const g = [['Emergency fund', 82], ['Diya’s college', 34], ['New car', 61]];
  return (
    <ul className="kl-goals">
      {g.map(([n, p]) => (
        <li key={n}>
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="v" style={{ strokeDasharray: `${p * 0.942} 94.2` }} /></svg>
          <span>{n}</span><b>{p}%</b>
        </li>
      ))}
    </ul>
  );
}
function RetireCurve() {
  return (
    <svg className="kl-curve" viewBox="0 0 200 90" aria-label="Savings cross what you need in 2045">
      <path d="M0 70 C60 66 110 50 200 30" className="need" />
      <path d="M0 86 C70 82 120 60 200 6" className="have" />
      <circle cx="152" cy="40" r="4.5" />
      <text x="146" y="58">2045</text>
    </svg>
  );
}
function CoverRings() {
  const p = [['Arjun', '₹1.6Cr'], ['Meera', '₹60L'], ['Diya', '₹10L'], ['Paati', '₹5L']];
  return <div className="kl-covers">{p.map(([n, v]) => <span key={n}><b>{v}</b>{n}</span>)}</div>;
}
function Expiries() {
  const d = [['Car PUC', 9, 'urgent'], ['Meera’s passport', 460, ''], ['Arjun’s licence', 1500, '']];
  return (
    <ul className="kl-exp">
      {d.map(([n, days, c]) => (
        <li key={n} className={c}><span>{n}</span><i style={{ width: `${Math.max(4, Math.min(100, days / 15))}%` }} /><b>{days < 60 ? `${days} days` : days < 730 ? `${Math.round(days / 30)} months` : `${Math.round(days / 365)} years`}</b></li>
      ))}
    </ul>
  );
}
function MonthDots() {
  const marks = { 1: 'money', 5: 'money', 10: 'calendar', 12: 'insurance', 14: 'calendar', 20: 'loans', 24: 'documents' };
  return (
    <div className="kl-month" aria-hidden="true">
      {Array.from({ length: 30 }, (_, i) => i + 1).map(d => <span key={d} className={marks[d] ? 'on' : ''} style={marks[d] ? { '--c': MODULES[marks[d]].color } : undefined}>{d}</span>)}
    </div>
  );
}
function SpendBars() {
  const v = [62, 58, 71, 54, 66, 49];
  return <div className="kl-spend" aria-hidden="true">{v.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>;
}

export default function Landing() {
  const nav = useNavigate();
  useEffect(() => { document.title = 'Kanalyst: your family’s money, plans and paperwork'; }, []);

  return (
    <div className="kl">
      <nav className="kl-nav">
        <div className="kl-logo"><span className="kl-logo-mark" aria-hidden="true" />Kanalyst</div>
        <div className="kl-nav-links">
          <a href="#modules">What it tracks</a>
          <a href="#month">A month</a>
          <button type="button" className="kl-btn ghost" onClick={() => nav('/login')}>Log in</button>
          <button type="button" className="kl-btn" onClick={() => nav('/signup')}>Start free</button>
        </div>
      </nav>

      <header className="kl-hero">
        <div className="kl-hero-copy">
          <h1>Everything your family runs on, in one home.</h1>
          <p>Investments, goals, loans, insurance, documents and the dates that matter, for every person in your house. Kanalyst fills most of it in for you and tells you what needs attention this week.</p>
          <div className="kl-cta">
            <button type="button" className="kl-btn lg" onClick={() => nav('/signup')}>Create your family home</button>
            <button type="button" className="kl-btn lg ghost" onClick={() => nav('/login')}>I have an account</button>
          </div>
          <p className="kl-small">Free to use. Built in India, for Indian families.</p>
        </div>
        <Constellation />
      </header>
      <p className="kl-sample">The family above is a sample. Tap a person to see what Kanalyst keeps for them.</p>

      <section id="modules" className="kl-modules" aria-labelledby="kl-mod-h">
        <h2 id="kl-mod-h">What Kanalyst keeps track of</h2>
        <div className="kl-bento">
          <article className="kl-b money">
            <h3>Money</h3>
            <p>Stocks, mutual funds, FDs, RDs, NPS, EPF and PPF for each person, with prices updated every day.</p>
            <MoneyBar />
          </article>
          <article className="kl-b goals">
            <h3>Goals on a Blueprint</h3>
            <p>Draw each goal, map the funds behind it and watch it fill.</p>
            <GoalLanes />
          </article>
          <article className="kl-b retire">
            <h3>Retirement</h3>
            <p>When you can stop working, using your real spending, loans and SIPs.</p>
            <RetireCurve />
          </article>
          <article className="kl-b insurance">
            <h3>Insurance <em className="kl-new">New</em></h3>
            <p>Who is covered, for how much, and when each policy renews.</p>
            <CoverRings />
          </article>
          <article className="kl-b documents">
            <h3>Documents <em className="kl-new">New</em></h3>
            <p>Passports, licences, RC and PUC, with a reminder before anything expires.</p>
            <Expiries />
          </article>
          <article className="kl-b calendar">
            <h3>Family calendar <em className="kl-new">New</em></h3>
            <p>Birthdays, fees, EMIs, premiums and maturities on one timeline.</p>
            <MonthDots />
          </article>
          <article className="kl-b spend">
            <h3>Spending</h3>
            <p>Read from your bank SMS on Android, sorted into groceries, bills, EMIs and investments.</p>
            <SpendBars />
          </article>
          <article className="kl-b family">
            <h3>Family members <em className="kl-new">New</em></h3>
            <p>A profile for everyone, including children and parents who don’t log in. Share a home with your partner.</p>
            <div className="kl-faces" aria-hidden="true">{MEMBERS.map(m => <span key={m.id}>{m.name[0]}</span>)}<span className="add">+</span></div>
          </article>
        </div>
      </section>

      <section id="month" className="kl-june" aria-labelledby="kl-june-h">
        <div className="kl-june-head">
          <h2 id="kl-june-h">June, before it happens</h2>
          <p>Kanalyst puts every date from every module on one line, so nothing surprises you.</p>
        </div>
        <ol className="kl-line">
          {JUNE.map(e => (
            <li key={e.d} style={{ '--c': MODULES[e.m].color, '--x': (e.d - 1) / 29 }}>
              <span className="kl-day">{e.d} Jun</span>
              <span className="kl-ev">{e.t}</span>
              {e.a && <span className="kl-amt">{e.a}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="kl-sources" aria-labelledby="kl-src-h">
        <h2 id="kl-src-h">It fills itself in</h2>
        <div className="kl-src-grid">
          <div><h3>Bank SMS</h3><p>The Android app reads transaction messages on your phone: spends, SIPs, EMIs.</p></div>
          <div><h3>Statements</h3><p>Upload your CAS, NPS and EPF statements, and holdings update.</p></div>
          <div><h3>Your broker</h3><p>Stocks and dividends sync with live NSE prices.</p></div>
          <div><h3>You</h3><p>Every number can be changed. Kanalyst remembers your edits.</p></div>
        </div>
        <p className="kl-trust">Kanalyst only reads. It never moves money, and your family’s data is never sold or shared.</p>
      </section>

      <section className="kl-end">
        <h2>Bring the whole house together.</h2>
        <button type="button" className="kl-btn lg light" onClick={() => nav('/signup')}>Create your family home</button>
      </section>

      <footer className="kl-foot">
        <span>© 2026 Kanalyst</span>
        <a href="/login">Log in</a>
      </footer>
    </div>
  );
}
