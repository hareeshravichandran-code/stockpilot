/* Kanalyst — kanalyst.in interactions. No libraries. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = { money: 'var(--moss)', goals: 'var(--aubergine)', loans: 'var(--terracotta)', insurance: 'var(--prussian)', documents: 'var(--mulberry)', calendar: 'var(--marigold)' };

  // ── Nav border once scrolled ─────────────────────────────────────
  var nav = document.querySelector('.nav');
  window.addEventListener('scroll', function () { nav && nav.classList.toggle('scrolled', window.scrollY > 8); }, { passive: true });

  // ── Family map ──────────────────────────────────────────────────
  var MEMBERS = [
    { id: 'arjun', name: 'Arjun', role: 'You', x: 50, y: 24 },
    { id: 'meera', name: 'Meera', role: 'Partner', x: 76, y: 50 },
    { id: 'nila', name: 'Nila', role: 'Daughter, 8', x: 50, y: 76 },
    { id: 'paati', name: 'Paati', role: 'Grandmother', x: 24, y: 50 }
  ];
  var ITEMS = [
    { id: 'loan', m: 'loans', who: ['arjun', 'meera'], t: 'Home loan', n: '₹28L left', x: 76, y: 8 },
    { id: 'term', m: 'insurance', who: ['arjun'], t: 'Term cover', n: '₹1.5Cr', x: 24, y: 8 },
    { id: 'sip', m: 'money', who: ['arjun', 'meera'], t: 'SIPs', n: '₹35K / mo', x: 93, y: 28 },
    { id: 'ret', m: 'goals', who: ['arjun', 'meera'], t: 'Retirement', n: 'On track', x: 93, y: 72 },
    { id: 'pass', m: 'documents', who: ['meera'], t: 'Passport', n: 'Feb 2027', x: 76, y: 92 },
    { id: 'fees', m: 'calendar', who: ['nila'], t: 'School fees', n: '10 June', x: 50, y: 96 },
    { id: 'ssy', m: 'money', who: ['nila'], t: 'Sukanya', n: '₹3.2L', x: 24, y: 92 },
    { id: 'flo', m: 'insurance', who: ['arjun', 'meera', 'nila'], t: 'Family health', n: 'Renews Aug', x: 67, y: 65 },
    { id: 'fd', m: 'money', who: ['paati'], t: 'Senior FD', n: '1 June', x: 7, y: 72 },
    { id: 'sen', m: 'insurance', who: ['paati'], t: 'Senior health', n: 'July', x: 7, y: 28 },
    { id: 'puc', m: 'documents', who: ['arjun'], t: 'Car PUC', n: '9 days', urgent: true, x: 33, y: 33 },
    { id: 'bd', m: 'calendar', who: ['paati'], t: 'Paati turns 75', n: '14 June', x: 33, y: 67 }
  ];
  var stage = document.querySelector('.stage');
  if (stage) {
    var svg = stage.querySelector('.lines'), ns = 'http://www.w3.org/2000/svg';
    var sel = null, threads = [], nodes = {}, people = {};
    MEMBERS.forEach(function (m) {
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 50); l.setAttribute('y1', 50); l.setAttribute('x2', m.x); l.setAttribute('y2', m.y); l.setAttribute('class', 'spoke');
      svg.appendChild(l);
    });
    ITEMS.forEach(function (it) {
      it.who.forEach(function (w) {
        var m = MEMBERS.filter(function (x) { return x.id === w; })[0];
        // a gentle curve from person to item
        var mx = (m.x + it.x) / 2 + (it.y - m.y) * 0.12, my = (m.y + it.y) / 2 - (it.x - m.x) * 0.12;
        var p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M' + m.x + ' ' + m.y + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + it.x + ' ' + it.y);
        p.setAttribute('class', 'thread'); p.style.stroke = C[it.m];
        svg.appendChild(p); threads.push({ el: p, it: it });
      });
    });
    MEMBERS.forEach(function (m, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'person'; b.style.left = m.x + '%'; b.style.top = m.y + '%'; b.style.animationDelay = (0.25 + i * 0.09) + 's';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="avatar">' + ((window.KPEOPLE && window.KPEOPLE[m.id]) || m.name[0]) + '</span><span class="pname">' + m.name + '<small>' + m.role + '</small></span>';
      b.addEventListener('click', function () { userPicked = true; choose(sel === m.id ? null : m.id); });
      stage.appendChild(b); people[m.id] = b;
    });
    ITEMS.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'node' + (it.urgent ? ' urgent' : ''); d.style.left = it.x + '%'; d.style.top = it.y + '%';
      d.style.setProperty('--c', C[it.m]); d.style.animationDelay = (0.6 + i * 0.05) + 's';
      d.innerHTML = '<i></i><span>' + it.t + '</span><em>· ' + it.n + '</em>';
      d.addEventListener('mouseenter', function () { userPicked = true; });
      stage.appendChild(d); nodes[it.id] = d;
    });
    var pick = document.querySelector('.pick'), head = document.querySelector('.readout-head'), list = document.querySelector('.readout-list');
    var pickBtns = {};
    [{ id: null, name: 'Everyone' }].concat(MEMBERS).forEach(function (m) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = m.name;
      b.addEventListener('click', function () { userPicked = true; choose(m.id); });
      pick.appendChild(b); pickBtns[m.id === null ? '_all' : m.id] = b;
    });
    var userPicked = false;
    function choose(id) {
      sel = id;
      var lit = function (it) { return !sel || it.who.indexOf(sel) >= 0; };
      threads.forEach(function (t) { t.el.classList.toggle('dim', !lit(t.it)); t.el.classList.toggle('on', !!sel && lit(t.it)); });
      ITEMS.forEach(function (it) { nodes[it.id].classList.toggle('dim', !lit(it)); nodes[it.id].classList.toggle('lit', !!sel && lit(it)); });
      MEMBERS.forEach(function (m) {
        people[m.id].classList.toggle('on', sel === m.id); people[m.id].classList.toggle('dim', !!sel && sel !== m.id);
        people[m.id].setAttribute('aria-pressed', sel === m.id ? 'true' : 'false');
      });
      Object.keys(pickBtns).forEach(function (k) { pickBtns[k].classList.toggle('on', (k === '_all' && !sel) || k === sel); });
      var mine = sel ? ITEMS.filter(lit) : ITEMS.filter(function (it) { return it.urgent || ['fees', 'fd', 'flo'].indexOf(it.id) >= 0; });
      var p = MEMBERS.filter(function (m) { return m.id === sel; })[0];
      head.innerHTML = p ? '<b>' + p.name + '</b> · ' + mine.length + ' things' : '<b>This week</b> · whole family';
      list.innerHTML = mine.slice(0, 4).map(function (it) {
        return '<li style="--c:' + C[it.m] + '"><b>' + it.t + '</b><span class="' + (it.urgent ? 'urgent' : '') + '">' + it.n + '</span></li>';
      }).join('');
    }
    choose(null);
    // Gentle tour until the visitor interacts
    if (!reduce) {
      var order = ['arjun', 'meera', 'nila', 'paati', null], k = 0;
      var tour = setInterval(function () { if (userPicked) { clearInterval(tour); return; } choose(order[k++ % order.length]); }, 2800);
    }
  }

  // ── Faces anywhere: <i class="face" data-p="arjun"> ────────────
  if (window.KPEOPLE) document.querySelectorAll('.face[data-p]').forEach(function (el) { el.innerHTML = window.KPEOPLE[el.getAttribute('data-p')] || ''; });

  // ── Net worth count-up ─────────────────────────────────────────
  function inr(v) {
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  function countUp(el) {
    var to = +el.getAttribute('data-to'), t0 = null, dur = reduce ? 1 : 1400;
    function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); el.textContent = inr(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  // ── Scramble the "what we store" line ──────────────────────────
  function scramble(el) {
    var target = el.getAttribute('data-text'), chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', n = 0;
    var t = setInterval(function () {
      n++;
      el.textContent = target.split('').map(function (ch, i) { return i < n * 1.5 ? ch : chars[Math.floor(Math.random() * chars.length)]; }).join('');
      if (n * 1.5 >= target.length) clearInterval(t);
    }, 40);
  }

  // ── Calendar dots ───────────────────────────────────────────────
  var month = document.querySelector('.month');
  if (month) {
    var marks = { 1: 'money', 5: 'money', 10: 'calendar', 12: 'insurance', 14: 'calendar', 20: 'loans', 24: 'documents' };
    var html = '';
    for (var d = 1; d <= 30; d++) html += '<span class="' + (marks[d] ? 'on' : '') + '"' + (marks[d] ? ' style="--c:' + C[marks[d]] + ';transition-delay:' + (d * 0.03) + 's"' : '') + '>' + d + '</span>';
    month.innerHTML = html;
  }

  // ── Product tabs (auto-rotate until the visitor picks one) ─────
  var tabs = document.querySelectorAll('.tabs button'), views = document.querySelectorAll('.view'), tabWrap = document.querySelector('.tabs');
  var vi = 0, auto = !reduce, timer = null;
  function show(i) {
    vi = i;
    tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); t.style.animation = 'none'; t.offsetHeight; t.style.animation = ''; });
    views.forEach(function (v) { v.classList.toggle('on', v.getAttribute('data-v') === tabs[i].getAttribute('data-v')); });
    if (tabs[i].getAttribute('data-v') === 'dash') { var ce = document.querySelector('.count'); if (ce) countUp(ce); }
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
  // ── Reveal on scroll ────────────────────────────────────────────
  var revealables = document.querySelectorAll('.reveal, .june');
  function onIn(el) {
    el.classList.add('in');
    var c = el.querySelector('.nw-v'); if (c) countUp(c);
    var e = el.querySelector('.c-enc'); if (e && !reduce) scramble(e);
  }
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { onIn(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.2 });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(onIn);
  }
})();
