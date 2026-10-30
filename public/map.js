// HG-6 prototype reveal: "Territory you walk" + "Pull from the ground". Only loaded behind ?reveal=map.
import { nativePct, resistanceFor, pullOutcome, motionPlan, pickSpots, loadWalk, saveWalk, pathStyle, nearSpot, MAP_W, MAP_H, seeded, safeStorage, sameSpot } from './maplogic.js';
let maskSeq = 0; // unique mask id per map instance
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

export function createMapReveal({ h, city, getResults, picks, pickCard, reduced, ping }) {
  const motion = motionPlan(reduced);
  const wrap = h('div', { class: 'map-wrap' });
  const svg = s('svg', { viewBox: `0 0 ${MAP_W} ${MAP_H}`, class: 'map', role: 'group', 'aria-label': `Map of ${city.name}. Drag to walk; picks are buttons.` });
  wrap.append(svg);
  const store = safeStorage(); let paths = loadWalk(store, city.id), spots = [], current = null, dwell = null;

  // Static streets: a faint seeded grid, so the city feels like a place, not a chart.
  const streets = s('g', { class: 'streets' }); const r = seeded(`streets|${city.id}`);
  for (let i = 0; i < 14; i++) streets.append(s('line', { x1: r() * MAP_W, y1: 0, x2: r() * MAP_W, y2: MAP_H }), s('line', { x1: 0, y1: r() * MAP_H, x2: MAP_W, y2: r() * MAP_H }));
  const defs = s('defs'), maskId = `fogmask-${++maskSeq}`, mask = s('mask', { id: maskId });
  const maskPaths = s('g'); mask.append(s('rect', { width: MAP_W, height: MAP_H, fill: 'white' }), maskPaths); defs.append(mask);
  const fog = s('rect', { width: MAP_W, height: MAP_H, class: 'fog', mask: `url(#${maskId})` });
  const lit = s('g', { class: 'lit' }), spotsG = s('g');
  svg.append(defs, streets, lit, fog, spotsG);

  const d = (p) => 'M' + p.map(([x, y]) => `${x} ${y}`).join('L');
  function drawPaths() {
    lit.replaceChildren(); maskPaths.replaceChildren();
    const all = current ? [...paths, current] : paths;
    all.forEach((p, i) => { const st = pathStyle(i, all.length);
      lit.append(s('path', { d: d(p), 'stroke-width': st.width, opacity: st.opacity }));
      maskPaths.append(s('path', { d: d(p), 'stroke-width': st.width * 5, stroke: 'black', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); });
  }
  function drawSpots() {
    spots = pickSpots(picks(), city.id); spotsG.replaceChildren();
    for (const sp of spots) {
      const res = resistanceFor(nativePct(sp.pick, getResults()));
      const kind = { tv: 'Show', movie: 'Film', music: 'Band' }[sp.pick.category] || 'Pick';
      const g = s('g', { class: `spot${res.heavy ? '' : ' border'}`, tabindex: '0', role: 'button', 'aria-label': `${kind}: ${sp.pick.title}, ${res.label}. Press Enter to pull it up.`, transform: `translate(${sp.x} ${sp.y})` });
      g.append(s('circle', { r: 5, class: 'halo' }), s('circle', { r: 2.2, class: 'core' }));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPull(sp.pick, sp.el); } });
      g.addEventListener('click', () => { if (!walking) openPull(sp.pick, sp.el); });
      sp.el = g; spotsG.append(g);
    }
  }
  const toMap = (e) => { const b = svg.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * MAP_W, ((e.clientY - b.top) / b.height) * MAP_H]; };
  let walking = false, lastHit = null;
  svg.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.spot') && e.pointerType !== 'touch') return; walking = false; current = [toMap(e)]; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!current) return; const pt = toMap(e), last = current.at(-1);
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5) return;
    walking = true; e.preventDefault(); current.push(pt); drawPaths();
    const hit = nearSpot(pt, spots);
    if (hit && !sameSpot(hit, lastHit)) { buzz(20); ping(); if (motion.pulse) { hit.el.classList.remove('pulse'); void hit.el.getBBox(); hit.el.classList.add('pulse'); } }
    lastHit = hit; clearTimeout(dwell);
    if (hit) dwell = setTimeout(() => { if (current && sameSpot(nearSpot(current.at(-1), spots), hit)) { commitWalk(); openPull(hit.pick, hit.el); } }, 700);
  });
  // Save the walked path before anything (like openPull) clears it.
  function commitWalk() { if (current?.length > 1) paths = saveWalk(store, city.id, [...paths, current]); current = null; drawPaths(); }
  const end = (e) => { clearTimeout(dwell); if (!current) return;
    const start = current[0], stopAt = nearSpot(current.at(-1), spots);
    commitWalk(); lastHit = null;
    if (walking && stopAt) openPull(stopAt.pick, stopAt.el);
    else if (!walking && e?.pointerType === 'touch') { const tapped = nearSpot(start, spots); if (tapped) openPull(tapped.pick, tapped.el); }
    setTimeout(() => { walking = false; }, 0); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);

  // "Pull from the ground": the card sits sunk below a ledge; drag the handle up to lift it.
  let sheet = null; // tied to this map: destroy() removes it and its key listener
  function openPull(pick, origin) {
    if (sheet) return; current = null; clearTimeout(dwell);
    const res = resistanceFor(nativePct(pick, getResults()));
    const card = pickCard(pick, true); card.classList.add('ground-card');
    const handle = h('button', { class: 'pull-handle', 'aria-label': `Pull up ${pick.title} (${res.label}). Press Enter to open.` }, res.heavy ? 'Pull hard ↑' : 'Pull ↑');
    const close = h('button', { class: 'ghost', 'aria-label': 'Back to the map' }, 'Back to the map');
    const ground = h('div', { class: 'ground' }, card);
    sheet = h('div', { class: `pull-sheet ${res.heavy ? 'heavy' : 'light'}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': pick.title }, close, handle, ground);
    const travel = () => card.offsetHeight * 0.85 || 300;
    const setY = (moved, anim) => { card.style.transition = anim && motion.spring ? 'transform .45s cubic-bezier(.3,1.6,.5,1)' : 'none'; card.style.transform = `translateY(${Math.max(0, travel() - moved)}px)`; };
    const done = () => { sheet.classList.add('open'); card.style.transition = motion.spring ? 'transform .35s ease-out' : 'none'; card.style.transform = 'none'; if (!motion.spring) { card.style.opacity = 0; requestAnimationFrame(() => { card.style.transition = `opacity ${motion.fadeMs}ms`; card.style.opacity = 1; }); } handle.remove(); card.focus?.(); };
    let startY = null, moved = 0, ticks = 0;
    handle.addEventListener('pointerdown', (e) => { startY = e.clientY; ticks = 0; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => { if (startY == null) return; const dy = Math.max(0, startY - e.clientY);
      moved = dy * res.factor; setY(moved, false);
      if (res.tickEveryPx && Math.floor(dy / res.tickEveryPx) > ticks) { ticks = Math.floor(dy / res.tickEveryPx); buzz(8); } });
    const release = () => { if (startY == null) return; startY = null;
      if (moved === 0) return done(); // a plain tap opens it
      if (pullOutcome(moved, travel()) === 'open') done(); else setY(0, true); moved = 0; };
    handle.addEventListener('pointerup', release); handle.addEventListener('pointercancel', release);
    handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); } });
    const keys = (e) => {
      if (e.key === 'Escape') return shut();
      if (e.key !== 'Tab') return; // simple focus trap: Tab cycles inside the sheet
      const f = [...sheet.querySelectorAll('button,a[href],audio,input,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return; const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); } };
    shut = (restore = true) => { sheet?.remove(); sheet = null; document.removeEventListener('keydown', keys); shut = () => {};
      if (restore && origin?.isConnected) origin.focus(); };
    close.onclick = () => shut(); document.addEventListener('keydown', keys);
    document.body.append(sheet); setY(0, false); handle.focus();
  }
  let shut = () => {};
  drawPaths(); drawSpots();
  return { el: wrap, update: drawSpots, destroy: () => { clearTimeout(dwell); shut(false); } };
}
