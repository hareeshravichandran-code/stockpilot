import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const CURRENT_FY = 'FY2026';
const FY_ORDER = ['FY2026','FY2025','FY2024','FY2023','FY2022','FY2021'];

const fmt = (n) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtD = (n) => '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function CalendarView({ byMonth }) {
  const years = [...new Set(Object.keys(byMonth).map(k => k.slice(0,4)))].sort().reverse().slice(0,3);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {years.map(year => (
        <div key={year}>
          <div style={{ fontWeight: 600, color: '#64ffda', marginBottom: 8 }}>{year}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
            {MONTHS.map((m, i) => {
              const key = `${year}-${String(i+1).padStart(2,'0')}`;
              const amt = byMonth[key] || 0;
              const intensity = amt > 10000 ? 1 : amt > 5000 ? 0.7 : amt > 1000 ? 0.4 : amt > 0 ? 0.2 : 0;
              return (
                <div key={m} title={`${m} ${year}: ${fmtD(amt)}`} style={{
                  padding: '6px 4px', borderRadius: 6, textAlign: 'center', cursor: 'default',
                  background: amt > 0 ? `rgba(100,255,218,${intensity})` : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'transform 0.15s',
                }}>
                  <div style={{ fontSize: 10, color: '#aaa' }}>{m}</div>
                  {amt > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: amt > 5000 ? '#0a0a0a' : '#64ffda' }}>
                    {fmt(amt).replace('₹','')}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function BarChart({ byFY }) {
  const max = Math.max(...Object.values(byFY).filter(Boolean), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 160, padding: '0 8px' }}>
      {FY_ORDER.filter(fy => byFY[fy] !== undefined).map(fy => {
        const val = byFY[fy] || 0;
        const h = Math.max((val / max) * 140, 4);
        return (
          <div key={fy} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 11, color: '#64ffda', fontWeight: 600 }}>{fmt(val)}</div>
            <div style={{
              width: '100%', height: h, borderRadius: '4px 4px 0 0',
              background: fy === CURRENT_FY
                ? 'linear-gradient(180deg,#64ffda,#00bcd4)'
                : 'linear-gradient(180deg,rgba(100,255,218,0.4),rgba(100,255,218,0.15))',
              transition: 'height 0.5s ease',
            }} />
            <div style={{ fontSize: 11, color: '#888' }}>{fy}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dividends() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFY, setSelectedFY] = useState(CURRENT_FY);
  const [sortBy, setSortBy] = useState('ex_date');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/dividends');
      setData(res.data);
    } catch(e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'60vh', color:'#64ffda', fontSize:18 }}>
      ⏳ Fetching dividend data from NSE...
    </div>
  );
  if (error) return (
    <div style={{ padding: 32, color: '#ff6b6b' }}>❌ {error}</div>
  );

  const { income = [], summary = {} } = data || {};
  const { currentFY = 0, byFY = {}, byMonth = {}, totalAllTime = 0 } = summary;

  // Filter by selected FY
  const filtered = income
    .filter(d => d.fy === selectedFY)
    .sort((a, b) => sortBy === 'amount' ? b.total_dividend - a.total_dividend : new Date(b.ex_date) - new Date(a.ex_date));

  const fyTotal = filtered.reduce((s, d) => s + d.total_dividend, 0);
  const fyCount = filtered.length;

  // Upcoming dividends (ex_date in future)
  const today = new Date();
  const upcoming = income.filter(d => d.ex_date && new Date(d.ex_date) >= today).slice(0, 5);

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto', color: '#e0e0e0', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: '#64ffda', marginBottom: 24, fontSize: 22 }}>💰 Dividend Income</h2>

      {/* Top stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'FY2026 Dividends', val: fmt(currentFY), sub: 'Current financial year', color: '#64ffda' },
          { label: 'All-Time Income', val: fmt(totalAllTime), sub: 'Since FY2021', color: '#ffd700' },
          { label: `${selectedFY} Total`, val: fmt(fyTotal), sub: `${fyCount} dividends received`, color: '#00bcd4' },
          { label: 'Avg Per Month', val: fmt(currentFY / 12), sub: 'FY2026 monthly average', color: '#b39ddb' },
        ].map(t => (
          <div key={t.label} style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: 12,
            padding: '20px 16px', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{t.val}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 600, color: '#aaa', marginBottom: 20, fontSize: 14 }}>📊 Year-wise Dividend Income</div>
        <BarChart byFY={byFY} />
      </div>

      {/* Calendar heatmap */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 600, color: '#aaa', marginBottom: 20, fontSize: 14 }}>📅 Monthly Dividend Calendar</div>
        <CalendarView byMonth={byMonth} />
      </div>

      {/* Upcoming dividends */}
      {upcoming.length > 0 && (
        <div style={{ background: 'rgba(100,255,218,0.06)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(100,255,218,0.15)' }}>
          <div style={{ fontWeight: 600, color: '#64ffda', marginBottom: 12, fontSize: 14 }}>⏰ Upcoming Dividends</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{d.company}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>{d.dividend_type} • ₹{d.dividend_per_share}/share</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#64ffda', fontWeight: 600 }}>{fmtD(d.total_dividend)}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>Ex-date: {d.ex_date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FY selector + table */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {FY_ORDER.filter(fy => byFY[fy] || fy === CURRENT_FY).map(fy => (
              <button key={fy} onClick={() => setSelectedFY(fy)} style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13,
                background: selectedFY === fy ? '#64ffda' : 'rgba(255,255,255,0.08)',
                color: selectedFY === fy ? '#0a0a0a' : '#aaa', fontWeight: selectedFY === fy ? 700 : 400,
              }}>{fy}</button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#e0e0e0', padding: '6px 12px', borderRadius: 8, fontSize: 13
          }}>
            <option value="ex_date">Sort by Date</option>
            <option value="amount">Sort by Amount</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 40 }}>No dividend data for {selectedFY}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#888', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Company','Type','Ex-Date','₹/Share','Qty','Total Income'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Qty' || h === '₹/Share' || h === 'Total Income' ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                    <div>{d.company}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{d.symbol}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 11,
                      background: d.dividend_type === 'Final' ? 'rgba(100,255,218,0.15)' : 'rgba(255,215,0,0.15)',
                      color: d.dividend_type === 'Final' ? '#64ffda' : '#ffd700',
                    }}>{d.dividend_type}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888' }}>{d.ex_date}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>₹{d.dividend_per_share}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#888' }}>{d.quantity}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#64ffda' }}>{fmtD(d.total_dividend)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid rgba(255,255,255,0.12)', fontWeight: 700 }}>
                <td colSpan={5} style={{ padding: '10px 12px', color: '#aaa' }}>Total {selectedFY}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64ffda', fontSize: 16 }}>{fmtD(fyTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
