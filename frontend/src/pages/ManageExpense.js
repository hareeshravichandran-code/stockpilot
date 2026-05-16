import React, { useState, useEffect, useCallback } from 'react';
import { expenseAPI } from '../lib/api';

/* ─────────────────────── helpers ─────────────────────────── */
const CAT_ICONS = ['🏷️','🍕','🛍️','🚗','🏠','💊','📚','✈️','🎮','💆','⚡','💰','🎁','🏋️','🍎','☕','🏦','📊','🎯','🌿','💎','🔥','🛡️','🥦','🥜'];
const CAT_COLORS = ['#7C6CF0','#FF6B6B','#10D98C','#06D6C8','#FFBB3B','#74B9FF','#FD79A8','#00d4a1','#f59e0b','#e11d48'];
const FIELD_TYPES = [
  { id: 'TEXT',      label: 'Text Input',             icon: '✏️' },
  { id: 'DROPDOWN',  label: 'Dropdown',               icon: '📋' },
  { id: 'AUTOFILL',  label: 'Auto-fill by Category',  icon: '⚡' },
];

const fmtAmt = (n) => '₹' + Number(n||0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const MANAGE_TABS = [
  { id: 'categories',  label: 'Categories',       icon: '🗂️' },
  { id: 'rules',       label: 'SMS Rules',         icon: '📱' },
  { id: 'bulk',        label: 'Bulk Categorise',   icon: '⚡' },
  { id: 'budget',      label: 'Budgets',           icon: '🎯' },
  { id: 'fields',      label: 'Custom Fields',     icon: '🧩' },
  { id: 'sheets',      label: 'Google Sheets',     icon: '📊' },
];

/* ─────────────────────── styles ─────────────────────────── */
const S = {
  overlay: {
    position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)',
    zIndex:1000, display:'flex', alignItems:'stretch', justifyContent:'flex-end',
  },
  panel: {
    width:'min(900px,95vw)', background:'#0e1420', borderLeft:'1px solid rgba(255,255,255,0.08)',
    display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden',
  },
  header: {
    padding:'20px 24px 0', borderBottom:'1px solid rgba(255,255,255,0.07)',
    background:'#0b1019', flexShrink:0,
  },
  hRow: { display:'flex', alignItems:'center', gap:12, marginBottom:16 },
  hTitle: { flex:1, fontFamily:'DM Serif Display,serif', fontSize:22, color:'#e8edf5' },
  closeBtn: {
    background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    color:'#8899bb', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:18,
  },
  tabRow: { display:'flex', gap:2, overflowX:'auto', paddingBottom:0 },
  tab: (active) => ({
    padding:'10px 16px', cursor:'pointer', borderRadius:'8px 8px 0 0', whiteSpace:'nowrap',
    fontSize:13, fontWeight:500, border:'none', outline:'none',
    background: active ? '#141b2d' : 'transparent',
    color: active ? '#00d4a1' : '#4a5a7a',
    borderBottom: active ? '2px solid #00d4a1' : '2px solid transparent',
    transition:'all .15s',
  }),
  body: { flex:1, overflow:'auto', padding:24 },
  card: {
    background:'#141b2d', borderRadius:12, border:'1px solid rgba(255,255,255,0.07)',
    padding:16, marginBottom:12,
  },
  input: {
    width:'100%', background:'#0e1420', border:'1px solid rgba(255,255,255,0.12)',
    borderRadius:8, padding:'9px 12px', color:'#e8edf5', fontSize:13, outline:'none',
    boxSizing:'border-box',
  },
  label: { fontSize:11, color:'#4a5a7a', letterSpacing:1, textTransform:'uppercase', marginBottom:4, display:'block' },
  btn: (color='#00d4a1', ghost=false) => ({
    background: ghost ? 'transparent' : color,
    border: ghost ? `1px solid ${color}` : 'none',
    color: ghost ? color : '#0e1420',
    padding:'8px 16px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600,
  }),
  row: { display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' },
  badge: (color='#00d4a1') => ({
    background: color+'22', color, padding:'2px 8px', borderRadius:20,
    fontSize:11, fontWeight:600, display:'inline-block',
  }),
  divider: { borderColor:'rgba(255,255,255,0.06)', margin:'16px 0' },
  sectionTitle: { fontSize:11, color:'#4a5a7a', letterSpacing:1.5, textTransform:'uppercase', marginBottom:12, fontWeight:700 },
  empty: { textAlign:'center', padding:'48px 24px', color:'#4a5a7a' },
};

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                            */
/* ═══════════════════════════════════════════════════════════ */
export default function ManageExpense({ onClose }) {
  const [activeTab, setActiveTab] = useState('categories');

  // Shared data
  const [categories, setCategories]   = useState([]);
  const [transactions, setTransactions] = useState([]);

  const loadCategories = useCallback(async () => {
    try { const d = await expenseAPI.categories(); setCategories(d.data || d); }
    catch (e) { console.error(e); }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const r = await expenseAPI.getTransactions({ limit: 500 });
      // backend returns { data: [...], page, limit, total } so unwrap .data.data
      const rows = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      setTransactions(rows);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadCategories();
    if (activeTab === 'bulk') loadTransactions();
  }, [activeTab]);

  const parentCats = categories.filter(c => !c.parent_id);
  const subCats    = categories.filter(c =>  c.parent_id);

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.panel}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.hRow}>
            <div style={S.hTitle}>⚙️ Manage Expenses</div>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={S.tabRow}>
            {MANAGE_TABS.map(t => (
              <button key={t.id} style={S.tab(activeTab===t.id)} onClick={() => setActiveTab(t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={S.body}>
          {activeTab === 'categories'  && <CategoriesTab cats={categories} parentCats={parentCats} subCats={subCats} reload={loadCategories} />}
          {activeTab === 'rules'       && <RulesTab />}
          {activeTab === 'bulk'        && <BulkTab transactions={transactions} categories={parentCats} reload={loadTransactions} />}
          {activeTab === 'budget'      && <BudgetTab parentCats={parentCats} />}
          {activeTab === 'fields'      && <FieldsTab categories={parentCats} subCats={subCats} />}
          {activeTab === 'sheets'      && <SheetsTab />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: CATEGORIES                                           */
/* ═══════════════════════════════════════════════════════════ */
function CategoriesTab({ cats, parentCats, subCats, reload }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ name:'', type:'EXPENSE', parent_id:'', icon:'🏷️', color:'#00d4a1' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const systemCats = parentCats.filter(c => c.is_system);
  const userCats   = parentCats.filter(c => !c.is_system);

  const save = async () => {
    if (!form.name) { setError('Name required'); return; }
    setSaving(true); setError('');
    try {
      await expenseAPI.createCategory({ name:form.name, type:form.type, parent_id:form.parent_id||null, icon:form.icon, color:form.color });
      setShowForm(false); setForm({ name:'', type:'EXPENSE', parent_id:'', icon:'🏷️', color:'#00d4a1' });
      reload();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try { await expenseAPI.deleteCategory(id); reload(); }
    catch(e) { alert(e.message); }
  };

  const renderCatCard = (cat) => {
    const children = subCats.filter(s => s.parent_id === cat.id);
    return (
      <div key={cat.id} style={S.card}>
        <div style={{...S.row, justifyContent:'space-between'}}>
          <div style={S.row}>
            <span style={{fontSize:22}}>{cat.icon}</span>
            <div>
              <div style={{...S.row, gap:6}}>
                <span style={{color:'#e8edf5', fontWeight:600}}>{cat.name}</span>
                <span style={S.badge(cat.color || '#00d4a1')}>{cat.type}</span>
                {cat.is_system && <span style={S.badge('#4a5a7a')}>System</span>}
                {children.length > 0 && <span style={{fontSize:11,color:'#4a5a7a'}}>{children.length} subcategory</span>}
              </div>
            </div>
          </div>
          {!cat.is_system && (
            <button onClick={() => del(cat.id)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#f43f5e',fontSize:16}}>🗑</button>
          )}
        </div>
        {children.length > 0 && (
          <div style={{marginTop:8, paddingLeft:16, borderLeft:'2px solid rgba(255,255,255,0.06)', display:'flex', flexWrap:'wrap', gap:6}}>
            {children.map(s => (
              <div key={s.id} style={{...S.badge(s.color||'#8899bb'), display:'flex', alignItems:'center', gap:4}}>
                <span>{s.icon}</span><span>{s.name}</span>
                {!s.is_system && <span onClick={() => del(s.id)} style={{cursor:'pointer',marginLeft:2}}>✕</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{...S.row, justifyContent:'flex-end', marginBottom:16}}>
        <button style={S.btn()} onClick={() => setShowForm(v => !v)}>+ New Category</button>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{...S.card, border:'1px solid rgba(0,212,161,0.3)', marginBottom:20}}>
          <div style={{fontSize:13, fontWeight:600, color:'#00d4a1', marginBottom:12}}>New Category</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <span style={S.label}>Name *</span>
              <input style={S.input} value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Groceries" />
            </div>
            <div>
              <span style={S.label}>Type</span>
              <select style={S.input} value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}>
                {['EXPENSE','INCOME','INVESTMENT','BOTH'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Parent (for subcategory)</span>
              <select style={S.input} value={form.parent_id} onChange={e => setForm(f=>({...f,parent_id:e.target.value}))}>
                <option value="">— None (root category) —</option>
                {parentCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Icon</span>
              <div style={{...S.row, flexWrap:'wrap', gap:4, marginTop:2}}>
                {CAT_ICONS.map(ic => (
                  <button key={ic} onClick={() => setForm(f=>({...f,icon:ic}))}
                    style={{background:form.icon===ic?'rgba(0,212,161,0.2)':'rgba(255,255,255,0.04)',border:`1px solid ${form.icon===ic?'#00d4a1':'rgba(255,255,255,0.08)'}`,borderRadius:6,padding:'4px 6px',cursor:'pointer',fontSize:16}}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span style={S.label}>Color</span>
              <div style={{...S.row, gap:6, marginTop:2}}>
                {CAT_COLORS.map(c => (
                  <div key={c} onClick={() => setForm(f=>({...f,color:c}))}
                    style={{width:24,height:24,borderRadius:'50%',background:c,cursor:'pointer',border:form.color===c?'2px solid #fff':'2px solid transparent'}} />
                ))}
              </div>
            </div>
          </div>
          {error && <div style={{color:'#f43f5e',fontSize:12,marginTop:8}}>{error}</div>}
          <div style={{...S.row, marginTop:12}}>
            <button style={S.btn()} onClick={save} disabled={saving}>{saving?'Saving…':'Create'}</button>
            <button style={S.btn('#8899bb',true)} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Standard categories section */}
      <div style={S.sectionTitle}>🗂️ Standard Categories</div>
      <div style={{...S.card, background:'rgba(14,164,233,0.08)', border:'1px solid rgba(14,164,233,0.2)', fontSize:12, color:'#7cc3e8', marginBottom:12}}>
        🔒 System categories are shared across all users and cannot be deleted. You can add subcategories under any of them.
      </div>
      {systemCats.length === 0
        ? <div style={S.empty}><div>No system categories found.</div></div>
        : systemCats.map(renderCatCard)
      }

      {/* Custom categories section */}
      <div style={{...S.sectionTitle, marginTop:24}}>✨ My Categories</div>
      {userCats.length === 0
        ? <div style={S.empty}><div style={{fontSize:32, marginBottom:8}}>✨</div><div>No custom categories yet. Create one above.</div></div>
        : userCats.map(renderCatCard)
      }
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: SMS RULES                                            */
/* ═══════════════════════════════════════════════════════════ */
function RulesTab() {
  const [rules, setRules]           = useState([]);
  const [categories, setCategories] = useState([]);   // parent-only → for the dropdown
  const [allCats, setAllCats]       = useState([]);   // all including subcats → for name lookup
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState({ merchant_pattern:'', category_id:'', user_confirmed:true });
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([expenseAPI.getSmsRules(), expenseAPI.categories()]);
      setRules(r.data || r || []);
      const cats = c.data || c || [];
      setAllCats(cats);
      setCategories(cats.filter(x => !x.parent_id));
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  // search all categories (including subcats) so rules created on Android resolve correctly
  const catName = (id) => allCats.find(c => c.id === id)?.name || id;

  const openEdit = (rule) => {
    setEditing(rule.id);
    setForm({ merchant_pattern: rule.merchant_pattern, category_id: rule.category_id, user_confirmed: true });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.merchant_pattern || !form.category_id) return;
    setSaving(true);
    try {
      if (editing) {
        await expenseAPI.updateSmsRule(editing, form);
      } else {
        await expenseAPI.createSmsRule(form);
      }
      setShowForm(false); setEditing(null); setForm({ merchant_pattern:'', category_id:'', user_confirmed:true });
      load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    try { await expenseAPI.deleteSmsRule(id); load(); }
    catch(e) { alert(e.message); }
  };

  return (
    <div>
      <div style={{...S.row, justifyContent:'space-between', marginBottom:16}}>
        <div>
          <div style={{color:'#e8edf5', fontWeight:600}}>Categorisation Rules</div>
          <div style={{fontSize:12, color:'#4a5a7a', marginTop:2}}>Rules auto-assign categories to transactions based on merchant name patterns.</div>
        </div>
        <button style={S.btn()} onClick={() => { setEditing(null); setForm({ merchant_pattern:'', category_id:'', user_confirmed:true }); setShowForm(v=>!v); }}>+ New Rule</button>
      </div>

      {showForm && (
        <div style={{...S.card, border:'1px solid rgba(0,212,161,0.3)', marginBottom:16}}>
          <div style={{fontSize:13, fontWeight:600, color:'#00d4a1', marginBottom:12}}>{editing ? 'Edit Rule' : 'New Rule'}</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <span style={S.label}>Merchant Pattern *</span>
              <input style={S.input} value={form.merchant_pattern} onChange={e=>setForm(f=>({...f,merchant_pattern:e.target.value}))} placeholder="e.g. SWIGGY, AMAZON" />
              <div style={{fontSize:11,color:'#4a5a7a',marginTop:3}}>Case-insensitive. Use partial name.</div>
            </div>
            <div>
              <span style={S.label}>Category *</span>
              <select style={S.input} value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}>
                <option value="">— Select —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{...S.row, marginTop:12}}>
            <button style={S.btn()} onClick={save} disabled={saving}>{saving?'Saving…':'Save Rule'}</button>
            <button style={S.btn('#8899bb',true)} onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={S.empty}>Loading…</div> :
       rules.length === 0 ? <div style={S.empty}><div style={{fontSize:32,marginBottom:8}}>📱</div><div>No SMS rules yet. Create rules to auto-categorise transactions.</div></div> :
       rules.map(rule => (
        <div key={rule.id} style={S.card}>
          <div style={{...S.row, justifyContent:'space-between'}}>
            <div>
              <div style={{...S.row, gap:8}}>
                <code style={{background:'rgba(255,255,255,0.06)',padding:'2px 8px',borderRadius:4,fontSize:13,color:'#fb923c'}}>{rule.merchant_pattern}</code>
                <span style={{color:'#4a5a7a'}}>→</span>
                <span style={S.badge('#00d4a1')}>{catName(rule.category_id)}</span>
              </div>
              {rule.match_count > 0 && <div style={{fontSize:11,color:'#4a5a7a',marginTop:4}}>Matched {rule.match_count} transactions</div>}
            </div>
            <div style={S.row}>
              <button onClick={() => openEdit(rule)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#0ea5e9',fontSize:15}}>✏️</button>
              <button onClick={() => del(rule.id)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#f43f5e',fontSize:15}}>🗑</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: BULK CATEGORISE                                      */
/* ═══════════════════════════════════════════════════════════ */
function BulkTab({ transactions, categories, reload }) {
  const [selected, setSelected]     = useState(new Set());
  const [bulkCatId, setBulkCatId]   = useState('');
  const [applying, setApplying]     = useState(false);
  const [searchQ, setSearchQ]       = useState('');
  const [filterCat, setFilterCat]   = useState('uncategorized');
  const [done, setDone]             = useState(null);

  const filtered = transactions.filter(t => {
    if (filterCat === 'uncategorized') return !t.category_id;
    if (filterCat) return t.category_id === filterCat;
    return true;
  }).filter(t => !searchQ || (t.merchant_name||'').toLowerCase().includes(searchQ.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(t=>t.id)));
  };

  const apply = async () => {
    if (!selected.size || !bulkCatId) { alert('Select transactions and a category'); return; }
    setApplying(true);
    try {
      await expenseAPI.bulkCategorize([...selected], bulkCatId);
      setDone(`✓ ${selected.size} transactions categorised`);
      setSelected(new Set());
      reload();
    } catch(e) { alert(e.message); }
    finally { setApplying(false); }
  };

  const catName = (id) => categories.find(c=>c.id===id)?.name || '';

  return (
    <div>
      {done && <div style={{...S.card, background:'rgba(0,212,161,0.1)', border:'1px solid rgba(0,212,161,0.3)', color:'#00d4a1', marginBottom:12, fontSize:13}}>{done}</div>}

      {/* Controls */}
      <div style={{...S.card, marginBottom:16}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, alignItems:'end'}}>
          <div>
            <span style={S.label}>Search merchant</span>
            <input style={S.input} value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Filter by name…" />
          </div>
          <div>
            <span style={S.label}>Show</span>
            <select style={S.input} value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
              <option value="">All transactions</option>
              <option value="uncategorized">Uncategorised only</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <span style={S.label}>Apply category</span>
            <select style={S.input} value={bulkCatId} onChange={e=>setBulkCatId(e.target.value)}>
              <option value="">— Select category —</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <button style={{...S.btn(applying?'#4a5a7a':'#00d4a1'), alignSelf:'flex-end', whiteSpace:'nowrap'}} onClick={apply} disabled={applying||!selected.size||!bulkCatId}>
            {applying ? 'Applying…' : `Apply to ${selected.size || '…'}`}
          </button>
        </div>
        {selected.size > 0 && (
          <div style={{marginTop:10, fontSize:12, color:'#00d4a1'}}>
            {selected.size} selected
            <button onClick={() => setSelected(new Set())} style={{background:'transparent',border:'none',color:'#4a5a7a',cursor:'pointer',marginLeft:8}}>Clear</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{...S.card, padding:0, overflow:'hidden'}}>
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
          <thead>
            <tr style={{background:'#0b1019', borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
              <th style={{padding:'10px 12px', textAlign:'left', width:36}}>
                <input type="checkbox" checked={selected.size===filtered.length&&filtered.length>0} onChange={toggleAll} />
              </th>
              <th style={{padding:'10px 12px', textAlign:'left', color:'#4a5a7a', fontWeight:600}}>Merchant</th>
              <th style={{padding:'10px 12px', textAlign:'left', color:'#4a5a7a', fontWeight:600}}>Date</th>
              <th style={{padding:'10px 12px', textAlign:'right', color:'#4a5a7a', fontWeight:600}}>Amount</th>
              <th style={{padding:'10px 12px', textAlign:'left', color:'#4a5a7a', fontWeight:600}}>Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{padding:32, textAlign:'center', color:'#4a5a7a'}}>No transactions found</td></tr>
            )}
            {filtered.slice(0, 200).map(t => (
              <tr key={t.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)', background:selected.has(t.id)?'rgba(0,212,161,0.06)':'transparent'}}
                onClick={() => setSelected(prev => { const n=new Set(prev); n.has(t.id)?n.delete(t.id):n.add(t.id); return n; })}>
                <td style={{padding:'9px 12px'}}>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={()=>{}} />
                </td>
                <td style={{padding:'9px 12px', color:'#e8edf5', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {t.merchant_name || t.merchant || '—'}
                </td>
                <td style={{padding:'9px 12px', color:'#8899bb', fontSize:12}}>
                  {t.date_time ? new Date(parseInt(t.date_time)).toLocaleDateString('en-IN') : t.expense_date || '—'}
                </td>
                <td style={{padding:'9px 12px', textAlign:'right', color: t.type==='CREDIT'?'#00d4a1':'#f43f5e', fontWeight:600}}>
                  {t.type==='CREDIT'?'+':'-'}{fmtAmt(t.amount)}
                </td>
                <td style={{padding:'9px 12px'}}>
                  {t.category_id
                    ? <span style={S.badge('#0ea5e9')}>{catName(t.category_id) || t.category_id}</span>
                    : <span style={{color:'#4a5a7a', fontSize:11}}>Uncategorised</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div style={{padding:'8px 12px', fontSize:11, color:'#4a5a7a'}}>Showing first 200 of {filtered.length} transactions</div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: BUDGETS                                              */
/* ═══════════════════════════════════════════════════════════ */
function BudgetTab({ parentCats }) {
  const [budgets, setBudgets]   = useState([]);
  const [month, setMonth]       = useState(() => {
    const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ category_id:'', amount:'', period:'MONTHLY' });
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    try { const d = await expenseAPI.getBudgets(month); setBudgets(d.data || d || []); }
    catch(e) { console.error(e); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.category_id || !form.amount) return;
    setSaving(true);
    try { await expenseAPI.upsertBudget({ ...form, month: parseInt(month), amount: parseFloat(form.amount) }); setShowForm(false); load(); }
    catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this budget?')) return;
    try { await expenseAPI.deleteBudget(id); load(); }
    catch(e) { alert(e.message); }
  };

  const catName = (id) => parentCats.find(c=>c.id===id)?.name || id;
  const catIcon = (id) => parentCats.find(c=>c.id===id)?.icon || '💳';

  const displayMonth = () => {
    const y = parseInt(month.slice(0,4)), m = parseInt(month.slice(4,6))-1;
    return new Date(y,m,1).toLocaleString('en-IN',{month:'long',year:'numeric'});
  };

  return (
    <div>
      <div style={{...S.row, justifyContent:'space-between', marginBottom:16}}>
        <div>
          <div style={{color:'#e8edf5', fontWeight:600}}>Monthly Budgets</div>
          <div style={{fontSize:12, color:'#4a5a7a', marginTop:2}}>Set spending limits per category.</div>
        </div>
        <div style={S.row}>
          <input type="month" value={`${month.slice(0,4)}-${month.slice(4,6)}`}
            onChange={e => setMonth(e.target.value.replace('-',''))}
            style={{...S.input, width:'auto'}} />
          <button style={S.btn()} onClick={() => setShowForm(v=>!v)}>+ Add Budget</button>
        </div>
      </div>

      {showForm && (
        <div style={{...S.card, border:'1px solid rgba(0,212,161,0.3)', marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'#00d4a1',marginBottom:12}}>New Budget — {displayMonth()}</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <span style={S.label}>Category *</span>
              <select style={S.input} value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}>
                <option value="">— Select —</option>
                {parentCats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Budget Amount (₹) *</span>
              <input style={S.input} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="e.g. 5000" />
            </div>
          </div>
          <div style={{...S.row, marginTop:12}}>
            <button style={S.btn()} onClick={save} disabled={saving}>{saving?'Saving…':'Save Budget'}</button>
            <button style={S.btn('#8899bb',true)} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {budgets.length === 0 ? (
        <div style={S.empty}><div style={{fontSize:32,marginBottom:8}}>🎯</div><div>No budgets set for {displayMonth()}.</div></div>
      ) : (
        budgets.map(b => {
          const spent = b.spent || 0;
          const pct   = Math.min(100, (spent / b.amount) * 100);
          const over  = spent > b.amount;
          return (
            <div key={b.id} style={S.card}>
              <div style={{...S.row, justifyContent:'space-between', marginBottom:8}}>
                <div style={S.row}>
                  <span style={{fontSize:20}}>{catIcon(b.category_id)}</span>
                  <div>
                    <div style={{color:'#e8edf5',fontWeight:600}}>{catName(b.category_id)}</div>
                    <div style={{fontSize:12,color:'#4a5a7a'}}>Budget: {fmtAmt(b.amount)}</div>
                  </div>
                </div>
                <div style={S.row}>
                  <span style={{color: over?'#f43f5e':'#00d4a1', fontWeight:700}}>{fmtAmt(spent)}</span>
                  <button onClick={() => del(b.id)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#f43f5e'}}>🗑</button>
                </div>
              </div>
              <div style={{background:'rgba(255,255,255,0.06)',borderRadius:4,height:6,overflow:'hidden'}}>
                <div style={{width:`${pct}%`,height:'100%',background:over?'#f43f5e':'#00d4a1',transition:'width .4s',borderRadius:4}} />
              </div>
              <div style={{fontSize:11,color:'#4a5a7a',marginTop:4}}>{pct.toFixed(0)}% used {over&&<span style={{color:'#f43f5e'}}> · Over budget by {fmtAmt(spent-b.amount)}</span>}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: CUSTOM FIELDS                                        */
/* ═══════════════════════════════════════════════════════════ */
function FieldsTab({ categories, subCats }) {
  const [fields, setFields]     = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const EMPTY = { name:'', field_type:'TEXT', options:[], auto_fill_rules:[], is_required:false };
  const [form, setForm]         = useState(EMPTY);
  const [saving, setSaving]     = useState(false);

  // Rule builder state
  const [ruleCatId, setRuleCatId]   = useState('');
  const [ruleSubId, setRuleSubId]   = useState('');
  const [ruleValue, setRuleValue]   = useState('');
  const [optionInput, setOptionInput] = useState('');

  const subsForCat = subCats.filter(s => s.parent_id === ruleCatId);

  const load = async () => {
    try { const d = await expenseAPI.getCustomFields(); setFields(d.data||d||[]); }
    catch(e) { console.error(e); }
  };

  useEffect(() => { load(); }, []);

  const openEdit = (f) => {
    setEditing(f.id);
    setForm({ name:f.name, field_type:f.field_type, options: Array.isArray(f.options)?f.options:[], auto_fill_rules:Array.isArray(f.auto_fill_rules)?f.auto_fill_rules:[], is_required:f.is_required });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = { ...form, options: form.options, auto_fill_rules: form.auto_fill_rules };
      if (editing) await expenseAPI.updateCustomField(editing, payload);
      else await expenseAPI.createCustomField(payload);
      setShowForm(false); setEditing(null); setForm(EMPTY); load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this field?')) return;
    try { await expenseAPI.deleteCustomField(id); load(); }
    catch(e) { alert(e.message); }
  };

  const addOption = () => {
    if (!optionInput || form.options.includes(optionInput)) return;
    setForm(f => ({...f, options:[...f.options, optionInput.trim()]}));
    setOptionInput('');
  };

  const addRule = () => {
    if (!ruleCatId || !ruleValue) return;
    const catName = categories.find(c=>c.id===ruleCatId)?.name || ruleCatId;
    const subName = subCats.find(s=>s.id===ruleSubId)?.name;
    setForm(f => ({...f, auto_fill_rules:[...f.auto_fill_rules, { categoryId:ruleCatId, categoryName:catName, subcategoryId:ruleSubId||null, subcategoryName:subName||null, value:ruleValue }]}));
    setRuleCatId(''); setRuleSubId(''); setRuleValue('');
  };

  return (
    <div>
      <div style={{...S.row, justifyContent:'space-between', marginBottom:16}}>
        <div>
          <div style={{color:'#e8edf5', fontWeight:600}}>Custom Entry Fields</div>
          <div style={{fontSize:12, color:'#4a5a7a', marginTop:2}}>Extra fields shown on every transaction. Text, dropdown, or auto-fill by category.</div>
        </div>
        <button style={S.btn()} onClick={() => { setEditing(null); setForm(EMPTY); setShowForm(v=>!v); }}>+ Add Field</button>
      </div>

      {showForm && (
        <div style={{...S.card, border:'1px solid rgba(0,212,161,0.3)', marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'#00d4a1',marginBottom:12}}>{editing?'Edit Field':'New Custom Field'}</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12}}>
            <div>
              <span style={S.label}>Field Name *</span>
              <input style={S.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Project Code, Vehicle" />
            </div>
            <div>
              <span style={S.label}>Field Type</span>
              <select style={S.input} value={form.field_type} onChange={e=>setForm(f=>({...f,field_type:e.target.value,options:[],auto_fill_rules:[]}))}>
                {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{...S.row, marginBottom:12}}>
            <label style={{...S.row, gap:6, cursor:'pointer'}}>
              <input type="checkbox" checked={form.is_required} onChange={e=>setForm(f=>({...f,is_required:e.target.checked}))} />
              <span style={{fontSize:13,color:'#8899bb'}}>Required field</span>
            </label>
          </div>

          {/* Dropdown options */}
          {form.field_type === 'DROPDOWN' && (
            <div style={{marginBottom:12}}>
              <hr style={S.divider} />
              <div style={S.sectionTitle}>Dropdown Options</div>
              <div style={S.row}>
                <input style={{...S.input,flex:1}} value={optionInput} onChange={e=>setOptionInput(e.target.value)}
                  placeholder="Add option…" onKeyDown={e=>e.key==='Enter'&&addOption()} />
                <button style={S.btn()} onClick={addOption}>Add</button>
              </div>
              <div style={{...S.row, flexWrap:'wrap', gap:6, marginTop:8}}>
                {form.options.map(opt => (
                  <div key={opt} style={{background:'rgba(255,255,255,0.06)',borderRadius:20,padding:'3px 10px',fontSize:12,color:'#e8edf5',...S.row,gap:4}}>
                    {opt}
                    <span onClick={() => setForm(f=>({...f,options:f.options.filter(o=>o!==opt)}))} style={{cursor:'pointer',color:'#f43f5e'}}>✕</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-fill rules */}
          {form.field_type === 'AUTOFILL' && (
            <div style={{marginBottom:12}}>
              <hr style={S.divider} />
              <div style={S.sectionTitle}>Auto-fill Rules</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, marginBottom:8}}>
                <div>
                  <span style={S.label}>Category</span>
                  <select style={S.input} value={ruleCatId} onChange={e=>{setRuleCatId(e.target.value);setRuleSubId('');}}>
                    <option value="">— Select —</option>
                    {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </select>
                </div>
                <div>
                  <span style={S.label}>Subcategory (optional)</span>
                  <select style={S.input} value={ruleSubId} onChange={e=>setRuleSubId(e.target.value)} disabled={!ruleCatId}>
                    <option value="">— Any —</option>
                    {subsForCat.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <span style={S.label}>Auto-fill Value</span>
                  <input style={S.input} value={ruleValue} onChange={e=>setRuleValue(e.target.value)} placeholder="e.g. Idly, Car" />
                </div>
                <button style={{...S.btn('#00d4a1'),alignSelf:'flex-end'}} onClick={addRule}>Add</button>
              </div>
              {form.auto_fill_rules.map((r,i) => (
                <div key={i} style={{...S.row, justifyContent:'space-between', background:'rgba(255,255,255,0.04)', borderRadius:8, padding:'6px 10px', marginBottom:4}}>
                  <span style={{fontSize:12, color:'#06D6C8'}}>
                    ⚡ {r.categoryName}{r.subcategoryName ? ` › ${r.subcategoryName}` : ''} → "{r.value}"
                  </span>
                  <span onClick={() => setForm(f=>({...f,auto_fill_rules:f.auto_fill_rules.filter((_,j)=>j!==i)}))} style={{cursor:'pointer',color:'#f43f5e',fontSize:12}}>✕</span>
                </div>
              ))}
            </div>
          )}

          <div style={S.row}>
            <button style={S.btn()} onClick={save} disabled={saving||!form.name}>{saving?'Saving…':editing?'Save Changes':'Create Field'}</button>
            <button style={S.btn('#8899bb',true)} onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {fields.length === 0 ? (
        <div style={S.empty}><div style={{fontSize:32,marginBottom:8}}>🧩</div><div>No custom fields yet.</div></div>
      ) : (
        fields.map(f => (
          <div key={f.id} style={S.card}>
            <div style={{...S.row, justifyContent:'space-between'}}>
              <div style={S.row}>
                <span style={{fontSize:22}}>{FIELD_TYPES.find(t=>t.id===f.field_type)?.icon||'✏️'}</span>
                <div>
                  <div style={{...S.row,gap:6}}>
                    <span style={{color:'#e8edf5',fontWeight:600}}>{f.name}</span>
                    <span style={S.badge('#7C6CF0')}>{FIELD_TYPES.find(t=>t.id===f.field_type)?.label}</span>
                    {f.is_required && <span style={S.badge('#f43f5e')}>Required</span>}
                  </div>
                  {f.field_type==='DROPDOWN' && Array.isArray(f.options) && f.options.length > 0 && (
                    <div style={{fontSize:11,color:'#4a5a7a',marginTop:3}}>Options: {f.options.slice(0,4).join(', ')}{f.options.length>4?`…+${f.options.length-4} more`:''}</div>
                  )}
                  {f.field_type==='AUTOFILL' && Array.isArray(f.auto_fill_rules) && f.auto_fill_rules.length > 0 && (
                    <div style={{fontSize:11,color:'#06D6C8',marginTop:3}}>{f.auto_fill_rules.length} auto-fill rule(s)</div>
                  )}
                </div>
              </div>
              <div style={S.row}>
                <button onClick={() => openEdit(f)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#0ea5e9',fontSize:15}}>✏️</button>
                <button onClick={() => del(f.id)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#f43f5e',fontSize:15}}>🗑</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  TAB: GOOGLE SHEETS                                        */
/* ═══════════════════════════════════════════════════════════ */
function SheetsTab() {
  const [config, setConfig]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const EMPTY_CFG = {
    sheet_url:'', tab_name:'', is_enabled:false, sync_from_date:'',
    date_column:'A', amount_column:'B', category_column:'C',
    merchant_column:'D', type_column:'E', notes_column:'F',
    bank_column:'', reference_column:'', account_column:'',
    subcategory_column:'', user_email_column:'', start_row:2
  };
  const [form, setForm]       = useState(EMPTY_CFG);

  useEffect(() => {
    expenseAPI.getSheetConfig()
      .then(d => { if (d) { setConfig(d); setForm({...EMPTY_CFG,...d}); }})
      .catch(e => console.error(e));
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    try { await expenseAPI.saveSheetConfig(form); setSaved(true); setTimeout(()=>setSaved(false),3000); }
    catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const ColInput = ({ label, field }) => (
    <div>
      <span style={S.label}>{label}</span>
      <input style={{...S.input, textTransform:'uppercase'}} value={form[field]||''}
        onChange={e => setForm(f=>({...f,[field]:e.target.value.replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0,2)}))}
        placeholder="—" maxLength={2} />
    </div>
  );

  return (
    <div>
      <div style={{color:'#e8edf5',fontWeight:600,marginBottom:4}}>Google Sheets Sync</div>
      <div style={{fontSize:12,color:'#4a5a7a',marginBottom:16}}>Configure your Google Sheet to auto-receive transactions from the Android app.</div>

      <div style={S.card}>
        <div style={{...S.row, justifyContent:'space-between', marginBottom:16}}>
          <span style={{color:'#e8edf5',fontWeight:600}}>Enable Sheet Sync</span>
          <div onClick={() => setForm(f=>({...f,is_enabled:!f.is_enabled}))}
            style={{width:44,height:24,borderRadius:12,background:form.is_enabled?'#00d4a1':'#1a2235',cursor:'pointer',position:'relative',transition:'background .2s'}}>
            <div style={{position:'absolute',top:2,left:form.is_enabled?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .2s'}} />
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
          <div style={{gridColumn:'1/-1'}}>
            <span style={S.label}>Google Sheet URL</span>
            <input style={S.input} value={form.sheet_url||''} onChange={e=>setForm(f=>({...f,sheet_url:e.target.value}))} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
          <div>
            <span style={S.label}>Sheet Tab Name</span>
            <input style={S.input} value={form.tab_name||''} onChange={e=>setForm(f=>({...f,tab_name:e.target.value}))} placeholder="Sheet1" />
          </div>
          <div>
            <span style={S.label}>Sync From Date</span>
            <input type="date" style={S.input} value={form.sync_from_date||''} onChange={e=>setForm(f=>({...f,sync_from_date:e.target.value}))} />
          </div>
          <div>
            <span style={S.label}>Start From Row</span>
            <input type="number" style={S.input} value={form.start_row||2} onChange={e=>setForm(f=>({...f,start_row:parseInt(e.target.value)||2}))} min={1} />
          </div>
        </div>

        <hr style={S.divider} />
        <div style={S.sectionTitle}>Column Mapping (enter column letter, e.g. A B C)</div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
          <ColInput label="Date" field="date_column" />
          <ColInput label="Amount" field="amount_column" />
          <ColInput label="Category" field="category_column" />
          <ColInput label="Merchant" field="merchant_column" />
          <ColInput label="Type" field="type_column" />
          <ColInput label="Notes" field="notes_column" />
          <ColInput label="Bank" field="bank_column" />
          <ColInput label="Reference" field="reference_column" />
          <ColInput label="Account (last 4)" field="account_column" />
          <ColInput label="Subcategory" field="subcategory_column" />
          <ColInput label="User Email" field="user_email_column" />
        </div>

        <div style={{...S.row, gap:10}}>
          <button style={S.btn()} onClick={save} disabled={saving}>{saving?'Saving…':'Save Configuration'}</button>
          {saved && <span style={{color:'#00d4a1',fontSize:13}}>✓ Saved</span>}
        </div>
      </div>

      <div style={{...S.card,background:'rgba(14,164,233,0.08)',border:'1px solid rgba(14,164,233,0.2)',fontSize:12,color:'#7cc3e8',marginTop:12}}>
        <div style={{fontWeight:600,marginBottom:4}}>ℹ️ How it works</div>
        <div>The Android Kanalyst app writes transactions directly to this sheet. This web config mirrors the same settings — changes here sync to your mobile app on next open.</div>
      </div>
    </div>
  );
}
