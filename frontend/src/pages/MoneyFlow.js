import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { moneyflowAPI, mastersAPI, expenseAPI } from '../lib/api';
import { inrShort } from '../money/kinds';
import './MoneyFlow.css';

/*
 * Money flow, three views:
 *   Overview  month bars (spent + invested, 12 months, the picked month highlighted) -> that month by category -> its spends
 *   Report    any period, money in or out, a category, search, CSV
 *   Sheet     categories down, months across, like an expense-tracking spreadsheet (spending, investments, money in)
 * Colours (validated for colour-blind separation on the paper surface): spent #D9541E, invested #1F7FA8.
 */
const C_SPENT = '#D9541E', C_INV = '#1F7FA8';
const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shortMonth = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const niceMax = (v) => { if (v <= 0) return 1000; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };

/** Spent and invested per month as paired bars. Hover a month for its numbers; click to open it. */
function MonthBars({ months, current, onPick }) {
  const [hover, setHover] = useState(null);
  const W = 1000, H = 260, L = 56, R = 8, T = 16, B = 34;
  const max = niceMax(Math.max(...months.map(m => Math.max(m.expense, m.investment)), 1));
  const step = (W - L - R) / months.length;
  const bw = Math.min(22, step * 0.28);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bar = (x, v) => { const top = y(v), base = y(0), h = Math.max(0, base - top), r = Math.min(4, h, bw / 2);
    return h <= 0 ? '' : `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`; };
  const ticks = [0, max / 2, max];
  const hm = hover != null ? months[hover] : null;
  return (
    <div className="mf2-chart">
      <div className="mf2-legend" aria-hidden="true"><span><i style={{ background: C_SPENT }} />Spent</span><span><i style={{ background: C_INV }} />Invested</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spent and invested by month" preserveAspectRatio="none">
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="mf2-grid" /><text x={L - 8} y={y(t) + 4} className="mf2-ytick">{inrShort(t)}</text></g>)}
        {months.map((m, i) => {
          const x0 = L + i * step, cx = x0 + step / 2, sel = m.month === current;
          return (
            <g key={m.month} className={`mf2-col${sel ? ' sel' : ''}${hover === i ? ' hov' : ''}`}>
              {sel && <rect x={x0 + 2} y={T - 8} width={step - 4} height={H - T - B + 8} rx="10" className="mf2-band" />}
              <path d={bar(cx - bw - 1, m.expense)} fill={C_SPENT} />
              <path d={bar(cx + 1, m.investment)} fill={C_INV} />
              <text x={cx} y={H - 12} className="mf2-xtick">{shortMonth(m.month)}</text>
              <rect x={x0} y={0} width={step} height={H} fill="transparent" className="mf2-hit"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick(m.month)}>
                <title>{`${monthLabel(m.month)}: spent ${inr(m.expense)}, invested ${inr(m.investment)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {hm && (
        <div className="mf2-tip" style={{ left: `${((L + (hover + 0.5) * step) / W) * 100}%` }}>
          <b>{monthLabel(hm.month)}</b>
          <span><i style={{ background: C_SPENT }} />Spent<em>{inr(hm.expense)}</em></span>
          <span><i style={{ background: C_INV }} />Invested<em>{inr(hm.investment)}</em></span>
          <span className="in">Came in<em>{inr(hm.income)}</em></span>
        </div>
      )}
      <table className="mf2-sr"><caption>Spent and invested by month</caption><thead><tr><th>Month</th><th>Spent</th><th>Invested</th><th>Came in</th></tr></thead>
        <tbody>{months.map(m => <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{inr(m.expense)}</td><td>{inr(m.investment)}</td><td>{inr(m.income)}</td></tr>)}</tbody></table>
    </div>
  );
}

function Kpi({ label, value, usual, tone, note }) {
  const pct = usual ? Math.round(((value - usual) / Math.abs(usual)) * 100) : null;
  return (
    <div className={`mf2-kpi ${tone || ''}`}>
      <small>{label}</small>
      <b>{value < 0 ? '−' : ''}{inr(Math.abs(value))}</b>
      <span>{usual ? <>usual {inr(usual)}{pct != null && Math.abs(pct) >= 3 && <em className={(tone === 'spent' ? pct > 0 : pct < 0) ? 'bad' : 'good'}>{pct > 0 ? '+' : ''}{pct}%</em>}</> : note || 'no earlier months'}</span>
    </div>
  );
}

/** Spending by category for the month: one bar each, usual level marked; click one to filter the list below. */
function CategorySplit({ groups, pick, onPick }) {
  const total = groups.reduce((s, g) => s + g.actual, 0);
  const max = Math.max(1, ...groups.map(g => Math.max(g.actual, g.expected)));
  const shown = groups.filter(g => g.actual > 0 || g.expected > 0);
  if (!shown.length) return <p className="mf2-empty">No spending recorded this month yet.</p>;
  return (
    <ul className="mf2-cats">
      {shown.map(g => (
        <li key={g.key}>
          <button type="button" className={`${pick === g.key ? 'on' : ''}${g.uncategorised ? ' unc' : ''}`} aria-pressed={pick === g.key} onClick={() => onPick(pick === g.key ? null : g.key)}
            title={g.expected ? `Usual ${inr(g.expected)}` : 'New this month'}>
            <span className="mf2-cn">{g.name}<small>{g.count} payment{g.count === 1 ? '' : 's'}</small></span>
            <span className="mf2-cb"><i style={{ width: `${(g.actual / max) * 100}%` }} />{g.expected > 0 && <em style={{ left: `${(g.expected / max) * 100}%` }} />}</span>
            <span className="mf2-ca">{inr(g.actual)}<small>{total ? Math.round((g.actual / total) * 100) : 0}%</small></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
/** The month's spends, newest first; filtered by the picked category and a search. */
function SpendList({ items, pick, groupName, onClear }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const list = (items || []).filter(i => (!pick || i.key === pick) && (!q || `${i.merchant || ''} ${i.group}`.toLowerCase().includes(q.toLowerCase())));
  const shown = all ? list : list.slice(0, 15);
  return (
    <div className="mf2-list">
      <div className="mf2-list-tools">
        {pick && <button type="button" className="mf2-chip on" onClick={onClear}>{groupName} <span aria-hidden="true">×</span><span className="mf2-sr-only">clear category</span></button>}
        <input type="search" placeholder="Search payee" value={q} onChange={e => setQ(e.target.value)} aria-label="Search spends" />
        <span className="mf2-count">{list.length} payment{list.length === 1 ? '' : 's'} · {inr(list.reduce((s, i) => s + i.amount, 0))}</span>
      </div>
      {!list.length ? <p className="mf2-empty">Nothing matches.</p> : (
        <table className="mf2-table">
          <thead><tr><th>Date</th><th>Paid to</th><th>Category</th><th className="num">Amount</th></tr></thead>
          <tbody>{shown.map(i => (
            <tr key={i.id}><td>{fmtD(i.date)}</td><td className="payee">{String(i.merchant || '').replace(/^e[vp]1:.*/, '') || 'Bank payment'}</td>
              <td><span className="mf2-cat"><i style={{ background: i.color }} />{i.group}</span></td><td className="num">{inr(i.amount)}</td></tr>
          ))}</tbody>
        </table>
      )}
      {list.length > 15 && <button type="button" className="mf2-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </div>
  );
}

/** Categories down, months across: the expense-tracking sheet. Cells tinted by size within the section. */
function Sheet({ month }) {
  const [sec, setSec] = useState('expense');
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true; setD(null);
    moneyflowAPI.get(month, { span: 12, grid: 1 }).then(r => { if (live) setD(r.data); }).catch(() => { if (live) setD({ error: true }); });
    return () => { live = false; };
  }, [month]);
  if (!d) return <div className="mf-skel sm" />;
  if (d.error) return <p className="mf2-empty">Could not load the sheet. Try again.</p>;
  const months = d.months.map(m => m.month);
  const rows = (d.grid.find(g => g.section === sec) || { rows: [] }).rows;
  const colTot = months.map(mo => rows.reduce((s, r) => s + (r.values[mo] || 0), 0));
  const cellMax = Math.max(1, ...rows.flatMap(r => months.map(mo => r.values[mo] || 0)));
  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Category', ...months.map(monthLabel), 'Total'].map(esc).join(',')]
      .concat(rows.map(r => [esc(r.name), ...months.map(mo => r.values[mo] || 0), months.reduce((s, mo) => s + (r.values[mo] || 0), 0)].join(',')))
      .concat([[esc('Total'), ...colTot, colTot.reduce((a, b) => a + b, 0)].join(',')]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `kanalyst-${sec}-sheet-${months[0]}-to-${months[months.length - 1]}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="mf2-sheet">
      <div className="mf2-sheet-tools">
        <div className="mf2-seg" role="tablist" aria-label="Section">
          {[['expense', 'Spending'], ['investment', 'Investments'], ['income', 'Money in']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sec === k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{l}</button>)}
        </div>
        <button type="button" className="mf2-ghost" onClick={csv} disabled={!rows.length}>Download CSV</button>
      </div>
      {!rows.length ? <p className="mf2-empty">Nothing in this section for these months.</p> : (
        <div className="mf2-sheet-wrap" tabIndex={0} aria-label="Category by month sheet">
          <table className={`mf2-grid s-${sec}`}>
            <thead><tr><th className="cat">Category</th>{months.map(mo => <th key={mo} className={mo === month ? 'cur' : ''}>{shortMonth(mo)}<small>{mo.slice(2, 4)}</small></th>)}<th className="tot">Total</th><th className="tot">Avg / mo</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const tot = months.reduce((s, mo) => s + (r.values[mo] || 0), 0);
                const active = months.filter(mo => r.values[mo]).length;
                return (
                  <tr key={r.key}>
                    <th className="cat"><i style={{ background: r.color }} />{r.name}</th>
                    {months.map(mo => { const v = r.values[mo] || 0; return <td key={mo} className={mo === month ? 'cur' : ''} style={{ '--t': v ? 0.08 + 0.5 * (v / cellMax) : 0 }}>{v ? inrShort(v) : '–'}</td>; })}
                    <td className="tot">{inrShort(tot)}</td><td className="tot">{inrShort(active ? tot / months.length : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><th className="cat">Total</th>{colTot.map((v, i) => <td key={months[i]} className={months[i] === month ? 'cur' : ''}>{inrShort(v)}</td>)}<td className="tot">{inrShort(colTot.reduce((a, b) => a + b, 0))}</td><td className="tot">{inrShort(colTot.reduce((a, b) => a + b, 0) / months.length)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const ymdIst = (ms) => new Date(Number(ms) + 330 * 60000).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const PRESETS = [['month', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['custom', 'Custom']];
function rangeOf(p, month, from, to) {
  const t = new Date(); const ym = month;
  const [y, m] = ym.split('-').map(Number);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p === 'month') return [`${ym}-01`, iso(new Date(y, m, 0))];
  if (p === 'last') return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m - 1, 0))];
  if (p === '3m') return [iso(new Date(y, m - 3, 1)), iso(new Date(y, m, 0))];
  if (p === 'year') return [`${t.getFullYear()}-01-01`, iso(t)];
  return [from, to];
}

/** A simple report like the phone's: pick the period, money in or out, a category; totals and every payment by day. */
function Report({ month, cats }) {
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [type, setType] = useState('DEBIT');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [lo, hi] = rangeOf(preset, month, from, to);
  useEffect(() => {
    if (!lo || !hi) return undefined;
    let live = true; setRows(null);
    expenseAPI.getEntries({ from: lo, to: hi, ...(type ? { type } : {}), ...(cat ? { category: cat } : {}), limit: 5000 })
      .then(r => { if (live) setRows(r.data || []); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [lo, hi, type, cat]);
  const catName = (id) => cats.find(c => c.id === id)?.name || id || 'Not sorted';
  const shown = (rows || []).filter(r => !q || [r.merchant_name, r.comments, r.sms_body, catName(r.category_id)].some(x => x && String(x).toLowerCase().includes(q.toLowerCase())));
  const out = shown.filter(r => r.type !== 'CREDIT').reduce((s, r) => s + r.amount, 0);
  const inn = shown.filter(r => r.type === 'CREDIT').reduce((s, r) => s + r.amount, 0);
  const byDay = {};
  for (const r of shown) (byDay[ymdIst(r.date_time)] = byDay[ymdIst(r.date_time)] || []).push(r);
  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Type', 'Amount', 'Payee', 'Category', 'SMS'].join(',')]
      .concat(shown.map(r => [ymdIst(r.date_time), r.type === 'CREDIT' ? 'In' : 'Out', r.amount, esc(clean(r.merchant_name)), esc(catName(r.category_id)), esc(clean(r.sms_body))].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `kanalyst-report-${lo}-to-${hi}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const sortedCats = [...cats].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <div className="mf-report">
      <div className="mf-rfilters">
        <div className="mf-chips">{PRESETS.map(([k, l]) => <button key={k} type="button" className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>)}</div>
        {preset === 'custom' && <span className="mf-dates"><input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" /> – <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></span>}
        <div className="mf-chips">{[['DEBIT', 'Spent'], ['CREDIT', 'Came in'], ['', 'Both']].map(([k, l]) => <button key={k || 'all'} type="button" className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{sortedCats.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}</select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee or SMS" aria-label="Search" />
      </div>
      {rows === null ? <div className="mf-skel sm" /> : (
        <>
          <div className="mf-rtotals">
            <span><small>{fmtDay(lo)} – {fmtDay(hi)}</small><b>{shown.length} payments</b></span>
            {type !== 'CREDIT' && <span><small>Spent</small><b className="out">{inrShort(out)}</b></span>}
            {type !== 'DEBIT' && <span><small>Came in</small><b className="in">{inrShort(inn)}</b></span>}
            <button type="button" className="mf-linkbtn" onClick={csv} disabled={!shown.length}>Download CSV</button>
          </div>
          {!shown.length ? <div className="mf-none">No payments for these filters.</div> : (
            <div className="mf-rdays">
              {Object.keys(byDay).sort().reverse().slice(0, 120).map(d => (
                <div key={d} className="mf-rday">
                  <div className="mf-rday-h"><b>{fmtDay(d)}</b><span>{inrShort(byDay[d].reduce((s, r) => s + (r.type === 'CREDIT' ? 0 : r.amount), 0))}</span></div>
                  {byDay[d].map(r => (
                    <div key={r.id} className="mf-rrow">
                      <span className="mf-rt"><b>{clean(r.merchant_name) || clean(r.sms_body).slice(0, 48) || 'Bank payment'}</b><small className={r.category_id && r.category_id !== 'other' ? '' : 'unc'}>{catName(r.category_id)}</small></span>
                      <span className={`mf-ra ${r.type === 'CREDIT' ? 'in' : ''}`}>{r.type === 'CREDIT' ? '+' : '−'}{inrShort(r.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


const VIEWS = [['overview', 'Overview'], ['report', 'Report'], ['sheet', 'Sheet']];
export default function MoneyFlow({ embedded = false, onManage }) {
  const nav = useNavigate();
  const [view, setView] = useState(() => { try { return sessionStorage.getItem('mf-view') || 'overview'; } catch { return 'overview'; } });
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(null);
  const [made, setMade] = useState({});
  const [cats, setCats] = useState([]);
  const listRef = useRef(null);
  useEffect(() => { expenseAPI.categories().then(r => setCats((r.data || []).filter(c => !c.is_deleted))).catch(() => {}); }, []);
  const go = (v) => { setView(v); try { sessionStorage.setItem('mf-view', v); } catch { /* ignore */ } };
  const isNow = month === thisMonth();

  useEffect(() => {
    let live = true;
    setData(null); setErr(''); setPick(null);
    moneyflowAPI.get(month, { span: 12, items: 1 }).then(r => { if (live) setData(r.data); }).catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load Money flow. Reload the page to try again.'); });
    return () => { live = false; };
  }, [month]);

  const expGroups = useMemo(() => data?.sections?.expense?.groups || [], [data]);
  const pickName = expGroups.find(g => g.key === pick)?.name || '';
  const makeSub = async (s) => {
    setMade(m => ({ ...m, [s.merchant]: 'saving' }));
    try {
      await mastersAPI.create({ kind: 'subscription', title: s.merchant, amount: s.amount, frequency: 'monthly', due_day: s.due_day, match: { keywords: s.merchant.toLowerCase() } });
      setMade(m => ({ ...m, [s.merchant]: 'done' }));
    } catch { setMade(m => ({ ...m, [s.merchant]: 'error' })); }
  };
  const t = data?.totals;

  return (
    <div className={`mf mf2${embedded ? ' mf-embed' : ''}`}>
      <header className="mf2-top">
        {!embedded && <button type="button" className="mf-back" onClick={() => nav('/dashboard')} aria-label="Back">‹</button>}
        <h1>Money flow</h1>
        <nav className="mf2-views" role="tablist" aria-label="Views">
          {VIEWS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}
        </nav>
        <div className="mf2-month">
          <button type="button" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month">‹</button>
          <b>{monthLabel(month)}</b>
          <button type="button" onClick={() => setMonth(m => addMonths(m, 1))} disabled={isNow} aria-label="Next month">›</button>
        </div>
        {onManage && <button type="button" className="mf2-ghost" onClick={onManage} title="Categories, SMS rules, bulk categorise, budgets">Manage categories</button>}
      </header>

      <main className="mf2-main">
        {view === 'overview' && <>
          {err && <div className="mf-err" role="alert">{err}</div>}
          {!data && !err && <div className="mf-skel" />}
          {data && t && <>
            <section className="mf2-card mf2-hero">
              <div className="mf2-hero-head">
                <h2>Spent and invested, month by month</h2>
                <p>Click a month to open it below.</p>
              </div>
              <MonthBars months={data.months} current={month} onPick={setMonth} />
            </section>

            <section className="mf2-kpis" aria-label={`${monthLabel(month)} totals`}>
              <Kpi label={isNow ? 'Spent so far' : 'Spent'} value={t.expense.actual} usual={t.expense.expected} tone="spent" />
              <Kpi label="Invested" value={t.investment.actual} usual={t.investment.expected} tone="inv" />
              <Kpi label="Came in" value={t.income.actual} usual={t.income.expected} tone="in" />
              <Kpi label="Left over" value={t.saved.actual} usual={t.saved.expected} tone="left" />
            </section>
            {(data.left_out.duplicates > 0 || data.left_out.transfers > 0 || data.uncategorised > 0) && (
              <p className="mf2-note">
                "Usual" is the {data.expected_basis.toLowerCase()}.
                {data.left_out.transfers > 0 && <> {data.left_out.transfers} transfers between your own accounts ({inr(data.left_out.transfer_amount)}) are not counted.</>}
                {data.left_out.duplicates > 0 && <> {data.left_out.duplicates} repeated SMS for the same payment are counted once.</>}
                {data.uncategorised > 0 && <> <b>{inr(data.uncategorised)}</b> has no category yet. {onManage && <button type="button" className="mf2-link" onClick={onManage}>Sort it</button>}</>}
              </p>
            )}

            <div className="mf2-cols">
              <section className="mf2-card">
                <h2>Where it went in {shortMonth(month)} <small>{inr(t.expense.actual)}</small></h2>
                <CategorySplit groups={expGroups} pick={pick} onPick={(k) => { setPick(k); if (k) setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
                {data.sections.investment.groups.some(g => g.actual > 0) && <>
                  <h3 className="mf2-sub">Invested <small>{inr(t.investment.actual)}</small></h3>
                  <ul className="mf2-mini">{data.sections.investment.groups.filter(g => g.actual > 0).map(g => <li key={g.key}><span>{g.name}</span><b>{inr(g.actual)}</b></li>)}</ul>
                </>}
              </section>
              <section className="mf2-card" ref={listRef}>
                <h2>Spends in {shortMonth(month)} <small>newest first</small></h2>
                <SpendList items={data.items} pick={pick} groupName={pickName} onClear={() => setPick(null)} />
              </section>
            </div>

            {data.subscriptions.length > 0 && (
              <section className="mf2-card">
                <h2>These look like subscriptions <small>same payee, similar amount, most months</small></h2>
                <div className="mf-subs">
                  {data.subscriptions.map(s => (
                    <div key={s.merchant} className="mf-sub">
                      <div><b>{s.merchant}</b><small>{inr(s.amount)} a month · seen {s.months} of 6 months</small></div>
                      {made[s.merchant] === 'done' ? <span className="mf-ok">Added to Subscriptions</span>
                        : <button type="button" disabled={made[s.merchant] === 'saving'} onClick={() => makeSub(s)}>{made[s.merchant] === 'error' ? 'Try again' : 'Add as subscription'}</button>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>}
        </>}
        {view === 'report' && <section className="mf2-card"><h2>Report <small>any period, money in or out, a category</small></h2><Report month={month} cats={cats} /></section>}
        {view === 'sheet' && <section className="mf2-card"><h2>Monthly sheet <small>12 months to {monthLabel(month)}</small></h2><Sheet month={month} /></section>}
      </main>
    </div>
  );
}
