import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { householdAPI } from '../lib/api';
import { PersonForm } from './People';
import { Avatar, Faces, MODULE, inr, fmtDay, urgency, shortName, relLabel, ageFrom, errMsg, parseDate } from './shared';

import LogoLoader from '../components/LogoLoader';
import { FEATURES } from '../lib/features';
const GO = { insurance: 'insurance', documents: 'documents', family: 'calendar', money: 'calendar', goals: 'calendar', loans: 'calendar' };

export default function FamilyHome({ members, reloadMembers, notify, go }) {
  const nav = useNavigate();
  const [ov, setOv] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try { const r = await householdAPI.overview(); setOv(r.data); } catch (e) { notify(errMsg(e), 'error'); setOv({ attention: [], cover: [], gaps: [], counts: {}, premiums: {}, upcoming: [] }); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const me = members.find(m => m.is_me);
  const others = members.filter(m => !m.is_me);
  if (!ov) return <LogoLoader label="Looking across your family…" />;
  const c = ov.counts || {};
  const maxLife = Math.max(1, ...(ov.cover || []).map(x => x.life)), maxHealth = Math.max(1, ...(ov.cover || []).map(x => x.health));
  // Upcoming grouped by week
  const weeks = [];
  for (const it of ov.upcoming || []) {
    const d = parseDate(it.date); const wk = new Date(d); wk.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = wk.toDateString();
    let g = weeks.find(w => w.key === key);
    if (!g) { g = { key, start: wk, items: [] }; weeks.push(g); }
    g.items.push(it);
  }

  return (
    <div className="fo-page">
      <section className="fo-hello">
        <div className="fo-hello-copy">
          <h1>{me ? `${me.name}’s family` : 'Your family'}</h1>
          <p>{others.length ? `${members.length} people, ${c.policies || 0} insurance policies, ${c.documents || 0} documents and ${c.upcoming || 0} dates in the next two months.` : 'Add the people you look after to see their cover, documents and dates in one place.'}</p>
        </div>
        <div className="fo-hello-people">
          {members.map(m => (
            <button key={m.id} type="button" className="fo-hello-p" onClick={() => go('people')}>
              <Avatar m={m} size={56} ring />
              <span>{shortName(m)}</span>
              <small>{relLabel(m)}{ageFrom(m.dob) !== null ? `, ${ageFrom(m.dob)}` : ''}</small>
            </button>
          ))}
          <button type="button" className="fo-hello-p add" onClick={() => setAdding(true)}><span className="fo-plus" aria-hidden="true">+</span><span>Add</span></button>
        </div>
      </section>

      <div className="fo-tiles">
        <button type="button" className="fo-tile marigold" onClick={() => go('calendar')}>
          <span className="fo-tile-v">{c.upcoming || 0}</span><span className="fo-tile-k">dates in the next 60 days</span>
        </button>
        <button type="button" className="fo-tile prussian" onClick={() => go('insurance')}>
          <span className="fo-tile-v">{c.policies || 0}</span><span className="fo-tile-k">policies, {inr(ov.premiums?.yearly || 0)} a year in premiums</span>
        </button>
        <button type="button" className="fo-tile mulberry" onClick={() => go('documents')}>
          <span className="fo-tile-v">{c.documents || 0}</span><span className="fo-tile-k">{c.overdue ? `documents, ${c.overdue} overdue` : 'documents and renewals'}</span>
        </button>
        {FEATURES.retirement && (
          <button type="button" className="fo-tile moss" onClick={() => nav('/dashboard?tab=retirement')}>
            <span className="fo-tile-v">Plan</span><span className="fo-tile-k">retirement, goals and money</span>
          </button>
        )}
      </div>

      <div className="fo-home-grid">
        <section className="fo-card">
          <h2>Needs attention</h2>
          {ov.attention.length === 0 ? (
            <p className="fo-hint">Nothing due soon. Add passports, licences, school fees and policies so Kanalyst can remind you.</p>
          ) : (
            <ul className="fo-attn">
              {ov.attention.map(a => (
                <li key={`${a.module}${a.ref}${a.date}`} className={urgency(a.days)} style={{ '--c': MODULE[a.module]?.color }}>
                  <button type="button" onClick={() => go(GO[a.module] || 'calendar')}>
                    <span className="fo-attn-when"><b>{a.days < 0 ? `${-a.days}d` : a.days === 0 ? 'Today' : `${a.days}d`}</b><small>{a.days < 0 ? 'overdue' : a.days === 0 ? '' : 'to go'}</small></span>
                    <span className="fo-attn-main"><span className="fo-attn-title">{a.title}</span><span className="fo-attn-sub">{MODULE[a.module]?.name}, {fmtDay(a.date)}{a.amount ? `, ${inr(a.amount)}` : ''}</span></span>
                    <Faces ids={a.member_ids} members={members} size={24} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fo-card">
          <div className="fo-card-head"><h2>Who is covered</h2><button type="button" className="fo-link" onClick={() => go('insurance')}>All policies</button></div>
          {(ov.cover || []).length === 0 || c.policies === 0 ? (
            <p className="fo-hint">Add your health and term policies to see each person’s cover side by side.</p>
          ) : (
            <div className="fo-cover">
              {ov.cover.map(x => {
                const m = members.find(mm => mm.id === x.member_id);
                return (
                  <div key={x.member_id} className="fo-cover-row">
                    <Avatar m={m} size={30} />
                    <span className="fo-cover-name">{x.name}</span>
                    <span className="fo-cover-bars">
                      <span className="bar life" style={{ width: `${(x.life / maxLife) * 100}%` }} />
                      <span className="bar health" style={{ width: `${(x.health / maxHealth) * 100}%` }} />
                    </span>
                    <span className="fo-cover-v"><b>{x.life ? inr(x.life) : 'No life'}</b><b className="h">{x.health ? inr(x.health) : 'No health'}</b></span>
                  </div>
                );
              })}
              <div className="fo-cover-key"><span><i className="life" />Life and term</span><span><i className="health" />Health</span></div>
            </div>
          )}
          {ov.gaps?.length > 0 && <ul className="fo-gaps">{ov.gaps.map(g => <li key={g.text}>{g.text}</li>)}</ul>}
        </section>

        <section className="fo-card wide">
          <div className="fo-card-head"><h2>Coming up</h2><button type="button" className="fo-link" onClick={() => go('calendar')}>Open calendar</button></div>
          {weeks.length === 0 ? <p className="fo-hint">No dates in the next two months yet.</p> : (
            <div className="fo-weeks">
              {weeks.slice(0, 6).map(w => (
                <div key={w.key} className="fo-week">
                  <div className="fo-week-k">Week of {w.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                  <ul>
                    {w.items.slice(0, 6).map(it => (
                      <li key={it.id} style={{ '--c': MODULE[it.module]?.color }}>
                        <span className="fo-week-d">{fmtDay(it.date)}</span>
                        <span className="fo-week-t">{it.title}</span>
                        {it.amount ? <b>{inr(it.amount)}</b> : null}
                      </li>
                    ))}
                    {w.items.length > 6 && <li className="more">+{w.items.length - 6} more</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="fo-hint" style={{ marginTop: 10 }}>Dates come from People, Insurance, Documents, your FDs and RDs, and Blueprint goals.</p>
        </section>
      </div>
      {adding && <PersonForm onClose={() => setAdding(false)} onSaved={async () => { await reloadMembers(); await load(); }} notify={notify} />}
    </div>
  );
}
