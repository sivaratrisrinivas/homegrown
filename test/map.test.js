import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMapReveal, nativePct, resistanceFor, pullOutcome, motionPlan, loadWalk, saveWalk, seedPaths, walkKey, pickSpots, nearSpot, pathStyle } from '../public/maplogic.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('flag gating: only ?reveal=map turns the map on', () => {
  assert.equal(isMapReveal('?reveal=map'), true);
  assert.equal(isMapReveal('?x=1&reveal=map'), true);
  for (const s of ['', '?', '?reveal=list', '?reveal=MAP', '?map', undefined]) assert.equal(isMapReveal(s), false, String(s));
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // map.js is only imported lazily, inside the flagged branch; the default path still calls updateReveal().
  assert.doesNotMatch(app, /^import .*map\.js/m);
  assert.match(app, /if \(isMapReveal\(location\.search\)\) \{[\s\S]*?return;\s*\}\s*updateReveal\(\);/);
});

test('resistance scales with native %: strict is heavy with ticks, borderline is light', () => {
  const strict = resistanceFor(100), border = resistanceFor(60), low = resistanceFor(0);
  assert.equal(strict.heavy, true); assert.ok(strict.tickEveryPx > 0); assert.equal(strict.factor, 0.45);
  assert.equal(border.heavy, false); assert.equal(border.tickEveryPx, 0);
  assert.ok(strict.factor < border.factor && border.factor < low.factor);
  assert.equal(resistanceFor(80).heavy, true); assert.equal(resistanceFor(79).heavy, false);
  assert.equal(resistanceFor(500).pct, 100); assert.equal(resistanceFor('x').pct, 0);
  const byCat = { tv: { picks: [1, 2, 3], scarce: false }, music: { picks: [1], scarce: true } };
  assert.equal(nativePct({ category: 'tv', verification: { source: 'tmdb' } }, byCat), 100);
  assert.equal(nativePct({ category: 'music', verification: { source: 'musicbrainz' } }, byCat), 60);
  assert.equal(nativePct({ category: 'tv' }, byCat), 40);
  assert.equal(pullOutcome(100), 'spring'); assert.equal(pullOutcome(200), 'open'); assert.equal(pullOutcome(0), 'spring');
});

test('walked paths persist per city in localStorage, with 3 seeded starters', () => {
  const st = mem();
  const fresh = loadWalk(st, 'seoul');
  assert.deepEqual(fresh, []); assert.equal(seedPaths('seoul').length, 3);
  saveWalk(st, 'seoul', [...fresh, [[1, 1], [2.234, 3]]]);
  const again = loadWalk(st, 'seoul');
  assert.equal(again.length, 1); assert.deepEqual(again.at(-1), [[1, 1], [2.2, 3]]);
  assert.equal(loadWalk(st, 'paris').length, 0, 'other cities are separate');
  assert.ok(st.m.has(walkKey('seoul')) && !st.m.has(walkKey('paris')));
  st.setItem(walkKey('seoul'), '{bad'); assert.deepEqual(loadWalk(st, 'seoul'), []);
  const many = saveWalk(st, 'x', Array.from({ length: 100 }, () => [[0, 0], [1, 1]]));
  assert.equal(many.length, 40);
  assert.deepEqual(loadWalk(null, 'x'), []); assert.equal(seedPaths('x').length, 3); // seeds still draw
});

test('reduced motion: no springs or pulses, a short fade instead', () => {
  assert.deepEqual(motionPlan(true), { spring: false, fadeMs: 150, pulse: false });
  assert.equal(motionPlan(false).spring, true);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce\)\{\*\{animation:none!important/);
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /motionPlan\(reduced\)/);
});

test('spots are deterministic per city and hit-testing finds them', () => {
  const picks = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  assert.deepEqual(pickSpots(picks, 'seoul'), pickSpots(picks, 'seoul'));
  const sp = pickSpots(picks, 'seoul');
  assert.equal(nearSpot([sp[1].x + 1, sp[1].y], sp).pick.title, 'b');
  assert.equal(nearSpot([-50, -50], sp), null);
  assert.ok(pathStyle(9, 10).width > pathStyle(0, 10).width);
});

