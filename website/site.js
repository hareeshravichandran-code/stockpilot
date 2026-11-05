/* Kanalyst — kanalyst.in interactions. No libraries. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = { money: 'var(--moss)', goals: 'var(--aubergine)', loans: 'var(--terracotta)', insurance: 'var(--prussian)', documents: 'var(--mulberry)', calendar: 'var(--marigold)' };
  var NAME = { money: 'Money', goals: 'Goals', loans: 'Loans', insurance: 'Insurance', documents: 'Documents', calendar: 'Dates' };

  // ── Family map ──────────────────────────────────────────────────
  var MEMBERS = [
    { id: 'arjun', name: 'Arjun', role: 'You', x: 50, y: 25 },
    { id: 'meera', name: 'Meera', role: 'Partner', x: 75, y: 50 },
    { id: 'nila', name: 'Nila', role: 'Daughter, 8', x: 50, y: 75 },
    { id: 'paati', name: 'Paati', role: 'Grandmother', x: 25, y: 50 }
  ];
  var ITEMS = [
    { id: 'loan', m: 'loans', who: ['arjun', 'meera'], t: 'Home loan', n: '₹28L left, ends 2043', x: 76, y: 8 },
    { id: 'term', m: 'insurance', who: ['arjun'], t: 'Term cover', n: '₹1.5Cr, renews March', x: 24, y: 8 },
    { id: 'sip', m: 'money', who: ['arjun', 'meera'], t: 'SIPs', n: '₹35K a month', x: 93, y: 30 },
    { id: 'ret', m: 'goals', who: ['arjun', 'meera'], t: 'Retirement', n: 'On track for 2045', x: 93, y: 70 },
    { id: 'pass', m: 'documents', who: ['meera'], t: 'Passport', n: 'Expires Feb 2027', x: 76, y: 92 },
    { id: 'fees', m: 'calendar', who: ['nila'], t: 'School fees', n: 'Due 10 June', x: 50, y: 97 },
    { id: 'ssy', m: 'money', who: ['nila'], t: 'Sukanya account', n: '₹3.2L saved', x: 24, y: 92 },
    { id: 'flo', m: 'insurance', who: ['arjun', 'meera', 'nila'], t: 'Family health cover', n: '₹10L, renews 12 Aug', x: 66, y: 66 },
    { id: 'fd', m: 'money', who: ['paati'], t: 'Senior citizen FD', n: 'Matures 1 June', x: 7, y: 70 },
    { id: 'sen', m: 'insurance', who: ['paati'], t: 'Senior health plan', n: 'Premium due July', x: 7, y: 30 },
    { id: 'puc', m: 'documents', who: ['arjun'], t: 'Car PUC', n: 'Due in 9 days', urgent: true, x: 34, y: 34 },
    { id: 'bd', m: 'calendar', who: ['paati'], t: 'Paati turns 75', n: '14 June', x: 32, y: 68 }
  ];
  var stage = document.querySelector('.stage');
  if (stage) {
    var svg = stage.querySelector('.lines'), ns = 'http://www.w3.org/2000/svg';
    var sel = null, threads = [], spokes = {}, nodes = {}, people = {};
    MEMBERS.forEach(function (m) {
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 50); l.setAttribute('y1', 50); l.setAttribute('x2', m.x); l.setAttribute('y2', m.y); l.setAttribute('class', 'spoke');
      svg.appendChild(l); spokes[m.id] = l;
    });
    ITEMS.forEach(function (it) {
      it.who.forEach(function (w) {
        var m = MEMBERS.filter(function (x) { return x.id === w; })[0];
        var l = document.createElementNS(ns, 'line');
        l.setAttribute('x1', m.x); l.setAttribute('y1', m.y); l.setAttribute('x2', it.x); l.setAttribute('y2', it.y);
        l.setAttribute('class', 'thread'); l.style.stroke = C[it.m];
        svg.appendChild(l); threads.push({ el: l, it: it });
      });
    });
    MEMBERS.forEach(function (m, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'person'; b.style.left = m.x + '%'; b.style.top = m.y + '%'; b.style.animationDelay = (0.2 + i * 0.08) + 's';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="avatar">' + ((window.KPEOPLE && window.KPEOPLE[m.id]) || m.name[0]) + '</span><span class="pname">' + m.name + '<small>' + m.role + '</small></span>';
      b.addEventListener('click', function () { choose(sel === m.id ? null : m.id); });
      stage.appendChild(b); people[m.id] = b;
    });
    ITEMS.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'node' + (it.urgent ? ' urgent' : ''); d.style.left = it.x + '%'; d.style.top = it.y + '%';
      d.style.setProperty('--c', C[it.m]); d.style.animationDelay = (0.55 + i * 0.05) + 's';
      d.innerHTML = '<i></i><span>' + it.t + '</span>';
      stage.appendChild(d); nodes[it.id] = d;
    });
    var pick = document.querySelector('.pick'), head = document.querySelector('.readout-head'), list = document.querySelector('.readout-list');
    var pickBtns = {};
    MEMBERS.concat([{ id: null, name: 'Everyone' }]).forEach(function (m) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = m.name;
      b.addEventListener('click', function () { userPicked = true; choose(m.id); });
      pick.appendChild(b); pickBtns[m.id === null ? '_all' : m.id] = b;
    });
    var userPicked = false;
    function choose(id) {
      sel = id;
      var lit = function (it) { return !sel || it.who.indexOf(sel) >= 0; };
      threads.forEach(function (t) { t.el.classList.toggle('dim', !lit(t.it)); t.el.classList.toggle('on', !!sel && lit(t.it)); });
      ITEMS.forEach(function (it) { nodes[it.id].classList.toggle('dim', !lit(it)); });
      MEMBERS.forEach(function (m) {
        people[m.id].classList.toggle('on', sel === m.id); people[m.id].classList.toggle('dim', !!sel && sel !== m.id);
        people[m.id].setAttribute('aria-pressed', sel === m.id ? 'true' : 'false');
      });
      Object.keys(pickBtns).forEach(function (k) { pickBtns[k].classList.toggle('on', (k === '_all' && !sel) || k === sel); });
      var mine = sel ? ITEMS.filter(lit) : ITEMS.filter(function (it) { return it.urgent || ['fees', 'fd', 'flo'].indexOf(it.id) >= 0; });
      var p = MEMBERS.filter(function (m) { return m.id === sel; })[0];
      head.innerHTML = p ? '<b>' + p.name + '</b>: ' + mine.length + ' things' : '<b>This week</b> for the family';
      list.innerHTML = mine.map(function (it) {
        return '<li style="--c:' + C[it.m] + '"><b>' + it.t + '</b><span class="' + (it.urgent ? 'urgent' : '') + '">' + it.n + '</span></li>';
      }).join('');
    }
    choose(null);
    // Gentle tour until the visitor interacts
    if (!reduce) {
      var order = ['arjun', 'meera', 'nila', 'paati', null], k = 0;
      stage.addEventListener('pointerenter', function () { userPicked = true; });
      Object.keys(people).forEach(function (id) { people[id].addEventListener('click', function () { userPicked = true; }); });
      var tour = setInterval(function () { if (userPicked) { clearInterval(tour); return; } choose(order[k++ % order.length]); }, 2600);
    }
  }

  // ── Faces anywhere: <i class="face" data-p="arjun"> ────────────
  if (window.KPEOPLE) document.querySelectorAll('.face[data-p]').forEach(function (el) { el.innerHTML = window.KPEOPLE[el.getAttribute('data-p')] || ''; });

  // ── Calendar dots ───────────────────────────────────────────────
  var month = document.querySelector('.month');
  if (month) {
    var marks = { 1: 'money', 5: 'money', 10: 'calendar', 12: 'insurance', 14: 'calendar', 20: 'loans', 24: 'documents' };
    var html = '';
    for (var d = 1; d <= 30; d++) html += '<span class="' + (marks[d] ? 'on' : '') + '"' + (marks[d] ? ' style="--c:' + C[marks[d]] + ';transition-delay:' + (d * 0.03) + 's"' : '') + '>' + d + '</span>';
    month.innerHTML = html;
  }

  // ── Reveal on scroll ────────────────────────────────────────────
  var revealables = document.querySelectorAll('.reveal, .june, .phone-sec, #rooms .b');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.25 });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('in'); });
  }

  // ── Product tabs (auto-rotate until the visitor picks one) ─────
  var tabs = document.querySelectorAll('.tabs button'), views = document.querySelectorAll('.view'), tabWrap = document.querySelector('.tabs');
  var vi = 0, auto = !reduce, timer = null;
  function show(i) {
    vi = i;
    tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); t.style.animation = 'none'; t.offsetHeight; t.style.animation = ''; });
    views.forEach(function (v) { v.classList.toggle('on', v.getAttribute('data-v') === tabs[i].getAttribute('data-v')); });
    if (tabs[i].getAttribute('data-v') === 'dash') countUp();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { auto = false; tabWrap.classList.add('paused'); clearInterval(timer); show(i); });
  });
  var seeSec = document.getElementById('see');
  if (seeSec && 'IntersectionObserver' in window) {
    var started = false;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && !started) {
          started = true; show(0);
          if (auto) timer = setInterval(function () { if (auto) show((vi + 1) % tabs.length); }, 6000);
        }
      });
    }, { threshold: 0.3 }).observe(seeSec);
  }
  if (reduce) tabWrap && tabWrap.classList.add('paused');

  function inr(v) {
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  function countUp() {
    var el = document.querySelector('.count'); if (!el) return;
    var to = +el.getAttribute('data-to'), t0 = null, dur = reduce ? 1 : 1200;
    function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); el.textContent = inr(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  // ── Retire-when slider ──────────────────────────────────────────
  var sip = document.getElementById('sip');
  if (sip) {
    var out = document.getElementById('sip-out'), age = document.getElementById('ret-age');
    var need = document.getElementById('sl-need'), have = document.getElementById('sl-have'), dot = document.getElementById('sl-dot');
    var AGE = 32, START = 1000000, SPEND = 60000, R = 0.11, INF = 0.06, SWR = 0.04, STEP = 0.05, H = 38;
    function sim(m) {
      var c = START, rows = [], cross = null;
      for (var y = 0; y <= H; y++) {
        var magic = SPEND * 12 * Math.pow(1 + INF, y) / SWR;
        rows.push([c, magic]);
        if (cross === null && c >= magic) cross = y;
        c = c * (1 + R) + m * 12 * Math.pow(1 + STEP, y);
      }
      return { rows: rows, cross: cross };
    }
    var maxV = sim(150000).rows[H][0];
    function path(rows, idx) {
      return rows.map(function (r, i) {
        var x = (i / H) * 320, y = 155 - Math.min(1, Math.sqrt(r[idx] / maxV)) * 150;
        return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
    }
    function update() {
      var m = +sip.value, s = sim(m);
      out.textContent = '₹' + m.toLocaleString('en-IN');
      sip.style.setProperty('--fill', ((m - 5000) / (150000 - 5000) * 100) + '%');
      age.textContent = s.cross === null ? '70+' : String(AGE + s.cross);
      age.classList.toggle('late', s.cross === null || AGE + s.cross > 58);
      need.setAttribute('d', path(s.rows, 1)); have.setAttribute('d', path(s.rows, 0));
      if (s.cross !== null) {
        var r = s.rows[s.cross];
        dot.setAttribute('cx', ((s.cross / H) * 320).toFixed(1)); dot.setAttribute('cy', (155 - Math.min(1, Math.sqrt(r[0] / maxV)) * 150).toFixed(1)); dot.style.opacity = 1;
      } else dot.style.opacity = 0;
    }
    sip.addEventListener('input', update); update();
  }

  // ── Flow lines (sources → hub → modules) ───────────────────────
  var flow = document.querySelector('.flow');
  function drawFlow() {
    var g = flow && flow.querySelector('.paths'); if (!g || window.innerWidth <= 1020) return;
    var box = flow.getBoundingClientRect(), hub = flow.querySelector('.hub').getBoundingClientRect();
    var sv = flow.querySelector('.flow-svg'); sv.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
    var hx = hub.left - box.left + hub.width / 2, hy = hub.top - box.top + hub.height / 2, out = '';
    flow.querySelectorAll('.src li').forEach(function (li) {
      var r = li.getBoundingClientRect(), x = r.right - box.left, y = r.top - box.top + r.height / 2;
      out += '<path stroke="var(--ink-3)" d="M' + x + ' ' + y + ' C' + (x + 80) + ' ' + y + ' ' + (hx - 120) + ' ' + hy + ' ' + (hx - hub.width / 2) + ' ' + hy + '"/>';
    });
    flow.querySelectorAll('.dst li').forEach(function (li) {
      var r = li.getBoundingClientRect(), x = r.left - box.left, y = r.top - box.top + r.height / 2;
      out += '<path stroke="' + getComputedStyle(li).getPropertyValue('--c') + '" d="M' + (hx + hub.width / 2) + ' ' + hy + ' C' + (hx + 120) + ' ' + hy + ' ' + (x - 80) + ' ' + y + ' ' + x + ' ' + y + '"/>';
    });
    g.innerHTML = out;
  }
  window.addEventListener('load', drawFlow);
  window.addEventListener('resize', function () { clearTimeout(drawFlow.t); drawFlow.t = setTimeout(drawFlow, 150); });
})();
