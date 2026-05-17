import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

const CURRENT_FY = 'FY2026';
const FY_ORDER = ['FY2026','FY2025','FY2024','FY2023','FY2022','FY2021'];

const fmt  = (n) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtD = (n) => '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Year-wise bar chart ───────────────────────────────────────────────
function BarChart({ byFY }) {
  const max = Math.max(...Object.values(byFY).filter(Boolean), 1);
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:16, height:160, padding:'0 8px' }}>
      {FY_ORDER.filter(fy => byFY[fy] !== undefined).map(fy => {
        const val = byFY[fy] || 0;
        const h = Math.max((val / max) * 140, 4);
        return (
          <div key={fy} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
            <div style={{ fontSize:11, color:'var(--lime)', fontWeight:600 }}>{fmt(val)}</div>
            <div style={{
              width:'100%', height:h, borderRadius:'4px 4px 0 0',
              background: fy === CURRENT_FY
                ? 'linear-gradient(180deg,#6b8e23,#1f6b4a)'
                : 'linear-gradient(180deg,rgba(107,142,35,0.30),rgba(107,142,35,0.06))',
              transition:'height 0.5s ease',
            }} />
            <div style={{ fontSize:11, color:'#888' }}>{fy}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Monthly drill-down view ───────────────────────────────────────────
function MonthDrillDown({ yearMonth, income, onClose }) {
  const [year, mon] = yearMonth.split('-');
  const monthIdx    = parseInt(mon, 10) - 1;

  // Navigate prev/next month
  const [currentYear, setCurrentYear] = useState(parseInt(year));
  const [currentMon,  setCurrentMon]  = useState(monthIdx);

  const goPrev = () => {
    if (currentMon === 0) { setCurrentMon(11); setCurrentYear(y => y - 1); }
    else setCurrentMon(m => m - 1);
  };
  const goNext = () => {
    const now = new Date();
    if (currentYear === now.getFullYear() && currentMon === now.getMonth()) return; // don't go to future
    if (currentMon === 11) { setCurrentMon(0); setCurrentYear(y => y + 1); }
    else setCurrentMon(m => m + 1);
  };
  const isCurrentMonth = (() => {
    const now = new Date();
    return currentYear === now.getFullYear() && currentMon === now.getMonth();
  })();

  // Filter dividends for the displayed month
  const monthKey = `${currentYear}-${String(currentMon + 1).padStart(2, '0')}`;
  const entries  = income.filter(d => d.ex_date && d.ex_date.startsWith(monthKey));

  // Group by date
  const byDate = entries.reduce((acc, d) => {
    const date = d.ex_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(d);
    return acc;
  }, {});

  const sortedDates = Object.keys(byDate).sort();
  const monthTotal  = entries.reduce((s, d) => s + d.total_dividend, 0);

  return (
    <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:24,
      border:'1px solid rgba(107,142,35,0.15)', marginBottom:24 }}>

      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={goPrev}
            style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
              color:'#e0e0e0', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:16, lineHeight:1 }}>
            ‹
          </button>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'var(--lime)' }}>
              {MONTH_NAMES_FULL[currentMon]} {currentYear}
            </div>
            <div style={{ fontSize:12, color:'#666', marginTop:2 }}>
              {entries.length} dividend{entries.length !== 1 ? 's' : ''} · {fmtD(monthTotal)}
            </div>
          </div>
          <button onClick={goNext} disabled={isCurrentMonth}
            style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
              color: isCurrentMonth ? '#444' : '#e0e0e0',
              borderRadius:8, padding:'6px 12px',
              cursor: isCurrentMonth ? 'not-allowed' : 'pointer', fontSize:16, lineHeight:1 }}>
            ›
          </button>
        </div>
        <button onClick={onClose}
          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
            color:'#888', borderRadius:8, padding:'6px 14px', cursor:'pointer', fontSize:13 }}>
          ✕ Close
        </button>
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign:'center', color:'#555', padding:'30px 0', fontSize:14 }}>
          No dividends received in {MONTH_NAMES_FULL[currentMon]} {currentYear}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {sortedDates.map(date => {
            const dayEntries = byDate[date];
            const dayTotal   = dayEntries.reduce((s, d) => s + d.total_dividend, 0);
            const d          = new Date(date + 'T00:00:00');
            const dayLabel   = d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });

            return (
              <div key={date} style={{ background:'rgba(255,255,255,0.03)', borderRadius:8,
                border:'1px solid rgba(255,255,255,0.06)', overflow:'hidden' }}>
                {/* Date header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'8px 14px', background:'rgba(107,142,35,0.06)',
                  borderBottom:'1px solid rgba(107,142,35,0.10)' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--lime)' }}>{dayLabel}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--lime)' }}>{fmtD(dayTotal)}</span>
                </div>
                {/* Stocks on that date */}
                {dayEntries.map((d, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'8px 14px', borderBottom: i < dayEntries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    transition:'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:32, height:32, borderRadius:8, background:'rgba(107,142,35,0.10)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:11, fontWeight:700, color:'var(--lime)', flexShrink:0 }}>
                        {(d.symbol || d.company || '??').slice(0, 4)}
                      </div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:'#e0e0e0' }}>{d.company}</div>
                        <div style={{ fontSize:11, color:'#666', marginTop:1 }}>
                          {d.symbol} · ₹{d.dividend_per_share}/share × {d.quantity} shares
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'var(--lime)' }}>{fmtD(d.total_dividend)}</div>
                      <div style={{ fontSize:10, color:'#555', marginTop:2 }}>
                        <span style={{ padding:'1px 6px', borderRadius:10, fontSize:10,
                          background: d.dividend_type === 'Final' ? 'var(--mint-soft)' : 'var(--gold-soft)',
                          color: d.dividend_type === 'Final' ? 'var(--mint)' : 'var(--gold)' }}>
                          {d.dividend_type || 'Interim'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Monthly calendar heatmap ──────────────────────────────────────────
function CalendarView({ byMonth, income, onMonthClick, selectedMonthKey }) {
  const years = [...new Set(Object.keys(byMonth).map(k => k.slice(0,4)))].sort().reverse().slice(0,3);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      {years.map(year => (
        <div key={year}>
          <div style={{ fontWeight:600, color:'var(--lime)', marginBottom:8 }}>{year}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:4 }}>
            {MONTHS.map((m, i) => {
              const key       = `${year}-${String(i+1).padStart(2,'0')}`;
              const amt       = byMonth[key] || 0;
              const intensity = amt > 10000 ? 1 : amt > 5000 ? 0.7 : amt > 1000 ? 0.4 : amt > 0 ? 0.2 : 0;
              const isSelected = key === selectedMonthKey;
              const hasData    = amt > 0;

              return (
                <div key={m}
                  title={`${m} ${year}: ${fmtD(amt)}${hasData ? ' — click to view details' : ''}`}
                  onClick={() => hasData && onMonthClick(key)}
                  style={{
                    padding:'6px 4px', borderRadius:6, textAlign:'center',
                    cursor: hasData ? 'pointer' : 'default',
                    background: isSelected
                      ? 'rgba(107,142,35,0.25)'
                      : amt > 0
                      ? `rgba(100,255,218,${intensity})`
                      : 'rgba(255,255,255,0.04)',
                    border: isSelected
                      ? '1px solid rgba(107,142,35,0.50)'
                      : '1px solid rgba(255,255,255,0.06)',
                    transform: hasData && !isSelected ? undefined : undefined,
                    transition: 'all 0.15s',
                    boxShadow: isSelected ? '0 0 8px rgba(107,142,35,0.20)' : 'none',
                  }}>
                  <div style={{ fontSize:10, color: isSelected ? 'var(--text)' : '#aaa' }}>{m}</div>
                  {amt > 0 && (
                    <div style={{ fontSize:10, fontWeight:700,
                      color: isSelected ? '#fff' : amt > 5000 ? 'var(--lime)' : 'var(--text-3)' }}>
                      {fmt(amt).replace('₹','')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {years.length > 0 && (
        <div style={{ fontSize:11, color:'#444', marginTop:4 }}>
          💡 Click any highlighted month to see date-wise dividend breakdown
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
export default function Dividends() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [selectedFY, setSelectedFY]   = useState(CURRENT_FY);
  const [sortBy, setSortBy]           = useState('ex_date');
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true); setError(null);
    try {
      const url = forceRefresh ? '/api/dividends?refresh=1' : '/api/dividends';
      const res = await api.get(url);
      setData(res.data);
    } catch(e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'60vh', color:'var(--lime)', fontSize:18 }}>
      ⏳ Fetching dividend data from NSE...
    </div>
  );
  if (error) return (
    <div style={{ padding:32, color:'#ff6b6b' }}>❌ {error}</div>
  );

  const { income = [], summary = {} } = data || {};
  const { currentFY = 0, byFY = {}, byMonth = {}, totalAllTime = 0 } = summary;

  const filtered = income
    .filter(d => d.fy === selectedFY)
    .sort((a, b) => sortBy === 'amount' ? b.total_dividend - a.total_dividend : new Date(b.ex_date) - new Date(a.ex_date));

  const fyTotal = filtered.reduce((s, d) => s + d.total_dividend, 0);
  const fyCount = filtered.length;

  const today    = new Date();
  const upcoming = income.filter(d => d.ex_date && new Date(d.ex_date) >= today).slice(0, 5);
  const { fromCache, lastSynced } = data || {};

  const handleMonthClick = (key) => {
    setSelectedMonthKey(prev => prev === key ? null : key);
  };

  return (
    <div style={{ padding:'24px', maxWidth:1100, margin:'0 auto', color:'#e0e0e0', fontFamily:'Inter, sans-serif' }}>
      {/* Page header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <h2 style={{ color:'var(--text)', margin:0, fontSize:22 }}>💰 Dividend Income</h2>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {lastSynced && (
            <span style={{ fontSize:12, color:'#666' }}>
              {fromCache ? '📦 Cached' : '🔄 Refreshed'} · {new Date(lastSynced).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
            </span>
          )}
          <button onClick={() => load(true)} disabled={loading} style={{
            background:'rgba(107,142,35,0.08)', border:'1px solid rgba(107,142,35,0.15)',
            color:'var(--lime)', borderRadius:8, padding:'7px 14px', cursor:'pointer', fontSize:12, fontWeight:600
          }}>{loading ? '⏳ Fetching...' : '🔄 Refresh from Yahoo'}</button>
        </div>
      </div>

      {/* Top stat tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:16, marginBottom:32 }}>
        {[
          { label:'FY2026 Dividends',   val: fmt(currentFY),       sub:'Current financial year',       color:'var(--lime)' },
          { label:'All-Time Income',    val: fmt(totalAllTime),    sub:'Since FY2021',                 color:'var(--gold)' },
          { label:`${selectedFY} Total`,val: fmt(fyTotal),         sub:`${fyCount} dividends received`,color:'var(--teal)' },
          { label:'Avg Per Month',      val: fmt(currentFY / 12),  sub:'FY2026 monthly average',       color:'#b39ddb' },
        ].map(t => (
          <div key={t.label} style={{
            background:'rgba(255,255,255,0.04)', borderRadius:12,
            padding:'20px 16px', border:'1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize:12, color:'#888', marginBottom:6 }}>{t.label}</div>
            <div style={{ fontSize:22, fontWeight:700, color:t.color }}>{t.val}</div>
            <div style={{ fontSize:11, color:'#666', marginTop:4 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Year-wise bar chart */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:24, marginBottom:24, border:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight:600, color:'#aaa', marginBottom:20, fontSize:14 }}>📊 Year-wise Dividend Income</div>
        <BarChart byFY={byFY} />
      </div>

      {/* Calendar heatmap */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:24, marginBottom: selectedMonthKey ? 0 : 24, border:'1px solid rgba(255,255,255,0.08)',
        borderBottomLeftRadius: selectedMonthKey ? 0 : 12, borderBottomRightRadius: selectedMonthKey ? 0 : 12 }}>
        <div style={{ fontWeight:600, color:'#aaa', marginBottom:20, fontSize:14 }}>📅 Monthly Dividend Calendar</div>
        <CalendarView
          byMonth={byMonth}
          income={income}
          onMonthClick={handleMonthClick}
          selectedMonthKey={selectedMonthKey}
        />
      </div>

      {/* Drill-down panel — slides in below the calendar */}
      {selectedMonthKey && (
        <div style={{
          borderTop: 'none',
          background:'rgba(255,255,255,0.04)',
          borderRadius:'0 0 12px 12px',
          border:'1px solid rgba(255,255,255,0.08)',
          borderTopColor:'rgba(107,142,35,0.15)',
          marginBottom:24,
          padding:'0 24px 24px',
        }}>
          <MonthDrillDown
            yearMonth={selectedMonthKey}
            income={income}
            onClose={() => setSelectedMonthKey(null)}
          />
        </div>
      )}

      {/* Upcoming dividends */}
      {upcoming.length > 0 && (
        <div style={{ background:'rgba(107,142,35,0.06)', borderRadius:12, padding:20, marginBottom:24, border:'1px solid rgba(107,142,35,0.12)' }}>
          <div style={{ fontWeight:600, color:'var(--lime)', marginBottom:12, fontSize:14 }}>⏰ Upcoming Dividends</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {upcoming.map((d, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <span style={{ fontWeight:600, color:'#e0e0e0' }}>{d.company}</span>
                  <span style={{ marginLeft:8, fontSize:12, color:'#888' }}>{d.dividend_type} · ₹{d.dividend_per_share}/share</span>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ color:'var(--lime)', fontWeight:600 }}>{fmtD(d.total_dividend)}</div>
                  <div style={{ fontSize:11, color:'#888' }}>Ex-date: {d.ex_date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FY selector + table */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:24, border:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ display:'flex', gap:8 }}>
            {FY_ORDER.filter(fy => byFY[fy] || fy === CURRENT_FY).map(fy => (
              <button key={fy} onClick={() => setSelectedFY(fy)} style={{
                padding:'6px 14px', borderRadius:20, border:'none', cursor:'pointer', fontSize:13,
                background: selectedFY === fy ? 'var(--lime)' : 'var(--surface-2)',
                color: selectedFY === fy ? 'var(--text)' : '#aaa',
                fontWeight: selectedFY === fy ? 700 : 400,
              }}>{fy}</button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)',
            color:'#e0e0e0', padding:'6px 12px', borderRadius:8, fontSize:13
          }}>
            <option value="ex_date">Sort by Date</option>
            <option value="amount">Sort by Amount</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', color:'#666', padding:40 }}>No dividend data for {selectedFY}</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ color:'#888', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
                {['Company','Type','Ex-Date','₹/Share','Qty','Total Income'].map(h => (
                  <th key={h} style={{ padding:'8px 12px', textAlign: h === 'Qty' || h === '₹/Share' || h === 'Total Income' ? 'right' : 'left', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i}
                  style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', transition:'background 0.15s', cursor:'pointer' }}
                  onClick={() => d.ex_date && handleMonthClick(d.ex_date.slice(0,7))}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <td style={{ padding:'10px 12px', fontWeight:500 }}>
                    <div>{d.company}</div>
                    <div style={{ fontSize:11, color:'#666' }}>{d.symbol}</div>
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    <span style={{
                      padding:'2px 8px', borderRadius:12, fontSize:11,
                      background: d.dividend_type === 'Final' ? 'rgba(107,142,35,0.12)' : 'rgba(255,215,0,0.15)',
                      color: d.dividend_type === 'Final' ? 'var(--mint)' : 'var(--gold)',
                    }}>{d.dividend_type}</span>
                  </td>
                  <td style={{ padding:'10px 12px', color:'#888' }}>{d.ex_date}</td>
                  <td style={{ padding:'10px 12px', textAlign:'right' }}>₹{d.dividend_per_share}</td>
                  <td style={{ padding:'10px 12px', textAlign:'right', color:'#888' }}>{d.quantity}</td>
                  <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, color:'var(--lime)' }}>{fmtD(d.total_dividend)}</td>
                </tr>
              ))}
              <tr style={{ borderTop:'2px solid rgba(255,255,255,0.12)', fontWeight:700 }}>
                <td colSpan={5} style={{ padding:'10px 12px', color:'#aaa' }}>Total {selectedFY}</td>
                <td style={{ padding:'10px 12px', textAlign:'right', color:'var(--lime)', fontSize:16 }}>{fmtD(fyTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
