import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { portfolioAPI, emailAPI, authAPI } from '../lib/api';
import AdminPanel from './AdminPanel';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import './Dashboard.css';

const SECTOR_COLORS = {
  'IT': '#0ea5e9', 'Auto': '#f59e0b', 'Bank': '#00d4a1',
  'Infra': '#34d399', 'Pharma': '#a78bfa', 'FMCG': '#f43f5e', 'Other': '#6b7280'
};

function fmt(n) { return '₹' + (Math.abs(n) >= 100000 ? (n/100000).toFixed(2)+'L' : Math.abs(n) >= 1000 ? (n/1000).toFixed(1)+'K' : n?.toFixed(0)); }
function fmtFull(n) { return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function pct(n) { return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }

export default function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState('dashboard');
  const [portfolio, setPortfolio] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [dividends, setDividends] = useState({ dividends: [], totalIncome: 0 });
  const [tax, setTax] = useState(null);
  const [emailStatus, setEmailStatus] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectStep, setConnectStep] = useState('choose');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profile, setProfile] = useState({ pan: '', dob: '', mobile: '', name: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await portfolioAPI.get();
      setPortfolio(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadPortfolio();
    emailAPI.status().then(r => setEmailStatus(r.data.connections || [])).catch(() => {});

    // Handle OAuth callback
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) { setSyncResult({ success: true, message: `${connected} connected!` }); }
    if (error) { setSyncResult({ success: false, message: 'Connection failed. Please try again.' }); }
  }, [loadPortfolio, searchParams]);

  const loadTab = async (t) => {
    setTab(t);
    if (t === 'transactions' && transactions.length === 0) {
      const r = await portfolioAPI.transactions().catch(() => ({ data: [] }));
      setTransactions(r.data);
    }
    if (t === 'dividends' && dividends.dividends.length === 0) {
      const r = await portfolioAPI.dividends().catch(() => ({ data: { dividends: [], totalIncome: 0 } }));
      setDividends(r.data);
    }
    if (t === 'tax' && !tax) {
      const r = await portfolioAPI.tax().catch(() => ({ data: {} }));
      setTax(r.data);
    }
  };

  const connectGmail = async () => {
    setConnectStep('connecting');
    try {
      const r = await emailAPI.connectGmail();
      window.location.href = r.data.url;
    } catch (e) {
      setConnectStep('choose');
      alert('Failed to get OAuth URL. Check backend is running.');
    }
  };

  const syncEmails = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await emailAPI.syncCAS();
      setSyncResult(r.data);
      await loadPortfolio();
    } catch (e) {
      setSyncResult({ success: false, message: e.response?.data?.error || 'Sync failed' });
    } finally { setSyncing(false); }
  };

  const saveProfile = async () => {
    setProfileSaving(true); setProfileError('');
    try {
      await authAPI.saveProfile({ pan: profile.pan, dob: profile.dob, mobile: profile.mobile, name: profile.name });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (e) {
      setProfileError(e.response?.data?.error || 'Failed to save');
    } finally { setProfileSaving(false); }
  };

  const s = portfolio?.summary || {};
  const holdings = portfolio?.holdings || [];

  // Sector data for chart
  const sectorData = Object.entries(
    holdings.reduce((acc, h) => {
      acc[h.sector] = (acc[h.sector] || 0) + h.marketValue;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: Math.round(value) }));

  // Mock growth data (replace with real historical data later)
  const growthData = [
    { month: 'Apr', cost: 1100000, market: 1100000 },
    { month: 'May', cost: 1150000, market: 1160000 },
    { month: 'Jun', cost: 1180000, market: 1210000 },
    { month: 'Jul', cost: 1190000, market: 1270000 },
    { month: 'Aug', cost: 1194517, market: 1330000 },
    { month: 'Sep', cost: 1194517, market: 1360000 },
    { month: 'Oct', cost: 1194517, market: 1390000 },
    { month: 'Nov', cost: 1194517, market: 1400000 },
    { month: 'Dec', cost: 1194517, market: s.totalMarket || 1409134 },
  ];

  if (loading) return (
    <div className="db-loading">
      <div className="db-spinner"></div>
      <p>Loading your portfolio…</p>
    </div>
  );

  return (
    <div className="db-layout">
      {/* SIDEBAR */}
      <aside className="db-sidebar">
        <div className="db-logo">
          <div className="db-logo-mark">StockPilot</div>
          <div className="db-logo-sub">Portfolio Intelligence</div>
        </div>

        <nav className="db-nav">
          <div className="db-nav-label">Overview</div>
          {[
            { id:'dashboard', icon:'⬡', label:'Dashboard' },
            { id:'holdings', icon:'◈', label:'Holdings' },
            { id:'dividends', icon:'◎', label:'Dividends' },
            { id:'transactions', icon:'⇄', label:'Transactions' },
          ].map(n => (
            <div key={n.id} className={`db-nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => loadTab(n.id)}>
              <span>{n.icon}</span> {n.label}
            </div>
          ))}

          <div className="db-nav-label" style={{marginTop:12}}>Analytics</div>
          {[
            { id:'tax', icon:'⊞', label:'Tax Summary' },
            { id:'admin', icon:'⚙', label:'Sync Logs' },
          ].map(n => (
            <div key={n.id} className={`db-nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => loadTab(n.id)}>
              <span>{n.icon}</span> {n.label}
            </div>
          ))}
        </nav>

        <div className="db-sidebar-footer">
          <div className="db-user">
            <div className="db-avatar">{user?.name?.[0]?.toUpperCase()}</div>
            <div>
              <div className="db-user-name">{user?.name}</div>
              <div className="db-user-email">{user?.email}</div>
            </div>
          </div>
          <button className="db-connect-btn" onClick={() => { setShowConnectModal(true); setConnectStep('choose'); }}>
            + Connect Gmail
          </button>
          <button className="db-connect-btn" style={{marginTop:6,background:'#1e293b',border:'1px solid #334155'}} onClick={() => setShowProfileModal(true)}>
            ⚙ Profile &amp; PAN
          </button>
          <button className="db-logout-btn" onClick={() => { logout(); nav('/'); }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="db-main">
        {/* TOPBAR */}
        <div className="db-topbar">
          <div>
            <h1 className="db-page-title">
              {{ dashboard:'Dashboard', holdings:'Holdings', dividends:'Dividend Tracker',
                 transactions:'Transaction History', tax:'Tax Summary' }[tab]}
            </h1>
            <p className="db-page-sub">
              {emailStatus.length > 0
                ? `Last synced ${emailStatus[0].last_synced ? new Date(emailStatus[0].last_synced).toLocaleString('en-IN') : 'never'}`
                : 'No email connected yet'}
            </p>
          </div>
          <div className="db-topbar-right">
            {emailStatus.length > 0 && (
              <button className="db-sync-btn" onClick={syncEmails} disabled={syncing}>
                {syncing ? '⟳ Syncing…' : '⟳ Sync Emails'}
              </button>
            )}
            <div className="db-live-badge">● Live · NSE</div>
          </div>
        </div>

        {syncResult && (
          <div className={`db-banner ${syncResult.success !== false ? 'success' : 'error'}`}>
            {syncResult.success !== false
              ? `✅ Sync complete! Found ${syncResult.tradesFound || 0} trades, ${syncResult.dividendsFound || 0} dividends from ${syncResult.emailsFound || 0} emails.`
              : `❌ ${syncResult.message}`}
            <button onClick={() => setSyncResult(null)} style={{marginLeft:'auto',background:'none',border:'none',color:'inherit',cursor:'pointer'}}>✕</button>
          </div>
        )}

        <div className="db-content">
          {/* DASHBOARD */}
          {tab === 'dashboard' && (
            <div className="fade-in">
              {/* Stats */}
              <div className="db-stats-grid">
                {[
                  { label:'Portfolio Value', val: fmt(s.totalMarket || 0), sub: `${pct(s.totalPnlPct || 0)} since cost`, color:'blue' },
                  { label:'Total Invested', val: fmt(s.totalCost || 0), sub: `${s.holdingsCount || 0} holdings`, color:'green' },
                  { label:'Dividend Income FY26', val: fmt(s.totalDividend || 0), sub: `${s.yieldOnMarket || 0}% yield on market`, color:'gold' },
                  { label:'Unrealised P&L', val: fmt(s.totalPnl || 0), sub: pct(s.totalPnlPct || 0), color: s.totalPnl >= 0 ? 'green' : 'red' },
                ].map(c => (
                  <div key={c.label} className={`db-stat-card ${c.color}`}>
                    <div className="db-stat-label">{c.label}</div>
                    <div className={`db-stat-val ${c.color}`}>{c.val}</div>
                    <div className="db-stat-sub">{c.sub}</div>
                  </div>
                ))}
              </div>

              {/* No email connected prompt */}
              {emailStatus.length === 0 && (
                <div className="db-connect-prompt">
                  <div className="db-connect-prompt-icon">📬</div>
                  <div>
                    <strong>Connect your email to auto-sync your portfolio</strong>
                    <p>We'll read your broker emails to track trades, dividends & holdings automatically.</p>
                  </div>
                  <button className="db-connect-btn-inline" onClick={() => setShowConnectModal(true)}>
                    Connect Gmail →
                  </button>
                </div>
              )}

              {/* Charts */}
              <div className="db-grid-3">
                <div className="db-card">
                  <div className="db-card-header">
                    <div className="db-card-title">Portfolio Growth</div>
                    <div className="db-card-sub">Cost vs Market value</div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={growthData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="mktGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00d4a1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#00d4a1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" stroke="#4a5a7a" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#4a5a7a" tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/100000).toFixed(1)}L`} />
                      <Tooltip formatter={v => fmtFull(v)} contentStyle={{ background:'#141b2d', border:'1px solid #1a2235', borderRadius:8 }} />
                      <Area type="monotone" dataKey="cost" stroke="#4a5a7a" strokeWidth={1.5} strokeDasharray="4 3" fill="transparent" />
                      <Area type="monotone" dataKey="market" stroke="#00d4a1" strokeWidth={2.5} fill="url(#mktGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="db-card">
                  <div className="db-card-header">
                    <div className="db-card-title">Sector Split</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'12px 0' }}>
                    <PieChart width={160} height={160}>
                      <Pie data={sectorData} cx={75} cy={75} innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value">
                        {sectorData.map((entry) => (
                          <Cell key={entry.name} fill={SECTOR_COLORS[entry.name] || '#6b7280'} />
                        ))}
                      </Pie>
                    </PieChart>
                    <div style={{ width:'100%', padding:'0 16px' }}>
                      {sectorData.map(s => (
                        <div key={s.name} className="db-legend-row">
                          <span className="db-legend-dot" style={{ background: SECTOR_COLORS[s.name] || '#6b7280' }}></span>
                          <span className="db-legend-label">{s.name}</span>
                          <span className="db-legend-val">{fmt(s.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Holdings */}
              <div className="db-card" style={{ marginTop: 20 }}>
                <div className="db-card-header">
                  <div className="db-card-title">Top Holdings</div>
                  <button className="db-card-action" onClick={() => loadTab('holdings')}>View all →</button>
                </div>
                <div style={{overflowX:'auto'}}>
                <table className="db-table">
                  <thead>
                    <tr>
                      <th>Stock</th><th>Qty</th><th className="right">Avg Cost</th>
                      <th className="right">LTP</th><th className="right">Value</th><th className="right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.slice(0, 8).map(h => (
                      <tr key={h.symbol}>
                        <td><div className="db-stock-name">{h.company || h.symbol}</div><div className="db-stock-sym">{h.symbol}</div></td>
                        <td>{h.quantity}</td>
                        <td className="right mono">₹{Number(h.avg_cost).toFixed(2)}</td>
                        <td className="right mono">₹{Number(h.ltp).toFixed(2)}</td>
                        <td className="right mono">{fmt(h.marketValue)}</td>
                        <td className={`right mono ${h.pnl >= 0 ? 'pos' : 'neg'}`}>{pct(h.pnlPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* HOLDINGS */}
          {tab === 'holdings' && (
            <div className="fade-in db-card">
              <div className="db-card-header">
                <div className="db-card-title">All Holdings ({holdings.length})</div>
              </div>
              <div style={{overflowX:'auto'}}>
              <table className="db-table">
                <thead>
                  <tr>
                    <th>Stock</th><th>Sector</th><th className="right">Qty</th>
                    <th className="right">Avg Cost</th><th className="right">LTP</th>
                    <th className="right">Market Val</th><th className="right">P&L</th>
                    <th className="right">Div Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => (
                    <tr key={h.symbol}>
                      <td><div className="db-stock-name">{h.company || h.symbol}</div><div className="db-stock-sym">{h.symbol}</div></td>
                      <td><span className={`db-tag tag-${(h.sector||'').toLowerCase()}`}>{h.sector}</span></td>
                      <td className="right">{h.quantity}</td>
                      <td className="right mono">₹{Number(h.avg_cost).toFixed(2)}</td>
                      <td className="right mono">₹{Number(h.ltp).toFixed(2)}</td>
                      <td className="right mono">{fmt(h.marketValue)}</td>
                      <td className={`right mono ${h.pnl >= 0 ? 'pos' : 'neg'}`}>
                        {h.pnl >= 0 ? '+' : ''}{fmt(h.pnl)} ({pct(h.pnlPct)})
                      </td>
                      <td className="right">
                        <span className={`db-yield-badge ${h.dividendYieldOnCost >= 3 ? 'hi' : h.dividendYieldOnCost >= 1 ? 'md' : 'lo'}`}>
                          {h.dividendYieldOnCost > 0 ? h.dividendYieldOnCost + '%' : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {holdings.length === 0 && (
                    <tr><td colSpan="8" className="db-empty">No holdings yet. Connect your email to sync automatically.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* DIVIDENDS */}
          {tab === 'dividends' && (
            <div className="fade-in">
              <div className="db-stats-grid" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
                <div className="db-stat-card gold">
                  <div className="db-stat-label">Total Dividend FY26</div>
                  <div className="db-stat-val gold">{fmtFull(dividends.totalIncome)}</div>
                </div>
                <div className="db-stat-card green">
                  <div className="db-stat-label">Yield on Cost</div>
                  <div className="db-stat-val green">{s.yieldOnCost || 0}%</div>
                </div>
                <div className="db-stat-card blue">
                  <div className="db-stat-label">Yield on Market</div>
                  <div className="db-stat-val blue">{s.yieldOnMarket || 0}%</div>
                </div>
              </div>
              <div className="db-card" style={{marginTop:20}}>
                <div className="db-card-header">
                  <div className="db-card-title">Dividend History</div>
                  <div className="db-card-sub">Parsed from email alerts</div>
                </div>
                <table className="db-table">
                  <thead>
                    <tr><th>Company</th><th className="right">Amount/Share</th><th className="right">Qty</th><th className="right">Total</th><th>Date</th><th>Source</th></tr>
                  </thead>
                  <tbody>
                    {dividends.dividends.map((d, i) => (
                      <tr key={i}>
                        <td><div className="db-stock-name">{d.company}</div></td>
                        <td className="right mono">₹{d.dividend_per_share || '—'}</td>
                        <td className="right">{d.quantity || '—'}</td>
                        <td className="right mono pos">+{fmtFull(d.total_amount)}</td>
                        <td style={{color:'var(--text3)', fontSize:12}}>{d.credit_date ? new Date(d.credit_date).toLocaleDateString('en-IN') : '—'}</td>
                        <td style={{color:'var(--text3)', fontSize:12}}>{d.source}</td>
                      </tr>
                    ))}
                    {dividends.dividends.length === 0 && (
                      <tr><td colSpan="6" className="db-empty">No dividends synced yet. Connect your email and sync.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TRANSACTIONS */}
          {tab === 'transactions' && (
            <div className="fade-in db-card">
              <div className="db-card-header">
                <div className="db-card-title">Transaction History</div>
                <div className="db-card-sub">Parsed from broker contract note emails</div>
              </div>
              <table className="db-table">
                <thead>
                  <tr><th>Type</th><th>Symbol</th><th className="right">Qty</th><th className="right">Price</th><th className="right">Value</th><th>Broker</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={i}>
                      <td><span className={`db-tx-badge ${t.type === 'BUY' ? 'buy' : 'sell'}`}>{t.type}</span></td>
                      <td><div className="db-stock-name">{t.symbol}</div></td>
                      <td className="right">{t.quantity}</td>
                      <td className="right mono">₹{Number(t.price).toFixed(2)}</td>
                      <td className={`right mono ${t.type === 'BUY' ? 'neg' : 'pos'}`}>
                        {t.type === 'SELL' ? '+' : '-'}{fmtFull(t.quantity * t.price)}
                      </td>
                      <td style={{color:'var(--text3)', fontSize:12}}>{t.broker}</td>
                      <td style={{color:'var(--text3)', fontSize:12}}>{t.trade_date ? new Date(t.trade_date).toLocaleDateString('en-IN') : '—'}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr><td colSpan="7" className="db-empty">No transactions yet. Connect your email to auto-import.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAX */}
          {tab === 'tax' && tax && (
            <div className="fade-in">
              <div className="db-stats-grid">
                <div className="db-stat-card gold">
                  <div className="db-stat-label">STCG (&lt; 1 Year)</div>
                  <div className="db-stat-val gold">{fmtFull(tax.stcg)}</div>
                  <div className="db-stat-sub">Tax @20%: {fmtFull(tax.stcgTax)}</div>
                </div>
                <div className="db-stat-card green">
                  <div className="db-stat-label">LTCG (> 1 Year)</div>
                  <div className="db-stat-val green">{fmtFull(tax.ltcg)}</div>
                  <div className="db-stat-sub">Exempt up to ₹1.25L</div>
                </div>
                <div className="db-stat-card blue">
                  <div className="db-stat-label">Dividend Income</div>
                  <div className="db-stat-val blue">{fmtFull(tax.dividendIncome)}</div>
                  <div className="db-stat-sub">TDS: {fmtFull(tax.tdsDeducted)}</div>
                </div>
                <div className="db-stat-card red">
                  <div className="db-stat-label">Net Tax Liability</div>
                  <div className="db-stat-val" style={{color:'var(--red)'}}>{fmtFull(tax.stcgTax + tax.ltcgTax)}</div>
                  <div className="db-stat-sub">STCG + LTCG taxable</div>
                </div>
              </div>
              <div className="db-card" style={{marginTop:20,padding:20}}>
                <div className="db-card-title" style={{marginBottom:12}}>Important Notes</div>
                {[
                  'LTCG up to ₹1,25,000 per year is exempt from tax (Section 112A)',
                  'LTCG above ₹1.25L is taxed at 12.5% without indexation benefit',
                  'STCG on equity is taxed at 20% (increased from 15% in Budget 2024)',
                  'Dividend income is added to your total income and taxed at slab rate',
                  'TDS @10% is deducted by companies if dividend exceeds ₹5,000 per company',
                  'Consult a CA for final filing — these are estimates based on your email data',
                ].map((note, i) => (
                  <div key={i} style={{display:'flex',gap:10,marginBottom:10,fontSize:13,color:'var(--text2)'}}>
                    <span style={{color:'var(--accent)',flexShrink:0}}>→</span> {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* EMAIL CONNECT MODAL */}
      {showConnectModal && (
        <div className="db-modal-overlay" onClick={e => { if(e.target === e.currentTarget) setShowConnectModal(false); }}>
          <div className="db-modal fade-in">
            <button className="db-modal-close" onClick={() => setShowConnectModal(false)}>✕</button>

            {connectStep === 'choose' && (<>
              <div className="db-modal-title">Connect Your Email</div>
              <div className="db-modal-sub">StockPilot reads your broker emails to automatically track your portfolio. Read-only access, no email modification.</div>
              <div className="db-email-options">
                <div className="db-email-option" onClick={connectGmail}>
                  <span style={{fontSize:28}}>📧</span>
                  <div><div style={{fontWeight:600}}>Gmail</div><div style={{fontSize:12,color:'var(--text2)'}}>Google OAuth 2.0 — read-only</div></div>
                  <span style={{marginLeft:'auto',color:'var(--text3)'}}>→</span>
                </div>
                <div className="db-email-option" style={{opacity:0.5,cursor:'not-allowed'}}>
                  <span style={{fontSize:28}}>📨</span>
                  <div><div style={{fontWeight:600}}>Outlook</div><div style={{fontSize:12,color:'var(--text2)'}}>Coming soon</div></div>
                </div>
                <div className="db-email-option" style={{opacity:0.5,cursor:'not-allowed'}}>
                  <span style={{fontSize:28}}>📩</span>
                  <div><div style={{fontWeight:600}}>Yahoo Mail</div><div style={{fontSize:12,color:'var(--text2)'}}>Coming soon</div></div>
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--text3)',textAlign:'center',marginTop:16,lineHeight:1.6}}>
                🔒 We only read emails. We never send, delete, or modify any emails.
              </div>
            </>)}

            {connectStep === 'connecting' && (
              <div style={{textAlign:'center',padding:'30px 0'}}>
                <div className="db-spinner" style={{margin:'0 auto 16px'}}></div>
                <div style={{fontSize:16,fontWeight:600}}>Redirecting to Google…</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PROFILE MODAL ── */}
      {showProfileModal && (
        <div className="db-modal-overlay" onClick={e => { if(e.target===e.currentTarget) setShowProfileModal(false); }}>
          <div className="db-modal" style={{maxWidth:420}}>
            <div className="db-modal-header">
              <h3>Profile &amp; PDF Settings</h3>
              <button className="db-modal-close" onClick={() => setShowProfileModal(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <p style={{color:'#64748b',fontSize:12,marginBottom:16,lineHeight:1.5}}>
                Required to unlock password-protected PDFs from CDSL, NSDL and brokers.
                Gemini AI uses your PAN + DOB to generate the correct password automatically.
              </p>

              <div style={{marginBottom:14}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>FULL NAME</label>
                <input className="db-input" placeholder="As per PAN card e.g. HAREESH RAVICHANDRAN"
                  value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} />
              </div>

              <div style={{marginBottom:14}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>PAN NUMBER</label>
                <input className="db-input" placeholder="e.g. ABCDE1234F" maxLength={10}
                  value={profile.pan} onChange={e => setProfile({...profile, pan: e.target.value.toUpperCase()})} />
                <span style={{color:'#475569',fontSize:11,marginTop:3,display:'block'}}>Used to unlock CDSL/NSDL CAS PDFs</span>
              </div>

              <div style={{marginBottom:14}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>DATE OF BIRTH</label>
                <input className="db-input" type="date"
                  value={profile.dob} onChange={e => setProfile({...profile, dob: e.target.value})} />
                <span style={{color:'#475569',fontSize:11,marginTop:3,display:'block'}}>Used for ICICI Direct, HDFC Sec password formats</span>
              </div>

              <div style={{marginBottom:20}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>MOBILE (optional)</label>
                <input className="db-input" placeholder="10-digit mobile number"
                  value={profile.mobile} onChange={e => setProfile({...profile, mobile: e.target.value})} />
                <span style={{color:'#475569',fontSize:11,marginTop:3,display:'block'}}>Used for 5paisa and some other brokers</span>
              </div>

              {profileError && <div style={{color:'#f43f5e',fontSize:12,marginBottom:12,padding:'6px 10px',background:'#1a0a0e',borderRadius:4}}>{profileError}</div>}
              {profileSaved && <div style={{color:'#00d4a1',fontSize:12,marginBottom:12,padding:'6px 10px',background:'#0a2a1a',borderRadius:4}}>✓ Profile saved successfully</div>}

              <button className="db-sync-btn" style={{width:'100%'}} onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>

              <div style={{marginTop:16,padding:'10px 12px',background:'#0a1628',borderRadius:6,border:'1px solid #1e3a5f'}}>
                <div style={{color:'#0ea5e9',fontSize:11,fontWeight:700,marginBottom:4}}>HOW PDF PASSWORDS WORK</div>
                <div style={{color:'#64748b',fontSize:11,lineHeight:1.6}}>
                  1. Gemini AI reads the email body for password hints<br/>
                  2. Combines your PAN + DOB + Name to generate candidates<br/>
                  3. Tries each until the PDF opens<br/>
                  4. Falls back to rule-based patterns if AI fails
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