import { isValidWalk, safeStorage } from '../public/maplogic.js';
test('corrupt walk data (non-pairs, NaN, strings) falls back to seeds', () => {
  const st = mem();
  for (const bad of [[[1, 2, 3]], [[[1, 'a']]], [[[1]]], [['x']], [[[1, null]]], [[[1, 2], [3, 1e999]]], {}, 5]) {
    st.setItem(walkKey('c'), JSON.stringify(bad));
    assert.deepEqual(loadWalk(st, 'c'), [], JSON.stringify(bad));
  }
  assert.equal(isValidWalk([[[1, 2], [3, 4]]]), true);
});
test('storage access is guarded', () => {
  assert.equal(safeStorage(() => { throw new Error('SecurityError'); }), null);
  const s = mem(); assert.equal(safeStorage(() => s), s);
  assert.deepEqual(loadWalk(safeStorage(() => { throw 1; }), 'c'), []);
});
test('map lifecycle: destroy closes the sheet and key listener; shut restores focus; map failures fall back', () => {
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /destroy: \(\) => \{[^}]*shut\(false\)/);
  assert.match(map, /removeEventListener\('keydown', keys\)/);
  assert.match(map, /origin\.focus\(\)/); assert.match(map, /e\.key !== 'Tab'/);
  assert.doesNotMatch(map, /viaKeyboard|localStorage/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /\.catch\(\(\) => \{[^\n]*picksView\(\)/);
  assert.match(app, /revealEls\?\.destroy\?\.\(\)/);
});

import { spotKey, sameSpot, mapFraming } from '../public/maplogic.js';
test('spots are keyed by city|category|title and do not move when categories land', () => {
  const tv = [{ category: 'tv', title: 'A' }, { category: 'tv', title: 'B' }];
  const before = pickSpots(tv, 'seoul'), after = pickSpots([{ category: 'music', title: 'Z' }, ...tv, { category: 'movie', title: 'M' }], 'seoul');
  for (const b of before) { const a = after.find((x) => x.key === b.key); assert.equal(a.x, b.x); assert.equal(a.y, b.y); }
  assert.equal(spotKey('seoul', tv[0]), 'seoul|tv|A');
  assert.ok(sameSpot(before[0], after[1])); assert.ok(!sameSpot(before[0], before[1])); assert.ok(!sameSpot(null, before[0]));
});
test('map framing keeps lead, postcard line, notes, pending; drops pick cards', () => {
  const el = (tag, hasArticle = false, cls = '') => ({ cls, matches: (s) => s === 'article' && tag === 'article', querySelector: (s) => (s === 'article' && hasArticle ? {} : null) });
  const lead = el('p', false, 'lead'), hero = el('article'), grid = el('div', true), pend = el('p', false, 'pending'), note = el('p', false, 'note'), scarce = el('section', true);
  assert.deepEqual(mapFraming([lead, hero, grid, pend, note, scarce]), [lead, pend, note]);
});
test('map.js: unique mask id, touch tap opens spot, dwell saves walk first', () => {
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /fogmask-\$\{\+\+maskSeq\}/); assert.doesNotMatch(map, /'url\(#fogmask\)'/);
  assert.match(map, /!walking && e\?\.pointerType === 'touch'\) \{ const tapped = nearSpot\(start, spots\)/);
  assert.match(map, /commitWalk\(\); openPull\(hit\.pick/);
  assert.match(map, /sameSpot\(hit, lastHit\)/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /mapFraming\(picksView\(\)\)/); assert.match(app, /mine\.update = refresh/);
});

import { OPEN_PX, sinkDepth, dragToOpen, MIN_SPOT_GAP } from '../public/maplogic.js';
test('release-to-open is reachable: strict-native opens within 400px of drag on a 600px card', () => {
  const card = 600, sink = sinkDepth(card);
  assert.ok(sink <= OPEN_PX * 2 && sink >= OPEN_PX, 'card sinks less than a phone screen');
  const strict = resistanceFor(100), border = resistanceFor(60);
  assert.equal(pullOutcome(400 * strict.factor), 'open');
  assert.ok(dragToOpen(100) <= 400 && dragToOpen(60) < dragToOpen(100), 'heavier still needs more drag');
  for (const dy of [50, 150, 250]) assert.equal(pullOutcome(dy * strict.factor), 'spring', `${dy}px springs back`);
  assert.equal(pullOutcome(100 * border.factor), 'spring');
  assert.equal(sinkDepth(0), OPEN_PX); assert.equal(sinkDepth(5000), OPEN_PX * 2);
});
test('spots stay >= 8 units apart, in bounds, and independent of arrival order', () => {
  const picks = Array.from({ length: 15 }, (_, i) => ({ category: ['tv', 'movie', 'music'][i % 3], title: `T${i}` }));
  for (const city of ['seoul', 'mexico_city', 'paris', 'chennai']) {
    const a = pickSpots(picks, city), b = pickSpots([...picks].reverse(), city);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) >= MIN_SPOT_GAP, `${city} ${a[i].key} vs ${a[j].key}`);
    for (const s of a) { assert.ok(s.x >= 6 && s.x <= 94 && s.y >= 6 && s.y <= 134); const o = b.find((x) => x.key === s.key); assert.equal(o.x, s.x); assert.equal(o.y, s.y); }
    assert.deepEqual(a.map((s) => s.pick), picks, 'returned in input order');
  }
});

