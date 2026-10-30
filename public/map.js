// Map reveal (HG-6, restyled in HG-10): walk the fog, pull picks out of the ground. Only loaded behind ?reveal=map.
import { nativePct, resistanceFor, pullOutcome, sinkDepth, motionPlan, pickSpots, loadWalk, saveWalk, pathStyle, nearSpot, MAP_W, MAP_H, seeded, safeStorage, sameSpot, isTap, acceptPointer, seedPaths, SEED_STYLE } from './maplogic.js';
let maskSeq = 0; // unique mask id per map instance
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
const HINT_KEY = 'homegrown:map-hint-seen';

export function createMapReveal({ h, city, getResults, picks, pickCard, reduced, ping }) {
  const motion = motionPlan(reduced);
  const wrap = h('div', { class: 'map-wrap' });
  const svg = s('svg', { viewBox: `0 0 ${MAP_W} ${MAP_H}`, class: 'map', role: 'group', 'aria-label': `Map of ${city.name}. Drag to walk; picks are buttons.` });
  const store = safeStorage();
  let hintSeen = false; try { hintSeen = store?.getItem(HINT_KEY) === '1'; } catch {}
  const hint = hintSeen ? null : h('p', { class: 'map-hint' }, 'Drag to wander. Stop on a light.');
  wrap.append(svg); if (hint) wrap.append(hint);
  const hideHint = () => { if (!hint?.isConnected) return; try { store?.setItem(HINT_KEY, '1'); } catch {}
    if (reduced) return hint.remove(); hint.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: EASE_OUT }).finished.catch(() => {}).finally(() => hint.remove()); };
  const loops = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => wrap.classList.toggle('paused', !e.isIntersecting)) : null; loops?.observe(wrap); const seeds = seedPaths(city.id); let paths = loadWalk(store, city.id), spots = [], current = null, dwell = null;

  // Static streets: a faint seeded grid plus three thicker avenues, so the city feels like a place.
  const streets = s('g', { class: 'streets' }); const r = seeded(`streets|${city.id}`);
  for (let i = 0; i < 14; i++) streets.append(s('line', { x1: r() * MAP_W, y1: 0, x2: r() * MAP_W, y2: MAP_H }), s('line', { x1: 0, y1: r() * MAP_H, x2: MAP_W, y2: r() * MAP_H }));
  for (let i = 0; i < 3; i++) { const a = r() * MAP_H, b = r() * MAP_H; streets.append(s('line', { class: 'ave', x1: 0, y1: a, x2: MAP_W, y2: b })); }
  const defs = s('defs'), maskId = `fogmask-${++maskSeq}`, mask = s('mask', { id: maskId });
  const maskPaths = s('g'); mask.append(s('rect', { width: MAP_W, height: MAP_H, fill: 'white' }), maskPaths); defs.append(mask);
  const fog = s('rect', { width: MAP_W, height: MAP_H, class: 'fog', mask: `url(#${maskId})` });
  const lit = s('g', { class: 'lit' }), spotsG = s('g');
  svg.append(defs, streets, lit, fog, spotsG);

  const d = (p) => 'M' + p.map(([x, y]) => `${x} ${y}`).join('L');
  function drawPaths() {
    lit.replaceChildren(); maskPaths.replaceChildren();
    for (const p of seeds) { // starter paths: dashed and dimmer than the user's own trail
      lit.append(s('path', { d: d(p), class: 'seed', 'stroke-width': SEED_STYLE.width, opacity: SEED_STYLE.opacity, 'stroke-dasharray': SEED_STYLE.dash }));
      maskPaths.append(s('path', { d: d(p), 'stroke-width': SEED_STYLE.width * 3, stroke: 'black', fill: 'none', 'stroke-linecap': 'round' })); }
    const all = current ? [...paths, current] : paths;
    all.forEach((p, i) => { const st = pathStyle(i, all.length);
      lit.append(s('path', { d: d(p), 'stroke-width': st.width, opacity: st.opacity }));
      maskPaths.append(s('path', { d: d(p), 'stroke-width': st.width * 5, stroke: 'black', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); });
  }
  // Spot elements are reused by key, so focus, a running pulse and Tab position survive updates.
  const spotEls = new Map(), spotByKey = new Map(), opened = new Set();
  function drawSpots() {
    spots = pickSpots(picks(), city.id); spotByKey.clear();
    const keep = new Set(spots.map((sp) => sp.key));
    for (const [k, g] of spotEls) if (!keep.has(k)) { g.remove(); spotEls.delete(k); }
    for (const sp of spots) {
      spotByKey.set(sp.key, sp);
      const res = resistanceFor(nativePct(sp.pick, getResults()));
      const kind = { tv: 'Show', movie: 'Film', music: 'Band' }[sp.pick.category] || 'Pick';
      let g = spotEls.get(sp.key);
      if (!g) {
        const key = sp.key; g = s('g', { tabindex: '0', role: 'button' });
        g.append(s('circle', { r: 5, class: 'halo' }), s('circle', { r: 5, class: 'ring' }), s('circle', { r: 2.2, class: 'core' }));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKey(key); } });
        g.addEventListener('click', () => { if (!walking) openKey(key); });
        spotEls.set(key, g);
      }
      g.setAttribute('class', `spot${res.heavy ? '' : ' border'}${opened.has(sp.key) ? ' opened' : ''}`);
      g.setAttribute('aria-label', `${kind}: ${sp.pick.title}, ${res.label}. Press Enter to pull it up.`);
      g.setAttribute('transform', `translate(${sp.x} ${sp.y})`);
      sp.el = g; spotsG.append(g); // append moves an existing node: keeps DOM/Tab order = spot order
    }
    // A17: at most 5 unopened spots breathe, 400 ms apart (one staggered group); reduced motion: static halo.
    let n = 0; for (const sp of spots) { const halo = sp.el.querySelector('.halo'); const on = !reduced && !opened.has(sp.key) && n < 5; halo.style.animation = on ? '' : 'none'; if (on) halo.style.setProperty('--o', `${n++ * 400}ms`); }
  }
  const openKey = (key) => { const sp = spotByKey.get(key); if (sp) openPull(sp.pick, key); };
  // Screen -> map units through the SVG's own matrix, so the letterboxed (meet) frame still maps exactly.
  const toMap = (e) => { const m = svg.getScreenCTM().inverse(); const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return [p.x, p.y]; };
  let moved0 = null;
  let walking = false, lastHit = null, activePointer = null; // one walking pointer at a time
  svg.addEventListener('pointerdown', (e) => { if (!acceptPointer(activePointer, e.pointerId)) return; if (e.target.closest?.('.spot') && e.pointerType !== 'touch') return; activePointer = e.pointerId; walking = false; current = [toMap(e)]; moved0 = [e.clientX, e.clientY]; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!current || e.pointerId !== activePointer) return; const pt = toMap(e), last = current.at(-1);
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5) return;
    walking = true; e.preventDefault(); current.push(pt); drawPaths();
    if (moved0 && Math.hypot(e.clientX - moved0[0], e.clientY - moved0[1]) > 20) hideHint();
    const hit = nearSpot(pt, spots);
    if (hit && !sameSpot(hit, lastHit)) { buzz(12); ping(); hitRing(hit.el); }
    lastHit = hit; clearTimeout(dwell);
    if (hit) dwell = setTimeout(() => { if (current && sameSpot(nearSpot(current.at(-1), spots), hit)) { commitWalk(); openPull(hit.pick, hit.key); } }, 700);
  });
  // A18: a one-shot ring on the spot (reduced motion: the halo outline thickens instead).
  function hitRing(g) {
    if (!motion.pulse) { const halo = g.querySelector('.halo'); halo.style.strokeWidth = '1'; setTimeout(() => { halo.style.strokeWidth = ''; }, 300); return; }
    g.querySelector('.ring').animate([{ transform: 'scale(1)', opacity: 0.8 }, { transform: 'scale(2)', opacity: 0 }], { duration: 300, easing: EASE_OUT });
  }
  // Save the walked path before anything (like openPull) clears it.
  function commitWalk() { if (current?.length > 1) paths = saveWalk(store, city.id, [...paths, current]); current = null; drawPaths(); }
  // Walk state is reset on every pointer end, even after a dwell-open already cleared `current`.
  // `walking` clears on the next tick so the click that follows a walk doesn't count as a tap.
  const resetWalk = () => { lastHit = null; setTimeout(() => { walking = false; }, 0); };
  const end = (e) => { if (e?.pointerId !== activePointer) return; activePointer = null; clearTimeout(dwell); if (!current) return resetWalk();
    const start = current[0], stopAt = nearSpot(current.at(-1), spots);
    commitWalk();
    if (walking && stopAt) openPull(stopAt.pick, stopAt.key);
    else if (!walking && e?.pointerType === 'touch') { const tapped = nearSpot(start, spots); if (tapped) openPull(tapped.pick, tapped.key); }
    resetWalk(); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);

  // "Pull from the ground": the card sits sunk below a ledge; drag the handle up to lift it.
  let sheet = null; // tied to this map: destroy() removes it and its key listener
  function openPull(pick, originKey) {
    if (sheet) return; current = null; clearTimeout(dwell); resetWalk();
    const res = resistanceFor(nativePct(pick, getResults()));
    const card = pickCard(pick, true); card.classList.add('ground-card');
    // The resistance is felt (factor, ticks, spring), not labelled: the caption is always "Pull up".
    const handle = h('button', { class: 'pull-handle', 'aria-label': `Pull up ${pick.title} (${res.label}). Press Enter to open.` }, h('i'), h('span', { class: 'cap' }, 'Pull up'));
    const close = h('button', { class: 'x', 'aria-label': 'Back to the map' }, '×');
    const ground = h('div', { class: 'ground' }, card);
    const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true' });
    const inner = h('div', { class: 'inner' }, close, handle, ground);
    sheet = h('div', { class: `pull-sheet ${res.heavy ? 'heavy' : 'light'}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': pick.title }, inner);
    opened.add(originKey); drawSpots();
    const travel = () => sinkDepth(card.offsetHeight);
    const setY = (moved, anim) => { card.style.transition = anim && motion.spring ? `transform 300ms ${EASE_OUT}` : 'none'; card.style.transform = `translateY(${Math.max(0, travel() - moved)}px)`; };
    const done = () => { sheet.classList.add('open'); card.style.transition = motion.spring ? (res.heavy ? 'transform 550ms cubic-bezier(.3,1.15,.6,1)' : 'transform 450ms cubic-bezier(.34,1.4,.64,1)') : 'none'; card.style.transform = 'none'; if (!motion.spring) { card.style.opacity = 0; requestAnimationFrame(() => { card.style.transition = `opacity ${motion.fadeMs}ms`; card.style.opacity = 1; }); } handle.remove(); card.focus?.(); };
    let startY = null, startX = 0, moved = 0, ticks = 0, travelled = 0;
    handle.addEventListener('pointerdown', (e) => { startY = e.clientY; startX = e.clientX; travelled = 0; moved = 0; ticks = 0; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => { if (startY == null) return; travelled = Math.max(travelled, Math.hypot(e.clientX - startX, e.clientY - startY)); const dy = Math.max(0, startY - e.clientY);
      moved = dy * res.factor; setY(moved, false);
      if (res.tickEveryPx && Math.floor(dy / res.tickEveryPx) > ticks) { ticks = Math.floor(dy / res.tickEveryPx); buzz(8); } });
    const release = () => { if (startY == null) return; startY = null;
      if (isTap(travelled)) return done(); // only a near-still tap opens; a downward drag springs back
      if (pullOutcome(moved) === 'open') done(); else setY(0, true); moved = 0; };
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
    // Swipe down on the opened sheet closes it, as do the ×, the scrim and Esc.
    let swipe = null;
    inner.addEventListener('pointerdown', (e) => { if (sheet?.classList.contains('open') && inner.scrollTop <= 0 && !e.target.closest('a,button,input,audio')) swipe = e.clientY; });
    inner.addEventListener('pointerup', (e) => { if (swipe != null && e.clientY - swipe > 80) shut(); swipe = null; });
    inner.addEventListener('pointercancel', () => { swipe = null; });
    scrim.addEventListener('click', () => shut());
    shut = (restore = true) => { sheet?.remove(); scrim.remove(); sheet = null; document.removeEventListener('keydown', keys); shut = () => {};
      const origin = spotEls.get(originKey); if (restore && origin?.isConnected) origin.focus(); };
    close.onclick = () => shut(); document.addEventListener('keydown', keys);
    document.body.append(scrim, sheet); setY(0, false); handle.focus();
    if (!reduced) { scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }); inner.animate([{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE_OUT }); }
  }
  let shut = () => {};
  drawPaths(); drawSpots();
  // A20: saved trails draw themselves in on a return visit.
  if (paths.length && !reduced) requestAnimationFrame(() => { for (const el of lit.querySelectorAll('path:not(.seed)')) { const len = el.getTotalLength?.() || 0; if (!len) continue;
    el.style.strokeDasharray = len; el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, easing: EASE_OUT }).finished.catch(() => {}).finally(() => { el.style.strokeDasharray = ''; }); } });
  return { el: wrap, update: drawSpots, destroy: () => { clearTimeout(dwell); loops?.disconnect(); shut(false); } };
}
