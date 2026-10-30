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
  assert.equal(strict.heavy, true); assert.ok(strict.tickEveryPx > 0); assert.equal(strict.factor, 0.3);
  assert.equal(border.heavy, false); assert.equal(border.tickEveryPx, 0);
  assert.ok(strict.factor < border.factor && border.factor < low.factor);
  assert.equal(resistanceFor(80).heavy, true); assert.equal(resistanceFor(79).heavy, false);
  assert.equal(resistanceFor(500).pct, 100); assert.equal(resistanceFor('x').pct, 0);
  const byCat = { tv: { picks: [1, 2, 3], scarce: false }, music: { picks: [1], scarce: true } };
  assert.equal(nativePct({ category: 'tv', verification: { source: 'tmdb' } }, byCat), 100);
  assert.equal(nativePct({ category: 'music', verification: { source: 'musicbrainz' } }, byCat), 60);
  assert.equal(nativePct({ category: 'tv' }, byCat), 40);
  assert.equal(pullOutcome(100, 300), 'spring'); assert.equal(pullOutcome(200, 300), 'open'); assert.equal(pullOutcome(5, 0), 'spring');
});

test('walked paths persist per city in localStorage, with 3 seeded starters', () => {
  const st = mem();
  const fresh = loadWalk(st, 'seoul');
  assert.equal(fresh.length, 3); assert.deepEqual(fresh, seedPaths('seoul'));
  saveWalk(st, 'seoul', [...fresh, [[1, 1], [2.234, 3]]]);
  const again = loadWalk(st, 'seoul');
  assert.equal(again.length, 4); assert.deepEqual(again.at(-1), [[1, 1], [2.2, 3]]);
  assert.equal(loadWalk(st, 'paris').length, 3, 'other cities are separate');
  assert.ok(st.m.has(walkKey('seoul')) && !st.m.has(walkKey('paris')));
  st.setItem(walkKey('seoul'), '{bad'); assert.deepEqual(loadWalk(st, 'seoul'), seedPaths('seoul'));
  const many = saveWalk(st, 'x', Array.from({ length: 100 }, () => [[0, 0], [1, 1]]));
  assert.equal(many.length, 40);
  assert.equal(loadWalk(null, 'x').length, 3); // no storage: still never blank
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
    assert.deepEqual(loadWalk(st, 'c'), seedPaths('c'), JSON.stringify(bad));
  }
  assert.equal(isValidWalk([[[1, 2], [3, 4]]]), true);
});
test('storage access is guarded', () => {
  assert.equal(safeStorage(() => { throw new Error('SecurityError'); }), null);
  const s = mem(); assert.equal(safeStorage(() => s), s);
  assert.equal(loadWalk(safeStorage(() => { throw 1; }), 'c').length, 3);
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