import { SEED_STYLE, MAX_PATHS } from '../public/maplogic.js';
test('seed paths are separate: never stored, never trimmed, drawn dashed and dimmer', () => {
  const st = mem(), seeds = seedPaths('seoul');
  const walked = Array.from({ length: MAX_PATHS + 10 }, (_, i) => [[i, 1], [i, 2]]);
  saveWalk(st, 'seoul', walked);
  const stored = JSON.parse(st.getItem(walkKey('seoul')));
  assert.equal(stored.length, MAX_PATHS);
  for (const s of seeds) assert.ok(!stored.some((p) => JSON.stringify(p) === JSON.stringify(s)), 'seed not in walk array');
  assert.deepEqual(seedPaths('seoul'), seeds, 'seeds unchanged by trimming');
  st.setItem(walkKey('seoul'), JSON.stringify([...seeds, [[1, 1], [2, 2]]])); // older build stored seeds
  assert.deepEqual(loadWalk(st, 'seoul'), [[[1, 1], [2, 2]]]);
  assert.ok(SEED_STYLE.dash && SEED_STYLE.opacity < pathStyle(0, 1).opacity && SEED_STYLE.width < pathStyle(0, 1).width);
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /for \(const p of seeds\)/); assert.match(map, /'stroke-dasharray': SEED_STYLE\.dash/);
});

import { isTap, TAP_PX, acceptPointer } from '../public/maplogic.js';
test('pull handle: only near-zero travel is a tap; a downward drag is not', () => {
  assert.equal(TAP_PX, 6); assert.equal(isTap(0), true); assert.equal(isTap(5.9), true);
  assert.equal(isTap(6), false); assert.equal(isTap(80), false, 'downward 80px drag (moved=0) springs back');
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /travelled = Math\.max\(travelled, Math\.hypot/); assert.match(map, /if \(isTap\(travelled\)\) return done\(\)/);
  assert.doesNotMatch(map, /moved === 0/);
});
test('one walking pointer at a time; move/up filtered by pointerId', () => {
  assert.equal(acceptPointer(null, 1), true); assert.equal(acceptPointer(1, 1), true); assert.equal(acceptPointer(1, 2), false);
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /e\.pointerId !== activePointer\) return; const pt/);
  assert.match(map, /const end = \(e\) => \{ if \(e\?\.pointerId !== activePointer\) return; activePointer = null;/);
});
test('spots are reused by key across updates; shut re-resolves origin by key; refresh failures fall back', () => {
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /let g = spotEls\.get\(sp\.key\)/); assert.doesNotMatch(map, /spotsG\.replaceChildren\(\)/);
  assert.match(map, /const origin = spotEls\.get\(originKey\)/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /try \{ m\.update\(\);[\s\S]*?catch \{[^\n]*delete mine\.update; delete mine\.destroy; picks\.replaceChildren\(\.\.\.picksView\(\)\)/);
  assert.match(app, /\.catch\(\(\) => \{ if \(revealEls === mine\) \{ delete mine\.update; delete mine\.destroy;/);
});

test('walk state resets after a dwell-open (current already null) and in openPull', () => {
  const map = readFileSync(new URL('../public/map.js', import.meta.url), 'utf8');
  assert.match(map, /const resetWalk = \(\) => \{ lastHit = null; setTimeout\(\(\) => \{ walking = false; \}, 0\); \};/);
  assert.match(map, /if \(!current\) return resetWalk\(\);/, 'early return still resets');
  assert.match(map, /if \(sheet\) return; current = null; clearTimeout\(dwell\); resetWalk\(\);/);
  // Simulate the bug sequence with the same reset rule: dwell-open, then pointerup with current=null.
  let walking = true, lastHit = { key: 'k' }, current = null; const ticks = [];
  const resetWalk = () => { lastHit = null; ticks.push(() => { walking = false; }); };
  const end = () => { if (!current) return resetWalk(); };
  end(); ticks.forEach((f) => f());
  assert.equal(walking, false); assert.equal(lastHit, null);
});
