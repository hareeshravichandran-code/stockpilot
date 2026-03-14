import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api, { portfolioAPI, emailAPI, authAPI, incomeAPI, mfAPI } from '../lib/api';
import AdminPanel from './AdminPanel';
import Dividends from './Dividends';
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
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectStep, setConnectStep] = useState('choose');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profile, setProfile] = useState({ pan: '', dob: '', mobile: '', name: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [showAddStock, setShowAddStock]     = useState(false);
  const [stockSearch, setStockSearch]       = useState('');
  const [stockResults, setStockResults]     = useState([]);
  const [selectedStock, setSelectedStock]   = useState(null);
  const [stockQty, setStockQty]             = useState('');
  const [stockCost, setStockCost]           = useState('');
  const [stockSaving, setStockSaving]       = useState(false);
  const [stockSaved, setStockSaved]         = useState(false);
  const [stockError, setStockError]         = useState('');
  const [searchLoading, setSearchLoading]   = useState(false);

  // ── Mutual Funds state ───────────────────────────────────────────
  const [mfData, setMfData]               = useState(null);
  const [mfLoading, setMfLoading]         = useState(false);
  const [mfRequestSent, setMfRequestSent] = useState(null);
  const [mfSyncing, setMfSyncing]         = useState(false);

  // ── Income Settings state ────────────────────────────────────────
  const [showIncomeSettings, setShowIncomeSettings] = useState(false);
  const [incomeRules, setIncomeRules]               = useState([]);
  const [incomeSummary, setIncomeSummary]           = useState({ currentFYTotal:0, thisMonthTotal:0, byCategory:{} });
  const [incomeEntries, setIncomeEntries]           = useState([]);
  const [incomeScanning, setIncomeScanning]         = useState(false);
  const [incomeScanResult, setIncomeScanResult]     = useState(null);
  const [showRuleForm, setShowRuleForm]             = useState(false);
  const [editingRule, setEditingRule]               = useState(null);
  const [ruleForm, setRuleForm] = useState({
    rule_name:'', category:'Salary', bank_sender:'', subject_pattern:'',
    body_pattern:'', account_last4:'', min_amount:'', period:'monthly', remark:''
  });
  const [ruleSaving, setRuleSaving]   = useState(false);
  const [ruleError, setRuleError]     = useState('');
  const INCOME_CATS = ['Salary','Freelance','Rental','Business','Interest','Bonus','Other'];
  const [liabilities, setLiabilities] = useState({ homeLoan: 0, creditCard: 0 });
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [dividendTotal, setDividendTotal] = useState(0);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetBalances, setAssetBalances] = useState({ ppf: 0, epf: 0, nps: 0, fd: 0, ssy: 0 });
  const [assetForm, setAssetForm] = useState({ ppf: '', epf: '', nps: '', fd: '', ssy: '', homeLoan: '', creditCard: '', salary: '' });
  const [assetSaving, setAssetSaving] = useState(false);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await portfolioAPI.get();
      setPortfolio(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadPortfolio();
    emailAPI.status().then(r => setEmailStatus(r.data.connections || [])).catch(() => {});

    // Load dividend total for dashboard tile — from dividend_income table
    api.get('/api/dividends').then(r => {
      const d = r.data;
      // API returns summary.currentFY for FY2026 total
      setDividendTotal(d.summary?.currentFY || d.summary?.totalAllTime || 0);
    }).catch(() => {});

    // Load asset balances from API
    api.get('/api/portfolio/assets').then(r => {
      const d = r.data;
      setAssetBalances({ ppf: d.ppf||0, epf: d.epf||0, nps: d.nps||0, fd: d.fd||0, ssy: d.ssy||0 });
      setLiabilities({ homeLoan: d.home_loan||0, creditCard: d.credit_card||0 });
      setMonthlyIncome(d.monthly_income||0);
      setAssetForm({
        ppf: d.ppf||'', epf: d.epf||'', nps: d.nps||'', fd: d.fd||'', ssy: d.ssy||'',
        homeLoan: d.home_loan||'', creditCard: d.credit_card||'', salary: d.monthly_income||''
      });
    }).catch(() => {});

    // Load income summary for dashboard tile
    incomeAPI.getEntries().then(r => {
      setIncomeSummary(r.data.summary || { currentFYTotal:0, thisMonthTotal:0, byCategory:{} });
    }).catch(() => {});

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
    if (t === 'dividends') { return; // Dividends component loads its own data
      const r = await portfolioAPI.dividends().catch(() => ({ data: { dividends: [], totalIncome: 0 } }));
      setDividends(r.data);
    }
    if (t === 'tax' && !tax) {
      const r = await portfolioAPI.tax().catch(() => ({ data: {} }));
      setTax(r.data);
    }
    if (t === 'mutualfunds' && !mfData) {
      setMfLoading(true);
      mfAPI.get().then(r => setMfData(r.data)).catch(() => {}).finally(() => setMfLoading(false));
    }
  };

  const connectGmail = async () => {
    setConnectStep('connecting');
    try {
      const r = await emailAPI.connectGmail();
      // Open OAuth in new tab so JWT in localStorage is preserved
      const popup = window.open(r.data.url, '_blank', 'width=500,height=600');
      // Poll every 3s to check if Gmail got connected
      const poll = setInterval(async () => {
        try {
          const s = await emailAPI.status();
          const connected = (s.data.connections || []).find(c => c.provider === 'gmail');
          if (connected) {
            clearInterval(poll);
            setShowConnectModal(false);
            setConnectStep('choose');
            setSyncResult({ success: null, message: 'Gmail connected! Click Sync Emails to import your CAS.' });
            if (popup) popup.close();
          }
        } catch(e) {}
      }, 3000);
      // Stop polling after 3 minutes
      setTimeout(() => clearInterval(poll), 180000);
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
    } catch (e) {
      const isTimeout = !e.response || e.code === 'ECONNABORTED';
      const msg = isTimeout
        ? 'Sync timed out — please try again. First sync can take up to a minute.'
        : (e.response?.data?.message || e.response?.data?.error || 'Sync failed');
      setSyncResult({ success: false, message: msg });
    } finally {
      setSyncing(false);
      // Always reload — holdings may have been saved even if sync returned an error
      await loadPortfolio();
      if (tab === 'holdings') await loadTab('holdings');
    }
  };

  const syncPrices = async () => {
    setSyncingPrices(true); setSyncResult(null);
    try {
      const r = await portfolioAPI.syncPrices();
      setSyncResult({ success: true, message: r.data.message });
      await loadPortfolio();
    } catch (e) {
      setSyncResult({ success: false, message: e.response?.data?.error || 'Price sync failed' });
    } finally { setSyncingPrices(false); }
  };

  // ── Income handlers ──────────────────────────────────────────────
  const loadIncome = async () => {
    try {
      const [rulesRes, entriesRes] = await Promise.all([
        incomeAPI.getRules(), incomeAPI.getEntries()
      ]);
      setIncomeRules(rulesRes.data || []);
      setIncomeEntries(entriesRes.data.entries || []);
      setIncomeSummary(entriesRes.data.summary || { currentFYTotal:0, thisMonthTotal:0, byCategory:{} });
    } catch(e) { console.error('loadIncome', e); }
  };

  const openIncomeSettings = () => {
    setShowIncomeSettings(true);
    setShowRuleForm(false);
    setEditingRule(null);
    setIncomeScanResult(null);
    loadIncome();
  };

  const scanIncome = async () => {
    setIncomeScanning(true); setIncomeScanResult(null);
    try {
      const r = await incomeAPI.scan();
      setIncomeScanResult({ success: true, message: r.data.message, found: r.data.found });
      if (r.data.found > 0) await loadIncome();
    } catch(e) {
      setIncomeScanResult({ success: false, message: e.response?.data?.error || 'Scan failed' });
    } finally { setIncomeScanning(false); }
  };

  const openRuleForm = (rule = null) => {
    if (rule) {
      setRuleForm({
        rule_name: rule.rule_name || '', category: rule.category || 'Salary',
        bank_sender: rule.bank_sender || '', subject_pattern: rule.subject_pattern || '',
        body_pattern: rule.body_pattern || '', account_last4: rule.account_last4 || '',
        min_amount: rule.min_amount || '', period: rule.period || 'monthly', remark: rule.remark || ''
      });
      setEditingRule(rule);
    } else {
      setRuleForm({ rule_name:'', category:'Salary', bank_sender:'', subject_pattern:'',
        body_pattern:'', account_last4:'', min_amount:'', period:'monthly', remark:'' });
      setEditingRule(null);
    }
    setRuleError('');
    setShowRuleForm(true);
  };

  const saveRule = async () => {
    if (!ruleForm.rule_name.trim()) { setRuleError('Rule name is required'); return; }
    if (!ruleForm.bank_sender && !ruleForm.subject_pattern && !ruleForm.body_pattern)
      { setRuleError('At least one filter is required (sender, subject, or body keyword)'); return; }
    setRuleSaving(true); setRuleError('');
    try {
      if (editingRule) {
        await incomeAPI.updateRule(editingRule.id, ruleForm);
      } else {
        await incomeAPI.createRule(ruleForm);
      }
      setShowRuleForm(false);
      await loadIncome();
    } catch(e) {
      setRuleError(e.response?.data?.error || 'Save failed');
    } finally { setRuleSaving(false); }
  };

  const deleteRule = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    await incomeAPI.deleteRule(id).catch(() => {});
    await loadIncome();
  };
  const handleStockSearch = async (val) => {
    setStockSearch(val);
    setSelectedStock(null);
    if (val.trim().length < 1) { setStockResults([]); return; }
    setSearchLoading(true);
    try {
      const r = await portfolioAPI.searchStocks(val);
      setStockResults(r.data || []);
    } catch(e) { setStockResults([]); }
    finally { setSearchLoading(false); }
  };

  const handleSelectStock = (stock) => {
    setSelectedStock(stock);
    setStockSearch(stock.company);
    setStockResults([]);
  };

  const handleSaveStock = async () => {
    if (!selectedStock) { setStockError('Please select a stock from the list'); return; }
    if (!stockQty || parseInt(stockQty) <= 0) { setStockError('Enter a valid quantity'); return; }
    setStockSaving(true); setStockError('');
    try {
      await portfolioAPI.addHolding({
        symbol:   selectedStock.symbol,
        isin:     selectedStock.isin,
        company:  selectedStock.company,
        sector:   selectedStock.sector,
        quantity: parseInt(stockQty),
        avgCost:  stockCost ? parseFloat(stockCost) : 0,
      });
      setStockSaved(true);
      await loadPortfolio();
      setTimeout(() => {
        setShowAddStock(false);
        setStockSaved(false);
        setSelectedStock(null);
        setStockSearch('');
        setStockQty('');
        setStockCost('');
      }, 1200);
    } catch(e) {
      setStockError(e.response?.data?.error || 'Failed to save. Try again.');
    } finally { setStockSaving(false); }
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
            { id:'holdings',     icon:'◈', label:'Stock Holdings' },
            { id:'mutualfunds',  icon:'◉', label:'Mutual Funds' },
            { id:'dividends',    icon:'◎', label:'Dividends' },
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
              {{ dashboard:'Dashboard', holdings:'Stock Holdings', dividends:'Dividend Tracker',
                 transactions:'Transaction History', tax:'Tax Summary', mutualfunds:'Mutual Funds' }[tab]}
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
                {syncing ? '⟳ Syncing… (up to 60s)' : '⟳ Sync Emails'}
              </button>
            )}
            <button className="db-sync-btn" onClick={syncPrices} disabled={syncingPrices}
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.3)', color: '#0ea5e9' }}>
              {syncingPrices ? '⟳ Syncing…' : '⟳ Sync Yahoo'}
            </button>
            <div className="db-live-badge">● Live · NSE</div>
          </div>
        </div>

        {syncResult && (
          <div className={`db-banner ${syncResult.success === true ? 'success' : syncResult.success === false ? 'error' : 'info'}`}>
            {syncResult.success === true
              ? syncResult.holdingsSaved != null
                ? `✅ Synced ${syncResult.holdingsSaved} holdings from ${syncResult.casType || 'CAS'}`
                : `✅ ${syncResult.message || 'Sync complete!'}`
              : syncResult.success === false
              ? `❌ ${syncResult.message}`
              : `ℹ️ ${syncResult.message}`}
            <button onClick={() => setSyncResult(null)} style={{marginLeft:'auto',background:'none',border:'none',color:'inherit',cursor:'pointer'}}>✕</button>
          </div>
        )}

        <div className="db-content">
          {/* DASHBOARD */}
          {tab === 'dashboard' && (
            <div className="fade-in">
              {/* ── Phase 1: 5 Tiles ── */}
              {(() => {
                const stocksVal = s.totalMarket || 0;
                const otherAssets = (assetBalances.ppf||0) + (assetBalances.epf||0) + (assetBalances.nps||0) + (assetBalances.fd||0) + (assetBalances.ssy||0);
                const totalNetWorth = stocksVal + otherAssets;
                const totalCredit = (liabilities.homeLoan||0) + (liabilities.creditCard||0);

                const pieData = [
                  { name: 'Stocks', value: stocksVal, color: '#64ffda' },
                  { name: 'PPF', value: assetBalances.ppf||0, color: '#ffd700' },
                  { name: 'EPF', value: assetBalances.epf||0, color: '#00bcd4' },
                  { name: 'NPS', value: assetBalances.nps||0, color: '#b39ddb' },
                  { name: 'FD', value: assetBalances.fd||0, color: '#ff8a65' },
                  { name: 'SSY', value: assetBalances.ssy||0, color: '#f48fb1' },
                ].filter(d => d.value > 0);

                const growthData = [
                  { fy: 'FY22', value: 520000 },
                  { fy: 'FY23', value: 780000 },
                  { fy: 'FY24', value: 1050000 },
                  { fy: 'FY25', value: 1194517 },
                  { fy: 'FY26', value: totalNetWorth || 1409134 },
                ];

                return (<>
                  {/* Top 5 tiles */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
                    {[
                      { label:'Total Net Worth', val: fmt(totalNetWorth), sub:'All assets combined', color:'#64ffda', icon:'💰' },
                      { label:'Dividend Income FY26', val: fmt(dividendTotal||0), sub: dividendTotal > 0 ? `${s.yieldOnMarket||0}% yield on market` : 'Sync dividends to update', color:'#ffd700', icon:'💸' },
                      { label:'Outstanding Credit', val: fmt(totalCredit), sub:'Loans + Credit Cards', color: totalCredit > 0 ? '#ff6b6b':'#888', icon:'🏦' },
                      { label:'Monthly Income', val: fmt(monthlyIncome), sub:'Salary this month', color:'#00bcd4', icon:'💼' },
                      { label:'This Month Expenses', val: fmt(monthlyExpenses), sub:'From transactions', color: monthlyExpenses > monthlyIncome*0.8 ? '#ff8a65':'#b39ddb', icon:'🧾' },
                    ].map(t => (
                      <div key={t.label} style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:'16px 14px', border:'1px solid rgba(255,255,255,0.08)', cursor:'default' }}>
                        <div style={{ fontSize:20, marginBottom:6 }}>{t.icon}</div>
                        <div style={{ fontSize:11, color:'#888', marginBottom:4 }}>{t.label}</div>
                        <div style={{ fontSize:20, fontWeight:700, color:t.color }}>{t.val}</div>
                        <div style={{ fontSize:11, color:'#555', marginTop:4 }}>{t.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Update balances button */}
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
                    <button onClick={() => setShowAssetModal(true)} style={{
                      background:'rgba(100,255,218,0.08)', border:'1px solid rgba(100,255,218,0.2)',
                      color:'#64ffda', borderRadius:8, padding:'7px 14px', cursor:'pointer', fontSize:12, fontWeight:600
                    }}>⚙ Update PPF/EPF/NPS/FD balances</button>
                  </div>

                  {/* Charts row */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1.8fr', gap:16, marginBottom:20 }}>
                    {/* Pie Chart */}
                    <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20, border:'1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight:600, color:'#aaa', fontSize:13, marginBottom:12 }}>📊 Asset Allocation</div>
                      {pieData.length > 0 ? (
                        <>
                          <PieChart width={200} height={180}>
                            <Pie data={pieData} cx={100} cy={90} innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={2}>
                              {pieData.map((d,i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background:'#1a1a2e', border:'1px solid #333', borderRadius:8, fontSize:12 }} />
                          </PieChart>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 12px', marginTop:8 }}>
                            {pieData.map(d => (
                              <div key={d.name} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11 }}>
                                <div style={{ width:8, height:8, borderRadius:'50%', background:d.color }} />
                                <span style={{ color:'#aaa' }}>{d.name}</span>
                                <span style={{ color:'#666' }}>{totalNetWorth > 0 ? ((d.value/totalNetWorth)*100).toFixed(0)+'%' : '-'}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ color:'#555', fontSize:12, textAlign:'center', paddingTop:40 }}>No asset data yet</div>
                      )}
                    </div>

                    {/* Growth Chart */}
                    <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20, border:'1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight:600, color:'#aaa', fontSize:13, marginBottom:12 }}>📈 Portfolio Growth (Yearly)</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={growthData} margin={{ top:5, right:10, left:0, bottom:0 }}>
                          <defs>
                            <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#64ffda" stopOpacity={0.25}/>
                              <stop offset="95%" stopColor="#64ffda" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="fy" stroke="#444" tick={{ fill:'#888', fontSize:11 }} />
                          <YAxis stroke="#444" tick={{ fill:'#888', fontSize:10 }} tickFormatter={v => '₹'+(v/100000).toFixed(0)+'L'} />
                          <Tooltip formatter={v => [fmt(v), 'Net Worth']} contentStyle={{ background:'#1a1a2e', border:'1px solid #333', borderRadius:8, fontSize:12 }} />
                          <Area type="monotone" dataKey="value" stroke="#64ffda" strokeWidth={2} fill="url(#growthGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* CAS date */}
                  {s.casDate && (
                    <div style={{ fontSize:'12px', color:'#555', textAlign:'right', marginBottom:8 }}>
                      📋 Stock holdings as per CAS dated {new Date(s.casDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })} ({s.casSource})
                    </div>
                  )}
                </>);
              })()}

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
                  <div className="db-card-title">Top Stock Holdings</div>
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

          {/* STOCK HOLDINGS */}
          {tab === 'holdings' && (() => {
            const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0);

            // Sector allocation pie data
            const sectorAlloc = Object.entries(
              holdings.reduce((acc, h) => {
                const sec = h.sector || 'Other';
                acc[sec] = (acc[sec] || 0) + h.marketValue;
                return acc;
              }, {})
            ).map(([name, value]) => ({ name, value: Math.round(value) }))
             .sort((a, b) => b.value - a.value);

            // Holdings growth — top 10 by value as bar-style area
            const topHoldings = [...holdings]
              .sort((a, b) => b.marketValue - a.marketValue)
              .slice(0, 10)
              .map(h => ({ name: h.symbol, value: Math.round(h.marketValue) }));

            const COLORS = ['#00d4a1','#0ea5e9','#f59e0b','#a78bfa','#f43f5e',
                            '#34d399','#fb923c','#818cf8','#e879f9','#4ade80'];

            return (
              <div className="fade-in">
                {/* Charts row */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gap:16, marginBottom:20 }}>

                  {/* Sector Allocation Pie */}
                  <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20, border:'1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14, marginBottom:16 }}>📊 Sector Allocation</div>
                    {sectorAlloc.length > 0 ? (
                      <>
                        <div style={{ display:'flex', justifyContent:'center' }}>
                          <PieChart width={200} height={200}>
                            <Pie data={sectorAlloc} cx={100} cy={100} innerRadius={55} outerRadius={90}
                              dataKey="value" paddingAngle={2}>
                              {sectorAlloc.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={v => fmt(v)}
                              contentStyle={{ background:'#1a1a2e', border:'1px solid #333', borderRadius:8, fontSize:12 }} />
                          </PieChart>
                        </div>
                        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                          {sectorAlloc.map((d, i) => (
                            <div key={d.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:12 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                                <div style={{ width:9, height:9, borderRadius:'50%', background:COLORS[i % COLORS.length], flexShrink:0 }} />
                                <span style={{ color:'#cbd5e1' }}>{d.name}</span>
                              </div>
                              <div style={{ display:'flex', gap:10 }}>
                                <span style={{ color:'#64748b', fontSize:11 }}>
                                  {totalValue > 0 ? ((d.value / totalValue) * 100).toFixed(1) : 0}%
                                </span>
                                <span style={{ color:'#94a3b8', fontWeight:600 }}>{fmt(d.value)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ color:'#475569', fontSize:12, textAlign:'center', paddingTop:60 }}>
                        Sync Yahoo to populate sectors
                      </div>
                    )}
                  </div>

                  {/* Holdings Growth — top 10 bar chart */}
                  <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20, border:'1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                      <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14 }}>📈 Top Holdings by Value</div>
                      <div style={{ fontSize:11, color:'#475569' }}>Current market value</div>
                    </div>
                    {topHoldings.length > 0 ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {topHoldings.map((h, i) => {
                          const pct = totalValue > 0 ? (h.value / totalValue * 100) : 0;
                          return (
                            <div key={h.name}>
                              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                                <span style={{ color:'#cbd5e1', fontWeight:600 }}>{h.name}</span>
                                <div style={{ display:'flex', gap:12 }}>
                                  <span style={{ color:'#64748b' }}>{pct.toFixed(1)}%</span>
                                  <span style={{ color:'#00d4a1', fontWeight:700 }}>{fmt(h.value)}</span>
                                </div>
                              </div>
                              <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                                <div style={{
                                  height:'100%', width:`${pct}%`, borderRadius:3,
                                  background: COLORS[i % COLORS.length],
                                  transition:'width 0.6s ease'
                                }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color:'#475569', fontSize:12, textAlign:'center', paddingTop:60 }}>
                        No holdings yet. Sync your CAS email.
                      </div>
                    )}

                    {/* Summary row */}
                    {totalValue > 0 && (
                      <div style={{ marginTop:16, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.06)',
                        display:'flex', justifyContent:'space-between', fontSize:12 }}>
                        <span style={{ color:'#64748b' }}>{holdings.length} stocks · Portfolio value</span>
                        <span style={{ color:'#00d4a1', fontWeight:700, fontSize:14 }}>{fmt(totalValue)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Holdings Table — clean, no Avg Cost, no P&L */}
                <div className="db-card">
                  <div className="db-card-header">
                    <div className="db-card-title">All Stock Holdings ({holdings.length})</div>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ fontSize:11, color:'#475569' }}>
                        {s.casDate ? `CAS as of ${new Date(s.casDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}` : 'From CAS email'}
                      </div>
                      <button onClick={() => { setShowAddStock(true); setStockError(''); setStockSaved(false); }}
                        style={{ background:'rgba(100,255,218,0.1)', border:'1px solid rgba(100,255,218,0.3)',
                          color:'#64ffda', borderRadius:8, padding:'6px 14px', cursor:'pointer',
                          fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:5 }}>
                        + Add Stock
                      </button>
                    </div>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table className="db-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Sector</th>
                          <th className="right">Qty</th>
                          <th className="right">LTP</th>
                          <th className="right">Current Value</th>
                          <th className="right">Allocation</th>
                          <th className="right">Div Yield</th>
                          <th style={{ fontSize:10, color:'#334155' }}>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map(h => {
                          const alloc = totalValue > 0 ? (h.marketValue / totalValue * 100).toFixed(1) : 0;
                          return (
                            <tr key={h.symbol}>
                              <td>
                                <div className="db-stock-name">{h.company || h.symbol}</div>
                                <div className="db-stock-sym">{h.symbol}</div>
                              </td>
                              <td>
                                <span className={`db-tag tag-${(h.sector || 'other').toLowerCase().replace(/\s+/g,'-')}`}>
                                  {h.sector || 'Other'}
                                </span>
                              </td>
                              <td className="right">{h.quantity}</td>
                              <td className="right mono">
                                {h.ltp > 0 ? `₹${Number(h.ltp).toFixed(2)}` : '—'}
                                {h.priceSource === 'Yahoo' && <span style={{ fontSize:9, color:'#334155', marginLeft:4 }}>Y</span>}
                                {h.priceSource === 'NSE'   && <span style={{ fontSize:9, color:'#334155', marginLeft:4 }}>N</span>}
                              </td>
                              <td className="right mono" style={{ color:'#00d4a1', fontWeight:600 }}>
                                {h.marketValue > 0 ? fmt(h.marketValue) : '—'}
                              </td>
                              <td className="right">
                                <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end' }}>
                                  <div style={{ width:40, height:4, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
                                    <div style={{ height:'100%', width:`${alloc}%`, background:'#0ea5e9', borderRadius:2 }} />
                                  </div>
                                  <span style={{ fontSize:11, color:'#64748b' }}>{alloc}%</span>
                                </div>
                              </td>
                              <td className="right">
                                <span className={`db-yield-badge ${h.dividendYieldOnCost >= 3 ? 'hi' : h.dividendYieldOnCost >= 1 ? 'md' : 'lo'}`}>
                                  {h.dividendYieldOnCost > 0 ? h.dividendYieldOnCost + '%' : '—'}
                                </span>
                              </td>
                              <td style={{ fontSize:10, color:'#1e3a5f' }}>
                                {h.source === 'manual'
                                  ? <span style={{ background:'rgba(251,146,60,0.15)', color:'#fb923c', borderRadius:4, padding:'2px 6px', fontSize:10, fontWeight:600 }}>Manual</span>
                                  : <span style={{ background:'rgba(100,255,218,0.08)', color:'#334155', borderRadius:4, padding:'2px 6px', fontSize:10 }}>CAS</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                        {holdings.length === 0 && (
                          <tr>
                            <td colSpan="8" className="db-empty">
                              No holdings yet. Connect Gmail → Sync Emails → your CAS holdings will appear here.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* MUTUAL FUNDS */}
          {tab === 'mutualfunds' && (() => {
            const mf       = mfData;
            const holdings = mf?.holdings || [];
            const summary  = mf?.summary  || {};
            const fmt      = (v) => v >= 10000000 ? `₹${(v/10000000).toFixed(2)}Cr` : v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
            const COLORS   = ['#00d4a1','#0ea5e9','#f59e0b','#a78bfa','#f43f5e','#34d399','#fb923c','#818cf8','#e879f9','#4ade80'];
            const pieData  = summary.byFundHouse || [];
            const gainPct  = summary.gainLossPct || 0;

            return (
              <div className="fade-in">

                {/* ── Top action bar ── */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:200 }}>
                    <div style={{ color:'#94a3b8', fontSize:12 }}>
                      {holdings.length} funds · Last synced from {[...new Set(holdings.map(h=>h.source))].join(', ') || 'CDSL'}
                    </div>
                  </div>
                  {/* Request CAMS + KFintech statement */}
                  <button
                    onClick={async () => {
                      setMfRequestSent(null);
                      try {
                        const r = await mfAPI.requestCAS();
                        setMfRequestSent({ success: true, message: r.data.message });
                      } catch(e) {
                        setMfRequestSent({ success: false, message: e.response?.data?.error || 'Request failed' });
                      }
                    }}
                    style={{ padding:'8px 16px', background:'rgba(14,165,233,0.12)', border:'1px solid rgba(14,165,233,0.3)',
                      color:'#0ea5e9', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    📧 Request CAMS + KFintech Statement
                  </button>
                  {/* Sync received statement PDFs */}
                  <button
                    disabled={mfSyncing}
                    onClick={async () => {
                      setMfSyncing(true); setMfRequestSent(null);
                      try {
                        const r = await mfAPI.syncStatements();
                        setMfRequestSent({ success: r.data.success, message: r.data.message });
                        if (r.data.savedCount > 0) {
                          const r2 = await mfAPI.get();
                          setMfData(r2.data);
                        }
                      } catch(e) {
                        setMfRequestSent({ success: false, message: e.response?.data?.error || 'Sync failed' });
                      } finally { setMfSyncing(false); }
                    }}
                    style={{ padding:'8px 16px', background: mfSyncing ? '#1e2d3d' : 'rgba(100,255,218,0.1)',
                      border:'1px solid rgba(100,255,218,0.3)', color:'#64ffda',
                      borderRadius:8, fontSize:12, fontWeight:700, cursor: mfSyncing ? 'not-allowed' : 'pointer' }}>
                    {mfSyncing ? '⟳ Syncing…' : '⟳ Sync MF Statements'}
                  </button>
                </div>

                {/* Status banner */}
                {mfRequestSent && (
                  <div style={{ marginBottom:16, padding:'10px 14px', borderRadius:8, fontSize:13,
                    background: mfRequestSent.success ? 'rgba(0,212,161,0.08)' : 'rgba(244,63,94,0.08)',
                    border: `1px solid ${mfRequestSent.success ? 'rgba(0,212,161,0.2)' : 'rgba(244,63,94,0.2)'}`,
                    color: mfRequestSent.success ? '#00d4a1' : '#f43f5e',
                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span>{mfRequestSent.success ? '✅' : '❌'} {mfRequestSent.message}</span>
                    <button onClick={() => setMfRequestSent(null)} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer' }}>✕</button>
                  </div>
                )}

                {mfLoading ? (
                  <div style={{ textAlign:'center', padding:60, color:'#334155' }}>Loading mutual funds…</div>
                ) : holdings.length === 0 ? (
                  <div style={{ textAlign:'center', padding:60, color:'#334155', lineHeight:2 }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
                    <div style={{ color:'#64748b', fontSize:14, marginBottom:8 }}>No mutual fund holdings yet</div>
                    <div style={{ color:'#334155', fontSize:12 }}>
                      CDSL demat MF units sync automatically with CAS.<br/>
                      For SIP folios (CAMS/KFintech), click <b style={{color:'#0ea5e9'}}>Request CAMS + KFintech Statement</b> above,<br/>
                      wait 5–30 minutes for the email, then click <b style={{color:'#64ffda'}}>Sync MF Statements</b>.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ── Summary tiles ── */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
                      {[
                        { label:'Current Value',   val: fmt(summary.totalValue),    color:'#64ffda' },
                        { label:'Invested',         val: fmt(summary.totalInvested || 0), color:'#0ea5e9' },
                        { label:'Gain / Loss',      val: fmt(Math.abs(summary.totalGainLoss||0)),
                          color: (summary.totalGainLoss||0) >= 0 ? '#00d4a1' : '#f43f5e',
                          prefix: (summary.totalGainLoss||0) >= 0 ? '+' : '-' },
                        { label:'Returns',          val: `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`,
                          color: gainPct >= 0 ? '#00d4a1' : '#f43f5e' },
                      ].map(t => (
                        <div key={t.label} style={{ background:'rgba(255,255,255,0.04)', borderRadius:10,
                          padding:'14px 16px', border:'1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ color:'#64748b', fontSize:11, marginBottom:6 }}>{t.label}</div>
                          <div style={{ color: t.color, fontWeight:700, fontSize:18 }}>{t.prefix||''}{t.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Charts row ── */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gap:16, marginBottom:20 }}>

                      {/* Pie — by fund house */}
                      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20,
                        border:'1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14, marginBottom:16 }}>
                          📊 By Fund House
                        </div>
                        {pieData.length > 0 ? (
                          <>
                            <div style={{ display:'flex', justifyContent:'center' }}>
                              <PieChart width={200} height={200}>
                                <Pie data={pieData} cx={100} cy={100} innerRadius={55} outerRadius={90}
                                  dataKey="value" paddingAngle={2}>
                                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={v => fmt(v)}
                                  contentStyle={{ background:'#1a1a2e', border:'1px solid #333', borderRadius:8, fontSize:12 }} />
                              </PieChart>
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:5, marginTop:4 }}>
                              {pieData.slice(0,6).map((d, i) => (
                                <div key={d.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ width:8, height:8, borderRadius:'50%', background:COLORS[i % COLORS.length], flexShrink:0 }} />
                                    <span style={{ color:'#cbd5e1' }}>{d.name}</span>
                                  </div>
                                  <span style={{ color:'#94a3b8', fontWeight:600 }}>{fmt(d.value)}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>

                      {/* Bar — top holdings by value */}
                      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20,
                        border:'1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14, marginBottom:16 }}>
                          📈 Holdings by Value
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                          {holdings.slice(0,8).map((h, i) => {
                            const pct = summary.totalValue > 0 ? (h.current_value / summary.totalValue * 100) : 0;
                            return (
                              <div key={h.id}>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                                  <span style={{ color:'#cbd5e1', fontWeight:600, maxWidth:220,
                                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                    {h.fund_name}
                                  </span>
                                  <div style={{ display:'flex', gap:10, flexShrink:0 }}>
                                    <span style={{ color:'#64748b' }}>{pct.toFixed(1)}%</span>
                                    <span style={{ color:'#00d4a1', fontWeight:700 }}>{fmt(h.current_value||0)}</span>
                                  </div>
                                </div>
                                <div style={{ height:5, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                                  <div style={{ height:'100%', width:`${pct}%`, borderRadius:3,
                                    background: COLORS[i % COLORS.length], transition:'width 0.6s ease' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* ── Holdings table ── */}
                    <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:12,
                      border:'1px solid rgba(255,255,255,0.07)', overflow:'hidden' }}>
                      <div style={{ padding:'16px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)',
                        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14 }}>
                          All Mutual Fund Holdings ({holdings.length})
                        </div>
                        <div style={{ color:'#64748b', fontSize:12 }}>
                          Total: <span style={{ color:'#64ffda', fontWeight:700 }}>{fmt(summary.totalValue)}</span>
                        </div>
                      </div>
                      <div style={{ overflowX:'auto' }}>
                        <table className="db-table">
                          <thead>
                            <tr>
                              <th>Fund</th>
                              <th>Category</th>
                              <th className="right">Units</th>
                              <th className="right">NAV</th>
                              <th className="right">Current Value</th>
                              <th className="right">Invested</th>
                              <th className="right">Gain/Loss</th>
                              <th>Folio / ISIN</th>
                              <th>Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {holdings.map(h => {
                              const gl    = (h.current_value||0) - (h.invested_value||0);
                              const glPct = h.invested_value > 0 ? (gl / h.invested_value * 100) : null;
                              return (
                                <tr key={h.id}>
                                  <td>
                                    <div style={{ fontWeight:600, color:'#e2e8f0', fontSize:12,
                                      maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                      {h.fund_name}
                                    </div>
                                    <div style={{ color:'#475569', fontSize:10, marginTop:1 }}>{h.fund_house}</div>
                                  </td>
                                  <td>
                                    <span style={{ fontSize:10, background:'rgba(14,165,233,0.1)', color:'#0ea5e9',
                                      borderRadius:4, padding:'2px 7px', fontWeight:600, whiteSpace:'nowrap' }}>
                                      {h.fund_category || 'Equity'}
                                    </span>
                                  </td>
                                  <td className="right mono" style={{ color:'#e2e8f0' }}>
                                    {Number(h.units||0).toLocaleString('en-IN',{maximumFractionDigits:3})}
                                  </td>
                                  <td className="right mono" style={{ color:'#94a3b8' }}>
                                    {h.nav ? `₹${Number(h.nav).toFixed(2)}` : '—'}
                                  </td>
                                  <td className="right mono" style={{ color:'#64ffda', fontWeight:700 }}>
                                    {h.current_value ? fmt(h.current_value) : '—'}
                                  </td>
                                  <td className="right mono" style={{ color:'#64748b' }}>
                                    {h.invested_value ? fmt(h.invested_value) : '—'}
                                  </td>
                                  <td className="right mono">
                                    {h.invested_value ? (
                                      <div>
                                        <span style={{ color: gl >= 0 ? '#00d4a1' : '#f43f5e', fontWeight:600 }}>
                                          {gl >= 0 ? '+' : ''}{fmt(Math.abs(gl))}
                                        </span>
                                        {glPct !== null && (
                                          <div style={{ color: glPct >= 0 ? '#00d4a1' : '#f43f5e', fontSize:10 }}>
                                            {glPct >= 0 ? '+' : ''}{glPct.toFixed(2)}%
                                          </div>
                                        )}
                                      </div>
                                    ) : '—'}
                                  </td>
                                  <td style={{ fontSize:10, color:'#475569', maxWidth:120,
                                    overflow:'hidden', textOverflow:'ellipsis' }}>
                                    {h.folio_number
                                      ? <span title={h.folio_number}>📁 {h.folio_number}</span>
                                      : h.isin
                                      ? <span title={h.isin} style={{ color:'#1e3a5f' }}>{h.isin}</span>
                                      : '—'}
                                  </td>
                                  <td>
                                    <span style={{ fontSize:10, borderRadius:4, padding:'2px 6px', fontWeight:600,
                                      background: h.source === 'CDSL' ? 'rgba(100,255,218,0.08)' :
                                                  h.source === 'CAMS' ? 'rgba(251,146,60,0.12)' :
                                                  'rgba(167,139,250,0.12)',
                                      color: h.source === 'CDSL' ? '#334155' :
                                             h.source === 'CAMS' ? '#fb923c' : '#a78bfa' }}>
                                      {h.source || 'CDSL'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* DIVIDENDS */}
          {tab === 'dividends' && (
            <div className="fade-in">
              <Dividends />
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

      {/* ASSET BALANCES MODAL */}
      {showAssetModal && (
        <div className="db-modal-overlay" onClick={e => { if(e.target===e.currentTarget) setShowAssetModal(false); }}>
          <div className="db-modal fade-in" style={{maxWidth:480}}>
            <div className="db-modal-header">
              <div className="db-modal-title">⚙ Update Balances</div>
              <button className="db-modal-close" onClick={() => setShowAssetModal(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <p style={{color:'#888',fontSize:13,marginBottom:16}}>Enter your current balances. These are saved to your account.</p>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[
                  {key:'ppf',label:'PPF Balance'},
                  {key:'epf',label:'EPF Balance'},
                  {key:'nps',label:'NPS Balance'},
                  {key:'fd',label:'Fixed Deposits'},
                  {key:'ssy',label:'SSY Balance'},
                  {key:'salary',label:'Monthly Salary'},
                  {key:'homeLoan',label:'Home Loan Outstanding'},
                  {key:'creditCard',label:'Credit Card Outstanding'},
                ].map(f => (
                  <div key={f.key} className="form-group" style={{margin:0}}>
                    <label style={{fontSize:12,color:'#888'}}>{f.label}</label>
                    <input
                      type="number"
                      placeholder="₹ 0"
                      value={assetForm[f.key]}
                      onChange={e => setAssetForm(p => ({...p,[f.key]:e.target.value}))}
                      style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'8px 12px',color:'#e0e0e0',width:'100%',fontSize:14}}
                    />
                  </div>
                ))}
              </div>

              <button
                style={{marginTop:20,width:'100%',background:'#64ffda',color:'#0a0a0a',border:'none',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}
                onClick={async () => {
                  try {
                    await api.post('/api/portfolio/assets', {
                      ppf: +assetForm.ppf||0, epf: +assetForm.epf||0,
                      nps: +assetForm.nps||0, fd: +assetForm.fd||0,
                      ssy: +assetForm.ssy||0, homeLoan: +assetForm.homeLoan||0,
                      creditCard: +assetForm.creditCard||0, monthlyIncome: +assetForm.salary||0
                    });
                    setAssetBalances({ ppf:+assetForm.ppf||0, epf:+assetForm.epf||0, nps:+assetForm.nps||0, fd:+assetForm.fd||0, ssy:+assetForm.ssy||0 });
                    setLiabilities({ homeLoan:+assetForm.homeLoan||0, creditCard:+assetForm.creditCard||0 });
                    setMonthlyIncome(+assetForm.salary||0);
                    setShowAssetModal(false);
                  } catch(e) { alert('Save failed: '+e.message); }
                }}
              >Save Balances</button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── INCOME SETTINGS MODAL ── */}
      {showIncomeSettings && (
        <div className="db-modal-overlay" onClick={e => { if(e.target===e.currentTarget) setShowIncomeSettings(false); }}>
          <div className="db-modal fade-in" style={{ maxWidth: 620, maxHeight:'90vh', overflowY:'auto' }}>
            <div className="db-modal-header">
              <div>
                <div className="db-modal-title">₹ Income Capture Rules</div>
                <div style={{ color:'#64748b', fontSize:12, marginTop:2 }}>
                  Auto-detect salary & income from your bank credit emails
                </div>
              </div>
              <button className="db-modal-close" onClick={() => setShowIncomeSettings(false)}>✕</button>
            </div>
            <div className="db-modal-body">

              {/* Summary strip */}
              {incomeSummary.currentFYTotal > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:20 }}>
                  {[
                    { label:'FY26 Total', val: fmt(incomeSummary.currentFYTotal), color:'#64ffda' },
                    { label:'This Month', val: fmt(incomeSummary.thisMonthTotal),  color:'#a78bfa' },
                    { label:'Entries',    val: incomeEntries.length,               color:'#0ea5e9' },
                  ].map(s => (
                    <div key={s.label} style={{ background:'#0a1628', borderRadius:8, padding:'10px 14px', border:'1px solid #1e3a5f', textAlign:'center' }}>
                      <div style={{ color:s.color, fontWeight:700, fontSize:18 }}>{s.val}</div>
                      <div style={{ color:'#475569', fontSize:11, marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Rule Form */}
              {showRuleForm ? (
                <div style={{ background:'#0a1628', borderRadius:10, padding:18, border:'1px solid #1e3a5f', marginBottom:16 }}>
                  <div style={{ color:'#64ffda', fontWeight:700, fontSize:13, marginBottom:14 }}>
                    {editingRule ? '✎ Edit Rule' : '+ New Income Rule'}
                  </div>

                  {/* Row 1: Name + Category */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>RULE NAME <span style={{color:'#f43f5e'}}>*</span></label>
                      <input className="db-input" placeholder="e.g. HDFC Salary"
                        value={ruleForm.rule_name} onChange={e => setRuleForm(p=>({...p,rule_name:e.target.value}))} />
                    </div>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>INCOME CATEGORY <span style={{color:'#f43f5e'}}>*</span></label>
                      <select className="db-input" value={ruleForm.category} onChange={e => setRuleForm(p=>({...p,category:e.target.value}))}
                        style={{ background:'#0f1c2e', color:'#e2e8f0', cursor:'pointer' }}>
                        {INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Bank Sender */}
                  <div style={{ marginBottom:12 }}>
                    <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>BANK SENDER EMAIL</label>
                    <input className="db-input" placeholder="e.g. alerts@hdfcbank.net or noreply@icicibank.com"
                      value={ruleForm.bank_sender} onChange={e => setRuleForm(p=>({...p,bank_sender:e.target.value}))} />
                    <span style={{ color:'#334155', fontSize:10, marginTop:3, display:'block' }}>
                      Check a real bank credit email → From: field. Partial match works e.g. "hdfcbank"
                    </span>
                  </div>

                  {/* Row 3: Subject + Body */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>SUBJECT CONTAINS</label>
                      <input className="db-input" placeholder="e.g. SALARY CREDIT"
                        value={ruleForm.subject_pattern} onChange={e => setRuleForm(p=>({...p,subject_pattern:e.target.value}))} />
                    </div>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>BODY CONTAINS</label>
                      <input className="db-input" placeholder="e.g. credited to your account"
                        value={ruleForm.body_pattern} onChange={e => setRuleForm(p=>({...p,body_pattern:e.target.value}))} />
                    </div>
                  </div>

                  {/* Row 4: Account Last 4 + Min Amount + Period */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>ACCOUNT LAST 4</label>
                      <input className="db-input" placeholder="e.g. 7823" maxLength={4}
                        value={ruleForm.account_last4} onChange={e => setRuleForm(p=>({...p,account_last4:e.target.value}))} />
                    </div>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>MIN AMOUNT (₹)</label>
                      <input className="db-input" type="number" placeholder="e.g. 10000"
                        value={ruleForm.min_amount} onChange={e => setRuleForm(p=>({...p,min_amount:e.target.value}))} />
                    </div>
                    <div>
                      <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>PERIOD</label>
                      <select className="db-input" value={ruleForm.period} onChange={e => setRuleForm(p=>({...p,period:e.target.value}))}
                        style={{ background:'#0f1c2e', color:'#e2e8f0', cursor:'pointer' }}>
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="irregular">Irregular</option>
                      </select>
                    </div>
                  </div>

                  {/* Remark */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:5 }}>REMARK (optional)</label>
                    <input className="db-input" placeholder="e.g. Main salary account, credited on 1st"
                      value={ruleForm.remark} onChange={e => setRuleForm(p=>({...p,remark:e.target.value}))} />
                  </div>

                  {ruleError && (
                    <div style={{ color:'#f43f5e', fontSize:12, marginBottom:10, padding:'7px 10px',
                      background:'rgba(244,63,94,0.08)', borderRadius:6, border:'1px solid rgba(244,63,94,0.2)' }}>
                      ⚠ {ruleError}
                    </div>
                  )}

                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={saveRule} disabled={ruleSaving}
                      style={{ flex:1, background:'#64ffda', color:'#0a0a0a', border:'none',
                        borderRadius:8, padding:'11px', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                      {ruleSaving ? '⟳ Saving…' : (editingRule ? '✎ Update Rule' : '+ Save Rule')}
                    </button>
                    <button onClick={() => setShowRuleForm(false)}
                      style={{ padding:'11px 18px', background:'#1e2d3d', color:'#94a3b8',
                        border:'1px solid #334155', borderRadius:8, cursor:'pointer', fontSize:13 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Existing rules list */}
                  {incomeRules.length > 0 && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:8 }}>ACTIVE RULES</div>
                      {incomeRules.map(rule => (
                        <div key={rule.id} style={{ background:'#0a1628', border:'1px solid #1e3a5f',
                          borderRadius:8, padding:'12px 14px', marginBottom:8,
                          display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                              <span style={{ color:'#e2e8f0', fontWeight:700, fontSize:13 }}>{rule.rule_name}</span>
                              <span style={{ fontSize:10, background:'rgba(100,255,218,0.1)', color:'#64ffda',
                                borderRadius:4, padding:'1px 7px', fontWeight:600 }}>{rule.category}</span>
                              <span style={{ fontSize:10, background:'rgba(255,255,255,0.04)', color:'#475569',
                                borderRadius:4, padding:'1px 7px' }}>{rule.period}</span>
                            </div>
                            <div style={{ color:'#475569', fontSize:11, lineHeight:1.6 }}>
                              {rule.bank_sender && <span>From: <span style={{color:'#64748b'}}>{rule.bank_sender}</span> · </span>}
                              {rule.subject_pattern && <span>Subject: <span style={{color:'#64748b'}}>"{rule.subject_pattern}"</span> · </span>}
                              {rule.body_pattern && <span>Body: <span style={{color:'#64748b'}}>"{rule.body_pattern}"</span></span>}
                            </div>
                            {rule.remark && <div style={{ color:'#334155', fontSize:10, marginTop:3 }}>💬 {rule.remark}</div>}
                          </div>
                          <div style={{ display:'flex', gap:6, flexShrink:0, marginLeft:10 }}>
                            <button onClick={() => openRuleForm(rule)}
                              style={{ background:'#1e2d3d', border:'1px solid #334155', color:'#94a3b8',
                                borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11 }}>Edit</button>
                            <button onClick={() => deleteRule(rule.id)}
                              style={{ background:'rgba(244,63,94,0.08)', border:'1px solid rgba(244,63,94,0.2)',
                                color:'#f43f5e', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11 }}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {incomeRules.length === 0 && (
                    <div style={{ textAlign:'center', padding:'20px 0', color:'#334155', fontSize:13, marginBottom:16 }}>
                      No rules yet. Create your first rule to start capturing income.
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                    <button onClick={() => openRuleForm()}
                      style={{ flex:1, background:'rgba(100,255,218,0.1)', border:'1px solid rgba(100,255,218,0.3)',
                        color:'#64ffda', borderRadius:8, padding:'11px', fontWeight:700,
                        fontSize:13, cursor:'pointer' }}>
                      + New Rule
                    </button>
                    <button onClick={scanIncome} disabled={incomeScanning || incomeRules.length === 0}
                      style={{ flex:1, background: incomeRules.length > 0 ? '#0ea5e9' : '#1e2d3d',
                        border:'none', color: incomeRules.length > 0 ? '#fff' : '#334155',
                        borderRadius:8, padding:'11px', fontWeight:700,
                        fontSize:13, cursor: incomeRules.length > 0 ? 'pointer' : 'not-allowed' }}>
                      {incomeScanning ? '⟳ Scanning Gmail…' : '⟳ Scan Gmail Now'}
                    </button>
                  </div>

                  {incomeScanResult && (
                    <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13,
                      background: incomeScanResult.success ? 'rgba(0,212,161,0.08)' : 'rgba(244,63,94,0.08)',
                      border: `1px solid ${incomeScanResult.success ? 'rgba(0,212,161,0.2)' : 'rgba(244,63,94,0.2)'}`,
                      color: incomeScanResult.success ? '#00d4a1' : '#f43f5e' }}>
                      {incomeScanResult.success ? '✅' : '⚠'} {incomeScanResult.message}
                    </div>
                  )}

                  {/* Recent entries */}
                  {incomeEntries.length > 0 && (
                    <div>
                      <div style={{ color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:8 }}>RECENT INCOME ENTRIES</div>
                      <div style={{ maxHeight:200, overflowY:'auto', borderRadius:8, border:'1px solid #1e3a5f' }}>
                        {incomeEntries.slice(0,15).map((e, i) => (
                          <div key={e.id} style={{ padding:'9px 14px', borderBottom:'1px solid #0f1b2d',
                            display:'flex', justifyContent:'space-between', alignItems:'center',
                            background: i%2===0 ? '#0a1628' : 'transparent' }}>
                            <div>
                              <div style={{ color:'#e2e8f0', fontSize:12, fontWeight:600 }}>{e.description || e.category}</div>
                              <div style={{ color:'#475569', fontSize:10, marginTop:1 }}>
                                {new Date(e.credited_on).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                                {' · '}<span style={{ color:'#334155' }}>{e.category}</span>
                                {e.source==='auto' && <span style={{ color:'#0ea5e9', marginLeft:6 }}>auto</span>}
                              </div>
                            </div>
                            <div style={{ color:'#64ffda', fontWeight:700, fontSize:13 }}>{fmt(e.amount)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* How it works tip */}
                  <div style={{ marginTop:14, padding:'10px 12px', background:'#0a1628', borderRadius:6,
                    border:'1px solid #1e3a5f', fontSize:11, color:'#334155', lineHeight:1.8 }}>
                    <span style={{ color:'#0ea5e9', fontWeight:700 }}>HOW IT WORKS</span><br/>
                    1. Create a rule matching your bank credit email (sender + keyword)<br/>
                    2. Click <b style={{color:'#94a3b8'}}>Scan Gmail Now</b> — scans last 90 days automatically<br/>
                    3. Detected credits appear in entries + on the dashboard tile
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ADD STOCK MODAL ── */}
      {showAddStock && (
        <div className="db-modal-overlay" onClick={e => { if(e.target===e.currentTarget){ setShowAddStock(false); setStockResults([]); }}}>
          <div className="db-modal fade-in" style={{ maxWidth:460 }}>
            <div className="db-modal-header">
              <div className="db-modal-title">+ Add Stock Holding</div>
              <button className="db-modal-close" onClick={() => { setShowAddStock(false); setStockResults([]); }}>✕</button>
            </div>
            <div className="db-modal-body">

              {/* Stock Search */}
              <div style={{ marginBottom:16 }}>
                <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:6 }}>
                  SEARCH STOCK
                </label>
                <div style={{ position:'relative' }}>
                  <input
                    className="db-input"
                    placeholder="Type company name or NSE symbol e.g. HDFC, Infosys…"
                    value={stockSearch}
                    onChange={e => handleStockSearch(e.target.value)}
                    autoFocus
                    style={{ width:'100%', paddingRight: searchLoading ? 36 : 12 }}
                  />
                  {searchLoading && (
                    <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                      width:14, height:14, border:'2px solid #334155', borderTopColor:'#64ffda',
                      borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />
                  )}

                  {/* Dropdown results */}
                  {stockResults.length > 0 && (
                    <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0,
                      background:'#1a2235', border:'1px solid #1e3a5f', borderRadius:8,
                      zIndex:1000, maxHeight:260, overflowY:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.4)' }}>
                      {stockResults.map(s => (
                        <div key={s.symbol} onClick={() => handleSelectStock(s)}
                          style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid #0f1b2d',
                            display:'flex', justifyContent:'space-between', alignItems:'center',
                            transition:'background 0.1s' }}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(100,255,218,0.06)'}
                          onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                          <div>
                            <div style={{ color:'#e2e8f0', fontWeight:700, fontSize:13 }}>{s.symbol}</div>
                            <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>{s.company}</div>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                            <span style={{ fontSize:10, color:'#334155', background:'rgba(255,255,255,0.05)',
                              borderRadius:4, padding:'2px 6px' }}>{s.sector}</span>
                            <span style={{ fontSize:9, color:'#1e3a5f' }}>{s.isin}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Stock preview */}
              {selectedStock && (
                <div style={{ background:'rgba(100,255,218,0.06)', border:'1px solid rgba(100,255,218,0.15)',
                  borderRadius:8, padding:'12px 14px', marginBottom:16,
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ color:'#64ffda', fontWeight:700, fontSize:14 }}>{selectedStock.symbol}</div>
                    <div style={{ color:'#94a3b8', fontSize:12, marginTop:2 }}>{selectedStock.company}</div>
                    <div style={{ color:'#334155', fontSize:10, marginTop:2 }}>{selectedStock.isin}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span style={{ fontSize:11, color:'#0ea5e9', background:'rgba(14,165,233,0.1)',
                      borderRadius:4, padding:'2px 8px' }}>{selectedStock.sector}</span>
                    <span style={{ fontSize:10, color:'#64748b' }}>NSE</span>
                  </div>
                </div>
              )}

              {/* Quantity + Cost */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
                <div>
                  <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:6 }}>
                    QUANTITY <span style={{ color:'#f43f5e' }}>*</span>
                  </label>
                  <input className="db-input" type="number" min="1" placeholder="e.g. 100"
                    value={stockQty} onChange={e => setStockQty(e.target.value)} />
                </div>
                <div>
                  <label style={{ display:'block', color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:6 }}>
                    AVG COST <span style={{ color:'#475569', fontWeight:400 }}>(optional)</span>
                  </label>
                  <input className="db-input" type="number" min="0" placeholder="₹ per share"
                    value={stockCost} onChange={e => setStockCost(e.target.value)} />
                </div>
              </div>

              <div style={{ background:'#0a1628', borderRadius:6, padding:'10px 12px', marginBottom:16,
                border:'1px solid #1e3a5f', fontSize:11, color:'#475569', lineHeight:1.7 }}>
                <span style={{ color:'#0ea5e9', fontWeight:700 }}>ℹ Auto-sync:</span> Current price &
                sector will be fetched from Yahoo Finance automatically when you click <b style={{ color:'#94a3b8' }}>Sync Yahoo</b>.
                Avg cost is optional — only needed for P&L tracking.
              </div>

              {stockError && (
                <div style={{ color:'#f43f5e', fontSize:12, marginBottom:12, padding:'8px 12px',
                  background:'rgba(244,63,94,0.08)', borderRadius:6, border:'1px solid rgba(244,63,94,0.2)' }}>
                  ⚠ {stockError}
                </div>
              )}
              {stockSaved && (
                <div style={{ color:'#00d4a1', fontSize:12, marginBottom:12, padding:'8px 12px',
                  background:'rgba(0,212,161,0.08)', borderRadius:6, border:'1px solid rgba(0,212,161,0.2)' }}>
                  ✅ Stock added successfully!
                </div>
              )}

              <button onClick={handleSaveStock} disabled={stockSaving || !selectedStock}
                style={{ width:'100%', background: selectedStock ? '#64ffda' : '#1e2d3d',
                  color: selectedStock ? '#0a0a0a' : '#334155',
                  border:'none', borderRadius:8, padding:'13px', fontWeight:700,
                  fontSize:14, cursor: selectedStock ? 'pointer' : 'not-allowed', transition:'all 0.2s' }}>
                {stockSaving ? '⟳ Saving…' : '+ Add to Holdings'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
