/* Kanalyst — the family walks the page.
 * Arjun, Meera, Paati and Nila leave the map in the hero and follow the visitor down the page, each to
 * the rooms that are theirs; Nila hops across the card tops. At the end they line up beside Start free.
 * Built on GSAP ScrollTrigger (scrub) + MotionPathPlugin. Desktop with a mouse only, never under reduced
 * motion; phones get the closing line-up. Uses transforms only. */
(function () {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger || !window.KPEOPLE) return;
  gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desktop = window.matchMedia('(min-width: 1080px) and (hover: hover) and (pointer: fine)');
  var HIDE_KEY = 'k-family-hidden';
  var hidden = false;
  try { hidden = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* private mode */ }

  var WHO = ['arjun', 'meera', 'paati', 'nila'];
  var NAME = { arjun: 'Arjun', meera: 'Meera', paati: 'Paati', nila: 'Nila' };
  // Where each one goes, top to bottom. a = anchor on the target [x 0..1, y 0..1], d = nudge in px, hop = jump arc.
  var ROUTES = {
    arjun: [
      { s: '.b.documents', a: [0.82, 0], d: [0, 2] },
      { s: '#see .window', a: [0.1, 0], d: [0, 2] },
      { s: '.cipher', a: [0.08, 0], d: [0, 2] },
      { s: '.motto', a: [0.12, 0], d: [0, 2] }
    ],
    meera: [
      { s: '.b.spend', a: [0.62, 0], d: [0, 2] },
      { s: '#flow .src li:first-child', a: [0.86, 0], d: [0, 2] },
      { s: '.trio > div:nth-child(3)', a: [0.15, 0], d: [0, -6] },
      { s: '.motto', a: [0.24, 0], d: [0, 2] }
    ],
    paati: [
      { s: '.b.insurance', a: [0.74, 0], d: [0, 2] },
      { s: '#see .window', a: [0.9, 0], d: [0, 2] },
      { s: '.trio > div:nth-child(1)', a: [0.2, 0], d: [0, -6] },
      { s: '.about .mail', a: [0.8, 0], d: [0, 2] }
    ],
    nila: [
      { s: '.b.money', a: [0.18, 0], d: [0, 2], hop: 1 },
      { s: '.b.calendar', a: [0.5, 0], d: [0, 2], hop: 1, poke: '.month span.on' },
      { s: '#flow .dst li:last-child', a: [0.5, 0], d: [0, 2], hop: 1 },
      { s: '.june .line li:first-child', a: [0, 0.5], d: [-2, 2] },
      { s: '.june .line li:last-child', a: [0, 0.5], d: [-2, 2], walk: 1 },
      { s: '.net', a: [0.5, 0.5], d: [0, -6], hop: 1 }
    ]
  };

  var layer, walkers = {}, tl = null, idle = {}, lastPos = {};

  // Full-body characters: the head is taken from each portrait (people.js), the body is drawn here with
  // arms and legs that pivot at the shoulder and hip, so they can walk, jump, wave and point.
  var LOOK = {
    arjun: { skin: '#b07650', top: '#b8551f', bottom: '#2a3550', shoe: '#1a1612', kid: 0, skirt: 0 },
    meera: { skin: '#c58a5f', top: '#e3a018', bottom: '#964062', shoe: '#5a2a1a', kid: 0, skirt: 1, sash: '#b8551f' },
    paati: { skin: '#a8714d', top: '#5d3b78', bottom: '#5d3b78', shoe: '#3a2a20', kid: 0, skirt: 2 },
    nila:  { skin: '#c99064', top: '#2d6b6b', bottom: '#2d6b6b', shoe: '#964062', kid: 1, skirt: 1 }
  };
  function headOf(id) {
    var svg = window.KPEOPLE[id];
    var inner = svg.slice(svg.indexOf('<g clip-path'), svg.lastIndexOf('</g>'));
    inner = inner.replace(/^<g clip-path="[^"]*">/, '')
      .replace(/<rect width="100" height="100"[^>]*\/>/, '')
      .replace(/<circle cx="50" cy="44" r="30"[^>]*\/>/, '');
    return '<clipPath id="kh-' + id + '"><rect x="0" y="0" width="100" height="' + (LOOK[id].kid ? 71 : 68) + '"/></clipPath>' +
      '<g clip-path="url(#kh-' + id + ')">' + inner + '</g>';
  }
  function rigSVG(id) {
    var L = LOOK[id], kid = L.kid;
    var sh = kid ? 80 : 74, hip = kid ? 112 : 120, leg = kid ? 30 : 42, arm = kid ? 30 : 40, H = hip + leg + 10;
    var limb = function (cls, ox, oy, inner) { return '<g class="' + cls + '" style="transform-origin:' + ox + 'px ' + oy + 'px">' + inner + '</g>'; };
    var legG = function (cls, x) {
      return limb('leg ' + cls, x, hip, '<rect x="' + (x - 4.5) + '" y="' + (hip - 4) + '" width="9" height="' + (leg + 4) + '" rx="4.5" fill="' + (L.skirt ? L.skin : L.bottom) + '"/>' +
        '<ellipse cx="' + (x + 2) + '" cy="' + (hip + leg + 2) + '" rx="7" ry="4.5" fill="' + L.shoe + '"/>');
    };
    var armG = function (cls, x) {
      return limb('arm ' + cls, x, sh, '<rect x="' + (x - 4) + '" y="' + (sh - 3) + '" width="8" height="' + (arm + 3) + '" rx="4" fill="' + L.skin + '"/>' +
        '<rect x="' + (x - 4.5) + '" y="' + (sh - 4) + '" width="9" height="' + (kid ? 12 : 16) + '" rx="4.5" fill="' + L.top + '"/>' +
        '<circle cx="' + x + '" cy="' + (sh + arm) + '" r="4.6" fill="' + L.skin + '"/>');
    };
    var torso;
    if (L.skirt === 2) torso = '<path d="M34 ' + (sh - 6) + ' Q50 ' + (sh - 10) + ' 66 ' + (sh - 6) + ' L72 ' + (hip + leg - 4) + ' Q50 ' + (hip + leg + 2) + ' 28 ' + (hip + leg - 4) + ' Z" fill="' + L.top + '"/>' +
      '<path d="M60 ' + (sh - 6) + ' L72 ' + (hip + leg - 6) + ' L62 ' + (hip + leg - 4) + ' Z" fill="#fff" opacity=".12"/>';
    else if (L.skirt === 1) torso = '<path d="M35 ' + (sh - 6) + ' Q50 ' + (sh - 10) + ' 65 ' + (sh - 6) + ' L70 ' + (hip + (kid ? 6 : 10)) + ' Q50 ' + (hip + (kid ? 10 : 14)) + ' 30 ' + (hip + (kid ? 6 : 10)) + ' Z" fill="' + L.top + '"/>' +
      (L.sash ? '<path d="M58 ' + (sh - 6) + ' L66 ' + (sh - 4) + ' L46 ' + (hip + 8) + ' L40 ' + (hip + 4) + ' Z" fill="' + L.sash + '"/>' : '<path d="M42 ' + (sh - 6) + ' Q50 ' + (sh) + ' 58 ' + (sh - 6) + '" fill="#faf5e8"/>');
    else torso = '<rect x="34" y="' + (sh - 7) + '" width="32" height="' + (hip - sh + 9) + '" rx="10" fill="' + L.top + '"/>' +
      '<path d="M43 ' + (sh - 7) + ' L50 ' + (sh + 2) + ' L57 ' + (sh - 7) + ' Z" fill="#faf5e8"/>' +
      '<rect x="35" y="' + (hip - 6) + '" width="30" height="8" rx="3" fill="' + L.bottom + '"/>';
    return '<svg class="rig" viewBox="0 0 100 ' + H + '" width="68" height="' + Math.round(68 * H / 100) + '" aria-hidden="true">' +
      '<g class="fig">' + armG('a-back', 35) + legG('l-a', 44) + legG('l-b', 56) +
      '<g class="torso">' + torso + '</g>' + headOf(id) + armG('a-front', 65) + '</g></svg>';
  }

  function makeLayer() {
    layer = document.createElement('div');
    layer.className = 'troupe';
    layer.setAttribute('aria-hidden', 'true');
    WHO.forEach(function (id) {
      var w = document.createElement('div');
      w.className = 'walker w-' + id + (LOOK[id].kid ? ' kid' : '');
      w.innerHTML = '<span class="w-shadow"></span><span class="w-body"><span class="w-lean">' + rigSVG(id) + '</span></span><span class="w-name">' + NAME[id] + '</span>';
      layer.appendChild(w); walkers[id] = w;
    });
    document.body.appendChild(layer);
  }

  // Document coordinates of an anchor point on an element
  function pt(el, a, d) {
    var r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX + r.width * a[0] + (d ? d[0] : 0), y: r.top + window.scrollY + r.height * a[1] + (d ? d[1] : 0) };
  }
  function heroPoint(id) {
    var btn, people = document.querySelectorAll('.stage .person');
    var map = { arjun: 0, meera: 1, nila: 2, paati: 3 };     // order the map draws them in
    btn = people[map[id]];
    return btn ? pt(btn.querySelector('.avatar'), [0.5, 1], [0, 0]) : { x: 200, y: 400 };
  }
  // The end: a row between the heading and Start free
  function endSlots() {
    var h = document.querySelector('.end h2'), b = document.querySelector('.end .btn');
    if (!h || !b) return null;
    var hp = h.getBoundingClientRect(), bp = b.getBoundingClientRect();
    var left = hp.right + window.scrollX + 30, btnL = bp.left + window.scrollX, base = bp.bottom + window.scrollY + 4;
    var right = btnL - 78;                                   // room for Nila
    var gap = Math.min(86, (right - left) / 3);
    // arjun, meera, paati in a row; nila right against the button
    return WHO.map(function (id, i) { return id === 'nila' ? { x: btnL - 14, y: base } : { x: right - gap * (2 - i), y: base }; });
  }
  // Scroll position (0..1) at which an element sits comfortably in view
  function progressFor(el, frac) {
    var max = ScrollTrigger.maxScroll(window) || 1;
    var top = el.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.min(1, (top - window.innerHeight * (frac || 0.58)) / max));
  }

  function build() {
    if (tl) { tl.scrollTrigger && tl.scrollTrigger.kill(); tl.kill(); tl = null; }
    var ends = endSlots(); if (!ends) return;
    var endEl = document.querySelector('.end');
    var pEnd = Math.min(0.995, progressFor(endEl, 0.7));
    tl = gsap.timeline({ defaults: { ease: 'none' }, paused: true });
    tl.to({}, { duration: 0.001 }, 0.999);                 // the timeline spans 0..1 = top..bottom of the page

    WHO.forEach(function (id, wi) {
      var w = walkers[id], body = w.querySelector('.w-body');
      var from = heroPoint(id);
      gsap.set(w, { x: from.x, y: from.y, autoAlpha: 0 });
      var prevT = 0.004 + wi * 0.002, prev = from;
      // Jump out of the map
      tl.to(w, { autoAlpha: 1, duration: 0.004 }, prevT)
        .to(w, { motionPath: { path: [{ x: prev.x, y: prev.y }, { x: prev.x + (wi % 2 ? 26 : -26), y: prev.y - 70 }, { x: prev.x + (wi % 2 ? 40 : -40), y: prev.y + 30 }], curviness: 1.3 }, duration: 0.03 }, prevT);
      prev = { x: prev.x + (wi % 2 ? 40 : -40), y: prev.y + 30 };
      prevT += 0.034;

      ROUTES[id].forEach(function (stop) {
        var el = document.querySelector(stop.s); if (!el) return;
        var to = pt(el, stop.a, stop.d);
        var t = progressFor(el, stop.hop ? 0.62 : 0.6);
        if (t <= prevT + 0.012) t = prevT + 0.012;          // always move forward in time
        if (t > pEnd - 0.02) t = pEnd - 0.02;
        var dur = Math.max(0.008, t - prevT);
        if (stop.hop) {
          tl.to(body, { scaleY: 0.86, scaleX: 1.1, duration: 0.003, ease: 'power2.in' }, Math.max(0, prevT - 0.003))
            .to(body, { scaleY: 1, scaleX: 1, duration: 0.003, ease: 'power2.out' }, prevT);
          var peak = Math.min(prev.y, to.y) - 90;
          tl.to(w, { motionPath: { path: [{ x: prev.x, y: prev.y }, { x: (prev.x + to.x) / 2, y: peak }, { x: to.x, y: to.y }], curviness: 1.4 }, duration: dur, ease: 'power1.inOut' }, prevT);
        } else {
          tl.to(w, { x: to.x, y: to.y, duration: dur, ease: stop.walk ? 'none' : 'power1.inOut' }, prevT);
        }
        // Landing squash, then she/he settles
        tl.to(body, { scaleY: 0.84, scaleX: 1.12, duration: 0.0025, ease: 'power2.out' }, t)
          .to(body, { scaleY: 1, scaleX: 1, duration: 0.004, ease: 'back.out(3)' }, t + 0.0025);
        if (stop.poke) tl.call(poke, [stop.poke, el], t);
        prev = to; prevT = t + 0.012;
      });

      // Everyone home: line up beside Start free
      var slot = ends[wi];
      var dEnd = Math.max(0.01, pEnd - prevT);
      tl.to(w, { motionPath: { path: [{ x: prev.x, y: prev.y }, { x: (prev.x + slot.x) / 2, y: Math.min(prev.y, slot.y) - 60 }, { x: slot.x, y: slot.y }], curviness: 1 }, duration: dEnd, ease: 'power1.inOut' }, prevT);
    });
    tl.call(function () { layer.classList.add('home'); WHO.forEach(function (id) { walkers[id].classList.remove('left'); }); }, null, pEnd)
      .call(function () { layer.classList.remove('home'); }, null, pEnd - 0.001);

    ScrollTrigger.create({
      trigger: document.documentElement, start: 0, end: 'max', scrub: 0.8, animation: tl,
      onUpdate: track
    });
    // The map's seats empty while the family is away
    ScrollTrigger.create({ trigger: document.documentElement, start: 30, end: 'max', toggleClass: { targets: '.stage', className: 'away' } });
  }

  function poke(sel, card) {
    var bits = card.querySelectorAll(sel); if (!bits.length) return;
    var b = bits[Math.floor(Math.random() * bits.length)];
    gsap.fromTo(b, { scale: 1 }, { scale: 1.35, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' });
  }

  // Feet move only while that person is moving; they face where they walk
  var leanTo = {};
  function secondary(id, dx, dy) {
    var w = walkers[id], el = w.querySelector('.w-lean');
    if (!leanTo[id]) leanTo[id] = {
      r: gsap.quickTo(el, 'rotation', { duration: 0.35, ease: 'power3.out' }),
      sy: gsap.quickTo(el, 'scaleY', { duration: 0.25, ease: 'power2.out' }),
      sx: gsap.quickTo(el, 'scaleX', { duration: 0.25, ease: 'power2.out' })
    };
    var lean = Math.max(-11, Math.min(11, dx * 0.9));
    var st = dy < -1.5 ? Math.min(0.12, -dy * 0.012) : 0;           // stretch going up
    leanTo[id].r(lean); leanTo[id].sy(1 + st); leanTo[id].sx(1 - st * 0.6);
  }
  function settle(id) { if (leanTo[id]) { leanTo[id].r(0); leanTo[id].sy(1); leanTo[id].sx(1); } }
  function track() {
    WHO.forEach(function (id) {
      var w = walkers[id], x = gsap.getProperty(w, 'x'), y = gsap.getProperty(w, 'y'), p = lastPos[id];
      if (p && (Math.abs(x - p.x) > 0.6 || Math.abs(y - p.y) > 0.6)) {
        var dx = x - p.x, dy = y - p.y;
        w.classList.add('moving');
        w.classList.toggle('up', dy < -1.2 && Math.abs(dy) > Math.abs(dx) * 0.5);       // going up: jump pose
        w.classList.toggle('down', dy > 3 && Math.abs(dy) > Math.abs(dx) * 1.2);        // dropping down the page
        if (Math.abs(dx) > 0.6) w.classList.toggle('left', dx < 0);
        secondary(id, dx, dy);
        clearTimeout(idle[id]);
        idle[id] = setTimeout(function () { w.classList.remove('moving', 'up', 'down'); settle(id); }, 170);
      }
      lastPos[id] = { x: x, y: y };
    });
  }

  // Hide / show switch
  function makeSwitch() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'fam-switch';
    var paint = function () { b.textContent = hidden ? 'Show the family' : 'Hide the family'; b.setAttribute('aria-pressed', hidden ? 'true' : 'false'); };
    b.addEventListener('click', function () {
      hidden = !hidden; paint();
      try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch (e) { /* ignore */ }
      document.documentElement.classList.toggle('family-hidden', hidden);
    });
    paint(); document.body.appendChild(b);
  }

  // Phones, tablets, reduced motion: the family simply waits at the end
  function staticEnd() {
    var end = document.querySelector('.end'); if (!end || end.querySelector('.end-family')) return;
    var row = document.createElement('div'); row.className = 'end-family'; row.setAttribute('aria-hidden', 'true');
    row.innerHTML = WHO.map(function (id) { return '<span class="ef ef-' + id + (LOOK[id].kid ? ' kid' : '') + '">' + rigSVG(id) + '</span>'; }).join('');
    end.insertBefore(row, end.querySelector('.btn'));
    if ('IntersectionObserver' in window && !reduce) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { row.classList.add('in'); io.disconnect(); } }, { threshold: 0.6 });
      io.observe(row);
    } else row.classList.add('in');
  }

  function start() {
    document.documentElement.classList.toggle('family-hidden', hidden);
    if (reduce || !desktop.matches) { staticEnd(); return; }
    makeLayer(); makeSwitch(); build();
    var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { if (desktop.matches) { build(); ScrollTrigger.refresh(); } }, 250); });
  }
  // Wait for fonts and layout so the anchors are where they will stay
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestAnimationFrame(start); });
  else window.addEventListener('load', start);
})();
