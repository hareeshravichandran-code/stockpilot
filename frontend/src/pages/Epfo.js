import { useEffect, useRef, useState, useCallback } from 'react';
import { epfAPI } from '../lib/api';
import LogoLoader from '../components/LogoLoader';
import useCountUp from '../hooks/useCountUp';
import './Epfo.css';

const inr = (v) => '₹' + Math.round(+v || 0).toLocaleString('en-IN');
const short = (v) => { const x = Math.abs(+v || 0); return x >= 1e7 ? `₹${(x / 1e7).toFixed(2)}Cr` : x >= 1e5 ? `₹${(x / 1e5).toFixed(2)}L` : inr(x); };
const dt = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ym = (s) => (s ? new Date(s + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');
const KIND = { contribution: 'Contribution', interest: 'Interest', withdrawal: 'Withdrawal', transfer: 'Transfer', opening: 'Opening balance', closing: 'Closing balance', balance: 'Balance' };

/** EPFO: provident fund from the passbook PDF and EPFO SMS (read by the phone app). */
export default function Epfo({ hideValues }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [add, setAdd] = useState(null);
  const file = useRef(null);
  const load = useCallback(() => epfAPI.get().then(r => setD(r.data)).catch(e => setErr(e?.response?.data?.error || 'Could not load EPFO')), []);
  useEffect(() => { load(); }, [load]);
  const total = useCountUp(d?.total?.balance || 0);
  const money = (v) => (hideValues ? '••••' : short(v));

  const upload = async (f) => {
    if (!f) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await epfAPI.passbook(f);
      setMsg(`Passbook read: ${r.data.contributions} contributions${r.data.account?.establishment ? ' from ' + r.data.account.establishment : ''}.`);
      await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Could not read the passbook'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const saveManual = async () => {
    setBusy(true); setErr('');
    try { await epfAPI.add(add); setAdd(null); await load(); } catch (e) { setErr(e?.response?.data?.error || 'Could not save'); } finally { setBusy(false); }
  };

  if (!d && !err) return <LogoLoader label="Opening your provident fund…" />;
  const accounts = d?.accounts || [];
  const recent = (d?.entries || []).filter(e => e.kind !== 'closing' && e.kind !== 'opening').slice(0, 24);

  return (
    <div className="ep">
      <section className="ep-hero">
        <div>
          <small>EPF balance</small>
          <h2>{hideValues ? '₹••••' : inr(total)}</h2>
          <p>{d?.total?.at ? `As of ${dt(d.total.at)}` : 'Add your passbook or let the phone app read EPFO SMS'}{d?.total?.monthly ? ` · ${money(d.total.monthly)} a month going in` : ''}</p>
        </div>
        <div className="ep-hero-side">
          <div><small>Pension (EPS)</small><b>{money(d?.total?.pension)}</b></div>
          <div><small>Accounts</small><b>{accounts.filter(a => a.status !== 'closed').length}</b></div>
        </div>
        <div className="ep-actions">
          <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={e => upload(e.target.files?.[0])} />
          <button type="button" className="k-btn-primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Reading…' : 'Upload passbook PDF'}</button>
          <button type="button" className="ep-ghost" onClick={() => setAdd({ establishment: '', member_id: '', balance: '', balance_at: new Date().toISOString().slice(0, 10) })}>Add manually</button>
        </div>
      </section>
      {msg && <div className="ep-ok">{msg}</div>}
      {err && <div className="ep-err">{err}</div>}

      {add && (
        <section className="ep-card ep-form">
          <h3>Add an EPF account</h3>
          <div className="ep-grid">
            <label>Employer<input value={add.establishment} onChange={e => setAdd({ ...add, establishment: e.target.value })} placeholder="ACME Technologies" /></label>
            <label>Member id or UAN<input value={add.member_id} onChange={e => setAdd({ ...add, member_id: e.target.value })} placeholder="TNMAS00123450000067890" /></label>
            <label>Balance<input type="number" value={add.balance} onChange={e => setAdd({ ...add, balance: e.target.value })} placeholder="₹" /></label>
            <label>As of<input type="date" value={add.balance_at} onChange={e => setAdd({ ...add, balance_at: e.target.value })} /></label>
          </div>
          <div className="ep-row"><button type="button" className="k-btn-primary" disabled={busy} onClick={saveManual}>Save</button><button type="button" className="ep-ghost" onClick={() => setAdd(null)}>Cancel</button></div>
        </section>
      )}

      {accounts.length === 0 ? (
        <section className="ep-card ep-empty">
          <h3>Bring in your provident fund</h3>
          <ol>
            <li><b>Passbook:</b> open <a href="https://passbook.epfindia.gov.in" target="_blank" rel="noreferrer">passbook.epfindia.gov.in</a>, log in with your UAN, pick the member id and year, and download the PDF. Upload it here (one file per year or employer).</li>
            <li><b>SMS:</b> the Kanalyst phone app reads EPFO messages (contribution received, passbook balance) and adds them here by itself.</li>
          </ol>
        </section>
      ) : (
        <>
          <div className="ep-accounts">
            {accounts.map((a, i) => (
              <article key={a.id} className={`ep-acc${a.status === 'closed' ? ' closed' : ''}`} style={{ '--i': i }}>
                <header><b>{a.establishment || 'EPF account'}</b><span>Member ••{a.member_key}</span></header>
                <div className="ep-acc-bal">{money(a.balance)}</div>
                <div className="ep-acc-meta">
                  <span>Employee {money(a.employee_total)}</span><span>Employer {money(a.employer_total)}</span><span>Pension {money(a.pension)}</span>
                </div>
                <footer>{a.last_wage_month ? `Last contribution ${ym(a.last_wage_month)}` : 'No contributions yet'} · {a.source === 'sms' ? 'From SMS' : a.source === 'passbook' ? 'From passbook' : 'Entered'}</footer>
              </article>
            ))}
          </div>

          {d.years.length > 0 && (
            <section className="ep-card">
              <h3>By financial year</h3>
              <table className="ep-table">
                <thead><tr><th>Year</th><th>Your share</th><th>Employer</th><th>Pension</th><th>Interest</th><th>Withdrawn</th></tr></thead>
                <tbody>{d.years.map(y => (
                  <tr key={y.fy}><td>{y.fy}</td><td>{money(y.employee)}</td><td>{money(y.employer)}</td><td>{money(y.pension)}</td><td className="in">{y.interest ? money(y.interest) : '—'}</td><td>{y.withdrawn ? money(y.withdrawn) : '—'}</td></tr>
                ))}</tbody>
              </table>
            </section>
          )}

          <section className="ep-card">
            <h3>Recent</h3>
            <div className="ep-list">
              {recent.map((e, i) => (
                <div key={e.id} className={`ep-item k-${e.kind}`} style={{ '--i': i }}>
                  <span className="ep-date">{dt(e.txn_date)}</span>
                  <span className="ep-t">{KIND[e.kind] || e.kind}{e.wage_month ? ` · ${ym(e.wage_month)}` : ''}<small>{e.particulars}</small></span>
                  <span className={`ep-src ${e.source}`}>{e.source === 'sms' ? 'SMS' : e.source === 'passbook' ? 'Passbook' : 'Entered'}</span>
                  <span className="ep-amt">{e.kind === 'balance' ? money(e.balance) : money((+e.employee || 0) + (+e.employer || 0) || e.amount)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
