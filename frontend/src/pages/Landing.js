import { useNavigate } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  const nav = useNavigate();
  return (
    <div className="landing">
      <nav className="land-nav">
        <div className="land-logo">StockPilot</div>
        <div className="land-nav-links">
          <span onClick={() => nav('/login')}>Log in</span>
          <button className="btn-primary" onClick={() => nav('/signup')}>Get Started Free</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">🇮🇳 Built for Indian investors</div>
        <h1 className="hero-title">
          Your entire portfolio<br/>
          <span className="gradient-text">synced from your inbox</span>
        </h1>
        <p className="hero-sub">
          Connect Gmail or Outlook. StockPilot reads your broker emails and
          automatically tracks your stocks, dividends, and taxes — just like INDMoney.
        </p>
        <div className="hero-btns">
          <button className="btn-primary btn-lg" onClick={() => nav('/signup')}>
            Start for free →
          </button>
          <button className="btn-ghost btn-lg" onClick={() => nav('/login')}>
            I have an account
          </button>
        </div>
        <div className="hero-trust">
          Works with&nbsp;
          <strong>Zerodha</strong> · <strong>Groww</strong> · <strong>Angel One</strong> ·
          <strong>Upstox</strong> · <strong>CDSL</strong> · <strong>NSDL</strong>
        </div>
      </section>

      <section className="features">
        {[
          { icon:'📬', title:'Email Sync', desc:'Connect Gmail or Outlook. We scan for contract notes, dividend alerts, and CDSL statements.' },
          { icon:'📊', title:'Live Portfolio', desc:'Real-time NSE/BSE prices. Instant P&L, sector allocation, and performance charts.' },
          { icon:'💰', title:'Dividend Tracker', desc:'Every dividend, auto-logged from email alerts. Know exactly what you\'ll earn.' },
          { icon:'🧾', title:'Tax Summary', desc:'STCG, LTCG, and TDS summary ready for your CA. One-click export.' },
        ].map(f => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-desc">{f.desc}</div>
          </div>
        ))}
      </section>

      <footer className="land-footer">
        <span>© 2025 StockPilot</span>
        <span>Built with ❤️ for Indian investors</span>
        <span style={{color:'var(--text3)', fontSize:'12px'}}>
          We only read emails. Never send or delete.
        </span>
      </footer>
    </div>
  );
}
