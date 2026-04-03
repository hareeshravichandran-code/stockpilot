import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api, { portfolioAPI, emailAPI, authAPI, incomeAPI, mfAPI, goalsAPI, familyAPI, fdAPI, rdAPI, portfolioHistoryAPI, npsAPI } from '../lib/api';
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
  const [mfData, setMfData]                   = useState(null);
  const [mfLoading, setMfLoading]             = useState(false);

  // ── Income state ────────────────────────────────────────────────
  const [showSettings, setShowSettings]             = useState(false);
  const [settingsSection, setSettingsSection]       = useState('income'); // 'income' | 'expense'
  const [showIncomeSettings, setShowIncomeSettings] = useState(false);
  const [incomeRules, setIncomeRules]               = useState([]);
  const [incomeSummary, setIncomeSummary]           = useState({ currentFYTotal:0, thisMonthTotal:0, byCategory:{}, byMonth:{}, fyLabel:'FY26' });
  const [incomeEntries, setIncomeEntries]           = useState([]);
  const [incomeScanning, setIncomeScanning]         = useState(false);
  const [incomeScanResult, setIncomeScanResult]     = useState(null);
  const [showRuleForm, setShowRuleForm]             = useState(false);
  const [editingRule, setEditingRule]               = useState(null);
  const [indianBanks, setIndianBanks]               = useState([]);
  const [showManualEntry, setShowManualEntry]       = useState(false);
  const [manualEntryForm, setManualEntryForm]       = useState({ category:'Salary', amount:'', credited_on: new Date().toISOString().split('T')[0], description:'', receive_bank:'' });
  const [manualEntrySaving, setManualEntrySaving]   = useState(false);
  const INCOME_CATS = ['Salary','Freelance','Rental','Business','Interest','Bonus','Other'];
  const EMPTY_RULE = {
    rule_name:'', category:'Salary', receive_bank:'', bank_sender:'',
    subject_pattern:'', body_pattern:'', account_last4:'',
    min_amount:'', period:'monthly', remark:'',
    date_day_from:'', date_day_to:'',
    lookback_months:'0', credit_only: true,
  };
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);
  const [ruleSaving, setRuleSaving]   = useState(false);
  const [ruleError, setRuleError]     = useState('');

  // ── Expense state ─────────────────────────────────────────────────
  const [expenseEntries, setExpenseEntries]   = useState([]);
  const [expenseSummary, setExpenseSummary]   = useState({ currentFYTotal:0, thisMonthTotal:0, byCategory:{}, byMonth:{}, fyLabel:'FY26', uncategorized:0 });
  const [expenseRules, setExpenseRules]       = useState([]);
  const [expenseScanning, setExpenseScanning] = useState(false);
  const [expenseScanResult, setExpenseScanResult] = useState(null);
  const [expenseCategories, setExpenseCategories] = useState({});
  const [showExpenseEntry, setShowExpenseEntry] = useState(false);
  const [editingExpense, setEditingExpense]   = useState(null); // for inline edit
  const [expenseEntryForm, setExpenseEntryForm] = useState({
    category:'', sub_category:'', amount:'',
    expense_date: new Date().toISOString().split('T')[0],
    merchant_name:'', comments:''
  });
  const [expenseEntrySaving, setExpenseEntrySaving] = useState(false);
  const [expenseRuleForm, setExpenseRuleForm] = useState({
    rule_name:'', email_sender:'', subject_pattern:'', body_pattern:'', lookback_months:'0'
  });
  const [showExpenseRuleForm, setShowExpenseRuleForm] = useState(false);
  const [editingExpenseRule, setEditingExpenseRule]   = useState(null);
  const [expenseRuleSaving, setExpenseRuleSaving]     = useState(false);

  // ── Privacy toggle ───────────────────────────────────────────────
  const [hideValues, setHideValues] = useState(() => {
    try { return localStorage.getItem('kanalyst_hide_values') === 'true'; } catch(e) { return false; }
  });
  const toggleHide = () => {
    const next = !hideValues;
    setHideValues(next);
    try { localStorage.setItem('kanalyst_hide_values', String(next)); } catch(e) {}
  };
  const masked = (val) => hideValues ? '••••••' : val;
  const maskedNum = (val) => hideValues ? '₹ ••••' : val;

  // ── Family state ─────────────────────────────────────────────────
  const [familyMode, setFamilyMode]         = useState(false);
  const [familyStatus, setFamilyStatus]     = useState({ inFamily:false, members:[], pendingInvites:[], sentInvites:[] });
  const [familyLoading, setFamilyLoading]   = useState(false);
  const [inviteEmail, setInviteEmail]       = useState('');
  const [inviteSending, setInviteSending]   = useState(false);
  const [inviteResult, setInviteResult]     = useState(null);
  const [showFamilySettings, setShowFamilySettings] = useState(false);

  // ── Goals state ──────────────────────────────────────────────────
  const [goals, setGoals]                     = useState([]);
  const [goalsSummary, setGoalsSummary]       = useState({ total:0, new:0, inprogress:0, completed:0, totalTargetValue:0, totalCurrentValue:0 });
  const [goalsFilter, setGoalsFilter]         = useState('all'); // all|new|inprogress|completed
  const [goalsDurationFilter, setGoalsDurationFilter] = useState('all');
  const [showGoalForm, setShowGoalForm]       = useState(false);
  const [editingGoal, setEditingGoal]         = useState(null);
  const [goalFormSaving, setGoalFormSaving]   = useState(false);
  const [goalDetail, setGoalDetail]           = useState(null);   // goal being viewed
  const [goalCycles, setGoalCycles]           = useState([]);
  const [goalForm, setGoalForm]               = useState({
    name:'', description:'', target_value:'',
    duration_type:'mid', target_date:'',
    is_recurring: false, recurrence:'monthly',
    recurrence_day:'1', recurrence_month:'',
  });
  const [linkingGoalId, setLinkingGoalId]     = useState(null);  // goal we're linking assets to
  const [linkingAsset, setLinkingAsset]       = useState(null);  // {type,ref,name,value} being linked
  const [bulkLinkMode, setBulkLinkMode]        = useState(null);  // null | 'stock' | 'mf'
  const [syncingNAV, setSyncingNAV]            = useState(false);
  const [navSyncResult, setNavSyncResult]      = useState(null);
  const [refreshing, setRefreshing]            = useState(false);  // global refresh pulse

  // ── Portfolio History state ──────────────────────────────────────
  const [historyData, setHistoryData]         = useState([]);
  const [historySummary, setHistorySummary]   = useState({});
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyYears, setHistoryYears]       = useState(5);
  const [backfillFromDate, setBackfillFromDate] = useState('');
  const [backfillToDate, setBackfillToDate]   = useState('');
  const [backfilling, setBackfilling]         = useState(false);
  const [backfillResult, setBackfillResult]   = useState(null);
  const [historyDetailDate, setHistoryDetailDate] = useState(null);
  const [historyDetail, setHistoryDetail]     = useState(null);

  // ── NPS state ─────────────────────────────────────────────────────
  const [npsData, setNpsData]               = useState({ latest: null, history: [], count: 0 });
  const [npsSyncing, setNpsSyncing]         = useState(false);
  const [npsSyncResult, setNpsSyncResult]   = useState(null);
  const [showNpsForm, setShowNpsForm]       = useState(false);
  const [npsForm, setNpsForm]               = useState({});
  const [npsSaving, setNpsSaving]           = useState(false);
  const [npsError, setNpsError]             = useState('');
  const [npsFromDate, setNpsFromDate]       = useState('');

  // ── FD state ──────────────────────────────────────────────────────
  const [fdList, setFdList]             = useState([]);
  const [fdSummary, setFdSummary]       = useState({});
  const [fdLoading, setFdLoading]       = useState(false);
  const [showFdForm, setShowFdForm]     = useState(false);
  const [editingFd, setEditingFd]       = useState(null);
  const [fdSaving, setFdSaving]         = useState(false);
  const [fdError, setFdError]           = useState('');
  const [fdForm, setFdForm]             = useState({});

  // ── RD state ──────────────────────────────────────────────────────
  const [rdList, setRdList]             = useState([]);
  const [rdSummary, setRdSummary]       = useState({});
  const [rdLoading, setRdLoading]       = useState(false);
  const [showRdForm, setShowRdForm]     = useState(false);
  const [editingRd, setEditingRd]       = useState(null);
  const [rdSaving, setRdSaving]         = useState(false);
  const [rdError, setRdError]           = useState('');
  const [rdForm, setRdForm]             = useState({});
  const [bulkLinking, setBulkLinking]          = useState(false);
  const [bulkProgress, setBulkProgress]        = useState({ current: 0, total: 0 });
  const [bulkLinkResult, setBulkLinkResult]    = useState(null);  // {linked, skipped} — bulk link all to one goal
  const [picUploading, setPicUploading]       = useState(false);
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
    // Auto-refresh prices silently on login (no spinner, background call)
    portfolioAPI.syncPrices().then(() => loadPortfolio()).catch(() => {});
    loadGoals();
    loadFDs();
    loadRDs();
    loadHistory(5);
    loadNPS();
    console.log('[Kanalyst] Dashboard v3 loaded - goal linking active');
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

    // Load MF total for net worth tile
    mfAPI.get().then(r => setMfData(r.data)).catch(() => {});

    // Handle OAuth callback
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) { setSyncResult({ success: true, message: `${connected} connected!` }); }
    if (error) { setSyncResult({ success: false, message: 'Connection failed. Please try again.' }); }
  }, [loadPortfolio, searchParams]);

  // Auto-scan income every 30 mins
  useEffect(() => {
    const run = () => { if (incomeRules.length > 0) incomeAPI.scan().catch(() => {}); };
    const interval = setInterval(run, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [incomeRules.length]);

  // ── Expense handlers ─────────────────────────────────────────────
  const loadExpenses = async () => {
    try {
      const [rulesRes, catsRes] = await Promise.all([
        api.get('/api/expense/rules'), api.get('/api/expense/categories')
      ]);
      const entriesRes = familyMode
        ? await familyAPI.combinedExpenses()
        : await api.get('/api/expense/entries');
      setExpenseEntries(entriesRes.data.entries || []);
      setExpenseSummary(entriesRes.data.summary || { currentFYTotal:0, thisMonthTotal:0, byCategory:{}, byMonth:{}, fyLabel:'FY26', uncategorized:0 });
      setExpenseRules(rulesRes.data || []);
      setExpenseCategories(catsRes.data || {});
    } catch(e) { console.error('loadExpenses', e); }
  };

  const scanExpenses = async () => {
    setExpenseScanning(true); setExpenseScanResult(null);
    try {
      const r = await api.post('/api/expense/scan');
      setExpenseScanResult({
        success:      true,
        message:      r.data.message,
        found:        r.data.found        || 0,
        emailsFound:  r.data.emailsFound  || 0,
        emailsRead:   r.data.emailsRead   || 0,
        rulesApplied: r.data.rulesApplied || 0,
        ruleResults:  r.data.ruleResults  || [],
      });
      await loadExpenses();
    } catch(e) {
      setExpenseScanResult({ success:false, message: e.response?.data?.error || 'Scan failed. Check Gmail is connected.' });
    } finally { setExpenseScanning(false); }
  };

  const saveExpenseEntry = async () => {
    if (!expenseEntryForm.amount || !expenseEntryForm.expense_date) return;
    setExpenseEntrySaving(true);
    try {
      await api.post('/api/expense/entries', expenseEntryForm);
      setShowExpenseEntry(false);
      setExpenseEntryForm({ category:'', sub_category:'', amount:'', expense_date:new Date().toISOString().split('T')[0], merchant_name:'', comments:'' });
      await loadExpenses();
    } catch(e) { console.error(e); }
    finally { setExpenseEntrySaving(false); }
  };

  const updateExpenseCategory = async (id, category, sub_category, merchant_name) => {
    try {
      await api.put(`/api/expense/entries/${id}`, { category, sub_category, merchant_name });
      setEditingExpense(null);
      await loadExpenses();
    } catch(e) { console.error(e); }
  };

  const deleteExpenseEntry = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await api.delete(`/api/expense/entries/${id}`).catch(()=>{});
    await loadExpenses();
  };

  const autoCategorizeMerchant = async (merchant) => {
    if (!merchant) return null;
    try {
      const r = await api.post('/api/expense/categorize', { merchant_name: merchant });
      return r.data;
    } catch(e) { return null; }
  };

  const saveExpenseRule = async () => {
    if (!expenseRuleForm.rule_name) return;
    setExpenseRuleSaving(true);
    try {
      if (editingExpenseRule) await api.put(`/api/expense/rules/${editingExpenseRule.id}`, expenseRuleForm);
      else                    await api.post('/api/expense/rules', expenseRuleForm);
      setShowExpenseRuleForm(false); setEditingExpenseRule(null);
      setExpenseRuleForm({ rule_name:'', email_sender:'', subject_pattern:'', body_pattern:'', lookback_months:'0' });
      await loadExpenses();
    } catch(e) { console.error(e); }
    finally { setExpenseRuleSaving(false); }
  };

  // Auto-scan expenses every 30 mins
  useEffect(() => {
    const interval = setInterval(() => {
      incomeAPI.scan().catch(() => {});
      api.post('/api/expense/scan').catch(() => {});
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  // ── Family handlers ──────────────────────────────────────────────
  const loadFamilyStatus = async () => {
    setFamilyLoading(true);
    try {
      const r = await familyAPI.status();
      setFamilyStatus(r.data);
    } catch(e) { console.error(e); }
    finally { setFamilyLoading(false); }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true); setInviteResult(null);
    try {
      const r = await familyAPI.invite({ email: inviteEmail.trim() });
      setInviteResult({ success: true, message: r.data.message });
      setInviteEmail('');
      await loadFamilyStatus();
    } catch(e) {
      setInviteResult({ success: false, message: e.response?.data?.error || 'Failed to send invite' });
    } finally { setInviteSending(false); }
  };

  const respondInvite = async (id, action) => {
    try {
      if (action === 'accept') await familyAPI.acceptInvite(id);
      else                     await familyAPI.rejectInvite(id);
      await loadFamilyStatus();
      if (action === 'accept') await loadFamilyData(); // refresh all data in family mode
    } catch(e) { console.error(e); }
  };

  const removeFamilyMember = async (memberId) => {
    if (!window.confirm('Remove this member from your family?')) return;
    await familyAPI.removeMember(memberId).catch(() => {});
    await loadFamilyStatus();
    if (familyMode) await loadFamilyData();
  };

  // Load all combined data when family mode is toggled on
  const loadFamilyData = async () => {
    try {
      const [portRes, mfRes] = await Promise.all([
        familyAPI.combinedPortfolio(),
        familyAPI.combinedMF(),
      ]);
      // Merge into existing portfolio state with _member tag
      setPortfolio({
        holdings: portRes.data.holdings,
        summary: {
          ...portRes.data.summary,
          totalMarket: portRes.data.summary?.totalValue || 0,
        }
      });
      const mfHoldingsData = mfRes.data.holdings || [];
      const mfTotalValue   = mfRes.data.totalValue ||
        mfHoldingsData.reduce((s,h) => s + parseFloat(h.current_value||0), 0);
      const mfTotalCost    = mfHoldingsData.reduce((s,h) => s + parseFloat(h.total_cost||h.avg_cost||0), 0);
      setMfData({
        holdings: mfHoldingsData,
        summary: {
          totalValue:    mfTotalValue,
          count:         mfHoldingsData.length,
          gainLoss:      mfTotalValue - mfTotalCost,
          gainLossPct:   mfTotalCost > 0 ? ((mfTotalValue - mfTotalCost) / mfTotalCost * 100).toFixed(2) : 0,
          byFundHouse:   [],
          lastStatement: null,
        }
      });
    } catch(e) { console.error('loadFamilyData', e); }
  };

  // Toggle family mode
  const toggleFamilyMode = async () => {
    const next = !familyMode;
    setFamilyMode(next);
    if (next) {
      await loadFamilyData();
    } else {
      // Reload individual data
      await loadPortfolio();
      mfAPI.get().then(r => setMfData(r.data)).catch(() => {});
    }
  };

  // Load family status on mount if in a family
  useEffect(() => {
    loadFamilyStatus();
  // eslint-disable-line
  }, []); // eslint-disable-line

  // ── Goals handlers ──────────────────────────────────────────────
  const loadGoals = async () => {
    try {
      const r = familyMode
        ? await familyAPI.combinedGoals()
        : await goalsAPI.getAll();
      setGoals(r.data.goals || []);
      setGoalsSummary(r.data.summary || {});
    } catch(e) { console.error('loadGoals', e); }
  };

  const saveGoal = async () => {
    if (!goalForm.name || !goalForm.target_value) return;
    setGoalFormSaving(true);
    try {
      if (editingGoal) await goalsAPI.update(editingGoal.id, goalForm);
      else             await goalsAPI.create(goalForm);
      setShowGoalForm(false); setEditingGoal(null);
      setGoalForm({ name:'', description:'', target_value:'', duration_type:'mid', target_date:'', is_recurring:false, recurrence:'monthly', recurrence_day:'1', recurrence_month:'' });
      await loadGoals();
    } catch(e) { console.error(e); }
    setGoalFormSaving(false);
  };

  const deleteGoal = async (id) => {
    if (!window.confirm('Delete this goal? All linked assets will be unlinked.')) return;
    await goalsAPI.delete(id).catch(() => {});
    setGoalDetail(null);
    await loadGoals();
  };

  const openGoalDetail = async (goal) => {
    // Fetch fresh goal data (includes latest assets)
    try {
      const fresh = await goalsAPI.getAll();
      const freshGoal = (fresh.data.goals || []).find(g => g.id === goal.id) || goal;
      setGoalDetail(freshGoal);
      setGoals(fresh.data.goals || []);
      setGoalsSummary(fresh.data.summary || {});
    } catch(e) {
      setGoalDetail(goal);
    }
    const r = await goalsAPI.getCycles(goal.id).catch(() => ({ data: [] }));
    setGoalCycles(r.data || []);
  };

  const uploadGoalPic = async (goalId, file) => {
    if (!file) return;
    setPicUploading(true);
    const form = new FormData(); form.append('file', file);
    await goalsAPI.uploadPic(goalId, form).catch(() => {});
    await loadGoals();
    setPicUploading(false);
  };

  const linkAssetToGoal = async (goalId, assetType, assetRef, assetName) => {
    await goalsAPI.linkAsset(goalId, { asset_type: assetType, asset_ref: assetRef, asset_name: assetName }).catch(() => {});
    await loadGoals();
    setLinkingGoalId(null);
  };

  // Link a specific holding to a chosen goal (from the holdings table)
  const linkHoldingToGoal = async (goalId) => {
    if (!linkingAsset || !goalId) return;
    try {
      await goalsAPI.linkAsset(goalId, {
        asset_type: linkingAsset.type,
        asset_ref:  linkingAsset.ref,
        asset_name: linkingAsset.name,
      });
      setLinkingAsset(null);
      await smoothRefresh();
      goalsAPI.recompute(goalId).catch(() => {});
    } catch(e) {
      if (e.response?.data?.error?.includes('already linked')) {
        alert('This holding is already linked to that goal.');
      } else {
        console.error(e);
      }
    }
  };

  // Bulk-link ALL holdings of a type to one goal
  const bulkLinkToGoal = async (goalId) => {
    if (!bulkLinkMode || !goalId) return;
    setBulkLinking(true);
    setBulkLinkResult(null);
    const items = bulkLinkMode === 'stock'
      ? holdings.map(h => ({ type:'stock', ref: h.isin||h.symbol, name: h.company||h.symbol }))
      : mfHoldings.map(h => ({ type:'mf', ref: h.isin||h.folio_number, name: h.fund_name||h.scheme_name||h.isin }));
    const total = items.length;
    setBulkProgress({ current: 0, total });
    let linked = 0, skipped = 0;
    for (let i = 0; i < items.length; i++) {
      setBulkProgress({ current: i + 1, total });
      try {
        await goalsAPI.linkAsset(goalId, { asset_type: items[i].type, asset_ref: items[i].ref, asset_name: items[i].name });
        linked++;
      } catch(e) { skipped++; }
    }
    setBulkLinking(false);
    setBulkProgress({ current: 0, total: 0 });
    setBulkLinkResult({ linked, skipped });
    await smoothRefresh();
    goalsAPI.recompute(goalId).catch(()=>{});
  };

  // Unlink a holding directly from the row (without opening goal detail)
  const unlinkFromRow = async (goal, assetRef) => {
    const asset = goal.assets?.find(a => a.asset_ref === assetRef);
    if (!asset) return;
    if (!window.confirm(`Remove link to "${goal.name}"?`)) return;
    try {
      await goalsAPI.unlinkAsset(goal.id, asset.id);
      goalsAPI.recompute(goal.id).catch(() => {});
      await smoothRefresh();
    } catch(e) { console.error('unlinkFromRow', e); }
  };

  const unlinkAsset = async (goalId, assetId) => {
    await goalsAPI.unlinkAsset(goalId, assetId).catch(() => {});
    if (goalDetail?.id === goalId) openGoalDetail({ ...goalDetail });
    await loadGoals();
  };

  // Sync MF NAV from AMFI
  const syncMFNav = async () => {
    setSyncingNAV(true); setNavSyncResult(null);
    try {
      const r = await mfAPI.syncNAV();
      setNavSyncResult({ success: true, message: r.data.message, updated: r.data.updated, total: r.data.total });
      await smoothRefresh();
    } catch(e) {
      setNavSyncResult({ success: false, message: e.response?.data?.error || 'NAV sync failed' });
    } finally { setSyncingNAV(false); }
  };

  // ── FD handlers ──────────────────────────────────────────────────
  const loadFDs = async () => {
    setFdLoading(true);
    try {
      const r = await fdAPI.getAll();
      setFdList(r.data.fds || []);
      setFdSummary(r.data.summary || {});
    } catch(e) { console.error(e); } finally { setFdLoading(false); }
  };

  const openFdForm = (fd = null) => {
    setEditingFd(fd);
    setFdError('');
    if (fd) {
      // Parse tenor_days back to Y/M/D
      const years = Math.floor(fd.tenor_days / 365);
      const rem   = fd.tenor_days % 365;
      const months = Math.floor(rem / 30);
      const days  = rem % 30;
      setFdForm({ ...fd, tenor_years: String(years), tenor_months_part: String(months), tenor_days_part: String(days), goal_id: fd.goal_id || '', goal_earmark_pct: String(fd.goal_earmark_pct || 100) });
    } else {
      setFdForm({institution_name:'',institution_type:'bank',nickname:'',branch_ref:'',principal_amount:'',interest_rate_pa:'',compounding_freq:'quarterly',payout_type:'cumulative',payout_frequency:'',start_date:'',tenor_days:'',tenor_years:'',tenor_months_part:'',tenor_days_part:'',on_maturity_action:'undecided',auto_renew_type:'',tds_applicable:true,form_15g:false,tds_rate:'10',is_tax_saving_fd:false,is_senior_rate:false,goal_id:'',goal_earmark_pct:'100',notes:''});
    }
    setShowFdForm(true);
  };

  const saveFd = async () => {
    setFdSaving(true); setFdError('');
    try {
      // Compute tenor_days from Y/M/D parts
      const tenor = (parseInt(fdForm.tenor_years||0)*365) + (parseInt(fdForm.tenor_months_part||0)*30) + parseInt(fdForm.tenor_days_part||0);
      if (tenor < 7) { setFdError('Tenor must be at least 7 days'); setFdSaving(false); return; }
      const payload = { ...fdForm, tenor_days: tenor, tds_applicable: fdForm.form_15g ? false : fdForm.tds_applicable, goal_id: fdForm.goal_id || null };
      if (editingFd) await fdAPI.update(editingFd.fd_id, payload);
      else           await fdAPI.create(payload);
      setShowFdForm(false);
      await loadFDs();
    } catch(e) { setFdError(e.response?.data?.error || 'Save failed'); }
    finally { setFdSaving(false); }
  };

  const deleteFd = async (id) => {
    if (!window.confirm('Delete this Fixed Deposit?')) return;
    await fdAPI.delete(id).catch(() => {});
    await loadFDs();
  };

  // ── RD handlers ──────────────────────────────────────────────────
  const loadRDs = async () => {
    setRdLoading(true);
    try {
      const r = await rdAPI.getAll();
      setRdList(r.data.rds || []);
      setRdSummary(r.data.summary || {});
    } catch(e) { console.error(e); } finally { setRdLoading(false); }
  };

  const openRdForm = (rd = null) => {
    setEditingRd(rd);
    setRdError('');
    setRdForm(rd ? { ...rd, goal_id: rd.goal_id||'', goal_earmark_pct: String(rd.goal_earmark_pct||100) } : {institution_name:'',institution_type:'bank',nickname:'',account_reference:'',monthly_installment:'',interest_rate_pa:'',compounding_freq:'quarterly',start_date:'',tenure_months:'',missed_installments:'0',penalty_per_100:'1.50',tds_applicable:true,form_15g:false,tds_rate:'10',is_senior_rate:false,goal_id:'',goal_earmark_pct:'100',notes:''});
    setShowRdForm(true);
  };

  const saveRd = async () => {
    setRdSaving(true); setRdError('');
    try {
      const payload = { ...rdForm, tds_applicable: rdForm.form_15g ? false : rdForm.tds_applicable, goal_id: rdForm.goal_id || null };
      if (editingRd) await rdAPI.update(editingRd.rd_id, payload);
      else           await rdAPI.create(payload);
      setShowRdForm(false);
      await loadRDs();
    } catch(e) { setRdError(e.response?.data?.error || 'Save failed'); }
    finally { setRdSaving(false); }
  };

  const deleteRd = async (id) => {
    if (!window.confirm('Delete this Recurring Deposit?')) return;
    await rdAPI.delete(id).catch(() => {});
    await loadRDs();
  };

  // Smooth global refresh - reloads all data with fade animation
  const smoothRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadPortfolio(),
      mfAPI.get().then(r => setMfData(r.data)).catch(() => {}),
      loadGoals(),
      loadFDs(),
      loadRDs(),
      loadHistory(historyYears),
      loadNPS(),
    ]);
    setRefreshing(false);
  };

  // ── Portfolio History handlers ──────────────────────────────────
  const loadHistory = async (years = historyYears) => {
    setHistoryLoading(true);
    try {
      const r = await portfolioHistoryAPI.get(years);
      setHistoryData(r.data.snapshots || []);
      setHistorySummary(r.data.summary || {});
    } catch(e) { console.error(e); }
    finally { setHistoryLoading(false); }
  };

  const loadHistoryDetail = async (date) => {
    setHistoryDetailDate(date);
    try {
      const r = await portfolioHistoryAPI.detail(date);
      setHistoryDetail(r.data);
    } catch(e) { setHistoryDetail(null); }
  };

  const startBackfill = async () => {
    setBackfilling(true); setBackfillResult(null);
    try {
      const r = await portfolioHistoryAPI.backfill(backfillFromDate || null, backfillToDate || null);
      setBackfillResult({ success: true, message: r.data.message });
      // Poll for completion - reload history after 30s
      setTimeout(() => loadHistory(historyYears), 30000);
    } catch(e) {
      setBackfillResult({ success: false, message: e.response?.data?.error || 'Backfill failed' });
    } finally { setBackfilling(false); }
  };

  // ── NPS handlers ─────────────────────────────────────────────────
  const loadNPS = async () => {
    try {
      const r = await npsAPI.get();
      console.log('[NPS] API response:', JSON.stringify(r.data).slice(0, 300));
      if (r.data && (r.data.latest !== undefined)) {
        setNpsData(r.data);
      } else {
        console.error('[NPS] Unexpected response shape:', r.data);
      }
    } catch(e) {
      console.error('[NPS] loadNPS failed:', e.message, e.response?.data);
    }
  };

  const syncNPS = async () => {
    setNpsSyncing(true); setNpsSyncResult(null);
    try {
      const r = await npsAPI.sync(npsFromDate || null);
      setNpsSyncResult({ success: true, message: r.data.message });
      setTimeout(() => loadNPS(), 25000); // reload after async processing
    } catch(e) {
      setNpsSyncResult({ success: false, message: e.response?.data?.error || 'Sync failed' });
    } finally { setNpsSyncing(false); }
  };

  const saveNpsManual = async () => {
    setNpsSaving(true); setNpsError('');
    try {
      await npsAPI.manual(npsForm);
      setShowNpsForm(false);
      await loadNPS();
    } catch(e) { setNpsError(e.response?.data?.error || 'Save failed'); }
    finally { setNpsSaving(false); }
  };

  const loadTab = async (t) => {
    setTab(t);
    if (t === 'transactions' && transactions.length === 0) {
      const r = await portfolioAPI.transactions().catch(() => ({ data: [] }));
      setTransactions(r.data);
    }
    if (t === 'income')   { await loadIncome();   return; }
    if (t === 'expenses') { await loadExpenses(); return; }
    if (t === 'goals')    { await loadGoals();    return; }
    if (t === 'bankdeposits') { await Promise.all([loadFDs(), loadRDs(), loadNPS()]); return; }
    if (t === 'nps') { await loadNPS(); return; }
    if (t === 'holdings' || t === 'mutualfunds') { if (goals.length === 0) loadGoals(); if (t === 'holdings' && historyData.length === 0) loadHistory(historyYears); }
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
      await smoothRefresh();
      if (tab === 'holdings') setTab('holdings');
    }
  };

  const syncPrices = async () => {
    setSyncingPrices(true); setSyncResult(null);
    try {
      const r = await portfolioAPI.syncPrices();
      setSyncResult({ success: true, message: r.data.message });
      await smoothRefresh();
    } catch (e) {
      setSyncResult({ success: false, message: e.response?.data?.error || 'Price sync failed' });
    } finally { setSyncingPrices(false); }
  };

  // ── Income handlers ──────────────────────────────────────────────
  const loadIncome = async () => {
    try {
      const [rulesRes, banksRes] = await Promise.all([
        incomeAPI.getRules(), incomeAPI.getBanks()
      ]);
      setIncomeRules(rulesRes.data || []);
      // Family mode: merge all members' income
      const entriesRes = familyMode
        ? await familyAPI.combinedIncome()
        : await incomeAPI.getEntries();
      const entries = familyMode
        ? (entriesRes.data.entries || [])
        : (entriesRes.data.entries || []);
      setIncomeEntries(entries);
      setIncomeSummary(entriesRes.data.summary || { currentFYTotal:0, thisMonthTotal:0, byCategory:{}, byMonth:{}, fyLabel:'FY26' });
      setIndianBanks(banksRes.data || []);
    } catch(e) { console.error('loadIncome', e); }
  };

  const openIncomeSettings = () => {
    setShowSettings(false);
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
      setIncomeScanResult({
        success:      true,
        message:      r.data.message,
        found:        r.data.found        || 0,
        emailsFound:  r.data.emailsFound  || 0,
        emailsRead:   r.data.emailsRead   || 0,
        rulesApplied: r.data.rulesApplied || 0,
        ruleResults:  r.data.ruleResults  || [],
        scannedAt:    r.data.scannedAt,
      });
      await loadIncome(); // always reload to refresh list
    } catch(e) {
      setIncomeScanResult({ success: false, message: e.response?.data?.error || 'Scan failed. Check Gmail is connected.' });
    } finally { setIncomeScanning(false); }
  };

  const openRuleForm = (rule = null) => {
    if (rule) {
      setRuleForm({
        rule_name:       rule.rule_name       || '',
        category:        rule.category        || 'Salary',
        receive_bank:    rule.receive_bank    || '',
        bank_sender:     rule.bank_sender     || '',
        subject_pattern: rule.subject_pattern || '',
        body_pattern:    rule.body_pattern    || '',
        account_last4:   rule.account_last4   || '',
        min_amount:      rule.min_amount      || '',
        period:          rule.period          || 'monthly',
        remark:          rule.remark          || '',
        date_day_from:   String(rule.date_day_from  ?? 28),
        date_day_to:     String(rule.date_day_to    ?? 5),
        lookback_months: String(rule.lookback_months ?? 0),
        credit_only:     rule.credit_only !== false,
      });
      setEditingRule(rule);
    } else {
      setRuleForm({ rule_name:'', category:'Salary', receive_bank:'', bank_sender:'',
        subject_pattern:'', body_pattern:'', account_last4:'', min_amount:'',
        period:'monthly', remark:'', date_day_from:'', date_day_to:'',
        lookback_months:'0', credit_only: true });
      setEditingRule(null);
    }
    setRuleError('');
    setShowRuleForm(true);
  };

  const saveRule = async () => {
    if (!ruleForm.rule_name.trim())  { setRuleError('Rule name is required'); return; }
    if (!ruleForm.receive_bank.trim()) { setRuleError('Receive bank is required — select which bank receives the money'); return; }
    if (!ruleForm.category.trim())   { setRuleError('Category is required'); return; }
    setRuleSaving(true); setRuleError('');
    try {
      const payload = {
        rule_name:       ruleForm.rule_name,
        category:        ruleForm.category,
        receive_bank:    ruleForm.receive_bank,
        bank_sender:     ruleForm.bank_sender     || null,
        subject_pattern: ruleForm.subject_pattern || null,
        body_pattern:    ruleForm.body_pattern    || null,
        account_last4:   ruleForm.account_last4   || null,
        min_amount:      parseFloat(ruleForm.min_amount) || 0,
        period:          ruleForm.period,
        remark:          ruleForm.remark          || null,
        date_day_from:   parseInt(ruleForm.date_day_from)   || 28,
        date_day_to:     parseInt(ruleForm.date_day_to)     || 5,
        lookback_months: parseInt(ruleForm.lookback_months) || 0,
        credit_only:     ruleForm.credit_only !== false,
      };
      if (editingRule) await incomeAPI.updateRule(editingRule.id, payload);
      else             await incomeAPI.createRule(payload);
      setShowRuleForm(false);
      await loadIncome();
    } catch(e) {
      setRuleError(e.response?.data?.error || 'Save failed');
    } finally { setRuleSaving(false); }
  };

  const addManualEntry = async () => {
    if (!manualEntryForm.amount || !manualEntryForm.credited_on) return;
    setManualEntrySaving(true);
    try {
      await incomeAPI.addEntry(manualEntryForm);
      setShowManualEntry(false);
      setManualEntryForm({ category:'Salary', amount:'', credited_on: new Date().toISOString().split('T')[0], description:'', receive_bank:'' });
      await loadIncome();
    } catch(e) { console.error(e); }
    finally { setManualEntrySaving(false); }
  };

  const deleteIncomeEntry = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    await incomeAPI.deleteEntry(id).catch(() => {});
    await loadIncome();
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
  const holdings   = portfolio?.holdings || [];
  const mfHoldings = mfData?.holdings  || [];

  // Member badge for family mode
  const MemberBadge = ({ entry }) => {
    if (!familyMode || !entry?._member) return null;
    return (
      <span style={{
        fontSize:9, padding:'1px 6px', borderRadius:10, fontWeight:700,
        background: entry._isMe ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.12)',
        color:      entry._isMe ? '#818cf8' : '#f59e0b',
        marginLeft: 5, whiteSpace:'nowrap',
      }}>
        {entry._isMe ? 'You' : entry._member}
      </span>
    );
  };

  // Sector data for chart
  const sectorData = Object.entries(
    holdings.reduce((acc, h) => {
      acc[h.sector] = (acc[h.sector] || 0) + h.marketValue;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: Math.round(value) }));

  // Real portfolio history from snapshots (live data)
  const growthData = historyData.length > 0
    ? historyData.map(snap => {
        const dt = new Date(snap.snapshot_date + 'T00:00:00');
        return {
          month:    dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
          fullDate: snap.snapshot_date,
          cost:     parseFloat(snap.total_invested   || 0),
          market:   parseFloat(snap.total_value      || 0),
          equity:   parseFloat(snap.total_equity_value || 0),
          mf:       parseFloat(snap.total_mf_value   || 0),
        };
      })
    : [{ month: 'Now', fullDate: null, cost: s.totalCost || 0, market: s.totalMarket || 0, equity: 0, mf: 0 }];

  if (loading) return (
    <div className="db-loading">
      <div className="db-spinner"></div>
      <p>Loading your portfolio…</p>
    </div>
  );

  return (
    <div className="db-layout">
      <style>{`
        @keyframes kanalyst-fadein { from { opacity:0.3; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
        @keyframes kanalyst-pulse  { 0%,100%{ opacity:1; } 50%{ opacity:0.45; } }
        .kv-refresh { animation: kanalyst-fadein 0.35s ease; }
        .kv-loading { animation: kanalyst-pulse 1.2s ease infinite; pointer-events:none; }
        @keyframes kanalyst-valueup { 0%{color:inherit;} 40%{color:#00d4a1;transform:scale(1.04);} 100%{color:inherit;transform:scale(1);} }
        @keyframes kanalyst-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .kv-value-up   { animation: kanalyst-valueup 0.6s ease; }
        .kv-refresh-row{ animation: kanalyst-fadein 0.4s ease; }
        .kv-shimmer    { background:linear-gradient(90deg,#1e3a5f 25%,#2a4a6f 50%,#1e3a5f 75%); background-size:200% 100%; animation:kanalyst-shimmer 1.5s infinite; border-radius:6px; }
      `}</style>
      {/* SIDEBAR */}
      <aside className="db-sidebar">
        <div className="db-logo">
          <div className="db-logo-mark">Kanalyst</div>
          <div className="db-logo-sub">See yourself, financially</div>
        </div>

        <nav className="db-nav">
          <div className="db-nav-label">Overview</div>
          <div className={`db-nav-item ${tab==='dashboard'?'active':''}`} onClick={()=>loadTab('dashboard')}><span>⬡</span> Dashboard</div>
          <div className={`db-nav-item ${tab==='holdings'?'active':''}`} onClick={()=>loadTab('holdings')}><span>◈</span> Stock Holdings</div>
          <div className={`db-nav-item ${tab==='mutualfunds'?'active':''}`} onClick={()=>loadTab('mutualfunds')}><span>◉</span> Mutual Funds</div>
          <div className={`db-nav-item ${tab==='dividends'?'active':''}`} onClick={()=>loadTab('dividends')}><span>◎</span> Dividends</div>
          <div className={`db-nav-item ${tab==='transactions'?'active':''}`} onClick={()=>loadTab('transactions')}><span>⇄</span> Transactions</div>
          <div className={`db-nav-item ${tab==='bankdeposits'?'active':''}`} onClick={()=>loadTab('bankdeposits')}><span>🏦</span> Bank Deposits</div>
          <div className={`db-nav-item ${tab==='nps'?'active':''}`} onClick={()=>loadTab('nps')}><span>🏛</span> NPS</div>

          <div className="db-nav-label" style={{marginTop:12}}>Finance</div>
          <div className={`db-nav-item ${tab==='income'?'active':''}`} onClick={()=>loadTab('income')}><span>₹</span> Income</div>
          <div className={`db-nav-item ${tab==='expenses'?'active':''}`} onClick={()=>loadTab('expenses')}><span>💸</span> Expenses</div>
          <div className={`db-nav-item ${tab==='goals'?'active':''}`} onClick={()=>loadTab('goals')}><span>🎯</span> Goals</div>

          <div className="db-nav-label" style={{marginTop:12}}>Analytics</div>
          <div className={`db-nav-item ${tab==='tax'?'active':''}`} onClick={()=>loadTab('tax')}><span>⊞</span> Tax Summary</div>
          <div className={`db-nav-item ${tab==='admin'?'active':''}`} onClick={()=>loadTab('admin')}><span>⚙</span> Sync Logs</div>
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
          <button className="db-connect-btn" style={{marginTop:6,background:'#0f172a',border:'1px solid #1e3a5f',color:'#94a3b8'}}
            onClick={() => { setSettingsSection('income'); setShowSettings(true); }}>
            ⚙ Settings
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
            {/* Privacy toggle - eye button */}
            {/* Refresh indicator */}
            {refreshing && (
              <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#475569'}}>
                <div style={{width:12,height:12,borderRadius:'50%',border:'2px solid #1e3a5f',borderTopColor:'#6366f1',animation:'kanalyst-pulse 0.6s linear infinite'}}/>
                <span>Refreshing…</span>
              </div>
            )}
            {/* Family mode toggle - only shown if user is in a family */}
            {familyStatus.inFamily && (
              <button
                onClick={toggleFamilyMode}
                title={familyMode ? 'Switch to personal view' : 'Switch to family view'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: familyMode ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${familyMode ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                  transition: 'all 0.2s', color: familyMode ? '#818cf8' : '#64748b',
                  fontSize: 12, fontWeight: 600,
                }}>
                <span style={{ fontSize: 14 }}>👨‍👩‍👧‍👦</span>
                {familyMode ? 'Family View' : 'Personal'}
              </button>
            )}

            {/* Pending invites bell */}
            {familyStatus.pendingInvites?.length > 0 && (
              <button
                onClick={() => { setSettingsSection('family'); setShowSettings(true); }}
                title={`${familyStatus.pendingInvites.length} pending family invite`}
                style={{ position:'relative', background:'none', border:'none', cursor:'pointer', fontSize:20, padding:'4px 6px' }}>
                🔔
                <span style={{ position:'absolute', top:0, right:0, background:'#f43f5e', color:'#fff', borderRadius:'50%', fontSize:9, width:14, height:14, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>
                  {familyStatus.pendingInvites.length}
                </span>
              </button>
            )}

            <button
              onClick={toggleHide}
              title={hideValues ? 'Show dashboard values' : 'Hide dashboard values'}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 20, lineHeight: 1,
                opacity: hideValues ? 0.4 : 0.75,
                transition: 'opacity 0.2s',
                padding: '4px 6px',
              }}>
              {hideValues ? '🙈' : '👁'}
            </button>
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

        {/* Family mode banner */}
        {familyMode && familyStatus.inFamily && (
          <div style={{display:'flex',alignItems:'center',gap:12,padding:'8px 28px',background:'rgba(99,102,241,0.08)',borderBottom:'1px solid rgba(99,102,241,0.2)',fontSize:12,color:'#818cf8'}}>
            <span style={{fontSize:16}}>👨‍👩‍👧‍👦</span>
            <span style={{fontWeight:600}}>Family View</span>
            <span style={{color:'#475569'}}>•</span>
            <span style={{color:'#64748b'}}>
              Combined data from {familyStatus.members.length} member{familyStatus.members.length!==1?'s':''}:{' '}
              {familyStatus.members.map(m=>m.isMe?'You':m.name).join(', ')}
            </span>
            <button onClick={toggleFamilyMode} style={{marginLeft:'auto',background:'none',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',borderRadius:6,padding:'3px 10px',cursor:'pointer',fontSize:11}}>
              Switch to personal
            </button>
          </div>
        )}

        {syncResult && (
          <div className={`db-banner ${syncResult.success === true ? 'success' : syncResult.pdfLocked ? 'info' : syncResult.success === false ? 'error' : 'info'}`}>
            {syncResult.success === true
              ? syncResult.holdingsSaved != null
                ? `✅ Synced ${syncResult.holdingsSaved} holdings from ${syncResult.casType || 'CAS'}`
                : `✅ ${syncResult.message || 'Sync complete!'}`
              : syncResult.pdfLocked
              ? `🔒 ${syncResult.message}`
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
                const stocksVal   = s.totalMarket || 0;
                const fdRdVal     = (fdSummary.totalCurrentValue||0) + (rdSummary.totalCurrentValue||0);
                const mfVal       = mfData?.summary?.totalValue || 0;
                const npsVal = parseFloat(npsData.latest?.total_value||0);
                const otherAssets = (assetBalances.ppf||0) + (assetBalances.epf||0) + npsVal + fdRdVal + (assetBalances.ssy||0);
                const totalNetWorth = stocksVal + mfVal + otherAssets;
                const totalCredit = (liabilities.homeLoan||0) + (liabilities.creditCard||0);

                const pieData = [
                  { name: 'Stocks', value: stocksVal, color: '#64ffda' },
                  { name: 'Mutual Funds', value: mfVal, color: '#a78bfa' },
                  { name: 'PPF', value: assetBalances.ppf||0, color: '#ffd700' },
                  { name: 'EPF', value: assetBalances.epf||0, color: '#00bcd4' },
                  { name: 'NPS', value: npsVal, color: '#b39ddb' },
                  { name: 'Bank Deposits', value: fdRdVal, color: '#ff8a65' },
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
                  {/* Family combined bar - only in family mode */}
                  {familyMode && familyStatus.inFamily && (() => {
                    const fTotal    = holdings.reduce((s,h)=>s+(h.marketValue||0),0);
                    const fInvested = holdings.reduce((s,h)=>s+((h.quantity||0)*(h.avg_cost||0)),0);
                    const fPnl      = fTotal - fInvested;
                    return (
                      <div style={{background:'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08))',border:'1px solid rgba(99,102,241,0.25)',borderRadius:12,padding:'14px 20px',marginBottom:16,display:'flex',gap:28,alignItems:'center',flexWrap:'wrap'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:18}}>👨‍👩‍👧‍👦</span>
                          <span style={{color:'#818cf8',fontWeight:700,fontSize:13}}>Family Portfolio</span>
                        </div>
                        {[
                          {label:'Combined Value',  val:fmtFull(fTotal),    color:'#64ffda', cls:'kv-refresh'},
                          {label:'Total Invested',  val:fmtFull(fInvested), color:'#94a3b8'},
                          {label:'Total P&L',       val:fmtFull(fPnl),      color:fPnl>=0?'#00d4a1':'#f43f5e'},
                          {label:'Holdings',        val:holdings.length+' stocks', color:'#818cf8'},
                        ].map(stat=>(
                          <div key={stat.label}>
                            <div style={{color:'#475569',fontSize:10,fontWeight:600,letterSpacing:0.5,marginBottom:2}}>{stat.label}</div>
                            <div style={{color:stat.color,fontWeight:700,fontSize:16}}>{stat.val}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Top 5 tiles */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
                    {[
                      { label:'Total Net Worth', val: hideValues ? '₹ ••••' : fmt(totalNetWorth), sub: hideValues ? '—' : 'All assets combined', color:'#64ffda', icon:'💰' },
                      { label:'Dividend Income FY26', val: hideValues ? '₹ ••••' : fmt(dividendTotal||0), sub: hideValues ? '—' : dividendTotal > 0 ? `${s.yieldOnMarket||0}% yield on market` : 'Sync dividends to update', color:'#ffd700', icon:'💸' },
                      { label:'Outstanding Credit', val: hideValues ? '₹ ••••' : fmt(totalCredit), sub: hideValues ? '—' : 'Loans + Credit Cards', color: totalCredit > 0 ? '#ff6b6b':'#888', icon:'🏦' },
                      { label:'Monthly Income', val: hideValues ? '₹ ••••' : fmt(monthlyIncome), sub: hideValues ? '—' : 'Salary this month', color:'#00bcd4', icon:'💼' },
                      { label:'This Month Expenses', val: hideValues ? '₹ ••••' : fmt(monthlyExpenses), sub: hideValues ? '—' : 'From transactions', color: monthlyExpenses > monthlyIncome*0.8 ? '#ff8a65':'#b39ddb', icon:'🧾' },
                    ].map(t => (
                      <div key={t.label}
                        className={refreshing ? 'kv-loading' : 'kv-refresh'}
                        style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:'16px 14px', border:'1px solid rgba(255,255,255,0.08)', cursor:'default', transition:'opacity 0.3s' }}>
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
                <div className="db-card" style={{gridColumn:'span 2'}}>
                  <div className="db-card-header">
                    <div>
                      <div className="db-card-title">📈 Portfolio History</div>
                      <div className="db-card-sub">{historyData.length > 0 ? `${historyData.length} snapshots · ${historySummary.dateRange?.from||''} – ${historySummary.dateRange?.to||''}` : 'Sync CAS emails to build history'}</div>
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      {[1,3,5].map(y=>(
                        <button key={y} onClick={()=>{setHistoryYears(y);loadHistory(y);}}
                          style={{background:historyYears===y?'rgba(0,212,161,0.12)':'none',border:`1px solid ${historyYears===y?'rgba(0,212,161,0.4)':'#1e3a5f'}`,color:historyYears===y?'#00d4a1':'#475569',borderRadius:6,padding:'3px 9px',cursor:'pointer',fontSize:11,fontWeight:600}}>
                          {y}Y
                        </button>
                      ))}
                      {historySummary.growthPct && <span style={{fontSize:12,fontWeight:700,color:parseFloat(historySummary.growthPct)>=0?'#00d4a1':'#f43f5e'}}>{parseFloat(historySummary.growthPct)>=0?'+':''}{historySummary.growthPct}%</span>}
                    </div>
                  </div>
                  {historyLoading ? (
                    <div style={{height:220,display:'flex',alignItems:'center',justifyContent:'center',color:'#334155',fontSize:13}}>Loading history…</div>
                  ) : growthData.length <= 1 ? (
                    <div style={{height:220,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'#475569'}}>
                      <div style={{fontSize:32}}>📊</div>
                      <div style={{fontSize:13}}>No history yet — sync CAS emails or run Historical Sync from Settings</div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={growthData} margin={{ top:10, right:20, left:0, bottom:0 }}
                        onClick={e=>{if(e?.activePayload?.[0]?.payload?.fullDate) loadHistoryDetail(e.activePayload[0].payload.fullDate);}}>
                        <defs>
                          <linearGradient id="mktGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00d4a1" stopOpacity={0.25}/>
                            <stop offset="95%" stopColor="#00d4a1" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="month" stroke="#4a5a7a" tick={{ fontSize:10, fill:'#64748b' }} interval="preserveStartEnd"/>
                        <YAxis stroke="#4a5a7a" tick={{ fontSize:10, fill:'#64748b' }} tickFormatter={v=>v>=10000000?`₹${(v/10000000).toFixed(1)}Cr`:v>=100000?`₹${(v/100000).toFixed(1)}L`:`₹${(v/1000).toFixed(0)}K`} width={60}/>
                        <Tooltip contentStyle={{ background:'#0d1526', border:'1px solid #1e3a5f', borderRadius:8, fontSize:11 }} formatter={(v,name)=>[fmtFull(v),name==='market'?'Portfolio Value':name==='cost'?'Invested':name]} labelStyle={{color:'#94a3b8',marginBottom:4}} cursor={{stroke:'#6366f1',strokeWidth:1,strokeDasharray:'4 4'}}/>
                        <Area type="monotone" dataKey="cost"   stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 3" fill="url(#costGrad)" dot={false} name="Invested"/>
                        <Area type="monotone" dataKey="market" stroke="#00d4a1" strokeWidth={2.5} fill="url(#mktGrad)" dot={{r:3,fill:'#00d4a1',strokeWidth:0}} activeDot={{r:5}} name="Portfolio Value"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                  {historyDetail && historyDetailDate && (
                    <div style={{borderTop:'1px solid #1e3a5f',padding:'12px 0 4px',marginTop:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{fontSize:12,color:'#818cf8',fontWeight:600}}>📅 Snapshot: {new Date(historyDetailDate+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})} <span style={{color:'#64748b',fontWeight:400,marginLeft:8}}>{historyDetail.holding_count} stocks · {historyDetail.mf_count} funds</span></div>
                        <button onClick={()=>{setHistoryDetail(null);setHistoryDetailDate(null);}} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:13}}>✕</button>
                      </div>
                      <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                        {[{label:'Total',val:fmtFull(historyDetail.total_value||0),color:'#64ffda'},{label:'Equities',val:fmtFull(historyDetail.total_equity_value||0),color:'#00d4a1'},{label:'MF',val:fmtFull(historyDetail.total_mf_value||0),color:'#818cf8'},{label:'Invested',val:fmtFull(historyDetail.total_invested||0),color:'#94a3b8'},{label:'Gain/Loss',val:fmtFull(historyDetail.total_gain_loss||0),color:parseFloat(historyDetail.total_gain_loss||0)>=0?'#00d4a1':'#f43f5e'}].map(s=>(
                          <div key={s.label}><div style={{fontSize:10,color:'#475569'}}>{s.label}</div><div style={{fontSize:14,fontWeight:700,color:s.color}}>{s.val}</div></div>
                        ))}
                      </div>
                    </div>
                  )}
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
                      {familyMode && <th>Member</th>}<th>Stock</th><th>Qty</th><th className="right">Avg Cost</th>
                      <th className="right">LTP</th><th className="right">Value</th><th className="right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.slice(0, 8).map(h => (
                      <tr key={h.symbol}>
                        <td><div className="db-stock-name">{h.company || h.symbol}<MemberBadge entry={h}/></div><div className="db-stock-sym">{h.symbol}</div></td>
                        <td>{h.quantity}</td>
                        <td className="right mono">₹{Number(h.avg_cost).toFixed(2)}</td>
                        <td className="right mono">₹{Number(h.ltp).toFixed(2)}</td>
                        <td className="right mono">{fmt(h.marketValue)}</td>
                        <td className={`right mono ${h.pnl >= 0 ? 'pos' : 'neg'}`}>{pct(h.pnlPct)}</td>
                        <td style={{textAlign:'center'}}>
                          {(() => {
                            const linkedGoal = goals.find(g => g.assets?.some(a => a.asset_ref === (h.isin||h.symbol)));
                            return linkedGoal ? (
                              <span title={linkedGoal.name} style={{fontSize:11,padding:'2px 7px',borderRadius:10,background:'rgba(99,102,241,0.15)',color:'#818cf8',cursor:'pointer',whiteSpace:'nowrap'}}
                                onClick={()=>setLinkingAsset({type:'stock',ref:h.isin||h.symbol,name:h.company||h.symbol,value:(h.quantity||0)*(h.last_price||0)})}>
                                🎯 {linkedGoal.name.slice(0,12)}{linkedGoal.name.length>12?'…':''}
                              </span>
                            ) : (
                              <button title="Link to Goal" onClick={()=>setLinkingAsset({type:'stock',ref:h.isin||h.symbol,name:h.company||h.symbol,value:(h.quantity||0)*(h.last_price||0)})}
                                style={{background:'none',border:'1px dashed #334155',borderRadius:6,fontSize:11,cursor:'pointer',color:'#475569',padding:'2px 8px',transition:'all 0.15s'}}
                                onMouseOver={e=>{e.target.style.borderColor='#6366f1';e.target.style.color='#818cf8';}}
                                onMouseOut={e=>{e.target.style.borderColor='#334155';e.target.style.color='#475569';}}>
                                🎯 Link
                              </button>
                            );
                          })()}
                        </td>
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
                {/* Holdings total summary */}
                <div style={{display:'flex',alignItems:'center',gap:24,padding:'12px 18px',background:'rgba(255,255,255,0.03)',borderRadius:10,border:'1px solid rgba(255,255,255,0.06)',marginBottom:16,flexWrap:'wrap'}}>
                  <div>
                    <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>TOTAL VALUE</div>
                    <div className="kv-refresh" style={{color:'#64ffda',fontWeight:700,fontSize:22}}>{fmtFull(totalValue)}</div>
                  </div>
                  {(() => {
                    const invested = holdings.reduce((s,h)=>s+((h.quantity||0)*(h.avg_cost||0)),0);
                    const pnl      = totalValue - invested;
                    const pnlPct   = invested>0 ? ((pnl/invested)*100).toFixed(2) : '0';
                    return (<>
                      <div>
                        <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>INVESTED</div>
                        <div style={{color:'#94a3b8',fontWeight:700,fontSize:22}}>{fmtFull(invested)}</div>
                      </div>
                      <div>
                        <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>OVERALL P&L</div>
                        <div style={{color:pnl>=0?'#00d4a1':'#f43f5e',fontWeight:700,fontSize:22}}>{fmtFull(pnl)} <span style={{fontSize:13}}>({pnlPct}%)</span></div>
                      </div>
                    </>);
                  })()}
                  <div>
                    <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>HOLDINGS</div>
                    <div style={{color:'#818cf8',fontWeight:700,fontSize:22}}>{holdings.length} stocks</div>
                  </div>
                  {familyMode && holdings.some(h=>h._member) && (
                    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#475569'}}>
                      <span>👨‍👩‍👧‍👦</span>
                      <span>{[...new Set(holdings.map(h=>h._member).filter(Boolean))].join(' + ')}</span>
                    </div>
                  )}
                </div>
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
                      {holdings.length > 0 && (
                        <button onClick={() => { setBulkLinkMode('stock'); setBulkLinkResult(null); }}
                          style={{ background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.3)',
                            color:'#818cf8', borderRadius:8, padding:'6px 14px', cursor:'pointer',
                            fontSize:12, fontWeight:700 }}>
                          🎯 Link All to Goal
                        </button>
                      )}
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
                          {familyMode && <th style={{fontSize:10,color:'#818cf8'}}>Member</th>}
                          <th>Company</th>
                          <th>Sector</th>
                          <th className="right">Qty</th>
                          <th className="right">LTP</th>
                          <th className="right">Current Value</th>
                          <th className="right">Allocation</th>
                          <th className="right">Div Yield</th>
                          <th style={{ fontSize:10, color:'#334155' }}>CAS Date</th>
                          <th style={{ fontSize:10, color:'#334155' }}>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Statement date */}
                        {holdings.length > 0 && holdings[0]?.cas_statement_date && (
                          <tr><td colSpan="6" style={{padding:'4px 0 8px'}}>
                            <span style={{fontSize:11,color:'#475569'}}>
                              📅 CAS Statement: {new Date(holdings[0].cas_statement_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                            </span>
                          </td></tr>
                        )}
                        {holdings.map(h => {
                          const alloc = totalValue > 0 ? (h.marketValue / totalValue * 100).toFixed(1) : 0;
                          return (
                            <tr key={h.symbol + (h.demat_account||'')}>
                              {familyMode && <td style={{verticalAlign:'middle'}}><MemberBadge entry={h}/></td>}
                              <td>
                                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                                  <div className="db-stock-name" style={{flex:1,marginBottom:0}}>{h.company || h.symbol}</div>
                                  {(()=>{
                                    const _r=h.isin||h.symbol;
                                    const _g=goals.find(g=>g.assets&&g.assets.some(a=>a.asset_ref===_r));
                                    return _g?(
                                      <span style={{display:'flex',alignItems:'center',gap:2,flexShrink:0,borderRadius:8,background:'rgba(99,102,241,0.12)',border:'1px solid rgba(99,102,241,0.25)',overflow:'hidden'}}>
                                        <span onClick={()=>setLinkingAsset({type:'stock',ref:_r,name:h.company||h.symbol,value:(h.quantity||0)*(h.last_price||0)})}
                                          title={'Linked to: '+_g.name+' — click to change'}
                                          style={{fontSize:10,padding:'3px 6px',color:'#818cf8',cursor:'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
                                          🎯 {_g.name.slice(0,10)}{_g.name.length>10?'…':''}
                                        </span>
                                        <span onClick={e=>{e.stopPropagation();unlinkFromRow(_g,_r);}}
                                          title='Remove goal link'
                                          style={{fontSize:10,padding:'3px 5px',color:'#6366f1',cursor:'pointer',borderLeft:'1px solid rgba(99,102,241,0.25)',lineHeight:1}}>
                                          ✕
                                        </span>
                                      </span>
                                    ):(
                                      <button onClick={()=>setLinkingAsset({type:'stock',ref:_r,name:h.company||h.symbol,value:(h.quantity||0)*(h.last_price||0)})}
                                        style={{flexShrink:0,background:'#6366f1',border:'none',borderRadius:7,fontSize:10,color:'#fff',padding:'3px 9px',cursor:'pointer',whiteSpace:'nowrap',fontWeight:700}}>
                                        🎯 Goal
                                      </button>
                                    );
                                  })()}
                                </div>
                                <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                                  <span className="db-stock-sym">{h.symbol}</span>
                                  {h.demat_account && (
                                    <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:600,
                                      background: h.demat_account==='CDSL_GROWW' ? 'rgba(245,158,11,0.15)' : 'rgba(14,165,233,0.15)',
                                      color:      h.demat_account==='CDSL_GROWW' ? '#f59e0b' : '#38bdf8',
                                    }}>{h.demat_account==='CDSL_GROWW'?'Groww':h.demat_account==='NSDL_ICICI'?'ICICI':h.demat_account}</span>
                                  )}
                                </div>
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
                              <td style={{ fontSize:10, color:'#475569', whiteSpace:'nowrap' }}>
                                {h.cas_mail_date
                                  ? new Date(h.cas_mail_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
                                  : h.cas_updated_at
                                  ? new Date(h.cas_updated_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
                                  : '—'}
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
            </div>
            );
          })()}
          {/* MUTUAL FUNDS */}
          {tab === 'mutualfunds' && (() => {
            const mf       = mfData;
            const holdings = mf?.holdings || [];
            const summary  = mf?.summary  || {};
            const debug    = mf?.syncDebug || {};
            const fmt      = (v) => v >= 10000000 ? `₹${(v/10000000).toFixed(2)}Cr` : v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
            const COLORS   = ['#00d4a1','#0ea5e9','#f59e0b','#a78bfa','#f43f5e','#34d399','#fb923c','#818cf8','#e879f9','#4ade80'];
            const pieData  = summary.byFundHouse || [];
            const gainPct  = summary.gainLossPct || 0;

            return (
              <div className="fade-in">


                {/* ── Statement date info bar ── */}
                {holdings.length > 0 && holdings[0]?.statement_date && (
                  <div style={{ background:'rgba(14,165,233,0.06)', border:'1px solid rgba(14,165,233,0.15)',
                    borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12, color:'#64748b', display:'flex', gap:16 }}>
                    <span>📅 Statement: <b style={{color:'#e2e8f0'}}>{new Date(holdings[0].statement_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</b></span>
                    <span style={{color:'#334155'}}>|</span>
                    <span>{summary.count} fund{summary.count!==1?'s':''} · ₹{summary.totalValue?.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
                  </div>
                )}
                {debug.lastStatus && debug.lastStatus !== 'MF_BULK_OK' && debug.lastStatus !== 'NO_SYNC_YET' && (
                  <div style={{ background:'rgba(244,63,94,0.06)', border:'1px solid rgba(244,63,94,0.2)',
                    borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12 }}>
                    <span style={{ color:'#f43f5e', fontWeight:700 }}>❌ {debug.lastStatus}</span>
                    <span style={{ color:'#64748b', marginLeft:8 }}>{debug.lastMessage?.slice(0,120)}</span>
                  </div>
                )}

                {/* ── Action bar ── */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20, flexWrap:'wrap' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ color:'#64748b', fontSize:12 }}>
                      {holdings.length > 0
                        ? `${holdings.length} funds · Statement date: ${summary.lastStatement || '—'} · Sources: ${[...new Set(holdings.map(h=>h.source))].join(', ')}`
                        : 'No holdings yet — sync Gmail to import from CDSL/NSDL CAS emails'}
                    </div>
                  </div>
                  {/* DEMAT MFs — sync from Gmail (CDSL/NSDL CAS) */}
                  {holdings.length > 0 && (
                    <button onClick={() => { setBulkLinkMode('mf'); setBulkLinkResult(null); }}
                      style={{ padding:'8px 14px', background:'rgba(99,102,241,0.1)',
                        border:'1px solid rgba(99,102,241,0.3)', color:'#818cf8',
                        borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                      🎯 Link All to Goal
                    </button>
                  )}
                  <button onClick={syncMFNav} disabled={syncingNAV}
                    title='Fetch latest NAV from AMFI for all funds'
                    style={{ padding:'8px 16px', background:'rgba(245,158,11,0.08)',
                      border:'1px solid rgba(245,158,11,0.2)', color:'#f59e0b',
                      borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {syncingNAV ? '⟳ Updating NAV…' : '⟳ Update NAV (AMFI)'}
                  </button>
                  <button onClick={syncEmails} disabled={syncing}
                    style={{ padding:'8px 16px', background:'rgba(100,255,218,0.08)',
                      border:'1px solid rgba(100,255,218,0.2)', color:'#64ffda',
                      borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {syncing ? '⟳ Syncing…' : '⟳ Sync Gmail (CDSL/NSDL)'}
                  </button>
                </div>

                {/* NAV sync result */}
                {navSyncResult && (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'8px 14px',borderRadius:8,marginBottom:10,fontSize:12,
                    background:navSyncResult.success?'rgba(245,158,11,0.06)':'rgba(244,63,94,0.06)',
                    border:`1px solid ${navSyncResult.success?'rgba(245,158,11,0.2)':'rgba(244,63,94,0.2)'}`}}>
                    <span style={{color:navSyncResult.success?'#f59e0b':'#f43f5e'}}>
                      {navSyncResult.success ? '✅' : '⚠'} {navSyncResult.message}
                    </span>
                    <button onClick={()=>setNavSyncResult(null)} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:14}}>✕</button>
                  </div>
                )}

                {/* MF total summary bar */}
                {!mfLoading && holdings.length > 0 && (
                  <div style={{display:'flex',alignItems:'center',gap:24,padding:'12px 18px',background:'rgba(255,255,255,0.03)',borderRadius:10,border:'1px solid rgba(255,255,255,0.06)',marginBottom:16,flexWrap:'wrap'}}>
                    <div>
                      <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>TOTAL MF VALUE</div>
                      <div className="kv-refresh" style={{color:'#0ea5e9',fontWeight:700,fontSize:22}}>{fmt(summary.totalValue||0)}</div>
                    </div>
                    {(() => {
                      const totalCost = holdings.reduce((s,h)=>s+parseFloat(h.total_cost||0),0);
                      const totalVal  = summary.totalValue||0;
                      const gain      = totalVal - totalCost;
                      const gainPct   = totalCost>0 ? ((gain/totalCost)*100).toFixed(2) : '0';
                      return totalCost>0 ? (<>
                        <div>
                          <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>INVESTED</div>
                          <div style={{color:'#94a3b8',fontWeight:700,fontSize:22}}>{fmt(totalCost)}</div>
                        </div>
                        <div>
                          <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>OVERALL GAIN</div>
                          <div style={{color:gain>=0?'#00d4a1':'#f43f5e',fontWeight:700,fontSize:22}}>{fmt(gain)} <span style={{fontSize:13}}>({gainPct}%)</span></div>
                        </div>
                      </>) : null;
                    })()}
                    <div>
                      <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:2}}>FUNDS</div>
                      <div style={{color:'#818cf8',fontWeight:700,fontSize:22}}>{holdings.length}</div>
                    </div>
                    {familyMode && holdings.some(h=>h._member) && (
                      <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#475569'}}>
                        <span>👨‍👩‍👧‍👦</span>
                        <span>{[...new Set(holdings.map(h=>h._member).filter(Boolean))].join(' + ')}</span>
                      </div>
                    )}
                  </div>
                )}

                {mfLoading ? (
                  <div style={{ textAlign:'center', padding:60, color:'#334155' }}>Loading mutual funds…</div>
                ) : holdings.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'50px 20px', lineHeight:2 }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
                    <div style={{ color:'#64748b', fontSize:14, fontWeight:600, marginBottom:8 }}>No mutual fund holdings yet</div>
                    <div style={{ color:'#334155', fontSize:12, maxWidth:420, margin:'0 auto' }}>
                      Mutual funds sync automatically from your CDSL and NSDL CAS emails. Click <b style={{color:'#64ffda'}}>Sync Gmail (CDSL/NSDL)</b> above.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ── Summary tiles ── */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
                      {[
                        { label:'Current Value',   val: fmt(summary.totalValue),    color:'#64ffda' },
                        { label:'Amount Invested',  val: fmt(summary.totalInvested || 0), color:'#0ea5e9' },
                        { label:'Gain / Loss',
                          val: `${(summary.totalGainLoss||0) >= 0 ? '+' : '-'}${fmt(Math.abs(summary.totalGainLoss||0))}`,
                          color: (summary.totalGainLoss||0) >= 0 ? '#00d4a1' : '#f43f5e' },
                        { label:'Overall Returns',
                          val: `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`,
                          color: gainPct >= 0 ? '#00d4a1' : '#f43f5e' },
                      ].map(t => (
                        <div key={t.label} style={{ background:'rgba(255,255,255,0.04)', borderRadius:10,
                          padding:'14px 16px', border:'1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ color:'#64748b', fontSize:11, marginBottom:6 }}>{t.label}</div>
                          <div style={{ color:t.color, fontWeight:700, fontSize:18 }}>{t.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Charts row ── */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gap:16, marginBottom:20 }}>
                      {/* Pie — by fund house */}
                      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20,
                        border:'1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14, marginBottom:12 }}>By Fund House</div>
                        <div style={{ display:'flex', justifyContent:'center' }}>
                          <PieChart width={180} height={180}>
                            <Pie data={pieData} cx={90} cy={90} innerRadius={48} outerRadius={82}
                              dataKey="value" paddingAngle={2}>
                              {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={v => fmt(v)}
                              contentStyle={{ background:'#1a1a2e', border:'1px solid #333', borderRadius:8, fontSize:11 }} />
                          </PieChart>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:5, marginTop:6 }}>
                          {pieData.slice(0,5).map((d, i) => (
                            <div key={d.name} style={{ display:'flex', justifyContent:'space-between', fontSize:11, alignItems:'center' }}>
                              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                                <div style={{ width:8, height:8, borderRadius:'50%', background:COLORS[i%COLORS.length], flexShrink:0 }}/>
                                <span style={{ color:'#cbd5e1' }}>{d.name}</span>
                              </div>
                              <span style={{ color:'#94a3b8', fontWeight:600 }}>{fmt(d.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Bar — top holdings */}
                      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:20,
                        border:'1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14, marginBottom:12 }}>Holdings by Value</div>
                        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                          {holdings.slice(0,8).map((h, i) => {
                            const pct = summary.totalValue > 0 ? (h.current_value / summary.totalValue * 100) : 0;
                            return (
                              <div key={h.id || i}>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                                  <span style={{ color:'#cbd5e1', fontWeight:600, maxWidth:220,
                                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                    {h.fund_name}<MemberBadge entry={h}/>
                                  </span>
                                  <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                                    <span style={{ color:'#64748b' }}>{pct.toFixed(1)}%</span>
                                    <span style={{ color:'#00d4a1', fontWeight:700 }}>{fmt(h.current_value||0)}</span>
                                  </div>
                                </div>
                                <div style={{ height:5, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                                  <div style={{ height:'100%', width:`${pct}%`, borderRadius:3,
                                    background: COLORS[i%COLORS.length], transition:'width 0.6s ease' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* ── Holdings table — grouped by fund name ── */}
                    <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:12,
                      border:'1px solid rgba(255,255,255,0.07)', overflow:'hidden' }}>
                      <div style={{ padding:'14px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)',
                        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:14 }}>
                          All Mutual Fund Holdings ({holdings.length} folios)
                        </div>
                        <div style={{ color:'#64748b', fontSize:12 }}>
                          Total: <span style={{ color:'#64ffda', fontWeight:700 }}>{fmt(summary.totalValue)}</span>
                        </div>
                      </div>
                      <div style={{ overflowX:'auto' }}>
                        {(() => {
                          // Group folios by fund name
                          const grouped = holdings.reduce((acc, h) => {
                            const key = h.fund_name || h.isin || 'Unknown';
                            if (!acc[key]) acc[key] = [];
                            acc[key].push(h);
                            return acc;
                          }, {});

                          return (
                            <table className="db-table" style={{ width:'100%' }}>
                              <thead>
                                <tr>
                                  {familyMode && <th style={{fontSize:10,color:'#818cf8'}}>Member</th>}
                                  <th>Fund</th>
                                  <th>Category</th>
                                  <th className="right">Units</th>
                                  <th className="right">NAV (₹)</th>
                                  <th className="right">Current Value</th>
                                  <th className="right">Invested</th>
                                  <th className="right">Gain / Loss</th>
                                  <th>Folio / ISIN</th>
                                  <th>CAS Date</th>
                                  <th>Source</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(grouped).map(([fundName, folios]) => {
                                  const groupVal  = folios.reduce((s,h) => s + parseFloat(h.current_value||0), 0);
                                  const groupCost = folios.reduce((s,h) => s + parseFloat(h.invested_value||0), 0);
                                  const groupGL   = groupVal - groupCost;
                                  const groupGLPct= groupCost > 0 ? ((groupGL/groupCost)*100).toFixed(2) : null;
                                  const isMulti   = folios.length > 1;

                                  return folios.map((h, fi) => {
                                    const gl    = (h.current_value||0) - (h.invested_value||0);
                                    const glPct = h.invested_value > 0 ? (gl / h.invested_value * 100) : null;
                                    const _r    = h.isin || h.folio_number;
                                    const _g    = goals.find(g => g.assets && g.assets.some(a => a.asset_ref === _r));
                                    const isLast = fi === folios.length - 1;

                                    return <React.Fragment key={(h.id || fi) + '_frag'}>
                                      <tr key={h.id || fi}
                                        style={{ borderLeft: isMulti ? '3px solid rgba(14,165,233,0.3)' : 'none' }}>
                                        {familyMode && <td style={{verticalAlign:'middle'}}><MemberBadge entry={h}/></td>}
                                        <td style={{minWidth:200}}>
                                          <div style={{display:'flex',alignItems:'flex-start',gap:6}}>
                                            <div style={{flex:1}}>
                                              {fi === 0 ? (
                                                <div style={{ fontWeight:700, color:'#e2e8f0', fontSize:12,
                                                  maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                                  {h.fund_name}
                                                </div>
                                              ) : (
                                                <div style={{ color:'#475569', fontSize:11, paddingLeft:10 }}>↳ same fund</div>
                                              )}
                                              {fi === 0 && <div style={{ color:'#475569', fontSize:10, marginTop:1 }}>{h.fund_house}</div>}
                                            </div>
                                            {fi === 0 && (
                                              _g ? (
                                                <span style={{display:'flex',alignItems:'center',gap:2,flexShrink:0,borderRadius:8,background:'rgba(99,102,241,0.12)',border:'1px solid rgba(99,102,241,0.25)',overflow:'hidden',marginTop:2}}>
                                                  <span onClick={()=>setLinkingAsset({type:'mf',ref:_r,name:h.fund_name,value:h.current_value||0})}
                                                    style={{fontSize:10,padding:'3px 6px',color:'#818cf8',cursor:'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
                                                    🎯 {_g.name.slice(0,10)}{_g.name.length>10?'…':''}
                                                  </span>
                                                  <span onClick={e=>{e.stopPropagation();unlinkFromRow(_g,_r);}}
                                                    style={{fontSize:10,padding:'3px 5px',color:'#6366f1',cursor:'pointer',borderLeft:'1px solid rgba(99,102,241,0.25)',lineHeight:1}}>✕</span>
                                                </span>
                                              ) : (
                                                <button onClick={()=>setLinkingAsset({type:'mf',ref:_r,name:h.fund_name,value:h.current_value||0})}
                                                  style={{flexShrink:0,background:'#6366f1',border:'none',borderRadius:7,fontSize:10,color:'#fff',padding:'3px 9px',cursor:'pointer',whiteSpace:'nowrap',fontWeight:700,marginTop:2}}>
                                                  🎯 Goal
                                                </button>
                                              )
                                            )}
                                          </div>
                                        </td>
                                        <td>
                                          <span style={{ fontSize:10, background:'rgba(14,165,233,0.1)', color:'#0ea5e9',
                                            borderRadius:4, padding:'2px 7px', fontWeight:600, whiteSpace:'nowrap' }}>
                                            {h.fund_category || 'Equity'}
                                          </span>
                                        </td>
                                        <td className="right mono" style={{ color:'#e2e8f0' }}>
                                          {Number(h.units||0).toLocaleString('en-IN',{maximumFractionDigits:3,minimumFractionDigits:3})}
                                        </td>
                                        <td className="right mono" style={{ color:'#94a3b8' }}>
                                          {h.nav ? Number(h.nav).toFixed(3) : '—'}
                                        </td>
                                        <td className="right mono" style={{ color:'#64ffda', fontWeight:700 }}>
                                          {h.current_value ? fmt(h.current_value) : '—'}
                                        </td>
                                        <td className="right mono" style={{ color:'#64748b' }}>
                                          {h.invested_value ? fmt(h.invested_value) : '—'}
                                        </td>
                                        <td className="right mono">
                                          {h.invested_value ? (
                                            <>
                                              <span style={{ color: gl >= 0 ? '#00d4a1' : '#f43f5e', fontWeight:600, display:'block' }}>
                                                {gl >= 0 ? '+' : ''}{fmt(Math.abs(gl))}
                                              </span>
                                              {glPct !== null && (
                                                <span style={{ color: glPct >= 0 ? '#00d4a1' : '#f43f5e', fontSize:10 }}>
                                                  {glPct >= 0 ? '+' : ''}{glPct.toFixed(2)}%
                                                </span>
                                              )}
                                            </>
                                          ) : '—'}
                                        </td>
                                        <td style={{ fontSize:10, color:'#475569' }}>
                                          {h.folio_number
                                            ? <span>📁 {h.folio_number}</span>
                                            : h.isin
                                            ? <span style={{ color:'#1e3a5f', fontFamily:'monospace' }}>{h.isin}</span>
                                            : '—'}
                                        </td>
                                        <td style={{ fontSize:11, color:'#475569', whiteSpace:'nowrap' }}>
                                          {(h.cas_mail_date || h.statement_date)
                                            ? new Date((h.cas_mail_date||h.statement_date)+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
                                            : '—'}
                                        </td>
                                        <td>
                                          <span style={{ fontSize:10, borderRadius:4, padding:'2px 6px', fontWeight:600,
                                            background: h.source === 'CDSL'      ? 'rgba(100,255,218,0.08)' :
                                                        h.source === 'MFCENTRAL' ? 'rgba(14,165,233,0.12)'  :
                                                        h.source === 'CAMS'      ? 'rgba(251,146,60,0.12)'  :
                                                        'rgba(167,139,250,0.12)',
                                            color: h.source === 'CDSL'      ? '#334155' :
                                                   h.source === 'MFCENTRAL' ? '#0ea5e9' :
                                                   h.source === 'CAMS'      ? '#fb923c' : '#a78bfa' }}>
                                            {h.source || 'NSDL'}
                                          </span>
                                        </td>
                                      </tr>,

                                      (isMulti && isLast) ? (
                                        <tr key={fundName + '_sub'}
                                          style={{ background:'rgba(14,165,233,0.04)', borderLeft:'3px solid rgba(14,165,233,0.5)', borderTop:'1px solid rgba(14,165,233,0.15)' }}>
                                          {familyMode && <td/>}
                                          <td colSpan={2} style={{ padding:'6px 14px', fontSize:11, color:'#0ea5e9', fontWeight:700 }}>
                                            Σ {fundName.length > 35 ? fundName.slice(0,35)+'…' : fundName}
                                            <span style={{ color:'#475569', fontWeight:400, marginLeft:6 }}>({folios.length} folios)</span>
                                          </td>
                                          <td colSpan={2}/>
                                          <td className="right mono" style={{ fontSize:12, color:'#64ffda', fontWeight:700, padding:'6px 14px' }}>
                                            {fmt(groupVal)}
                                          </td>
                                          <td className="right mono" style={{ fontSize:12, color:'#64748b', padding:'6px 14px' }}>
                                            {groupCost > 0 ? fmt(groupCost) : '—'}
                                          </td>
                                          <td className="right mono" style={{ padding:'6px 14px' }}>
                                            {groupCost > 0 ? (
                                              <>
                                                <span style={{ color: groupGL >= 0 ? '#00d4a1' : '#f43f5e', fontWeight:700, display:'block', fontSize:12 }}>
                                                  {groupGL >= 0 ? '+' : ''}{fmt(Math.abs(groupGL))}
                                                </span>
                                                {groupGLPct && (
                                                  <span style={{ color: parseFloat(groupGLPct) >= 0 ? '#00d4a1' : '#f43f5e', fontSize:10 }}>
                                                    {parseFloat(groupGLPct) >= 0 ? '+' : ''}{groupGLPct}%
                                                  </span>
                                                )}
                                              </>
                                            ) : '—'}
                                          </td>
                                          <td colSpan={3}/>
                                        </tr>
                                      ) : null}
                                    </React.Fragment>;
                                  });
                                })}
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
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


          {/* GOALS TAB */}
          {tab === 'goals' && (
            <div style={{padding:'24px 28px'}} className="fade-in">

              {/* Header */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
                <div>
                  <h2 style={{color:'#e2e8f0',fontSize:22,fontWeight:700,margin:0}}>🎯 Goals</h2>
                  <div style={{color:'#64748b',fontSize:13,marginTop:3}}>Track financial goals · link holdings · monitor progress</div>
                </div>
                <button onClick={()=>{setEditingGoal(null);setGoalForm({name:'',description:'',target_value:'',duration_type:'mid',target_date:'',is_recurring:false,recurrence:'monthly',recurrence_day:'1',recurrence_month:''});setShowGoalForm(true);}}
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',border:'none',color:'#fff',borderRadius:10,padding:'10px 20px',cursor:'pointer',fontSize:13,fontWeight:700}}>
                  + New Goal
                </button>
              </div>

              {/* Summary cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:24}}>
                {[
                  {label:'Total Goals',  val:goalsSummary.total||0, color:'#e2e8f0', icon:'🎯'},
                  {label:'New',          val:goalsSummary.new||0,   color:'#94a3b8', icon:'⭕'},
                  {label:'In Progress',  val:goalsSummary.inprogress||0, color:'#f59e0b', icon:'🔄'},
                  {label:'Completed',    val:goalsSummary.completed||0,  color:'#00d4a1', icon:'✅'},
                  {label:'Total Target', val:fmtFull(goalsSummary.totalTargetValue||0), color:'#6366f1', icon:'💰'},
                ].map(s=>(
                  <div key={s.label} style={{background:'#0a1628',borderRadius:10,padding:'14px 16px',border:'1px solid #1e3a5f'}}>
                    <div style={{fontSize:18,marginBottom:6}}>{s.icon}</div>
                    <div style={{color:s.color,fontWeight:700,fontSize:s.label==='Total Target'?14:22}}>{s.val}</div>
                    <div style={{color:'#475569',fontSize:11,marginTop:3}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
                {['all','new','inprogress','completed'].map(f=>(
                  <button key={f} onClick={()=>setGoalsFilter(f)}
                    style={{padding:'6px 14px',borderRadius:20,border:`1px solid ${goalsFilter===f?'#6366f1':'#1e3a5f'}`,background:goalsFilter===f?'rgba(99,102,241,0.15)':'transparent',color:goalsFilter===f?'#818cf8':'#64748b',fontSize:12,fontWeight:600,cursor:'pointer',textTransform:'capitalize'}}>
                    {f==='all'?'All':f==='inprogress'?'In Progress':f.charAt(0).toUpperCase()+f.slice(1)}
                  </button>
                ))}
                <div style={{marginLeft:'auto',display:'flex',gap:8}}>
                  {['all','ultra_short','short','mid','long'].map(d=>(
                    <button key={d} onClick={()=>setGoalsDurationFilter(d)}
                      style={{padding:'6px 12px',borderRadius:20,border:`1px solid ${goalsDurationFilter===d?'#8b5cf6':'#1e3a5f'}`,background:goalsDurationFilter===d?'rgba(139,92,246,0.15)':'transparent',color:goalsDurationFilter===d?'#a78bfa':'#64748b',fontSize:11,cursor:'pointer'}}>
                      {d==='all'?'All Duration':d==='ultra_short'?'Ultra Short':d==='short'?'Short':d==='mid'?'Mid Term':'Long Term'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Goals list */}
              {(() => {
                const filtered = goals.filter(g =>
                  (goalsFilter==='all' || g.status===goalsFilter) &&
                  (goalsDurationFilter==='all' || g.duration_type===goalsDurationFilter)
                );
                if (filtered.length === 0) return (
                  <div style={{textAlign:'center',padding:'60px 20px',background:'#0a1628',borderRadius:12,border:'1px solid #1e3a5f'}}>
                    <div style={{fontSize:48,marginBottom:16}}>🎯</div>
                    <div style={{color:'#e2e8f0',fontSize:16,fontWeight:600,marginBottom:8}}>No goals yet</div>
                    <div style={{color:'#475569',fontSize:13}}>Create your first financial goal to start tracking progress</div>
                  </div>
                );
                return (
                  <div style={{display:'flex',flexDirection:'column',gap:14}}>
                    {filtered.map(goal => {
                      const prog   = Math.min(100, goal.progress || 0);
                      const statusColor = goal.status==='completed'?'#00d4a1':goal.status==='inprogress'?'#f59e0b':'#64748b';
                      const durLabel = {ultra_short:'Ultra Short',short:'Short',mid:'Mid Term',long:'Long Term'}[goal.duration_type] || goal.duration_type;
                      return (
                        <div key={goal.id} style={{background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:12,padding:0,overflow:'hidden',transition:'border-color 0.2s',cursor:'pointer'}}
                          onClick={()=>openGoalDetail(goal)}>

                          {/* Goal picture strip if exists */}
                          {goal.picture_url && (
                            <div style={{height:100,backgroundImage:`url(${goal.picture_url})`,backgroundSize:'cover',backgroundPosition:'center',position:'relative'}}>
                              <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,transparent 40%,#0a1628)'}}/>
                            </div>
                          )}

                          <div style={{padding:'16px 20px'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                              <div style={{flex:1}}>
                                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                                  <span style={{color:'#e2e8f0',fontWeight:700,fontSize:15}}>{goal.name}<MemberBadge entry={goal}/></span>
                                  <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:700,background:`${statusColor}22`,color:statusColor}}>
                                    {goal.status==='inprogress'?'In Progress':goal.status.charAt(0).toUpperCase()+goal.status.slice(1)}
                                  </span>
                                  <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(139,92,246,0.1)',color:'#a78bfa'}}>{durLabel}</span>
                                  {goal.is_recurring && <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(99,102,241,0.1)',color:'#818cf8'}}>🔄 {goal.recurrence}</span>}
                                </div>
                                {goal.description && <div style={{color:'#64748b',fontSize:12,marginBottom:4}}>{goal.description}</div>}
                                <div style={{display:'flex',gap:14,fontSize:11,color:'#475569',flexWrap:'wrap'}}>
                                  {goal.target_date && <span>📅 Target: {new Date(goal.target_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>}
                                  <span>🔗 {goal.asset_count} asset{goal.asset_count!==1?'s':''} linked</span>
                                  {goal.current_value > 0 && <span style={{color:'#6366f1'}}>· {fmtFull(goal.current_value)} tracked</span>}
                                  <span>📅 Started {new Date(goal.started_on+'T00:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</span>
                                </div>
                              </div>
                              <div style={{textAlign:'right',flexShrink:0,marginLeft:20}}>
                                <div style={{color:'#6366f1',fontWeight:700,fontSize:18}}>{prog.toFixed(1)}%</div>
                                <div style={{color:'#e2e8f0',fontSize:12,marginTop:2}}>{fmtFull(goal.current_value)} <span style={{color:'#475569'}}>of</span> {fmtFull(goal.target_value)}</div>
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div style={{height:6,background:'#1e3a5f',borderRadius:3,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${prog}%`,borderRadius:3,
                                background:prog>=100?'#00d4a1':prog>50?'#6366f1':'#f59e0b',
                                transition:'width 0.6s ease',boxShadow:prog>0?`0 0 8px ${prog>=100?'#00d4a1':prog>50?'#6366f1':'#f59e0b'}50`:undefined
                              }}/>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* EXPENSES TAB */}
          {tab === 'expenses' && (
            <div style={{padding:'24px 28px'}} className="fade-in">
              {/* Header */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
                <div>
                  <h2 style={{color:'#e2e8f0',fontSize:22,fontWeight:700,margin:0}}>💸 Expenses</h2>
                  <div style={{color:'#64748b',fontSize:13,marginTop:3}}>Auto-tracked from UPI & credit card emails · AI-powered category detection</div>
                </div>
                <div style={{display:'flex',gap:10}}>
                  {expenseSummary.uncategorized>0&&(
                    <div style={{background:'rgba(251,146,60,0.1)',border:'1px solid rgba(251,146,60,0.3)',color:'#fb923c',borderRadius:8,padding:'9px 14px',fontSize:12,fontWeight:600}}>
                      ⚠ {expenseSummary.uncategorized} need category
                    </div>
                  )}
                  <button onClick={()=>{setSettingsSection('expense');setShowSettings(true);}}
                    style={{background:'#1e293b',border:'1px solid #334155',color:'#94a3b8',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontSize:13}}>
                    ⚙ Rules
                  </button>
                  <button onClick={()=>setShowExpenseEntry(true)}
                    style={{background:'rgba(251,146,60,0.1)',border:'1px solid rgba(251,146,60,0.3)',color:'#fb923c',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontSize:13,fontWeight:700}}>
                    + Add Entry
                  </button>
                  <button onClick={scanExpenses} disabled={expenseScanning}
                    style={{background:expenseScanning?'#1e293b':'#fb923c',border:'none',color:'#fff',borderRadius:8,padding:'9px 16px',cursor:expenseScanning?'not-allowed':'pointer',fontSize:13,fontWeight:700}}>
                    {expenseScanning?'⟳ Scanning…':'⟳ Scan Now'}
                  </button>
                </div>
              </div>

              {expenseScanResult&&(
                <div style={{background:expenseScanResult.success?'rgba(251,146,60,0.06)':'rgba(244,63,94,0.06)',border:`1px solid ${expenseScanResult.success?'rgba(251,146,60,0.25)':'rgba(244,63,94,0.25)'}`,borderRadius:10,padding:'14px 18px',marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:600,color:expenseScanResult.success?'#fb923c':'#f43f5e',marginBottom:expenseScanResult.emailsRead>0?8:0}}>
                    {expenseScanResult.success?'✅':'⚠'} {expenseScanResult.message}
                  </div>
                  {expenseScanResult.success&&expenseScanResult.emailsRead>0&&(
                    <div style={{display:'flex',gap:20,flexWrap:'wrap',marginBottom:expenseScanResult.ruleResults?.length?10:0}}>
                      {[{label:'Emails Found',val:expenseScanResult.emailsFound||0},{label:'Emails Read',val:expenseScanResult.emailsRead||0},{label:'Captured',val:expenseScanResult.found||0,hi:true},{label:'Rules',val:expenseScanResult.rulesApplied||0}].map(s=>(
                        <div key={s.label} style={{textAlign:'center',minWidth:55}}>
                          <div style={{fontWeight:700,fontSize:20,color:s.hi?'#fb923c':'#e2e8f0'}}>{s.val}</div>
                          <div style={{fontSize:10,color:'#475569',marginTop:1}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {expenseScanResult.ruleResults?.length>0&&(
                    <div style={{borderTop:'1px solid rgba(255,255,255,0.05)',paddingTop:10}}>
                      <div style={{fontSize:10,color:'#475569',fontWeight:700,letterSpacing:1,marginBottom:6,textTransform:'uppercase'}}>Per Rule</div>
                      {expenseScanResult.ruleResults.map((r,i)=>(
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',marginBottom:3,background:'rgba(255,255,255,0.02)',borderRadius:6}}>
                          <span style={{color:'#e2e8f0',fontSize:12,fontWeight:600,flex:1}}>{r.ruleName}</span>
                          <div style={{display:'flex',gap:12,fontSize:11}}>
                            <span style={{color:'#475569'}}>{r.emailsFound||0} found</span>
                            <span style={{color:'#64748b'}}>{r.emailsRead||0} read</span>
                            <span style={{color:r.captured>0?'#fb923c':'#475569',fontWeight:r.captured>0?700:400}}>{r.captured||0} captured</span>
                            {(r.skipped||0)>0&&<span style={{color:'#374151'}}>{r.skipped} skipped</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Summary cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
                {[
                  {label:`${expenseSummary.fyLabel||'FY26'} Total`,val:fmtFull(expenseSummary.currentFYTotal||0),color:'#fb923c',icon:'📊'},
                  {label:'This Month',val:fmtFull(expenseSummary.thisMonthTotal||0),color:'#f43f5e',icon:'📅'},
                  {label:'Entries',val:expenseEntries.length,color:'#0ea5e9',icon:'📋'},
                  {label:'Uncategorized',val:expenseSummary.uncategorized||0,color:'#f59e0b',icon:'❓'},
                ].map(s=>(
                  <div key={s.label} style={{background:'#0a1628',borderRadius:10,padding:'14px 18px',border:'1px solid #1e3a5f'}}>
                    <div style={{fontSize:18,marginBottom:6}}>{s.icon}</div>
                    <div style={{color:s.color,fontWeight:700,fontSize:20}}>{s.val}</div>
                    <div style={{color:'#475569',fontSize:12,marginTop:3}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Charts */}
              {expenseEntries.length>0&&(()=>{
                const EXP_COLORS=['#fb923c','#f43f5e','#a78bfa','#0ea5e9','#64ffda','#34d399','#f59e0b','#ec4899','#6366f1','#10b981'];
                const catData = Object.entries(expenseSummary.byCategory||{}).map(([name,value])=>({name,value})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);
                const mthData = Object.keys(expenseSummary.byMonth||{}).sort().map(m=>({
                  month:new Date(m+'-01').toLocaleDateString('en-IN',{month:'short'}),
                  amount:expenseSummary.byMonth[m]
                }));
                return (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
                    <div style={{background:'#0a1628',borderRadius:10,border:'1px solid #1e3a5f',padding:'16px 20px'}}>
                      <div style={{color:'#e2e8f0',fontWeight:700,fontSize:14,marginBottom:16}}>By Category ({expenseSummary.fyLabel})</div>
                      <div style={{display:'flex',gap:16,alignItems:'center'}}>
                        <ResponsiveContainer width={150} height={150}>
                          <PieChart>
                            <Pie data={catData} cx={70} cy={70} innerRadius={40} outerRadius={68} dataKey="value" paddingAngle={2}>
                              {catData.map((_,i)=><Cell key={i} fill={EXP_COLORS[i%EXP_COLORS.length]}/>)}
                            </Pie>
                            <Tooltip formatter={v=>fmtFull(v)} contentStyle={{background:'#141b2d',border:'1px solid #1a2235',borderRadius:8,fontSize:12}}/>
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{flex:1,maxHeight:150,overflowY:'auto'}}>
                          {catData.slice(0,8).map((d,i)=>(
                            <div key={d.name} style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                              <div style={{display:'flex',alignItems:'center',gap:5}}>
                                <div style={{width:8,height:8,borderRadius:'50%',background:EXP_COLORS[i%EXP_COLORS.length],flexShrink:0}}/>
                                <span style={{color:'#94a3b8',fontSize:11}}>{d.name}</span>
                              </div>
                              <span style={{color:'#e2e8f0',fontSize:11,fontWeight:600}}>{fmtFull(d.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{background:'#0a1628',borderRadius:10,border:'1px solid #1e3a5f',padding:'16px 20px'}}>
                      <div style={{color:'#e2e8f0',fontWeight:700,fontSize:14,marginBottom:16}}>Monthly Trend</div>
                      <ResponsiveContainer width="100%" height={150}>
                        <AreaChart data={mthData} margin={{top:5,right:10,left:0,bottom:0}}>
                          <defs>
                            <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#fb923c" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="month" stroke="#334155" tick={{fill:'#64748b',fontSize:11}}/>
                          <YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'K'}/>
                          <Tooltip formatter={v=>[fmtFull(v),'Expense']} contentStyle={{background:'#141b2d',border:'1px solid #1a2235',borderRadius:8,fontSize:12}}/>
                          <Area type="monotone" dataKey="amount" stroke="#fb923c" strokeWidth={2} fill="url(#expGrad)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              {/* Expense table with inline category edit */}
              <div style={{background:'#0a1628',borderRadius:10,border:'1px solid #1e3a5f'}}>
                <div style={{padding:'14px 20px',borderBottom:'1px solid #1e3a5f',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{color:'#e2e8f0',fontWeight:700,fontSize:14}}>All Expenses</div>
                  <div style={{color:'#475569',fontSize:12}}>{expenseEntries.length} entries · click row to edit category</div>
                </div>
                {expenseEntries.length===0?(
                  <div style={{textAlign:'center',padding:'40px 20px'}}>
                    <div style={{fontSize:36,marginBottom:12}}>💸</div>
                    <div style={{fontSize:14,color:'#475569',marginBottom:8}}>No expenses yet</div>
                    <div style={{fontSize:12,color:'#334155'}}>Click "Scan Now" to auto-detect from emails, or add manually</div>
                  </div>
                ):(
                  <table className="db-table" style={{width:'100%'}}>
                    <thead><tr>
                      {familyMode&&<th>Member</th>}<th>Date</th><th>Merchant</th><th>Category</th>
                      <th>Sub-category</th><th>Source</th><th>Comments</th>
                      <th className="right">Amount</th><th></th>
                    </tr></thead>
                    <tbody>
                      {expenseEntries.map(e=>(
                        <tr key={e.id} style={{cursor:'pointer'}} onClick={()=>setEditingExpense(editingExpense===e.id?null:e.id)}>
                          {familyMode && <td style={{verticalAlign:'middle'}}><MemberBadge entry={e}/></td>}
                          <td style={{color:'#64748b',fontSize:12,whiteSpace:'nowrap'}}>
                            {new Date(e.expense_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                          </td>
                          <td>
                            <div style={{color:'#e2e8f0',fontSize:13}}>{e.merchant_name||'—'}</div>
                            {e.email_subject&&<div style={{color:'#334155',fontSize:10,marginTop:1}}>{e.email_subject.slice(0,45)}</div>}
                          </td>
                          <td>
                            {editingExpense===e.id?(
                              <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer',fontSize:12,padding:'4px 6px'}}
                                defaultValue={e.category||''} onClick={ev=>ev.stopPropagation()}
                                onChange={ev=>{ev.stopPropagation();updateExpenseCategory(e.id,ev.target.value,e.sub_category,e.merchant_name);}}>
                                <option value="">— select —</option>
                                {Object.keys(expenseCategories).map(cat=><option key={cat} value={cat}>{cat}</option>)}
                              </select>
                            ):(
                              e.category
                                ? <span style={{fontSize:11,padding:'2px 8px',borderRadius:4,fontWeight:600,background:'rgba(251,146,60,0.1)',color:'#fb923c'}}>{e.category}</span>
                                : <span style={{fontSize:11,color:'#f59e0b'}}>⚠ tap to set</span>
                            )}
                          </td>
                          <td style={{color:'#64748b',fontSize:12}}>{e.sub_category||'—'}</td>
                          <td>
                            <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,
                              background:e.source==='auto'?'rgba(14,165,233,0.1)':e.category_source==='ai'?'rgba(167,139,250,0.1)':'rgba(100,255,218,0.08)',
                              color:e.source==='auto'?'#38bdf8':e.category_source==='ai'?'#a78bfa':'#64ffda'}}>
                              {e.source==='manual'?'✎ manual':e.category_source==='ai'?'🤖 ai':e.category_source==='learned'?'📚 learned':e.category_source==='dict'?'📖 dict':'⚡ auto'}
                            </span>
                          </td>
                          <td style={{color:'#64748b',fontSize:12}}>{e.comments||'—'}</td>
                          <td className="right" style={{color:'#fb923c',fontWeight:700}}>{fmtFull(e.amount)}</td>
                          <td>
                            <div style={{display:'flex',gap:4}}>
                              {e.receipt_url
                                ? <a href={e.receipt_url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()}
                                    style={{background:'none',border:'none',color:'#0ea5e9',cursor:'pointer',fontSize:14,padding:'2px 6px',textDecoration:'none'}}>📎</a>
                                : <label onClick={ev=>ev.stopPropagation()} style={{cursor:'pointer',fontSize:14,padding:'2px 6px',color:'#334155'}}>
                                    📎
                                    <input type="file" style={{display:'none'}} accept="image/*,application/pdf"
                                      onChange={async ev=>{
                                        ev.stopPropagation();
                                        const file=ev.target.files[0]; if(!file)return;
                                        const form=new FormData(); form.append('file',file);
                                        await api.post(`/api/expense/entries/${e.id}/receipt`, form, { headers:{'Content-Type':'multipart/form-data'} });
                                        await loadExpenses();
                                      }} />
                                  </label>
                              }
                              <button onClick={ev=>{ev.stopPropagation();deleteExpenseEntry(e.id);}}
                                style={{background:'none',border:'none',color:'#334155',cursor:'pointer',fontSize:14,padding:'2px 6px'}}>✕</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* INCOME TAB */}
          {tab === 'income' && (
            <div style={{ padding: '24px 28px' }} className="fade-in">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
                <div>
                  <h2 style={{ color:'#e2e8f0', fontSize:22, fontWeight:700, margin:0 }}>₹ Income</h2>
                  <div style={{ color:'#64748b', fontSize:13, marginTop:3 }}>Track salary, rental & all income sources automatically</div>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={() => { setSettingsSection('income'); setShowSettings(true); }}
                    style={{ background:'#1e293b', border:'1px solid #334155', color:'#94a3b8', borderRadius:8, padding:'9px 16px', cursor:'pointer', fontSize:13 }}>
                    ⚙ Rules
                  </button>
                  <button onClick={() => setShowManualEntry(true)}
                    style={{ background:'rgba(100,255,218,0.1)', border:'1px solid rgba(100,255,218,0.3)', color:'#64ffda', borderRadius:8, padding:'9px 16px', cursor:'pointer', fontSize:13, fontWeight:700 }}>
                    + Add Entry
                  </button>
                  <button onClick={scanIncome} disabled={incomeScanning}
                    style={{ background: incomeScanning ? '#1e293b' : '#0ea5e9', border:'none', color:'#fff', borderRadius:8, padding:'9px 16px', cursor: incomeScanning ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:700 }}>
                    {incomeScanning ? '⟳ Scanning…' : '⟳ Scan Now'}
                  </button>
                </div>
              </div>

              {incomeScanResult&&(
                <div style={{background:incomeScanResult.success?'rgba(0,212,161,0.06)':'rgba(244,63,94,0.06)',border:`1px solid ${incomeScanResult.success?'rgba(0,212,161,0.25)':'rgba(244,63,94,0.25)'}`,borderRadius:10,padding:'14px 18px',marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:600,color:incomeScanResult.success?'#00d4a1':'#f43f5e',marginBottom:incomeScanResult.emailsRead>0?8:0}}>
                    {incomeScanResult.success?'✅':'⚠'} {incomeScanResult.message}
                  </div>
                  {incomeScanResult.success&&incomeScanResult.emailsRead>0&&(
                    <div style={{display:'flex',gap:20,flexWrap:'wrap',marginBottom:incomeScanResult.ruleResults?.length?10:0}}>
                      {[{label:'Emails Found',val:incomeScanResult.emailsFound||0},{label:'Emails Read',val:incomeScanResult.emailsRead||0},{label:'Captured',val:incomeScanResult.found||0,hi:true},{label:'Rules',val:incomeScanResult.rulesApplied||0}].map(s=>(
                        <div key={s.label} style={{textAlign:'center',minWidth:55}}>
                          <div style={{fontWeight:700,fontSize:20,color:s.hi?'#00d4a1':'#e2e8f0'}}>{s.val}</div>
                          <div style={{fontSize:10,color:'#475569',marginTop:1}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {incomeScanResult.ruleResults?.length>0&&(
                    <div style={{borderTop:'1px solid rgba(255,255,255,0.05)',paddingTop:10}}>
                      <div style={{fontSize:10,color:'#475569',fontWeight:700,letterSpacing:1,marginBottom:6,textTransform:'uppercase'}}>Per Rule</div>
                      {incomeScanResult.ruleResults.map((r,i)=>(
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',marginBottom:3,background:'rgba(255,255,255,0.02)',borderRadius:6}}>
                          <span style={{color:'#e2e8f0',fontSize:12,fontWeight:600,flex:1}}>{r.ruleName}</span>
                          <div style={{display:'flex',gap:12,fontSize:11}}>
                            <span style={{color:'#475569'}}>{r.emailsFound||0} found</span>
                            <span style={{color:'#64748b'}}>{r.emailsRead||0} read</span>
                            <span style={{color:r.captured>0?'#00d4a1':'#475569',fontWeight:r.captured>0?700:400}}>{r.captured||0} captured</span>
                            {(r.skipped||0)>0&&<span style={{color:'#374151'}}>{r.skipped} skipped</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Summary cards */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:24 }}>
                {[
                  { label:`${incomeSummary.fyLabel || 'FY26'} Total`, val: fmtFull(incomeSummary.currentFYTotal || 0), color:'#64ffda', icon:'📈' },
                  { label:'This Month',  val: fmtFull(incomeSummary.thisMonthTotal || 0), color:'#a78bfa', icon:'📅' },
                  { label:'Total Entries', val: incomeEntries.length, color:'#0ea5e9', icon:'📋' },
                ].map(s => (
                  <div key={s.label} style={{ background:'#0a1628', borderRadius:10, padding:'16px 20px', border:'1px solid #1e3a5f' }}>
                    <div style={{ fontSize:20, marginBottom:8 }}>{s.icon}</div>
                    <div style={{ color:s.color, fontWeight:700, fontSize:22 }}>{s.val}</div>
                    <div style={{ color:'#475569', fontSize:12, marginTop:4 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Charts */}
              {incomeEntries.length > 0 && (() => {
                const PIE_COLORS = ['#64ffda','#a78bfa','#0ea5e9','#f59e0b','#f43f5e','#34d399','#fb923c'];
                const catData = Object.entries(incomeSummary.byCategory || {}).map(([name,value]) => ({ name, value })).filter(d=>d.value>0);
                const mthData = Object.keys(incomeSummary.byMonth || {}).sort().map(m => ({
                  month: new Date(m+'-01').toLocaleDateString('en-IN',{month:'short'}),
                  amount: incomeSummary.byMonth[m]
                }));
                return (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24 }}>
                    <div style={{ background:'#0a1628', borderRadius:10, border:'1px solid #1e3a5f', padding:'16px 20px' }}>
                      <div style={{ color:'#e2e8f0', fontWeight:700, fontSize:14, marginBottom:16 }}>By Category ({incomeSummary.fyLabel || 'FY26'})</div>
                      <div style={{ display:'flex', gap:16, alignItems:'center' }}>
                        <ResponsiveContainer width={150} height={150}>
                          <PieChart>
                            <Pie data={catData} cx={70} cy={70} innerRadius={40} outerRadius={68} dataKey="value" paddingAngle={2}>
                              {catData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={v=>fmtFull(v)} contentStyle={{background:'#141b2d',border:'1px solid #1a2235',borderRadius:8,fontSize:12}} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{flex:1}}>
                          {catData.map((d,i) => (
                            <div key={d.name} style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <div style={{width:8,height:8,borderRadius:'50%',background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                                <span style={{color:'#94a3b8',fontSize:12}}>{d.name}</span>
                              </div>
                              <span style={{color:'#e2e8f0',fontSize:12,fontWeight:600}}>{fmtFull(d.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ background:'#0a1628', borderRadius:10, border:'1px solid #1e3a5f', padding:'16px 20px' }}>
                      <div style={{ color:'#e2e8f0', fontWeight:700, fontSize:14, marginBottom:16 }}>Monthly Trend ({incomeSummary.fyLabel || 'FY26'})</div>
                      <ResponsiveContainer width="100%" height={150}>
                        <AreaChart data={mthData} margin={{top:5,right:10,left:0,bottom:0}}>
                          <defs>
                            <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#64ffda" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#64ffda" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="month" stroke="#334155" tick={{fill:'#64748b',fontSize:11}}/>
                          <YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'K'}/>
                          <Tooltip formatter={v=>[fmtFull(v),'Income']} contentStyle={{background:'#141b2d',border:'1px solid #1a2235',borderRadius:8,fontSize:12}}/>
                          <Area type="monotone" dataKey="amount" stroke="#64ffda" strokeWidth={2} fill="url(#incGrad)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              {/* Transactions table */}
              <div style={{ background:'#0a1628', borderRadius:10, border:'1px solid #1e3a5f' }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ color:'#e2e8f0', fontWeight:700, fontSize:14 }}>All Income Transactions</div>
                  <div style={{ color:'#475569', fontSize:12 }}>{incomeEntries.length} entries</div>
                </div>
                {incomeEntries.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'40px 20px' }}>
                    <div style={{ fontSize:36, marginBottom:12 }}>₹</div>
                    <div style={{ fontSize:14, color:'#475569', marginBottom:8 }}>No income entries yet</div>
                    <div style={{ fontSize:12, color:'#334155' }}>Set up rules in Settings → Income Tracking, or add entries manually</div>
                  </div>
                ) : (
                  <table className="db-table" style={{ width:'100%' }}>
                    <thead><tr>
                      {familyMode&&<th>Member</th>}<th>Date</th><th>Description</th><th>Category</th>
                      <th>Bank</th><th>Source</th><th className="right">Amount</th><th></th>
                    </tr></thead>
                    <tbody>
                      {incomeEntries.map(e => (
                        <tr key={e.id}>
                          {familyMode && <td style={{verticalAlign:'middle'}}><MemberBadge entry={e}/></td>}
                          <td style={{color:'#64748b',fontSize:12,whiteSpace:'nowrap'}}>
                            {new Date(e.credited_on+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                          </td>
                          <td>
                            <div style={{color:'#e2e8f0',fontSize:13}}>{e.description||e.category}</div>
                            {e.email_subject && <div style={{color:'#334155',fontSize:11,marginTop:1}}>{e.email_subject.slice(0,55)}</div>}
                          </td>
                          <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:4,fontWeight:600,background:'rgba(100,255,218,0.08)',color:'#64ffda'}}>{e.category}</span></td>
                          <td style={{color:'#64748b',fontSize:12}}>{e.receive_bank||'—'}</td>
                          <td>
                            <span style={{fontSize:11,padding:'2px 7px',borderRadius:4,
                              background:e.source==='auto'?'rgba(14,165,233,0.1)':'rgba(167,139,250,0.1)',
                              color:e.source==='auto'?'#38bdf8':'#a78bfa'}}>
                              {e.source==='auto'?'⚡ auto':'✎ manual'}
                            </span>
                          </td>
                          <td className="right" style={{color:'#64ffda',fontWeight:700}}>{fmtFull(e.amount)}</td>
                          <td>
                            <button onClick={()=>deleteIncomeEntry(e.id)}
                              style={{background:'none',border:'none',color:'#334155',cursor:'pointer',fontSize:14,padding:'2px 6px'}}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAX */}
          {tab === 'bankdeposits' && (() => {
            const fmt2 = (v) => v >= 10000000 ? `₹${(v/10000000).toFixed(2)}Cr` : v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
            const daysToTenor = (y,m,d) => (parseInt(y||0)*365)+(parseInt(m||0)*30)+parseInt(d||0);
            const matDateFD = (sd, td) => { const dt=new Date(sd||new Date()); dt.setDate(dt.getDate()+parseInt(td||0)); return isNaN(dt)?'—':dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };
            const matDateRD = (sd, tm) => { const dt=new Date(sd||new Date()); dt.setMonth(dt.getMonth()+parseInt(tm||0)); return isNaN(dt)?'—':dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };

            // Live preview computations for form
            const fdPreview = (() => {
              if (!fdForm.principal_amount || !fdForm.interest_rate_pa || !fdForm.start_date) return null;
              const P=parseFloat(fdForm.principal_amount), r=parseFloat(fdForm.interest_rate_pa)/100;
              const n={monthly:12,quarterly:4,half_yearly:2,annually:1,simple:1}[fdForm.compounding_freq]||4;
              const t=daysToTenor(fdForm.tenor_years,fdForm.tenor_months_part,fdForm.tenor_days_part)/365;
              if(t<=0) return null;
              const mat = fdForm.compounding_freq==='simple' ? P*(1+r*t) : P*Math.pow(1+r/n,n*t);
              const tds = fdForm.tds_applicable&&!fdForm.form_15g ? (parseFloat(fdForm.tds_rate)||10)/100 : 0;
              const net = P + (mat-P)*(1-tds);
              const matDt = matDateFD(fdForm.start_date, daysToTenor(fdForm.tenor_years,fdForm.tenor_months_part,fdForm.tenor_days_part));
              return { maturity: mat.toFixed(0), net: net.toFixed(0), interest: (mat-P).toFixed(0), matDate: matDt };
            })();

            const rdPreview = (() => {
              if (!rdForm.monthly_installment || !rdForm.interest_rate_pa || !rdForm.tenure_months) return null;
              const R=parseFloat(rdForm.monthly_installment), r=parseFloat(rdForm.interest_rate_pa)/100, n=4, tm=parseInt(rdForm.tenure_months||0);
              if(tm<1) return null;
              let mat=0;
              for(let i=1;i<=tm;i++) mat+=R*Math.pow(1+r/n,n*(tm-i+1)/12);
              const total=R*tm, tds=rdForm.tds_applicable&&!rdForm.form_15g?(parseFloat(rdForm.tds_rate)||10)/100:0;
              const net = total+(mat-total)*(1-tds);
              const matDt = matDateRD(rdForm.start_date, rdForm.tenure_months);
              return { maturity: mat.toFixed(0), net: net.toFixed(0), interest: (mat-total).toFixed(0), totalInvest: (R*tm).toFixed(0), matDate: matDt };
            })();

            const InputField = ({label,val,onChange,type='text',placeholder='',note,required}) => (
              <div>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4,letterSpacing:0.5}}>
                  {label}{required&&<span style={{color:'#f43f5e',marginLeft:2}}>*</span>}
                </label>
                <input value={val} onChange={onChange} type={type} placeholder={placeholder}
                  style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                {note&&<div style={{color:'#334155',fontSize:10,marginTop:2}}>{note}</div>}
              </div>
            );
            const SelectField = ({label,val,onChange,options,required}) => (
              <div>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4,letterSpacing:0.5}}>
                  {label}{required&&<span style={{color:'#f43f5e',marginLeft:2}}>*</span>}
                </label>
                <select value={val} onChange={onChange}
                  style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box',cursor:'pointer'}}>
                  {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            );

            return (
              <div className="fade-in">
                {/* ── Summary bar ── */}
                <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:20}}>
                  {[
                    {label:'FD Count',       val: fdSummary.active||0,                        unit:'active',  color:'#64ffda', icon:'🏦'},
                    {label:'FD Corpus',       val: fmt2(fdSummary.totalCurrentValue||0),       unit:'current', color:'#64ffda', icon:''},
                    {label:'FD at Maturity',  val: fmt2(fdSummary.totalMaturityValue||0),      unit:'if held', color:'#f59e0b', icon:''},
                    {label:'RD Count',        val: rdSummary.active||0,                        unit:'active',  color:'#818cf8', icon:'📅'},
                    {label:'RD Monthly',      val: fmt2(rdSummary.totalMonthlyCommit||0),      unit:'/month',  color:'#818cf8', icon:''},
                    {label:'RD Corpus',       val: fmt2(rdSummary.totalCurrentValue||0),       unit:'invested',color:'#818cf8', icon:''},
                  ].map(s=>(
                    <div key={s.label} style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:10,padding:'12px 16px',minWidth:130}}>
                      <div style={{fontSize:10,color:'#475569',fontWeight:700,letterSpacing:0.5,marginBottom:2}}>{s.label.toUpperCase()}</div>
                      <div style={{fontSize:20,fontWeight:700,color:s.color}}>{s.icon} {s.val}</div>
                      <div style={{fontSize:10,color:'#334155',marginTop:1}}>{s.unit}</div>
                    </div>
                  ))}
                </div>

                {/* ── FD Section ── */}
                <div className="db-card" style={{marginBottom:20}}>
                  <div className="db-card-header">
                    <div className="db-card-title">🏦 Fixed Deposits ({fdList.length})</div>
                    <button onClick={()=>openFdForm()} style={{background:'#6366f1',border:'none',color:'#fff',borderRadius:8,padding:'7px 16px',cursor:'pointer',fontSize:12,fontWeight:700}}>+ Add FD</button>
                  </div>
                  {fdLoading ? <div style={{padding:40,textAlign:'center',color:'#475569'}}>Loading…</div> : fdList.length === 0 ? (
                    <div style={{padding:'40px 20px',textAlign:'center',color:'#475569'}}>
                      <div style={{fontSize:36,marginBottom:8}}>🏦</div>
                      <div style={{fontSize:13}}>No Fixed Deposits added yet. Click <b style={{color:'#6366f1'}}>+ Add FD</b> to get started.</div>
                    </div>
                  ) : (
                    <div style={{overflowX:'auto'}}>
                      <table className="db-table">
                        <thead><tr>
                          <th>Institution</th>
                          <th className="right">Principal</th>
                          <th className="right">Rate</th>
                          <th>Tenor</th>
                          <th>Maturity</th>
                          <th className="right">Current Value</th>
                          <th className="right">Maturity Amt</th>
                          <th>Goal</th>
                          <th>Status</th>
                          <th></th>
                        </tr></thead>
                        <tbody>
                        {fdList.map(fd => {
                          const linked = fd.goals;
                          const daysLeft = fd.days_to_maturity;
                          const urgency = daysLeft > 0 && daysLeft <= 30 ? 'warn' : daysLeft <= 0 ? 'done' : 'ok';
                          return (
                            <tr key={fd.fd_id} className="kv-refresh-row">
                              <td>
                                <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13}}>{fd.nickname||fd.institution_name}</div>
                                <div style={{fontSize:10,color:'#475569'}}>{fd.institution_name} · {fd.payout_type}</div>
                                {fd.is_tax_saving_fd && <span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'rgba(0,212,161,0.1)',color:'#00d4a1'}}>80C</span>}
                              </td>
                              <td className="right mono">{fmt2(fd.principal_amount)}</td>
                              <td className="right" style={{color:'#f59e0b',fontWeight:600}}>{fd.interest_rate_pa}%</td>
                              <td style={{fontSize:12,color:'#64748b'}}>{Math.round(fd.tenor_days/30)}m</td>
                              <td style={{fontSize:12,whiteSpace:'nowrap'}}>
                                {new Date(fd.maturity_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                                {urgency==='warn' && <div style={{fontSize:10,color:'#f59e0b'}}>⚠ {daysLeft}d left</div>}
                                {urgency==='done' && <div style={{fontSize:10,color:'#f43f5e'}}>Matured</div>}
                              </td>
                              <td className="right mono" style={{color:'#00d4a1',fontWeight:600}}>{fmt2(fd.current_value)}</td>
                              <td className="right mono" style={{color:'#64ffda',fontWeight:700}}>{fmt2(fd.maturity_amount)}</td>
                              <td>
                                {linked ? (
                                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:8,background:'rgba(99,102,241,0.15)',color:'#818cf8',whiteSpace:'nowrap'}}>
                                    🎯 {linked.name?.slice(0,12)}{linked.name?.length>12?'…':''}
                                  </span>
                                ) : (
                                  <span style={{fontSize:10,color:'#334155'}}>—</span>
                                )}
                              </td>
                              <td>
                                <span style={{fontSize:10,padding:'2px 7px',borderRadius:8,fontWeight:600,
                                  background:fd.is_active?'rgba(0,212,161,0.08)':'rgba(100,116,139,0.1)',
                                  color:fd.is_active?'#00d4a1':'#64748b'}}>
                                  {fd.is_active?'Active':'Closed'}
                                </span>
                              </td>
                              <td>
                                <div style={{display:'flex',gap:4}}>
                                  <button onClick={()=>openFdForm(fd)} style={{background:'#1e2d3d',border:'1px solid #334155',color:'#94a3b8',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>Edit</button>
                                  <button onClick={()=>deleteFd(fd.fd_id)} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>✕</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── RD Section ── */}
                <div className="db-card">
                  <div className="db-card-header">
                    <div className="db-card-title">📅 Recurring Deposits ({rdList.length})</div>
                    <button onClick={()=>openRdForm()} style={{background:'#818cf8',border:'none',color:'#fff',borderRadius:8,padding:'7px 16px',cursor:'pointer',fontSize:12,fontWeight:700}}>+ Add RD</button>
                  </div>
                  {rdLoading ? <div style={{padding:40,textAlign:'center',color:'#475569'}}>Loading…</div> : rdList.length === 0 ? (
                    <div style={{padding:'40px 20px',textAlign:'center',color:'#475569'}}>
                      <div style={{fontSize:36,marginBottom:8}}>📅</div>
                      <div style={{fontSize:13}}>No Recurring Deposits added yet. Click <b style={{color:'#818cf8'}}>+ Add RD</b> to get started.</div>
                    </div>
                  ) : (
                    <div style={{overflowX:'auto'}}>
                      <table className="db-table">
                        <thead><tr>
                          <th>Institution</th>
                          <th className="right">Monthly</th>
                          <th className="right">Rate</th>
                          <th>Tenure</th>
                          <th>Maturity</th>
                          <th className="right">Invested</th>
                          <th className="right">Maturity Amt</th>
                          <th className="right">Progress</th>
                          <th>Goal</th>
                          <th></th>
                        </tr></thead>
                        <tbody>
                        {rdList.map(rd => {
                          const linked = rd.goals;
                          const progress = rd.tenure_months > 0 ? Math.round((rd.installments_paid/rd.tenure_months)*100) : 0;
                          return (
                            <tr key={rd.rd_id} className="kv-refresh-row">
                              <td>
                                <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13}}>{rd.nickname||rd.institution_name}</div>
                                <div style={{fontSize:10,color:'#475569'}}>{rd.institution_name}</div>
                                {rd.missed_installments > 0 && <span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'rgba(244,63,94,0.1)',color:'#f43f5e'}}>⚠ {rd.missed_installments} missed</span>}
                              </td>
                              <td className="right mono" style={{color:'#818cf8',fontWeight:600}}>{fmt2(rd.monthly_installment)}/mo</td>
                              <td className="right" style={{color:'#f59e0b',fontWeight:600}}>{rd.interest_rate_pa}%</td>
                              <td style={{fontSize:12,color:'#64748b'}}>{rd.tenure_months}m</td>
                              <td style={{fontSize:12,whiteSpace:'nowrap'}}>
                                {new Date(rd.maturity_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                                {rd.days_to_maturity <= 0 && <div style={{fontSize:10,color:'#f43f5e'}}>Matured</div>}
                              </td>
                              <td className="right mono">{fmt2(rd.total_invested)}</td>
                              <td className="right mono" style={{color:'#64ffda',fontWeight:700}}>{fmt2(rd.maturity_amount)}</td>
                              <td>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                  <div style={{flex:1,height:4,background:'#1e3a5f',borderRadius:2,minWidth:50,overflow:'hidden'}}>
                                    <div style={{height:'100%',width:`${progress}%`,borderRadius:2,background:progress>=100?'#00d4a1':'#818cf8',transition:'width 0.6s'}}/>
                                  </div>
                                  <span style={{fontSize:10,color:'#64748b',flexShrink:0}}>{progress}%</span>
                                </div>
                                <div style={{fontSize:10,color:'#475569',marginTop:1}}>{rd.installments_paid}/{rd.tenure_months}</div>
                              </td>
                              <td>
                                {linked ? (
                                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:8,background:'rgba(99,102,241,0.15)',color:'#818cf8',whiteSpace:'nowrap'}}>
                                    🎯 {linked.name?.slice(0,12)}{linked.name?.length>12?'…':''}
                                  </span>
                                ) : <span style={{fontSize:10,color:'#334155'}}>—</span>}
                              </td>
                              <td>
                                <div style={{display:'flex',gap:4}}>
                                  <button onClick={()=>openRdForm(rd)} style={{background:'#1e2d3d',border:'1px solid #334155',color:'#94a3b8',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>Edit</button>
                                  <button onClick={()=>deleteRd(rd.rd_id)} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>✕</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Maturity alerts ── */}
                {fdList.filter(f=>f.is_active && f.days_to_maturity>=0 && f.days_to_maturity<=30).length > 0 && (
                  <div style={{marginTop:16,padding:'12px 16px',borderRadius:10,background:'rgba(245,158,11,0.06)',border:'1px solid rgba(245,158,11,0.2)'}}>
                    <div style={{color:'#f59e0b',fontWeight:700,fontSize:13,marginBottom:8}}>⏰ FDs Maturing Soon</div>
                    {fdList.filter(f=>f.is_active && f.days_to_maturity>=0 && f.days_to_maturity<=30).map(fd=>(
                      <div key={fd.fd_id} style={{fontSize:12,color:'#94a3b8',marginBottom:4}}>
                        <b style={{color:'#e2e8f0'}}>{fd.nickname||fd.institution_name}</b> matures in <b style={{color:'#f59e0b'}}>{fd.days_to_maturity} days</b> — {fmt2(fd.maturity_amount)} · {fd.on_maturity_action.replace('_',' ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {tab === 'nps' && (() => {
            const nl  = npsData.latest;
            const fmt2 = (v) => v >= 10000000 ? `₹${(v/10000000).toFixed(2)}Cr` : v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
            return (
              <div className="fade-in">

                {/* ── Header ──────────────────────────────────────── */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                  <div>
                    <div style={{fontSize:20,fontWeight:700,color:'#e2e8f0'}}>🏛 National Pension System</div>
                    <div style={{fontSize:12,color:'#475569',marginTop:2}}>
                      {nl ? `PRAN: ${nl.pran||'—'} · ${npsData.count} statement${npsData.count!==1?'s':''} loaded` : 'Connect Gmail and sync to load NPS data'}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    {nl && <div style={{fontSize:11,color:'#475569',background:'rgba(255,255,255,0.04)',padding:'4px 10px',borderRadius:6}}>
                      As of {new Date(nl.statement_to+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                    </div>}
                    <button onClick={()=>{setNpsForm({statement_to:'',total_value:'',total_contributions:'',notional_gain:'',xirr:'',scheme_e_value:'',scheme_e_pct:'75',scheme_c_value:'',scheme_c_pct:'15',scheme_g_value:'',scheme_g_pct:'10',goal_id:'',goal_earmark_pct:'100'});setShowNpsForm(true);}}
                      style={{background:'rgba(179,157,219,0.12)',border:'1px solid rgba(179,157,219,0.3)',color:'#b39ddb',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:12,fontWeight:700}}>
                      + Manual Entry
                    </button>
                    <button onClick={syncNPS} disabled={npsSyncing}
                      style={{background:'#6366f1',border:'none',color:'#fff',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:12,fontWeight:700,opacity:npsSyncing?0.7:1}}>
                      {npsSyncing?'⟳ Scanning Gmail…':'⟳ Sync from Gmail'}
                    </button>
                  </div>
                </div>

                {/* Sync result banner */}
                {npsSyncResult && (
                  <div style={{marginBottom:16,padding:'10px 14px',borderRadius:8,fontSize:12,display:'flex',justifyContent:'space-between',alignItems:'center',
                    background:npsSyncResult.success?'rgba(99,102,241,0.06)':'rgba(244,63,94,0.06)',
                    border:`1px solid ${npsSyncResult.success?'rgba(99,102,241,0.2)':'rgba(244,63,94,0.2)'}`,
                    color:npsSyncResult.success?'#818cf8':'#f43f5e'}}>
                    <span>{npsSyncResult.success?'✅':'⚠'} {npsSyncResult.message}</span>
                    <button onClick={()=>setNpsSyncResult(null)} style={{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:14}}>✕</button>
                  </div>
                )}

                {nl ? (
                  <div>
                    {/* ── Summary tiles ── */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
                      {[
                        {label:'Total Corpus',   val:fmt2(nl.total_value||0),         color:'#b39ddb', sub:'Current value'},
                        {label:'Total Invested', val:fmt2(nl.total_contributions||0),  color:'#94a3b8', sub:`${nl.num_contributions||0} contributions`},
                        {label:'Notional Gain',  val:fmt2(nl.notional_gain||0),        color:parseFloat(nl.notional_gain||0)>=0?'#00d4a1':'#f43f5e', sub:'Total gain/loss'},
                        {label:'XIRR',           val:nl.xirr!=null?nl.xirr+'%':'—',   color:'#f59e0b', sub:'Annualised return'},
                      ].map(s=>(
                        <div key={s.label} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:'16px 14px'}}>
                          <div style={{fontSize:10,color:'#475569',fontWeight:700,letterSpacing:0.5,marginBottom:4}}>{s.label}</div>
                          <div style={{fontSize:22,fontWeight:700,color:s.color,marginBottom:2}}>{s.val}</div>
                          <div style={{fontSize:10,color:'#334155'}}>{s.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Scheme allocation ── */}
                    {(nl.scheme_e_value||nl.scheme_c_value||nl.scheme_g_value) ? (
                      <div className="db-card" style={{marginBottom:16}}>
                        <div className="db-card-header">
                          <div className="db-card-title">Scheme Allocation</div>
                          {nl.cbo_name && <div className="db-card-sub">Employer: {nl.cbo_name}</div>}
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                          {[
                            {label:'Scheme E — Equity',           val:nl.scheme_e_value, pct:nl.scheme_e_pct, nav:nl.scheme_e_nav, units:nl.scheme_e_units, color:'#00d4a1'},
                            {label:'Scheme C — Corporate Bonds',  val:nl.scheme_c_value, pct:nl.scheme_c_pct, nav:nl.scheme_c_nav, units:nl.scheme_c_units, color:'#0ea5e9'},
                            {label:'Scheme G — Govt Securities',  val:nl.scheme_g_value, pct:nl.scheme_g_pct, nav:nl.scheme_g_nav, units:nl.scheme_g_units, color:'#f59e0b'},
                          ].map(s=>(
                            <div key={s.label} style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:10,padding:'14px 16px'}}>
                              <div style={{fontSize:10,color:'#475569',marginBottom:8,fontWeight:600}}>{s.label}</div>
                              <div style={{fontSize:20,fontWeight:700,color:s.color,marginBottom:8}}>{fmt2(s.val||0)}</div>
                              <div style={{height:4,background:'#1e3a5f',borderRadius:2,overflow:'hidden',marginBottom:6}}>
                                <div style={{height:'100%',width:`${Math.min(100,s.pct||0)}%`,background:s.color,borderRadius:2,transition:'width 0.8s ease'}}/>
                              </div>
                              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#475569'}}>
                                <span>{(s.pct||0).toFixed(1)}% of corpus</span>
                                <span>{Number(s.units||0).toFixed(4)} units</span>
                              </div>
                              <div style={{fontSize:10,color:'#334155',marginTop:2}}>NAV: ₹{s.nav||'—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* ── Growth chart ── */}
                    {npsData.history && npsData.history.length > 1 ? (
                      <div className="db-card" style={{marginBottom:16}}>
                        <div className="db-card-header">
                          <div>
                            <div className="db-card-title">📈 Corpus Growth</div>
                            <div className="db-card-sub">{npsData.history.length} data points · Since {npsData.history[0]?.date||''}</div>
                          </div>
                          {npsData.growthPct && (
                            <div style={{fontSize:16,fontWeight:700,color:parseFloat(npsData.growthPct)>=0?'#00d4a1':'#f43f5e'}}>
                              {parseFloat(npsData.growthPct)>=0?'+':''}{npsData.growthPct}%
                            </div>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={(npsData.history||[]).map(h=>({
                            month: new Date(h.date+'T00:00:00').toLocaleDateString('en-IN',{month:'short',year:'2-digit'}),
                            total:  parseFloat(h.total_value||0),
                            equity: parseFloat(h.scheme_e||0),
                            corp:   parseFloat(h.scheme_c||0),
                            govt:   parseFloat(h.scheme_g||0),
                          }))}>
                            <defs>
                              <linearGradient id="npsGradTab" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#b39ddb" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#b39ddb" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="month" stroke="#4a5a7a" tick={{fontSize:10,fill:'#64748b'}} interval="preserveStartEnd"/>
                            <YAxis stroke="#4a5a7a" tick={{fontSize:10,fill:'#64748b'}} tickFormatter={v=>v>=100000?`₹${(v/100000).toFixed(1)}L`:`₹${(v/1000).toFixed(0)}K`} width={60}/>
                            <Tooltip contentStyle={{background:'#0d1526',border:'1px solid #1e3a5f',borderRadius:8,fontSize:11}} formatter={(v,name)=>[fmt2(v),name==='total'?'Corpus':name==='equity'?'Scheme E':name==='corp'?'Scheme C':'Scheme G']} labelStyle={{color:'#94a3b8'}}/>
                            <Area type="monotone" dataKey="equity" stroke="#00d4a1" strokeWidth={1} fill="none" dot={false} name="equity"/>
                            <Area type="monotone" dataKey="corp"   stroke="#0ea5e9" strokeWidth={1} fill="none" dot={false} name="corp"/>
                            <Area type="monotone" dataKey="govt"   stroke="#f59e0b" strokeWidth={1} fill="none" dot={false} name="govt"/>
                            <Area type="monotone" dataKey="total"  stroke="#b39ddb" strokeWidth={2.5} fill="url(#npsGradTab)" dot={{r:3,fill:'#b39ddb',strokeWidth:0}} activeDot={{r:5}} name="total"/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : null}

                    {/* ── Goal linkage ── */}
                    <div className="db-card" style={{marginBottom:16}}>
                      <div className="db-card-header">
                        <div className="db-card-title">🎯 Goal Linkage</div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:12}}>
                        {nl.goals ? (
                          <span style={{fontSize:13,padding:'4px 12px',borderRadius:8,background:'rgba(99,102,241,0.15)',color:'#818cf8',fontWeight:600}}>
                            🎯 {nl.goals.name}
                          </span>
                        ) : <span style={{fontSize:13,color:'#475569'}}>Not linked to any goal</span>}
                        <select value={nl.goal_id||''} onChange={async e=>{
                            await npsAPI.update(nl.id,{goal_id:e.target.value||null}).catch(()=>{});
                            await loadNPS();
                          }}
                          style={{marginLeft:'auto',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'8px 12px',color:'#e2e8f0',fontSize:12,outline:'none',cursor:'pointer'}}>
                          <option value="">— No goal —</option>
                          {(goals||[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                      {nl.goals && <div style={{fontSize:11,color:'#475569',marginTop:8}}>
                        NPS corpus of {fmt2(nl.total_value||0)} is contributing to "{nl.goals.name}"
                      </div>}
                    </div>

                    {/* ── All statements table ── */}
                    {npsData.history && npsData.history.length > 0 && (
                      <div className="db-card">
                        <div className="db-card-header">
                          <div className="db-card-title">Statement History</div>
                          <div className="db-card-sub">{npsData.count} records</div>
                        </div>
                        <div style={{overflowX:'auto'}}>
                          <table className="db-table">
                            <thead><tr>
                              <th>Date</th>
                              <th className="right">Total Corpus</th>
                              <th className="right">Invested</th>
                              <th className="right">Gain/Loss</th>
                              <th className="right">XIRR</th>
                              <th className="right">Scheme E</th>
                              <th className="right">Scheme C</th>
                              <th className="right">Scheme G</th>
                            </tr></thead>
                            <tbody>
                              {[...npsData.history].reverse().map((h,i)=>(
                                <tr key={i} className="kv-refresh-row">
                                  <td style={{color:'#94a3b8',fontSize:12}}>{new Date(h.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
                                  <td className="right mono" style={{color:'#b39ddb',fontWeight:700}}>{fmt2(h.total_value)}</td>
                                  <td className="right mono">{fmt2((npsData.history.find(x=>x.date===h.date)||{}).total_value)}</td>
                                  <td className="right mono" style={{color:parseFloat(h.total_value||0)>0?'#00d4a1':'#f43f5e'}}>—</td>
                                  <td className="right" style={{color:'#f59e0b'}}>{h.xirr!=null?h.xirr+'%':'—'}</td>
                                  <td className="right mono" style={{color:'#00d4a1'}}>{fmt2(h.scheme_e||0)}</td>
                                  <td className="right mono" style={{color:'#0ea5e9'}}>{fmt2(h.scheme_c||0)}</td>
                                  <td className="right mono" style={{color:'#f59e0b'}}>{fmt2(h.scheme_g||0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="db-card" style={{padding:'40px 20px',textAlign:'center'}}>
                    <div style={{fontSize:48,marginBottom:12}}>🏛</div>
                    <div style={{fontSize:16,fontWeight:600,color:'#e2e8f0',marginBottom:8}}>No NPS Data Loaded</div>
                    <div style={{fontSize:13,color:'#64748b',marginBottom:12,lineHeight:1.6}}>
                      Click <b style={{color:'#6366f1'}}>⟳ Sync from Gmail</b> to scan your Protean NPS emails,<br/>
                      or use <b style={{color:'#b39ddb'}}>+ Manual Entry</b> to add data directly.
                    </div>
                    <button onClick={async()=>{
                      try {
                        const r = await npsAPI.get();
                        alert('NPS API Response:\ncount: ' + r.data.count + '\nlatest: ' + JSON.stringify(r.data.latest)?.slice(0,200));
                        if (r.data.count > 0) loadNPS();
                      } catch(e) { alert('NPS API Error: ' + e.message); }
                    }} style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontSize:12,marginBottom:16}}>
                      🔍 Debug: Check API Response
                    </button>
                    <div style={{display:'flex',gap:12,justifyContent:'center'}}>
                      <button onClick={syncNPS} disabled={npsSyncing}
                        style={{background:'#6366f1',border:'none',color:'#fff',borderRadius:8,padding:'10px 20px',cursor:'pointer',fontSize:13,fontWeight:700}}>
                        {npsSyncing?'⟳ Scanning…':'⟳ Sync from Gmail'}
                      </button>
                      <button onClick={()=>{setNpsForm({statement_to:'',total_value:'',total_contributions:'',notional_gain:'',xirr:'',scheme_e_value:'',scheme_e_pct:'75',scheme_c_value:'',scheme_c_pct:'15',scheme_g_value:'',scheme_g_pct:'10',goal_id:'',goal_earmark_pct:'100'});setShowNpsForm(true);}}
                        style={{background:'rgba(179,157,219,0.12)',border:'1px solid rgba(179,157,219,0.3)',color:'#b39ddb',borderRadius:8,padding:'10px 20px',cursor:'pointer',fontSize:13,fontWeight:700}}>
                        + Manual Entry
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })()}

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
              <div className="db-modal-sub">Kanalyst reads your broker emails to automatically track your portfolio. Read-only access, no email modification.</div>
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

      {/* ── MANUAL EXPENSE ENTRY ── */}
      {showExpenseEntry && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowExpenseEntry(false);}}>
          <div className="db-modal fade-in" style={{maxWidth:520}}>
            <div className="db-modal-header">
              <div className="db-modal-title">💸 Add Expense</div>
              <button className="db-modal-close" onClick={()=>setShowExpenseEntry(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              {/* Amount + Date */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>AMOUNT (₹) *</label>
                  <input className="db-input" type="number" placeholder="e.g. 450" value={expenseEntryForm.amount} onChange={e=>setExpenseEntryForm(p=>({...p,amount:e.target.value}))} />
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>DATE *</label>
                  <input className="db-input" type="date" value={expenseEntryForm.expense_date} onChange={e=>setExpenseEntryForm(p=>({...p,expense_date:e.target.value}))} />
                </div>
              </div>
              {/* Merchant + auto-categorize */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>MERCHANT / PAID TO</label>
                <div style={{display:'flex',gap:8}}>
                  <input className="db-input" style={{flex:1}} placeholder="e.g. Swiggy, Zomato, Apollo Pharmacy"
                    value={expenseEntryForm.merchant_name}
                    onChange={e=>setExpenseEntryForm(p=>({...p,merchant_name:e.target.value}))} />
                  <button onClick={async()=>{
                      const r = await autoCategorizeMerchant(expenseEntryForm.merchant_name);
                      if(r?.category) setExpenseEntryForm(p=>({...p,category:r.category,sub_category:r.sub_category||''}));
                    }}
                    style={{background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.3)',color:'#a78bfa',borderRadius:8,padding:'8px 12px',cursor:'pointer',fontSize:12,whiteSpace:'nowrap'}}>
                    🤖 Auto
                  </button>
                </div>
              </div>
              {/* Category + Sub */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>CATEGORY</label>
                  <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}
                    value={expenseEntryForm.category} onChange={e=>setExpenseEntryForm(p=>({...p,category:e.target.value,sub_category:''}))}>
                    <option value="">— select —</option>
                    {Object.keys(expenseCategories).map(cat=><option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>SUB-CATEGORY</label>
                  <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}
                    value={expenseEntryForm.sub_category} onChange={e=>setExpenseEntryForm(p=>({...p,sub_category:e.target.value}))}>
                    <option value="">— select —</option>
                    {(expenseCategories[expenseEntryForm.category]||[]).map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {/* Comments */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>COMMENTS</label>
                <input className="db-input" placeholder="Optional notes" value={expenseEntryForm.comments} onChange={e=>setExpenseEntryForm(p=>({...p,comments:e.target.value}))} />
              </div>
              <button onClick={saveExpenseEntry} disabled={!expenseEntryForm.amount||!expenseEntryForm.expense_date||expenseEntrySaving}
                style={{width:'100%',background:'#fb923c',color:'#fff',border:'none',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                {expenseEntrySaving?'⟳ Saving…':'+ Save Expense'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── GOAL FORM MODAL ── */}
      {showGoalForm && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowGoalForm(false);}}>
          <div className="db-modal fade-in" style={{maxWidth:560,maxHeight:'90vh',overflowY:'auto'}}>
            <div className="db-modal-header">
              <div className="db-modal-title" style={{fontSize:18,fontWeight:700,color:'#e2e8f0'}}>
                {editingGoal ? '✎ Edit Goal' : '🎯 New Goal'}
              </div>
              <button className="db-modal-close" onClick={()=>setShowGoalForm(false)}>✕</button>
            </div>
            <div className="db-modal-body">

              {/* Name */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>GOAL NAME *</label>
                <input className="db-input" placeholder="e.g. Emergency Fund, House Down Payment, Retirement" value={goalForm.name} onChange={e=>setGoalForm(p=>({...p,name:e.target.value}))} />
              </div>

              {/* Description */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>DESCRIPTION</label>
                <textarea className="db-input" rows={2} placeholder="What is this goal for?" value={goalForm.description} onChange={e=>setGoalForm(p=>({...p,description:e.target.value}))} style={{resize:'vertical',minHeight:60}} />
              </div>

              {/* Target + Duration */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>TARGET VALUE (₹) *</label>
                  <input className="db-input" type="number" placeholder="e.g. 500000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))} />
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>TARGET DATE</label>
                  <input className="db-input" type="date" value={goalForm.target_date} onChange={e=>setGoalForm(p=>({...p,target_date:e.target.value}))} />
                </div>
              </div>

              {/* Duration type */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:8}}>DURATION</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                  {[
                    {id:'ultra_short',label:'Ultra Short',hint:'Days / Weeks',color:'#f59e0b'},
                    {id:'short',      label:'Short',      hint:'Months',       color:'#0ea5e9'},
                    {id:'mid',        label:'Mid Term',   hint:'1–5 Years',    color:'#6366f1'},
                    {id:'long',       label:'Long Term',  hint:'5+ Years',     color:'#00d4a1'},
                  ].map(d=>(
                    <div key={d.id} onClick={()=>setGoalForm(p=>({...p,duration_type:d.id}))}
                      style={{padding:'10px 8px',borderRadius:8,border:`1px solid ${goalForm.duration_type===d.id?d.color:'#1e3a5f'}`,background:goalForm.duration_type===d.id?`${d.color}15`:'#060e1a',cursor:'pointer',textAlign:'center'}}>
                      <div style={{color:goalForm.duration_type===d.id?d.color:'#e2e8f0',fontSize:12,fontWeight:600}}>{d.label}</div>
                      <div style={{color:'#475569',fontSize:10,marginTop:2}}>{d.hint}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recurring toggle */}
              <div style={{marginBottom:12,background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:goalForm.is_recurring?12:0}}>
                  <div>
                    <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>Recurring Goal</div>
                    <div style={{color:'#475569',fontSize:11}}>Repeats on a schedule (SIP, yearly savings, etc.)</div>
                  </div>
                  <div onClick={()=>setGoalForm(p=>({...p,is_recurring:!p.is_recurring}))}
                    style={{width:44,height:24,borderRadius:12,background:goalForm.is_recurring?'#6366f1':'#334155',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}>
                    <div style={{position:'absolute',top:2,left:goalForm.is_recurring?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left 0.2s'}}/>
                  </div>
                </div>
                {goalForm.is_recurring && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                    <div>
                      <label style={{display:'block',color:'#94a3b8',fontSize:10,fontWeight:700,marginBottom:4}}>FREQUENCY</label>
                      <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0'}} value={goalForm.recurrence} onChange={e=>setGoalForm(p=>({...p,recurrence:e.target.value}))}>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div>
                      <label style={{display:'block',color:'#94a3b8',fontSize:10,fontWeight:700,marginBottom:4}}>DAY</label>
                      <input className="db-input" type="number" min="1" max="31" placeholder="1-31" value={goalForm.recurrence_day} onChange={e=>setGoalForm(p=>({...p,recurrence_day:e.target.value}))} />
                    </div>
                    {goalForm.recurrence==='yearly' && (
                      <div>
                        <label style={{display:'block',color:'#94a3b8',fontSize:10,fontWeight:700,marginBottom:4}}>MONTH</label>
                        <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0'}} value={goalForm.recurrence_month} onChange={e=>setGoalForm(p=>({...p,recurrence_month:e.target.value}))}>
                          {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>(
                            <option key={i+1} value={i+1}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Picture upload - only when editing existing */}
              {editingGoal && (
                <div style={{marginBottom:16}}>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:8}}>GOAL PICTURE</label>
                  <label style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',border:'1px dashed #1e3a5f',borderRadius:8,cursor:'pointer',color:'#475569',fontSize:12}}>
                    {picUploading ? '⟳ Uploading...' : '📷 Upload a picture for this goal'}
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>uploadGoalPic(editingGoal.id,e.target.files[0])} />
                  </label>
                  {editingGoal.picture_url && <img src={editingGoal.picture_url} alt="" style={{marginTop:8,width:'100%',height:80,objectFit:'cover',borderRadius:8}} />}
                </div>
              )}

              <button onClick={saveGoal} disabled={!goalForm.name||!goalForm.target_value||goalFormSaving}
                style={{width:'100%',background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',border:'none',borderRadius:10,padding:'13px',fontWeight:700,fontSize:14,cursor:'pointer',marginTop:4}}>
                {goalFormSaving ? '⟳ Saving...' : (editingGoal ? 'Update Goal' : '🎯 Create Goal')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GOAL DETAIL MODAL ── */}
      {goalDetail && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setGoalDetail(null);}}>
          <div className="db-modal fade-in" style={{maxWidth:640,maxHeight:'90vh',overflowY:'auto',padding:0}}>
            {/* Picture header */}
            {goalDetail.picture_url ? (
              <div style={{height:140,backgroundImage:`url(${goalDetail.picture_url})`,backgroundSize:'cover',backgroundPosition:'center',borderRadius:'20px 20px 0 0',position:'relative'}}>
                <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(0,0,0,0.2),rgba(10,22,40,0.95))',borderRadius:'20px 20px 0 0'}}/>
                <div style={{position:'absolute',bottom:16,left:24,right:24,display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
                  <div>
                    <div style={{color:'#fff',fontSize:20,fontWeight:700}}>{goalDetail.name}</div>
                    <div style={{color:'rgba(255,255,255,0.6)',fontSize:12}}>{goalDetail.description}</div>
                  </div>
                  <button onClick={()=>setGoalDetail(null)} style={{background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.2)',color:'#fff',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,backdropFilter:'blur(8px)'}}>✕ Close</button>
                </div>
              </div>
            ) : (
              <div style={{padding:'20px 24px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{color:'#e2e8f0',fontSize:18,fontWeight:700}}>{goalDetail.name}</div>
                  {goalDetail.description && <div style={{color:'#64748b',fontSize:12,marginTop:2}}>{goalDetail.description}</div>}
                </div>
                <button onClick={()=>setGoalDetail(null)} style={{background:'#1e293b',border:'1px solid #334155',color:'#94a3b8',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12}}>✕ Close</button>
              </div>
            )}

            <div style={{padding:'20px 24px 24px'}}>
              {/* Progress */}
              <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16,marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                  <div>
                    <div style={{color:'#475569',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:2}}>CURRENT</div>
                    <div style={{color:'#6366f1',fontWeight:700,fontSize:22}}>{fmtFull(goalDetail.current_value||0)}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{color:'#475569',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:2}}>TARGET</div>
                    <div style={{color:'#e2e8f0',fontWeight:700,fontSize:22}}>{fmtFull(goalDetail.target_value)}</div>
                  </div>
                </div>
                <div style={{height:10,background:'#1e3a5f',borderRadius:5,overflow:'hidden',marginBottom:6}}>
                  <div style={{height:'100%',width:`${Math.min(100,goalDetail.progress||0)}%`,borderRadius:5,background:goalDetail.progress>=100?'#00d4a1':goalDetail.progress>50?'#6366f1':'#f59e0b',transition:'width 0.6s',boxShadow:`0 0 10px ${goalDetail.progress>=100?'#00d4a1':'#6366f1'}60`}} />
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#475569'}}>
                  <span>{(goalDetail.progress||0).toFixed(1)}% achieved</span>
                  {goalDetail.target_date && <span>Target: {new Date(goalDetail.target_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>}
                </div>
              </div>

              {/* Linked assets */}
              <div style={{marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{color:'#e2e8f0',fontWeight:700,fontSize:13}}>Linked Assets</div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>{setGoalDetail(null);loadTab('holdings');}}
                      style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>
                      + Stock
                    </button>
                    <button onClick={()=>{setGoalDetail(null);loadTab('mutualfunds');}}
                      style={{background:'rgba(14,165,233,0.1)',border:'1px solid rgba(14,165,233,0.3)',color:'#38bdf8',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>
                      + Mutual Fund
                    </button>
                  </div>
                </div>
                {goalDetail.assets?.length===0 ? (
                  <div style={{textAlign:'center',padding:'20px',color:'#334155',fontSize:13,border:'1px dashed #1e3a5f',borderRadius:8}}>
                    No assets linked yet. Link your stocks or MF folios to track progress automatically.
                  </div>
                ) : goalDetail.assets?.map(a=>(
                  <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#060e1a',borderRadius:8,marginBottom:6,border:'1px solid #1e3a5f'}}>
                    <div>
                      <span style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>{a.asset_name}</span>
                      <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'rgba(99,102,241,0.1)',color:'#818cf8',marginLeft:8}}>{a.asset_type.toUpperCase()}</span>
                    </div>
                    <button onClick={()=>unlinkAsset(goalDetail.id, a.id)} style={{background:'none',border:'none',color:'#334155',cursor:'pointer',fontSize:14}}>✕</button>
                  </div>
                ))}
              </div>

              {/* Cycles (if recurring) */}
              {goalDetail.is_recurring && (
                <div style={{marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <div style={{color:'#e2e8f0',fontWeight:700,fontSize:13}}>Cycles
                      {goalDetail.recurrence && <span style={{fontSize:10,color:'#475569',fontWeight:400,marginLeft:6}}>({goalDetail.recurrence})</span>}
                    </div>
                    {goalCycles.some(cy=>cy.status==='inprogress') && (
                      <button onClick={async()=>{
                        const val = prompt('Amount achieved this cycle (₹):');
                        if(val===null) return;
                        await goalsAPI.closeCycle(goalDetail.id, {action:'close', achieved_value: parseFloat(val)||0});
                        await openGoalDetail(goalDetail);
                      }} style={{background:'rgba(0,212,161,0.1)',border:'1px solid rgba(0,212,161,0.3)',color:'#00d4a1',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:11,fontWeight:600}}>
                        ✓ Close Current Cycle
                      </button>
                    )}
                  </div>
                  {goalCycles.length === 0 ? (
                    <div style={{color:'#334155',fontSize:12,textAlign:'center',padding:'12px 0'}}>No cycles yet</div>
                  ) : goalCycles.slice(0,5).map(cy=>(
                    <div key={cy.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#060e1a',borderRadius:8,marginBottom:4,border:'1px solid #1e3a5f',fontSize:12}}>
                      <span style={{color:'#94a3b8'}}>Cycle {cy.cycle_number} · {cy.cycle_start}</span>
                      <div style={{display:'flex',gap:10,alignItems:'center'}}>
                        {cy.achieved_value>0 && <span style={{color:'#e2e8f0'}}>{fmtFull(cy.achieved_value)}</span>}
                        <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:cy.status==='completed'?'rgba(0,212,161,0.1)':cy.status==='missed'?'rgba(244,63,94,0.1)':'rgba(245,158,11,0.1)',color:cy.status==='completed'?'#00d4a1':cy.status==='missed'?'#f43f5e':'#f59e0b'}}>{cy.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>{setEditingGoal(goalDetail);setGoalForm({name:goalDetail.name,description:goalDetail.description||'',target_value:String(goalDetail.target_value),duration_type:goalDetail.duration_type,target_date:goalDetail.target_date||'',is_recurring:goalDetail.is_recurring,recurrence:goalDetail.recurrence||'monthly',recurrence_day:String(goalDetail.recurrence_day||1),recurrence_month:String(goalDetail.recurrence_month||'')});setGoalDetail(null);setShowGoalForm(true);}}
                  style={{flex:1,background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',borderRadius:8,padding:'10px',cursor:'pointer',fontSize:13,fontWeight:600}}>✎ Edit</button>
                <button onClick={()=>{const f=new FormData();document.getElementById(`goal-pic-${goalDetail.id}`)?.click();}} style={{flex:1,background:'rgba(14,165,233,0.1)',border:'1px solid rgba(14,165,233,0.3)',color:'#38bdf8',borderRadius:8,padding:'10px',cursor:'pointer',fontSize:13,fontWeight:600}}>
                  📷 Upload Picture
                  <input id={`goal-pic-${goalDetail.id}`} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{uploadGoalPic(goalDetail.id,e.target.files[0]);}} />
                </button>
                <button onClick={()=>deleteGoal(goalDetail.id)} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:8,padding:'10px 14px',cursor:'pointer',fontSize:13}}>🗑</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BULK LINK MODAL ── */}
      {bulkLinkMode && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setBulkLinkMode(null);}}>
          <div className="db-modal fade-in" style={{maxWidth:520}}>
            <div className="db-modal-header">
              <div style={{fontSize:16,fontWeight:700,color:'#e2e8f0'}}>
                🎯 Link All {bulkLinkMode==='stock'?'Stocks':'Mutual Funds'} to a Goal
                <div style={{fontSize:12,color:'#64748b',fontWeight:400,marginTop:4}}>
                  {bulkLinkMode==='stock'
                    ? `All ${holdings.length} stock${holdings.length!==1?'s':''} will be linked. You can change individual ones after.`
                    : `All ${mfHoldings.length} fund${mfHoldings.length!==1?'s':''} will be linked. You can change individual ones after.`}
                </div>
              </div>
              <button className="db-modal-close" onClick={()=>setBulkLinkMode(null)}>✕</button>
            </div>
            <div className="db-modal-body">
              {goals.length === 0 ? (
                <div style={{textAlign:'center',padding:'30px 0',color:'#475569'}}>
                  <div style={{fontSize:32,marginBottom:8}}>🎯</div>
                  <div>No goals yet. Create a goal first from the Goals tab.</div>
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{color:'#64748b',fontSize:12,marginBottom:4}}>Select a goal — all holdings will be assigned to it:</div>
                  {goals.map(goal => {
                    const prog = Math.min(100, goal.progress || 0);
                    return (
                      <div key={goal.id}
                        onClick={()=>bulkLinkToGoal(goal.id)}
                        style={{
                          display:'flex',justifyContent:'space-between',alignItems:'center',
                          padding:'12px 16px',borderRadius:10,cursor:'pointer',
                          border:'1px solid #1e3a5f',background:'#060e1a',transition:'all 0.15s',
                        }}
                        onMouseOver={e=>{e.currentTarget.style.borderColor='#6366f1';e.currentTarget.style.background='rgba(99,102,241,0.05)';}}
                        onMouseOut={e=>{e.currentTarget.style.borderColor='#1e3a5f';e.currentTarget.style.background='#060e1a';}}>
                        <div style={{flex:1}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                            <span style={{color:'#e2e8f0',fontWeight:700,fontSize:14}}>{goal.name}</span>
                            <span style={{fontSize:10,padding:'1px 7px',borderRadius:8,
                              background:goal.status==='completed'?'rgba(0,212,161,0.1)':goal.status==='inprogress'?'rgba(245,158,11,0.1)':'rgba(100,116,139,0.1)',
                              color:goal.status==='completed'?'#00d4a1':goal.status==='inprogress'?'#f59e0b':'#64748b'}}>
                              {goal.status==='inprogress'?'In Progress':goal.status==='completed'?'Completed':'New'}
                            </span>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <div style={{flex:1,height:5,background:'#1e3a5f',borderRadius:3,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${prog}%`,borderRadius:3,
                                background:prog>=100?'#00d4a1':prog>50?'#6366f1':'#f59e0b'}}/>
                            </div>
                            <span style={{color:'#475569',fontSize:11,flexShrink:0}}>{prog.toFixed(0)}% of {fmtFull(goal.target_value)}</span>
                          </div>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,marginLeft:16,flexShrink:0}}>
                          {bulkLinking && bulkProgress.total > 0 ? (
                            <>
                              <span style={{fontSize:12,color:'#f59e0b',fontWeight:700,whiteSpace:'nowrap'}}>
                                {bulkProgress.current} / {bulkProgress.total}
                              </span>
                              <div style={{width:60,height:3,background:'rgba(245,158,11,0.15)',borderRadius:2}}>
                                <div style={{height:'100%',borderRadius:2,background:'#f59e0b',
                                  width:`${Math.round((bulkProgress.current/bulkProgress.total)*100)}%`,
                                  transition:'width 0.15s ease'}}/>
                              </div>
                            </>
                          ) : (
                            <span style={{fontSize:13,color:'#6366f1',fontWeight:700,whiteSpace:'nowrap'}}>
                              {bulkLinking ? 'Starting…' : 'Link All →'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {bulkLinkResult && (
                <div style={{margin:'14px 0 0',padding:'12px 16px',borderRadius:10,background:'rgba(0,212,161,0.06)',border:'1px solid rgba(0,212,161,0.2)'}}>
                  <div style={{color:'#00d4a1',fontWeight:700,fontSize:13,marginBottom:4}}>
                    ✅ {bulkLinkResult.linked} holding{bulkLinkResult.linked!==1?'s':''} linked to goal!
                  </div>
                  {bulkLinkResult.skipped > 0 && <div style={{color:'#475569',fontSize:11}}>{bulkLinkResult.skipped} already linked — skipped.</div>}
                  <div style={{color:'#64748b',fontSize:11,marginTop:4}}>Use the 🎯 button on any row to reassign individual holdings.</div>
                  <button onClick={()=>{setBulkLinkMode(null);setBulkLinkResult(null);}}
                    style={{marginTop:10,background:'#00d4a1',border:'none',color:'#000',borderRadius:8,padding:'7px 18px',fontWeight:700,fontSize:12,cursor:'pointer'}}>Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── LINK ASSET MODAL ── */}
      {linkingAsset && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setLinkingAsset(null);}}>
          <div className="db-modal fade-in" style={{maxWidth:500}}>
            <div className="db-modal-header">
              <div style={{fontSize:16,fontWeight:700,color:'#e2e8f0'}}>
                🎯 Link to Goal
                <div style={{fontSize:12,color:'#64748b',fontWeight:400,marginTop:4}}>{linkingAsset.name}</div>
              </div>
              <button className="db-modal-close" onClick={()=>setLinkingAsset(null)}>x</button>
            </div>
            <div className="db-modal-body">
              {goals.length === 0 ? (
                <div style={{textAlign:'center',padding:'30px 0',color:'#475569'}}>
                  <div style={{fontSize:32,marginBottom:8}}>🎯</div>
                  <div>No goals yet. Create a goal first from the Goals tab.</div>
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{color:'#64748b',fontSize:12,marginBottom:8}}>Select a goal to link <b style={{color:'#e2e8f0'}}>{linkingAsset.name}</b> to:</div>
                  {goals.map(goal => {
                    const alreadyLinked = goal.assets && goal.assets.some(a => a.asset_ref === linkingAsset.ref);
                    const prog = Math.min(100, goal.progress || 0);
                    return (
                      <div key={goal.id}
                        onClick={()=>!alreadyLinked && linkHoldingToGoal(goal.id)}
                        style={{
                          display:'flex',justifyContent:'space-between',alignItems:'center',
                          padding:'12px 16px',borderRadius:10,cursor:alreadyLinked?'default':'pointer',
                          border:`1px solid ${alreadyLinked?'rgba(0,212,161,0.3)':'#1e3a5f'}`,
                          background:alreadyLinked?'rgba(0,212,161,0.06)':'#060e1a',
                          transition:'border-color 0.15s',
                        }}
                        onMouseOver={e=>{ if(!alreadyLinked) e.currentTarget.style.borderColor='#6366f1'; }}
                        onMouseOut={e=>{ if(!alreadyLinked) e.currentTarget.style.borderColor='#1e3a5f'; }}>
                        <div style={{flex:1}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                            <span style={{color:'#e2e8f0',fontWeight:600,fontSize:13}}>{goal.name}</span>
                            <span style={{fontSize:10,padding:'1px 6px',borderRadius:8,
                              background:goal.status==='completed'?'rgba(0,212,161,0.1)':goal.status==='inprogress'?'rgba(245,158,11,0.1)':'rgba(100,116,139,0.1)',
                              color:goal.status==='completed'?'#00d4a1':goal.status==='inprogress'?'#f59e0b':'#64748b'}}>
                              {goal.status==='inprogress'?'In Progress':goal.status}
                            </span>
                            {alreadyLinked && <span style={{fontSize:10,padding:'1px 6px',borderRadius:8,background:'rgba(0,212,161,0.1)',color:'#00d4a1'}}>Already linked</span>}
                          </div>
                          <div style={{height:4,background:'#1e3a5f',borderRadius:2,overflow:'hidden',maxWidth:200}}>
                            <div style={{height:'100%',width:`${prog}%`,borderRadius:2,background:prog>=100?'#00d4a1':prog>50?'#6366f1':'#f59e0b'}}/>
                          </div>
                          <div style={{color:'#475569',fontSize:10,marginTop:3}}>{prog.toFixed(0)}% of {fmtFull(goal.target_value)}</div>
                        </div>
                        {!alreadyLinked && (
                          <span style={{fontSize:12,color:'#6366f1',fontWeight:600,marginLeft:12}}>Link →</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── NPS MANUAL ENTRY MODAL ── */}
      {showNpsForm && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowNpsForm(false)}}>
          <div className="db-modal fade-in" style={{maxWidth:540}}>
            <div className="db-modal-header">
              <div className="db-modal-title">🏛 Add NPS Entry</div>
              <button className="db-modal-close" onClick={()=>setShowNpsForm(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>STATEMENT DATE *</label>
                  <input type="date" value={npsForm.statement_to||''} onChange={e=>setNpsForm(p=>({...p,statement_to:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                  <div style={{fontSize:10,color:'#334155',marginTop:2}}>Last day of the NPS statement month</div>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TOTAL CORPUS (₹) *</label>
                  <input type="number" value={npsForm.total_value||''} onChange={e=>setNpsForm(p=>({...p,total_value:e.target.value}))} placeholder="e.g. 439215"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TOTAL CONTRIBUTIONS (₹)</label>
                  <input type="number" value={npsForm.total_contributions||''} onChange={e=>setNpsForm(p=>({...p,total_contributions:e.target.value}))} placeholder="e.g. 397445"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>NOTIONAL GAIN (₹)</label>
                  <input type="number" value={npsForm.notional_gain||''} onChange={e=>setNpsForm(p=>({...p,notional_gain:e.target.value}))} placeholder="e.g. 41770"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>XIRR (%)</label>
                  <input type="number" step="0.01" value={npsForm.xirr||''} onChange={e=>setNpsForm(p=>({...p,xirr:e.target.value}))} placeholder="e.g. 8.34"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:'#64ffda',fontWeight:700,marginBottom:8}}>Scheme-wise Breakdown (optional)</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[['e','Scheme E (Equity)','#00d4a1'],['c','Scheme C (Corp)','#0ea5e9'],['g','Scheme G (Govt)','#f59e0b']].map(([key,label,color])=>(
                    <div key={key}>
                      <div style={{fontSize:10,color:color,fontWeight:700,marginBottom:4}}>{label}</div>
                      <input type="number" value={npsForm[`scheme_${key}_value`]||''} onChange={e=>setNpsForm(p=>({...p,[`scheme_${key}_value`]:e.target.value}))} placeholder="₹ Value"
                        style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:6,padding:'7px 10px',color:'#e2e8f0',fontSize:12,outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'end',marginBottom:14}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>LINK TO GOAL</label>
                  <select value={npsForm.goal_id||''} onChange={e=>setNpsForm(p=>({...p,goal_id:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    <option value="">— No goal —</option>
                    {goals.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                {npsForm.goal_id && (
                  <div>
                    <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>EARMARK %</label>
                    <input type="number" min="1" max="100" value={npsForm.goal_earmark_pct||100} onChange={e=>setNpsForm(p=>({...p,goal_earmark_pct:e.target.value}))}
                      style={{width:70,background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none'}}/>
                  </div>
                )}
              </div>

              {npsError && <div style={{color:'#f43f5e',fontSize:12,marginBottom:10,padding:'7px 10px',background:'rgba(244,63,94,0.08)',borderRadius:6}}>⚠ {npsError}</div>}
              <button onClick={saveNpsManual} disabled={npsSaving||!npsForm.statement_to||!npsForm.total_value}
                style={{width:'100%',background:'#b39ddb',border:'none',color:'#fff',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                {npsSaving?'⟳ Saving…':'Save NPS Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FD FORM MODAL ── */}
      {showFdForm && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowFdForm(false)}}>
          <div className="db-modal fade-in" style={{maxWidth:620,maxHeight:'92vh',overflowY:'auto'}}>
            <div className="db-modal-header">
              <div className="db-modal-title">🏦 {editingFd?'Edit':'Add'} Fixed Deposit</div>
              <button className="db-modal-close" onClick={()=>setShowFdForm(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>INSTITUTION *</label>
                  <input list="fd-banks" value={fdForm.institution_name||''} onChange={e=>setFdForm(p=>({...p,institution_name:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}} placeholder="e.g. SBI"/>
                  <datalist id="fd-banks">
                    {['SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Bank','Post Office','Bajaj Finance','Tamilnad Mercantile Bank','Other'].map(b=><option key={b} value={b}/>)}
                  </datalist>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TYPE *</label>
                  <select value={fdForm.institution_type||'bank'} onChange={e=>setFdForm(p=>({...p,institution_type:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    {[['bank','Bank'],['post_office','Post Office'],['nbfc','NBFC'],['cooperative','Cooperative']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>NICKNAME</label>
                  <input value={fdForm.nickname||''} onChange={e=>setFdForm(p=>({...p,nickname:e.target.value}))} placeholder="e.g. Emergency Fund FD"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>PRINCIPAL (₹) *</label>
                  <input type="number" min="1000" value={fdForm.principal_amount||''} onChange={e=>setFdForm(p=>({...p,principal_amount:e.target.value}))} placeholder="e.g. 100000"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>INTEREST RATE (% p.a.) *</label>
                  <input type="number" step="0.01" value={fdForm.interest_rate_pa||''} onChange={e=>setFdForm(p=>({...p,interest_rate_pa:e.target.value}))} placeholder="e.g. 7.25"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>COMPOUNDING</label>
                  <select value={fdForm.compounding_freq||'quarterly'} onChange={e=>setFdForm(p=>({...p,compounding_freq:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    {[['quarterly','Quarterly'],['monthly','Monthly'],['half_yearly','Half Yearly'],['annually','Annually'],['simple','Simple Interest']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>PAYOUT TYPE</label>
                  <select value={fdForm.payout_type||'cumulative'} onChange={e=>setFdForm(p=>({...p,payout_type:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    {[['cumulative','Cumulative (at maturity)'],['non_cumulative','Non-Cumulative (periodic)']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>START DATE *</label>
                  <input type="date" value={fdForm.start_date||''} onChange={e=>setFdForm(p=>({...p,start_date:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              </div>

              {/* Tenor Y/M/D */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:6}}>TENOR *</label>
                <div style={{display:'flex',gap:8}}>
                  {[['tenor_years','Years'],['tenor_months_part','Months'],['tenor_days_part','Days']].map(([key,label])=>(
                    <div key={key} style={{flex:1}}>
                      <input type="number" min="0" value={fdForm[key]||0} onChange={e=>setFdForm(p=>({...p,[key]:e.target.value}))}
                        style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',textAlign:'center',boxSizing:'border-box'}}/>
                      <div style={{textAlign:'center',color:'#475569',fontSize:10,marginTop:3}}>{label}</div>
                    </div>
                  ))}
                </div>
                {fdForm.start_date && (parseInt(fdForm.tenor_years||0)*365+parseInt(fdForm.tenor_months_part||0)*30+parseInt(fdForm.tenor_days_part||0))>0 && (
                  <div style={{color:'#64748b',fontSize:11,marginTop:4}}>
                    Maturity: <b style={{color:'#e2e8f0'}}>
                    {(() => { const td=new Date(fdForm.start_date); td.setDate(td.getDate()+(parseInt(fdForm.tenor_years||0)*365+parseInt(fdForm.tenor_months_part||0)*30+parseInt(fdForm.tenor_days_part||0))); return td.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); })()}
                    </b>
                  </div>
                )}
              </div>

              {/* Maturity action */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>ON MATURITY</label>
                  <select value={fdForm.on_maturity_action||'undecided'} onChange={e=>setFdForm(p=>({...p,on_maturity_action:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    {[['undecided','Undecided'],['auto_renew','Auto Renew'],['credit_to_account','Credit to Account']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {fdForm.on_maturity_action==='auto_renew' && (
                  <div>
                    <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>RENEW WITH</label>
                    <select value={fdForm.auto_renew_type||'principal_only'} onChange={e=>setFdForm(p=>({...p,auto_renew_type:e.target.value}))}
                      style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                      {[['principal_only','Principal Only'],['principal_plus_interest','Principal + Interest']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* TDS */}
              <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:14,marginBottom:12}}>
                <div style={{fontSize:12,color:'#64ffda',fontWeight:700,marginBottom:10}}>Tax (TDS)</div>
                <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!fdForm.tds_applicable} onChange={e=>setFdForm(p=>({...p,tds_applicable:e.target.checked}))} style={{accentColor:'#6366f1'}}/>
                    TDS Applicable
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!fdForm.form_15g} onChange={e=>setFdForm(p=>({...p,form_15g:e.target.checked,tds_applicable:e.target.checked?false:p.tds_applicable}))} style={{accentColor:'#6366f1'}}/>
                    Form 15G/H Submitted
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!fdForm.is_tax_saving_fd} onChange={e=>setFdForm(p=>({...p,is_tax_saving_fd:e.target.checked,tenor_years:e.target.checked?'5':p.tenor_years,tenor_months_part:'0',tenor_days_part:'0'}))} style={{accentColor:'#6366f1'}}/>
                    Tax-Saving 80C FD (5yr)
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!fdForm.is_senior_rate} onChange={e=>setFdForm(p=>({...p,is_senior_rate:e.target.checked}))} style={{accentColor:'#6366f1'}}/>
                    Senior Citizen Rate
                  </label>
                </div>
                {fdForm.tds_applicable && !fdForm.form_15g && (
                  <div style={{marginTop:10}}>
                    <label style={{color:'#94a3b8',fontSize:11,marginBottom:4,display:'block'}}>TDS RATE (%)</label>
                    <input type="number" value={fdForm.tds_rate||10} onChange={e=>setFdForm(p=>({...p,tds_rate:e.target.value}))} style={{width:80,background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:6,padding:'6px 10px',color:'#e2e8f0',fontSize:12,outline:'none'}}/>
                  </div>
                )}
              </div>

              {/* Goal linkage */}
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'end',marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>LINK TO GOAL</label>
                  <select value={fdForm.goal_id||''} onChange={e=>setFdForm(p=>({...p,goal_id:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    <option value="">— No goal —</option>
                    {goals.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                {fdForm.goal_id && (
                  <div>
                    <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>EARMARK %</label>
                    <input type="number" min="1" max="100" value={fdForm.goal_earmark_pct||100} onChange={e=>setFdForm(p=>({...p,goal_earmark_pct:e.target.value}))}
                      style={{width:70,background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none'}}/>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {fdPreview && (
                <div style={{background:'rgba(99,102,241,0.06)',border:'1px solid rgba(99,102,241,0.2)',borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontSize:11,color:'#6366f1',fontWeight:700,marginBottom:8,letterSpacing:0.5}}>LIVE PREVIEW</div>
                  <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                    {[
                      {label:'Maturity Amount', val:`₹${Number(fdPreview.maturity).toLocaleString('en-IN')}`, color:'#64ffda'},
                      {label:'Interest Earned',  val:`₹${Number(fdPreview.interest).toLocaleString('en-IN')}`, color:'#f59e0b'},
                      {label:'Net After TDS',    val:`₹${Number(fdPreview.net).toLocaleString('en-IN')}`, color:'#00d4a1'},
                      {label:'Maturity Date',    val:fdPreview.matDate, color:'#818cf8'},
                    ].map(p=>(
                      <div key={p.label}>
                        <div style={{fontSize:10,color:'#475569'}}>{p.label}</div>
                        <div style={{fontSize:15,fontWeight:700,color:p.color}}>{p.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {fdError && <div style={{color:'#f43f5e',fontSize:12,marginBottom:10,padding:'7px 10px',background:'rgba(244,63,94,0.08)',borderRadius:6}}>⚠ {fdError}</div>}
              <button onClick={saveFd} disabled={fdSaving} style={{width:'100%',background:'#6366f1',border:'none',color:'#fff',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                {fdSaving?'⟳ Saving…':(editingFd?'Update FD':'Add Fixed Deposit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RD FORM MODAL ── */}
      {showRdForm && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowRdForm(false)}}>
          <div className="db-modal fade-in" style={{maxWidth:600,maxHeight:'92vh',overflowY:'auto'}}>
            <div className="db-modal-header">
              <div className="db-modal-title">📅 {editingRd?'Edit':'Add'} Recurring Deposit</div>
              <button className="db-modal-close" onClick={()=>setShowRdForm(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>INSTITUTION *</label>
                  <input list="rd-banks" value={rdForm.institution_name||''} onChange={e=>setRdForm(p=>({...p,institution_name:e.target.value}))} placeholder="e.g. HDFC Bank"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                  <datalist id="rd-banks">
                    {['SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Bank','Post Office','Tamilnad Mercantile Bank','Other'].map(b=><option key={b} value={b}/>)}
                  </datalist>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TYPE *</label>
                  <select value={rdForm.institution_type||'bank'} onChange={e=>setRdForm(p=>({...p,institution_type:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    {[['bank','Bank'],['post_office','Post Office'],['nbfc','NBFC'],['cooperative','Cooperative']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>NICKNAME</label>
                  <input value={rdForm.nickname||''} onChange={e=>setRdForm(p=>({...p,nickname:e.target.value}))} placeholder="e.g. Home Down Payment RD"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>MONTHLY INSTALLMENT (₹) *</label>
                  <input type="number" min="100" value={rdForm.monthly_installment||''} onChange={e=>setRdForm(p=>({...p,monthly_installment:e.target.value}))} placeholder="e.g. 5000"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>INTEREST RATE (% p.a.) *</label>
                  <input type="number" step="0.01" value={rdForm.interest_rate_pa||''} onChange={e=>setRdForm(p=>({...p,interest_rate_pa:e.target.value}))} placeholder="e.g. 6.5"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TENURE (months) *</label>
                  <input type="number" min="6" max="120" value={rdForm.tenure_months||''} onChange={e=>setRdForm(p=>({...p,tenure_months:e.target.value}))} placeholder="e.g. 36"
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>START DATE *</label>
                  <input type="date" value={rdForm.start_date||''} onChange={e=>setRdForm(p=>({...p,start_date:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>MISSED INSTALLMENTS</label>
                  <input type="number" min="0" value={rdForm.missed_installments||0} onChange={e=>setRdForm(p=>({...p,missed_installments:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              </div>

              {/* Maturity date preview */}
              {rdForm.start_date && rdForm.tenure_months && (
                <div style={{fontSize:11,color:'#64748b',marginBottom:12}}>
                  Maturity: <b style={{color:'#e2e8f0'}}>
                  {(() => { const dt=new Date(rdForm.start_date); dt.setMonth(dt.getMonth()+parseInt(rdForm.tenure_months||0)); return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); })()}
                  </b>
                </div>
              )}

              {/* TDS */}
              <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:14,marginBottom:12}}>
                <div style={{fontSize:12,color:'#64ffda',fontWeight:700,marginBottom:10}}>Tax (TDS)</div>
                <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!rdForm.tds_applicable} onChange={e=>setRdForm(p=>({...p,tds_applicable:e.target.checked}))} style={{accentColor:'#818cf8'}}/>
                    TDS Applicable
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!rdForm.form_15g} onChange={e=>setRdForm(p=>({...p,form_15g:e.target.checked,tds_applicable:e.target.checked?false:p.tds_applicable}))} style={{accentColor:'#818cf8'}}/>
                    Form 15G/H Submitted
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                    <input type="checkbox" checked={!!rdForm.is_senior_rate} onChange={e=>setRdForm(p=>({...p,is_senior_rate:e.target.checked}))} style={{accentColor:'#818cf8'}}/>
                    Senior Citizen Rate
                  </label>
                </div>
              </div>

              {/* Goal linkage */}
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'end',marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>LINK TO GOAL</label>
                  <select value={rdForm.goal_id||''} onChange={e=>setRdForm(p=>({...p,goal_id:e.target.value}))}
                    style={{width:'100%',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',cursor:'pointer',boxSizing:'border-box'}}>
                    <option value="">— No goal —</option>
                    {goals.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                {rdForm.goal_id && (
                  <div>
                    <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>EARMARK %</label>
                    <input type="number" min="1" max="100" value={rdForm.goal_earmark_pct||100} onChange={e=>setRdForm(p=>({...p,goal_earmark_pct:e.target.value}))}
                      style={{width:70,background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none'}}/>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {rdPreview && (
                <div style={{background:'rgba(129,140,248,0.06)',border:'1px solid rgba(129,140,248,0.2)',borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontSize:11,color:'#818cf8',fontWeight:700,marginBottom:8,letterSpacing:0.5}}>LIVE PREVIEW</div>
                  <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                    {[
                      {label:'Total Investment',  val:`₹${Number(rdPreview.totalInvest).toLocaleString('en-IN')}`, color:'#94a3b8'},
                      {label:'Maturity Amount',   val:`₹${Number(rdPreview.maturity).toLocaleString('en-IN')}`,    color:'#64ffda'},
                      {label:'Interest Earned',   val:`₹${Number(rdPreview.interest).toLocaleString('en-IN')}`,    color:'#f59e0b'},
                      {label:'Net After TDS',     val:`₹${Number(rdPreview.net).toLocaleString('en-IN')}`,         color:'#00d4a1'},
                      {label:'Maturity Date',     val:rdPreview.matDate,                                           color:'#818cf8'},
                    ].map(p=>(
                      <div key={p.label}>
                        <div style={{fontSize:10,color:'#475569'}}>{p.label}</div>
                        <div style={{fontSize:14,fontWeight:700,color:p.color}}>{p.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {rdError && <div style={{color:'#f43f5e',fontSize:12,marginBottom:10,padding:'7px 10px',background:'rgba(244,63,94,0.08)',borderRadius:6}}>⚠ {rdError}</div>}
              <button onClick={saveRd} disabled={rdSaving} style={{width:'100%',background:'#818cf8',border:'none',color:'#fff',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                {rdSaving?'⟳ Saving…':(editingRd?'Update RD':'Add Recurring Deposit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS MODAL ── */}
      {showSettings && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget){setShowSettings(false);setShowRuleForm(false);}}}>
          <div style={{background:'#0d1526',border:'1px solid #1e3a5f',borderRadius:14,width:720,maxWidth:'95vw',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',flex:1,minHeight:0}}>
              {/* Left nav */}
              <div style={{width:190,borderRight:'1px solid #1e3a5f',padding:'20px 0',flexShrink:0}}>
                <div style={{color:'#475569',fontSize:10,fontWeight:700,letterSpacing:2,padding:'0 16px 12px',textTransform:'uppercase'}}>Settings</div>
                {[{id:'family',icon:'👨‍👩‍👧‍👦',label:'Family'},{id:'history',icon:'📊',label:'Historical Sync'},{id:'privacy',icon:'👁',label:'Privacy'},{id:'income',icon:'₹',label:'Income Tracking'},{id:'expense',icon:'💸',label:'Expense Tracking'},{id:'expensesettings',icon:'⚙',label:'Expense Rules'}].map(s=>(
                  <div key={s.id} onClick={()=>setSettingsSection(s.id)}
                    style={{padding:'11px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,fontSize:13,
                      background:settingsSection===s.id?'rgba(100,255,218,0.08)':'transparent',
                      color:settingsSection===s.id?'#64ffda':'#64748b',
                      borderRight:settingsSection===s.id?'2px solid #64ffda':'2px solid transparent',transition:'all 0.15s'}}>
                    <span>{s.icon}</span>{s.label}
                  </div>
                ))}
              </div>
              {/* Content */}
              <div style={{flex:1,padding:'20px 24px',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}}>
                  <div>
                    <div style={{color:'#e2e8f0',fontWeight:700,fontSize:16}}>{settingsSection==='income'?'₹ Income Tracking':'💸 Expense Tracking'}</div>
                    <div style={{color:'#475569',fontSize:12,marginTop:3}}>{settingsSection==='income'?'Auto-detect income from bank credit emails every 30 min':'Coming soon'}</div>
                  </div>
                  <button onClick={()=>{setShowSettings(false);setShowRuleForm(false);}} style={{background:'none',border:'none',color:'#64748b',fontSize:20,cursor:'pointer',padding:4}}>✕</button>
                </div>

                {(settingsSection==='expense' || settingsSection==='expensesettings') && (
                  <>
                    <div style={{background:'rgba(251,146,60,0.06)',border:'1px solid rgba(251,146,60,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#fb923c'}}>
                      💡 Kanalyst auto-detects expenses from UPI debit & credit card emails every 30 min. Add rules to focus on specific banks.
                    </div>

                    {showExpenseRuleForm ? (
                      <div style={{background:'#060e1a',borderRadius:10,padding:16,border:'1px solid #1e3a5f',marginBottom:14}}>
                        <div style={{color:'#fb923c',fontWeight:700,fontSize:13,marginBottom:14}}>{editingExpenseRule?'✎ Edit Rule':'+ New Scan Rule'}</div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>RULE NAME *</label>
                            <input className="db-input" placeholder="e.g. HDFC Debit Alerts" value={expenseRuleForm.rule_name} onChange={e=>setExpenseRuleForm(p=>({...p,rule_name:e.target.value}))} />
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>BANK SENDER EMAIL</label>
                            <input className="db-input" placeholder="e.g. alerts@hdfcbank.net" value={expenseRuleForm.email_sender} onChange={e=>setExpenseRuleForm(p=>({...p,email_sender:e.target.value}))} />
                          </div>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>SUBJECT CONTAINS</label>
                            <input className="db-input" placeholder="e.g. Debit Alert" value={expenseRuleForm.subject_pattern} onChange={e=>setExpenseRuleForm(p=>({...p,subject_pattern:e.target.value}))} />
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>SCAN HISTORY</label>
                            <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}} value={expenseRuleForm.lookback_months} onChange={e=>setExpenseRuleForm(p=>({...p,lookback_months:e.target.value}))}>
                              <option value="0">From now</option>
                              <option value="1">Last 1 month</option>
                              <option value="3">Last 3 months</option>
                              <option value="6">Last 6 months</option>
                            </select>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:8}}>
                          <button onClick={saveExpenseRule} disabled={expenseRuleSaving}
                            style={{flex:1,background:'#fb923c',color:'#fff',border:'none',borderRadius:8,padding:'10px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                            {expenseRuleSaving?'⟳ Saving…':(editingExpenseRule?'Update':'Save Rule')}
                          </button>
                          <button onClick={()=>{setShowExpenseRuleForm(false);setEditingExpenseRule(null);}} style={{padding:'10px 16px',background:'#1e2d3d',color:'#94a3b8',border:'1px solid #334155',borderRadius:8,cursor:'pointer',fontSize:13}}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {expenseRules.map(r=>(
                          <div key={r.id} style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'10px 14px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <div>
                              <span style={{color:'#e2e8f0',fontWeight:600,fontSize:13}}>{r.rule_name}</span>
                              {r.email_sender&&<span style={{color:'#475569',fontSize:11,marginLeft:8}}>{r.email_sender}</span>}
                            </div>
                            <div style={{display:'flex',gap:6}}>
                              <button onClick={()=>{setEditingExpenseRule(r);setExpenseRuleForm({rule_name:r.rule_name,email_sender:r.email_sender||'',subject_pattern:r.subject_pattern||'',body_pattern:r.body_pattern||'',lookback_months:String(r.lookback_months||0)});setShowExpenseRuleForm(true);}} style={{background:'#1e2d3d',border:'1px solid #334155',color:'#94a3b8',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Edit</button>
                              <button onClick={async()=>{await api.delete(`/api/expense/rules/${r.id}`);await loadExpenses();}} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>✕</button>
                            </div>
                          </div>
                        ))}
                        {expenseRules.length===0&&<div style={{textAlign:'center',padding:'16px 0',color:'#334155',fontSize:13,marginBottom:12}}>No rules — default scan catches all debit emails.</div>}
                        <div style={{display:'flex',gap:10}}>
                          <button onClick={()=>setShowExpenseRuleForm(true)} style={{flex:1,background:'rgba(251,146,60,0.1)',border:'1px solid rgba(251,146,60,0.3)',color:'#fb923c',borderRadius:8,padding:'10px',fontWeight:700,fontSize:13,cursor:'pointer'}}>+ New Rule</button>
                          <button onClick={scanExpenses} disabled={expenseScanning} style={{flex:1,background:'#fb923c',border:'none',color:'#fff',borderRadius:8,padding:'10px',fontWeight:700,fontSize:13,cursor:'pointer'}}>{expenseScanning?'⟳ Scanning…':'⟳ Scan Now'}</button>
                        </div>
                        {expenseScanResult&&<div style={{marginTop:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:expenseScanResult.success?'rgba(251,146,60,0.08)':'rgba(244,63,94,0.08)',border:`1px solid ${expenseScanResult.success?'rgba(251,146,60,0.2)':'rgba(244,63,94,0.2)'}`,color:expenseScanResult.success?'#fb923c':'#f43f5e'}}>{expenseScanResult.success?'✅':'⚠'} {expenseScanResult.message}{(expenseScanResult.emailsRead||0)>0&&` · ${expenseScanResult.emailsRead} read, ${expenseScanResult.found} captured`}</div>}
                      </>
                    )}
                  </>
                )}

                {settingsSection==='family' && (
                <div>
                  <div style={{color:'#e2e8f0',fontSize:14,fontWeight:700,marginBottom:16}}>👨‍👩‍👧‍👦 Family</div>

                  {/* Pending invites */}
                  {familyStatus.pendingInvites?.length > 0 && (
                    <div style={{marginBottom:18}}>
                      <div style={{color:'#f59e0b',fontSize:12,fontWeight:700,letterSpacing:1,marginBottom:8}}>PENDING INVITES</div>
                      {familyStatus.pendingInvites.map(inv => (
                        <div key={inv.id} style={{background:'rgba(245,158,11,0.06)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:8}}>
                          <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600,marginBottom:4}}>{inv.inviterName} invited you to join <b>{inv.groupName}</b></div>
                          <div style={{color:'#64748b',fontSize:11,marginBottom:10}}>You will share portfolio data with this family group</div>
                          <div style={{display:'flex',gap:8}}>
                            <button onClick={()=>respondInvite(inv.id,'accept')} style={{flex:1,background:'#00d4a1',border:'none',color:'#000',borderRadius:8,padding:'8px',fontWeight:700,fontSize:13,cursor:'pointer'}}>✅ Accept</button>
                            <button onClick={()=>respondInvite(inv.id,'reject')} style={{flex:1,background:'rgba(244,63,94,0.1)',border:'1px solid rgba(244,63,94,0.3)',color:'#f43f5e',borderRadius:8,padding:'8px',fontWeight:700,fontSize:13,cursor:'pointer'}}>✕ Decline</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Current family members */}
                  {familyStatus.inFamily && familyStatus.members.length > 0 && (
                    <div style={{marginBottom:18}}>
                      <div style={{color:'#94a3b8',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:8}}>FAMILY MEMBERS</div>
                      {familyStatus.members.map(m => (
                        <div key={m.user_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,marginBottom:6}}>
                          <div>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>{m.name}</span>
                              {m.isMe && <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'rgba(99,102,241,0.1)',color:'#818cf8'}}>You</span>}
                              {m.role==='admin' && <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'rgba(0,212,161,0.1)',color:'#00d4a1'}}>Admin</span>}
                            </div>
                            <div style={{color:'#475569',fontSize:11,marginTop:2}}>{m.email}</div>
                          </div>
                          {!m.isMe && (
                            <button onClick={()=>removeFamilyMember(m.user_id)} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Remove</button>
                          )}
                          {m.isMe && (
                            <button onClick={()=>removeFamilyMember(m.user_id)} style={{background:'rgba(100,116,139,0.08)',border:'1px solid #1e3a5f',color:'#64748b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Leave</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sent invites */}
                  {familyStatus.sentInvites?.filter(i=>i.status==='pending').length > 0 && (
                    <div style={{marginBottom:18}}>
                      <div style={{color:'#94a3b8',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:8}}>SENT INVITES (AWAITING)</div>
                      {familyStatus.sentInvites.filter(i=>i.status==='pending').map(inv => (
                        <div key={inv.id} style={{display:'flex',justifyContent:'space-between',padding:'8px 14px',background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,marginBottom:4,fontSize:12}}>
                          <span style={{color:'#94a3b8'}}>{inv.invited_email}</span>
                          <span style={{color:'#f59e0b'}}>⏳ Pending</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Invite new member */}
                  <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16}}>
                    <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600,marginBottom:4}}>Invite a family member</div>
                    <div style={{color:'#475569',fontSize:11,marginBottom:12}}>They must have a Kanalyst account. Once accepted, you'll share portfolio data.</div>
                    <div style={{display:'flex',gap:8}}>
                      <input className="db-input" style={{flex:1}} type="email" placeholder="Enter email address"
                        value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}
                        onKeyDown={e=>e.key==='Enter'&&sendInvite()} />
                      <button onClick={sendInvite} disabled={!inviteEmail.trim()||inviteSending}
                        style={{background:'#6366f1',border:'none',color:'#fff',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontWeight:700,fontSize:13,whiteSpace:'nowrap'}}>
                        {inviteSending?'⟳':'Send Invite'}
                      </button>
                    </div>
                    {inviteResult && (
                      <div style={{marginTop:10,padding:'8px 12px',borderRadius:8,fontSize:12,
                        background:inviteResult.success?'rgba(0,212,161,0.08)':'rgba(244,63,94,0.08)',
                        color:inviteResult.success?'#00d4a1':'#f43f5e'}}>
                        {inviteResult.success?'✅':'⚠'} {inviteResult.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {settingsSection==='history' && (
                <div>
                  <div style={{color:'#e2e8f0',fontSize:14,fontWeight:700,marginBottom:4}}>📊 Historical Sync</div>
                  <div style={{color:'#475569',fontSize:12,marginBottom:16}}>
                    Scan all your old NSDL &amp; CDSL CAS emails to build a complete portfolio history. Each CAS email becomes a monthly snapshot used for the growth chart.
                  </div>

                  {/* History stats */}
                  {historyData.length > 0 && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
                      {[
                        {label:'Snapshots',    val:historyData.length,                                  color:'#64ffda'},
                        {label:'Date Range',   val:historySummary.dateRange?`${historySummary.dateRange.from} to ${historySummary.dateRange.to}`:'—', color:'#94a3b8'},
                        {label:'Growth',       val:historySummary.growthPct?`${historySummary.growthPct>=0?'+':''}${historySummary.growthPct}%`:'—', color:parseFloat(historySummary.growthPct||0)>=0?'#00d4a1':'#f43f5e'},
                      ].map(s=>(
                        <div key={s.label} style={{background:'#060e1a',borderRadius:8,padding:'10px 14px',border:'1px solid #1e3a5f',textAlign:'center'}}>
                          <div style={{color:s.color,fontWeight:700,fontSize:16}}>{s.val}</div>
                          <div style={{color:'#475569',fontSize:11,marginTop:2}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Date range selector */}
                  <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16,marginBottom:14}}>
                    <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600,marginBottom:4}}>Backfill Date Range</div>
                    <div style={{color:'#475569',fontSize:11,marginBottom:12}}>
                      Leave blank to scan ALL available CAS emails. Specify a range to limit the scan (e.g. last 5 years).
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                      <div>
                        <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>FROM DATE</label>
                        <input type="date" value={backfillFromDate} onChange={e=>setBackfillFromDate(e.target.value)}
                          style={{width:'100%',background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                        <div style={{fontSize:10,color:'#334155',marginTop:2}}>e.g. 2020-01-01 for 5 years</div>
                      </div>
                      <div>
                        <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:4}}>TO DATE</label>
                        <input type="date" value={backfillToDate} onChange={e=>setBackfillToDate(e.target.value)}
                          style={{width:'100%',background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:8,padding:'9px 12px',color:'#e2e8f0',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                        <div style={{fontSize:10,color:'#334155',marginTop:2}}>Leave blank for today</div>
                      </div>
                    </div>
                    <button onClick={startBackfill} disabled={backfilling}
                      style={{width:'100%',background:backfilling?'#1e2d3d':'#6366f1',border:'none',color:backfilling?'#475569':'#fff',borderRadius:8,padding:'11px',fontWeight:700,fontSize:13,cursor:backfilling?'not-allowed':'pointer'}}>
                      {backfilling ? '⟳ Scanning CAS emails — this may take a few minutes…' : '⟳ Start Historical Sync'}
                    </button>
                    {backfillResult && (
                      <div style={{marginTop:10,padding:'8px 12px',borderRadius:8,fontSize:12,
                        background:backfillResult.success?'rgba(0,212,161,0.06)':'rgba(244,63,94,0.06)',
                        border:`1px solid ${backfillResult.success?'rgba(0,212,161,0.2)':'rgba(244,63,94,0.2)'}`,
                        color:backfillResult.success?'#00d4a1':'#f43f5e'}}>
                        {backfillResult.success ? '✅' : '⚠'} {backfillResult.message}
                      </div>
                    )}
                  </div>

                  {/* NPS sync */}
                  <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16,marginBottom:14}}>
                    <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600,marginBottom:4}}>🏛 NPS Historical Sync</div>
                    <div style={{color:'#475569',fontSize:11,marginBottom:10}}>Scan all old NPS emails from Protean CRA and load your full pension history.</div>
                    <div style={{display:'flex',gap:8,marginBottom:10}}>
                      <input type="date" value={npsFromDate} onChange={e=>setNpsFromDate(e.target.value)} placeholder="From date (optional)"
                        style={{flex:1,background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:8,padding:'8px 12px',color:'#e2e8f0',fontSize:12,outline:'none'}}/>
                      <button onClick={syncNPS} disabled={npsSyncing}
                        style={{background:'#b39ddb',border:'none',color:'#fff',borderRadius:8,padding:'8px 16px',fontWeight:700,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                        {npsSyncing?'⟳ Scanning…':'Sync NPS'}
                      </button>
                    </div>
                    {npsSyncResult && <div style={{fontSize:11,padding:'6px 10px',borderRadius:6,background:npsSyncResult.success?'rgba(179,157,219,0.06)':'rgba(244,63,94,0.06)',color:npsSyncResult.success?'#b39ddb':'#f43f5e'}}>{npsSyncResult.message}</div>}
                  </div>

                  {/* Manual snapshot */}
                  <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16}}>
                    <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600,marginBottom:4}}>Save Current Snapshot</div>
                    <div style={{color:'#475569',fontSize:11,marginBottom:10}}>
                      Save today's portfolio values as a snapshot manually. Useful if auto-sync hasn't run yet.
                    </div>
                    <button onClick={async()=>{
                        try { await portfolioHistoryAPI.snapshot(); await loadHistory(historyYears); }
                        catch(e) { alert('Snapshot failed: '+e.message); }
                      }}
                      style={{background:'rgba(0,212,161,0.1)',border:'1px solid rgba(0,212,161,0.3)',color:'#00d4a1',borderRadius:8,padding:'9px 18px',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                      📸 Save Snapshot Now
                    </button>
                  </div>
                </div>
              )}

              {settingsSection==='privacy' && (
                <div>
                  <div style={{color:'#e2e8f0',fontSize:14,fontWeight:700,marginBottom:16}}>Privacy Settings</div>
                  <div style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:10,padding:16}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                      <div>
                        <div style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>Hide values on startup</div>
                        <div style={{color:'#475569',fontSize:11,marginTop:2}}>Dashboard opens with values hidden by default</div>
                      </div>
                      <div
                        onClick={()=>{ const next=!hideValues; setHideValues(next); try{localStorage.setItem('kanalyst_hide_values',String(next));}catch(e){} }}
                        style={{ width:44,height:24,borderRadius:12,background:hideValues?'#f43f5e':'#334155',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0 }}>
                        <div style={{ position:'absolute',top:2,left:hideValues?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left 0.2s' }}/>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:'#334155',padding:'8px 10px',background:'rgba(255,255,255,0.02)',borderRadius:6}}>
                      💡 You can also toggle visibility anytime with the 👁 button in the top bar
                    </div>
                  </div>
                </div>
              )}

              {settingsSection==='income' && (
                  <>
                    {(incomeSummary.currentFYTotal>0||incomeEntries.length>0) && (
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
                        {[{label:`${incomeSummary.fyLabel||'FY26'} Total`,val:fmt(incomeSummary.currentFYTotal||0),color:'#64ffda'},
                          {label:'This Month',val:fmt(incomeSummary.thisMonthTotal||0),color:'#a78bfa'},
                          {label:'Entries',val:incomeEntries.length,color:'#0ea5e9'}].map(s=>(
                          <div key={s.label} style={{background:'#060e1a',borderRadius:8,padding:'10px 14px',border:'1px solid #1e3a5f',textAlign:'center'}}>
                            <div style={{color:s.color,fontWeight:700,fontSize:18}}>{s.val}</div>
                            <div style={{color:'#475569',fontSize:11,marginTop:2}}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {showRuleForm ? (
                      <div style={{background:'#060e1a',borderRadius:10,padding:18,border:'1px solid #1e3a5f',marginBottom:16}}>
                        <div style={{color:'#64ffda',fontWeight:700,fontSize:13,marginBottom:16}}>{editingRule?'✎ Edit Rule':'+ New Income Rule'}</div>

                        {/* Name + Category */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>RULE NAME <span style={{color:'#f43f5e'}}>*</span></label>
                            <input className="db-input" placeholder="e.g. HDFC Salary" value={ruleForm.rule_name} onChange={e=>setRuleForm(p=>({...p,rule_name:e.target.value}))} />
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>CATEGORY <span style={{color:'#f43f5e'}}>*</span></label>
                            <div style={{display:'flex',gap:6}}>
                              <select className="db-input" style={{flex:1,background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}
                                value={INCOME_CATS.includes(ruleForm.category)?ruleForm.category:'__custom'}
                                onChange={e=>{if(e.target.value!=='__custom')setRuleForm(p=>({...p,category:e.target.value}));}}>
                                {INCOME_CATS.map(cat=><option key={cat} value={cat}>{cat}</option>)}
                                <option value="__custom">Custom…</option>
                              </select>
                              {!INCOME_CATS.includes(ruleForm.category) && (
                                <input className="db-input" style={{flex:1}} placeholder="Custom category" value={ruleForm.category} onChange={e=>setRuleForm(p=>({...p,category:e.target.value}))} />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Receive bank - mandatory */}
                        <div style={{marginBottom:12}}>
                          <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>
                            RECEIVE BANK <span style={{color:'#f43f5e'}}>*</span>
                            <span style={{color:'#334155',fontWeight:400,marginLeft:6}}>— which account receives the money</span>
                          </label>
                          <select className="db-input" style={{background:'#0f1c2e',color:ruleForm.receive_bank?'#e2e8f0':'#475569',cursor:'pointer',width:'100%'}}
                            value={ruleForm.receive_bank} onChange={e=>setRuleForm(p=>({...p,receive_bank:e.target.value}))}>
                            <option value="">Select your bank…</option>
                            {(indianBanks.length?indianBanks:[{label:'HDFC Bank'},{label:'ICICI Bank'},{label:'SBI'},{label:'Axis Bank'},{label:'Kotak Mahindra'},{label:'IndusInd Bank'},{label:'Yes Bank'},{label:'Punjab National'},{label:'Tamilnad Mercantile'},{label:'Other'}]).map(b=>(
                              <option key={b.label} value={b.label}>{b.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Date window */}
                        <div style={{background:'#0a1628',borderRadius:8,padding:'12px 14px',marginBottom:12,border:'1px solid #1a2a40'}}>
                          <div style={{color:'#64748b',fontSize:11,fontWeight:700,marginBottom:10}}>
                            📅 DATE WINDOW — when does this income typically arrive?
                          </div>
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                            <div>
                              <label style={{display:'block',color:'#94a3b8',fontSize:11,marginBottom:4}}>FROM (day of prev month)</label>
                              <input className="db-input" type="number" min="1" max="31" placeholder="28"
                                value={ruleForm.date_day_from} onChange={e=>setRuleForm(p=>({...p,date_day_from:e.target.value}))} />
                              <div style={{color:'#334155',fontSize:10,marginTop:3}}>e.g. 28 = 28th of last month</div>
                            </div>
                            <div>
                              <label style={{display:'block',color:'#94a3b8',fontSize:11,marginBottom:4}}>TO (day of this month)</label>
                              <input className="db-input" type="number" min="1" max="31" placeholder="5"
                                value={ruleForm.date_day_to} onChange={e=>setRuleForm(p=>({...p,date_day_to:e.target.value}))} />
                              <div style={{color:'#334155',fontSize:10,marginTop:3}}>e.g. 5 = 5th of this month</div>
                            </div>
                          </div>
                        </div>

                        {/* Bank sender + Subject */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>BANK SENDER EMAIL</label>
                            <input className="db-input" placeholder="e.g. alerts@hdfcbank.net" value={ruleForm.bank_sender} onChange={e=>setRuleForm(p=>({...p,bank_sender:e.target.value}))} />
                            <div style={{color:'#334155',fontSize:10,marginTop:3}}>Check a real bank email → From: field</div>
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>SUBJECT CONTAINS</label>
                            <input className="db-input" placeholder="e.g. SALARY CREDIT" value={ruleForm.subject_pattern} onChange={e=>setRuleForm(p=>({...p,subject_pattern:e.target.value}))} />
                          </div>
                        </div>

                        {/* Body + Account */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>BODY CONTAINS</label>
                            <input className="db-input" placeholder="e.g. credited to your account" value={ruleForm.body_pattern} onChange={e=>setRuleForm(p=>({...p,body_pattern:e.target.value}))} />
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>ACCOUNT LAST 4 DIGITS</label>
                            <input className="db-input" placeholder="e.g. 7823" maxLength={4} value={ruleForm.account_last4} onChange={e=>setRuleForm(p=>({...p,account_last4:e.target.value}))} />
                          </div>
                        </div>

                        {/* Min amount + Period + Lookback */}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:12}}>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>MIN AMOUNT (₹)</label>
                            <input className="db-input" type="number" placeholder="e.g. 10000" value={ruleForm.min_amount} onChange={e=>setRuleForm(p=>({...p,min_amount:e.target.value}))} />
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>PERIOD</label>
                            <select className="db-input" value={ruleForm.period} onChange={e=>setRuleForm(p=>({...p,period:e.target.value}))} style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}>
                              <option value="monthly">Monthly</option>
                              <option value="weekly">Weekly</option>
                              <option value="irregular">Irregular</option>
                            </select>
                          </div>
                          <div>
                            <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>SCAN HISTORY</label>
                            <select className="db-input" value={ruleForm.lookback_months} onChange={e=>setRuleForm(p=>({...p,lookback_months:e.target.value}))} style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}>
                              <option value="0">From now (default)</option>
                              <option value="1">Last 1 month</option>
                              <option value="3">Last 3 months</option>
                              <option value="6">Last 6 months</option>
                              <option value="12">Last 12 months</option>
                            </select>
                          </div>
                        </div>

                        {/* Credit only toggle */}
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:'10px 12px',background:'#060e1a',borderRadius:8,border:'1px solid #1a2a40'}}>
                          <div onClick={()=>setRuleForm(p=>({...p,credit_only:!p.credit_only}))}
                            style={{width:38,height:22,borderRadius:11,background:ruleForm.credit_only?'#64ffda':'#1e293b',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}>
                            <div style={{position:'absolute',top:4,left:ruleForm.credit_only?20:4,width:14,height:14,borderRadius:'50%',background:'#fff',transition:'left 0.2s'}}/>
                          </div>
                          <div>
                            <div style={{color:'#e2e8f0',fontSize:12,fontWeight:600}}>Credit emails only (recommended)</div>
                            <div style={{color:'#475569',fontSize:11}}>Ignore debit/payment emails — only capture money received</div>
                          </div>
                        </div>

                        {/* Remark */}
                        <div style={{marginBottom:14}}>
                          <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>REMARK (optional)</label>
                          <input className="db-input" placeholder="e.g. Main salary, credited around 1st" value={ruleForm.remark} onChange={e=>setRuleForm(p=>({...p,remark:e.target.value}))} />
                        </div>

                        {ruleError && (
                          <div style={{color:'#f43f5e',fontSize:12,marginBottom:10,padding:'7px 10px',background:'rgba(244,63,94,0.08)',borderRadius:6,border:'1px solid rgba(244,63,94,0.2)'}}>
                            ⚠ {ruleError}
                          </div>
                        )}

                        <div style={{display:'flex',gap:8}}>
                          <button onClick={saveRule} disabled={ruleSaving}
                            style={{flex:1,background:'#64ffda',color:'#0a0a0a',border:'none',borderRadius:8,padding:'11px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                            {ruleSaving?'⟳ Saving…':(editingRule?'✎ Update Rule':'+ Save Rule')}
                          </button>
                          <button onClick={()=>{setShowRuleForm(false);setRuleError('');}}
                            style={{padding:'11px 18px',background:'#1e2d3d',color:'#94a3b8',border:'1px solid #334155',borderRadius:8,cursor:'pointer',fontSize:13}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {incomeRules.map(rule=>(
                          <div key={rule.id} style={{background:'#060e1a',border:'1px solid #1e3a5f',borderRadius:8,padding:'12px 14px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                            <div style={{flex:1}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                                <span style={{color:'#e2e8f0',fontWeight:700,fontSize:13}}>{rule.rule_name}</span>
                                <span style={{fontSize:10,background:'rgba(100,255,218,0.1)',color:'#64ffda',borderRadius:4,padding:'1px 7px',fontWeight:600}}>{rule.category}</span>
                                {rule.receive_bank && <span style={{fontSize:10,background:'rgba(14,165,233,0.1)',color:'#38bdf8',borderRadius:4,padding:'1px 7px'}}>🏦 {rule.receive_bank}</span>}
                              </div>
                              <div style={{color:'#475569',fontSize:11,lineHeight:1.7}}>
                                {rule.bank_sender&&<span>Sender: <b style={{color:'#64748b'}}>{rule.bank_sender}</b> · </span>}
                                {rule.date_day_from&&<span>Window: <b style={{color:'#64748b'}}>Day {rule.date_day_from}–{rule.date_day_to}</b> · </span>}
                                {rule.lookback_months>0&&<span>History: <b style={{color:'#64748b'}}>{rule.lookback_months}mo</b></span>}
                              </div>
                              {rule.remark&&<div style={{color:'#334155',fontSize:10,marginTop:2}}>💬 {rule.remark}</div>}
                            </div>
                            <div style={{display:'flex',gap:6,marginLeft:10,flexShrink:0}}>
                              <button onClick={()=>openRuleForm(rule)} style={{background:'#1e2d3d',border:'1px solid #334155',color:'#94a3b8',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Edit</button>
                              <button onClick={()=>deleteRule(rule.id)} style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.2)',color:'#f43f5e',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>✕</button>
                            </div>
                          </div>
                        ))}

                        {incomeRules.length===0 && (
                          <div style={{textAlign:'center',padding:'20px 0',color:'#334155',fontSize:13,marginBottom:14}}>
                            No rules yet. Create your first rule to auto-capture income.
                          </div>
                        )}

                        <div style={{display:'flex',gap:10,marginBottom:14}}>
                          <button onClick={()=>openRuleForm()} style={{flex:1,background:'rgba(100,255,218,0.1)',border:'1px solid rgba(100,255,218,0.3)',color:'#64ffda',borderRadius:8,padding:'11px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                            + New Rule
                          </button>
                          <button onClick={scanIncome} disabled={incomeScanning||incomeRules.length===0}
                            style={{flex:1,background:incomeRules.length>0?'#0ea5e9':'#1e2d3d',border:'none',color:incomeRules.length>0?'#fff':'#334155',borderRadius:8,padding:'11px',fontWeight:700,fontSize:13,cursor:incomeRules.length>0?'pointer':'not-allowed'}}>
                            {incomeScanning?'⟳ Scanning…':'⟳ Scan Gmail Now'}
                          </button>
                        </div>

                        {incomeScanResult&&<div style={{marginTop:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:incomeScanResult.success?'rgba(0,212,161,0.08)':'rgba(244,63,94,0.08)',border:`1px solid ${incomeScanResult.success?'rgba(0,212,161,0.2)':'rgba(244,63,94,0.2)'}`,color:incomeScanResult.success?'#00d4a1':'#f43f5e'}}>{incomeScanResult.success?'✅':'⚠'} {incomeScanResult.message}{(incomeScanResult.emailsRead||0)>0&&` · ${incomeScanResult.emailsRead} read, ${incomeScanResult.found} captured`}</div>}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MANUAL INCOME ENTRY ── */}
      {showManualEntry && (
        <div className="db-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowManualEntry(false);}}>
          <div className="db-modal fade-in" style={{maxWidth:480}}>
            <div className="db-modal-header">
              <div className="db-modal-title">✎ Add Income Entry</div>
              <button className="db-modal-close" onClick={()=>setShowManualEntry(false)}>✕</button>
            </div>
            <div className="db-modal-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>CATEGORY <span style={{color:'#f43f5e'}}>*</span></label>
                  <div style={{display:'flex',gap:6}}>
                    <select className="db-input" style={{flex:1,background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}
                      value={INCOME_CATS.includes(manualEntryForm.category)?manualEntryForm.category:'__custom'}
                      onChange={e=>{if(e.target.value!=='__custom')setManualEntryForm(p=>({...p,category:e.target.value}));}}>
                      {INCOME_CATS.map(cat=><option key={cat} value={cat}>{cat}</option>)}
                      <option value="__custom">Custom…</option>
                    </select>
                    {!INCOME_CATS.includes(manualEntryForm.category) && (
                      <input className="db-input" style={{flex:1}} placeholder="Custom" value={manualEntryForm.category} onChange={e=>setManualEntryForm(p=>({...p,category:e.target.value}))} />
                    )}
                  </div>
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>AMOUNT (₹) <span style={{color:'#f43f5e'}}>*</span></label>
                  <input className="db-input" type="number" placeholder="e.g. 75000" value={manualEntryForm.amount} onChange={e=>setManualEntryForm(p=>({...p,amount:e.target.value}))} />
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>DATE <span style={{color:'#f43f5e'}}>*</span></label>
                  <input className="db-input" type="date" value={manualEntryForm.credited_on} onChange={e=>setManualEntryForm(p=>({...p,credited_on:e.target.value}))} />
                </div>
                <div>
                  <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>RECEIVE BANK</label>
                  <select className="db-input" style={{background:'#0f1c2e',color:'#e2e8f0',cursor:'pointer'}}
                    value={manualEntryForm.receive_bank} onChange={e=>setManualEntryForm(p=>({...p,receive_bank:e.target.value}))}>
                    <option value="">Select bank…</option>
                    {(indianBanks.length?indianBanks:[{label:'HDFC Bank'},{label:'ICICI Bank'},{label:'SBI'},{label:'Axis Bank'},{label:'Other'}]).map(b=>(
                      <option key={b.label} value={b.label}>{b.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:16}}>
                <label style={{display:'block',color:'#94a3b8',fontSize:11,fontWeight:700,marginBottom:5}}>DESCRIPTION</label>
                <input className="db-input" placeholder="e.g. February Salary, Rent from tenant" value={manualEntryForm.description} onChange={e=>setManualEntryForm(p=>({...p,description:e.target.value}))} />
              </div>
              <button onClick={addManualEntry} disabled={!manualEntryForm.amount||!manualEntryForm.credited_on||manualEntrySaving}
                style={{width:'100%',background:'#64ffda',color:'#0a0a0a',border:'none',borderRadius:8,padding:'12px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                {manualEntrySaving?'⟳ Saving…':'+ Save Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
