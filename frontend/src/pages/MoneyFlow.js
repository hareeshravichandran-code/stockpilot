import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { moneyflowAPI, mastersAPI, expenseAPI } from '../lib/api';
import { inrShort, kindOf, KindIcon } from '../money/kinds';
import './MoneyFlow.css';

const SECTIONS = [
  ['income', 'Came in', '#4d6a16'],
  ['expense', 'Spent', '#8C8270'],
  ['investment', 'Invested', '#111111'],
];
const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shortMonth = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function Delta({ actual, expected, goodWhenLow }) {
  if (!expected) return null;
  const pct = Math.round(((actual - expected) / Math.abs(expected)) * 100);
  if (Math.abs(pct) < 3) return <span className="mf-delta flat">on usual</span>;
  const up = pct > 0;
  const good = goodWhenLow ? !up : up;
  return <span className={`mf-delta ${good ? 'good' : 'bad'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

function GroupRows({ groups, color, goodWhenLow, isNow }) {
  const max = Math.max(1, ...groups.map(g => Math.max(g.actual, g.expected)));
  if (!groups.length) return <div className="mf-none">Nothing here this month.</div>;
  return (
    <div className="mf-rows">
      {groups.map(g => (
        <div key={g.key} className={`mf-row${g.uncategorised ? ' unc' : ''}`} title={`${g.count} transaction${g.count === 1 ? '' : 's'}${g.inferred ? ` · ${g.inferred} sorted by your rules` : ''}`}>
          <span className="mf-dot" style={{ background: g.color || color }} />
          <span className="mf-name">{g.name}</span>
          <span className="mf-bar">
            <i style={{ width: `${(g.actual / max) * 100}%`, background: g.color || color }} />
            {g.expected > 0 && <em style={{ left: `${(g.expected / max) * 100}%` }} title={`Usual ${inrShort(g.expected)}`} />}
          </span>
          <span className="mf-amt">{inrShort(g.actual)}</span>
          <span className="mf-exp">{g.expected ? `usual ${inrShort(g.expected)}` : 'new'}</span>
          {!isNow && <Delta actual={g.actual} expected={g.expected} goodWhenLow={goodWhenLow} />}
        </div>
      ))}
    </div>
  );
}

/** Spending month by month (the newest month on the right). Click a month to open it. */
function SpendTrend({ months, current, onPick }) {
  const max = Math.max(1, ...months.map(m => m.expense));
  const prior = months.slice(0, -1).filter(m => m.expense > 0);                // months before tracking began don't pull the average down
  const avg = prior.length ? prior.reduce((s, m) => s + m.expense, 0) / prior.length : 0;
  return (
    <div className="mf-spend" role="list" aria-label="Spending by month">
      {avg > 0 && <span className="mf-avg" style={{ bottom: `calc(${(avg / max) * 100}% * .78 + 34px)` }}><em>avg {inrShort(avg)}</em></span>}
      {months.map((m, i) => {
        const h = (m.expense / max) * 100;
        const over = avg > 0 && m.expense > avg * 1.1;
        return (
          <button key={m.month} type="button" role="listitem" className={`mf-sb${m.month === current ? ' cur' : ''}${over ? ' over' : ''}`} style={{ '--i': i }}
            onClick={() => onPick(m.month)} title={`${monthLabel(m.month)} · spent ${inrShort(m.expense)} · came in ${inrShort(m.income)} · invested ${inrShort(m.investment)}`}>
            <span className="mf-sb-v">{inrShort(m.expense)}</span>
            <span className="mf-sb-col"><i style={{ height: `${Math.max(2, h)}%` }} /></span>
            <span className="mf-sb-m">{shortMonth(m.month)}</span>
          </button>
        );
      })}
    </div>
  );
}

const ymdIst = (ms) => new Date(Number(ms) + 330 * 60000).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The month's latest payments, with their category and SMS. */
function RecentSpends({ month, cats, onReport }) {
  const [flow, setFlow] = useState(null);
  useEffect(() => {
    let live = true; setFlow(null);
    mastersAPI.month(month, { dividends: '0' }).then(r => { if (live) setFlow((r.data.flow || []).filter(f => f.dir !== 'in')); }).catch(() => { if (live) setFlow([]); });
    return () => { live = false; };
  }, [month]);
  const cat = (id) => cats.find(c => c.id === id);
  if (flow === null) return <div className="mf-skel sm" />;
  const list = flow.slice().sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount).slice(0, 12);
  if (!list.length) return <div className="mf-none">No spends recorded this month yet.</div>;
  return (
    <>
      <ul className="mf-recent">
        {list.map((f, i) => {
          const c = cat(f.category_id); const body = clean(f.body);
          const title = f.master_title || clean(f.title) || body.slice(0, 48) || 'Bank payment';
          return (
            <li key={f.id || i} style={{ '--i': i }}>
              <span className="mf-ric" style={{ '--c': kindOf(f.kind).c }}><KindIcon kind={f.kind} size={15} /></span>
              <span className="mf-rt"><b>{title}</b>
                <small className={c ? '' : 'unc'}>{fmtDay(f.date)} · {c ? `${c.icon || ''} ${c.name}` : 'Not sorted'}</small>
                {body && body !== title && <em>{body}</em>}</span>
              <span className="mf-ra">−{inrShort(f.amount)}</span>
            </li>
          );
        })}
      </ul>
      {flow.length > 12 && <button type="button" className="mf-linkbtn" onClick={onReport}>All {flow.length} spends in the report ↓</button>}
    </>
  );
}

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

export default function MoneyFlow({ embedded = false, onManage }) {
  const nav = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [made, setMade] = useState({});
  const [cats, setCats] = useState([]);
  useEffect(() => { expenseAPI.categories().then(r => setCats((r.data || []).filter(c => !c.is_deleted))).catch(() => {}); }, []);
  const goReport = () => document.getElementById('mf-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const isNow = month === thisMonth();

  useEffect(() => {
    let live = true;
    setData(null); setErr('');
    moneyflowAPI.get(month).then(r => { if (live) setData(r.data); }).catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load money flow'); });
    return () => { live = false; };
  }, [month]);

  const tiles = useMemo(() => data ? [
    ['income', 'Came in', data.totals.income, false],
    ['expense', 'Spent', data.totals.expense, true],
    ['investment', 'Invested', data.totals.investment, false],
    ['saved', 'Left over', data.totals.saved, false],
  ] : [], [data]);

  const makeSub = async (s) => {
    setMade(m => ({ ...m, [s.merchant]: 'saving' }));
    try {
      await mastersAPI.create({ kind: 'subscription', title: s.merchant, amount: s.amount, frequency: 'monthly', due_day: s.due_day, match: { keywords: s.merchant.toLowerCase() } });
      setMade(m => ({ ...m, [s.merchant]: 'done' }));
    } catch { setMade(m => ({ ...m, [s.merchant]: 'error' })); }
  };

  return (
    <div className={`mf${embedded ? ' mf-embed' : ''}`}>
      <header className="mf-top">
        {!embedded && <button type="button" className="mf-back" onClick={() => nav('/dashboard')} aria-label="Back">‹</button>}
        <div className="mf-brand"><h1>Money flow</h1><small>Spending month by month, this month, by category, recent spends and a report</small></div>
        <div className="mf-month">
          <button type="button" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month">‹</button>
          <b>{monthLabel(month)}</b>
          <button type="button" onClick={() => setMonth(m => addMonths(m, 1))} disabled={isNow} aria-label="Next month">›</button>
        </div>
        {onManage && <button type="button" className="mf-manage" onClick={onManage} title="Categories, SMS rules, categorise in bulk, budgets, custom fields and Google Sheets">Manage <small>categories · rules · budgets</small></button>}
      </header>

      <main className="mf-main">
        {err && <div className="mf-err">{err}</div>}
        {!data && !err && <div className="mf-skel" />}
        {data && <>
          <section className="mf-card wide mf-first">
            <h2>Spending, month by month <small>tap a month to open it</small></h2>
            <SpendTrend months={data.months} current={month} onPick={setMonth} />
          </section>

          <h3 className="mf-h">{monthLabel(month)}{isNow ? ' so far' : ''}</h3>
          <section className="mf-tiles">
            {tiles.map(([k, label, t, low]) => (
              <div key={k} className={`mf-tile t-${k}`}>
                <small>{label}{isNow && k !== 'saved' ? ' so far' : ''}</small>
                <b>{k === 'saved' && t.actual < 0 ? '−' : ''}{inrShort(Math.abs(t.actual))}</b>
                <span>Usual {k === 'saved' && t.expected < 0 ? '−' : ''}{inrShort(Math.abs(t.expected))}{!isNow && <Delta actual={t.actual} expected={t.expected} goodWhenLow={low} />}</span>
                {isNow && k === 'expense' && t.expected > 0 && <div className="mf-pace"><i style={{ width: `${Math.min(100, (t.actual / t.expected) * 100)}%` }} className={t.actual > t.expected ? 'over' : ''} /></div>}
              </div>
            ))}
          </section>

          <p className="mf-note">
            “Usual” is the {data.expected_basis.toLowerCase()}.
            {(data.left_out.duplicates > 0 || data.left_out.transfers > 0) && <> Left out: {data.left_out.duplicates > 0 && <><b>{data.left_out.duplicates}</b> repeated SMS for the same payment ({inrShort(data.left_out.duplicate_amount)})</>}
              {data.left_out.duplicates > 0 && data.left_out.transfers > 0 && ' and '}
              {data.left_out.transfers > 0 && <><b>{data.left_out.transfers}</b> transfers between your own accounts ({inrShort(data.left_out.transfer_amount)})</>}.</>}
            {data.uncategorised > 0 && <> <span className="mf-warn">{inrShort(data.uncategorised)} of spending has no category yet</span>: sort it with Manage → Bulk Categorise (here or in the app) and it moves into its group.</>}
          </p>

          <div className="mf-grid">
            <section className="mf-card wide">
              <h2><span style={{ background: '#8C8270' }} />Where it went, by category <small>{inrShort(data.sections.expense.actual)}</small></h2>
              <GroupRows groups={data.sections.expense.groups} color="#8C8270" goodWhenLow isNow={isNow} />
            </section>
            {SECTIONS.filter(s => s[0] !== 'expense').map(([k, title, c]) => (
              <section key={k} className="mf-card">
                <h2><span style={{ background: c }} />{title} <small>{inrShort(data.sections[k].actual)}</small></h2>
                <GroupRows groups={data.sections[k].groups} color={c} isNow={isNow} />
              </section>
            ))}
            <section className="mf-card wide">
              <h2><span style={{ background: '#9E2B25' }} />Recent spends <small>latest first</small></h2>
              <RecentSpends month={month} cats={cats} onReport={goReport} />
            </section>
            <section className="mf-card wide" id="mf-report">
              <h2><span style={{ background: '#111' }} />Report <small>pick a period, money in or out, a category</small></h2>
              <Report month={month} cats={cats} />
            </section>
            {data.subscriptions.length > 0 && (
              <section className="mf-card wide">
                <h2><span style={{ background: '#8a5a2b' }} />Looks like subscriptions <small>Same merchant, similar amount, most months</small></h2>
                <div className="mf-subs">
                  {data.subscriptions.map(s => (
                    <div key={s.merchant} className="mf-sub">
                      <div><b>{s.merchant}</b><small>{inrShort(s.amount)}/mo · seen {s.months} of 6 months · last {new Date(s.last + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></div>
                      {made[s.merchant] === 'done' ? <span className="mf-ok">✓ Added to Masters</span>
                        : <button type="button" disabled={made[s.merchant] === 'saving'} onClick={() => makeSub(s)}>{made[s.merchant] === 'error' ? 'Try again' : 'Make it a subscription'}</button>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>}
      </main>
    </div>
  );
}
