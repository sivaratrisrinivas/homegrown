import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whyLine } from '../lib/why.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const app = read('app.js'), css = read('styles.css'), html = read('index.html'), map = read('map.js');

test('HG-10: cut copy is gone from the client', () => {
  const all = app + html + map;
  for (const s of ['Sound off', 'Coming soon', 'On your postcard', 'Availability:', 'made in', 'Save my', 'Territory you walk', 'Pull hard', 'Skip, that', 'Where to watch ·', 'How did we do?', 'Start typing']) assert.ok(!all.includes(s), s);
  assert.doesNotMatch(app, /\.lead\b|c\.lead|postcardCategories/);
  assert.doesNotMatch(app, /👎/);
});

test('HG-10: new copy from the spec', () => {
  assert.match(html, /Pick 3 things you love\. Meet the local you\./);
  for (const s of ['You’re learning…', ' · Best match', '‹ Language', 'Not ready yet — we only open a city when its picks are truly local.', 'That’s enough →', 'e.g. Breaking Bad', 'Anything at all',
    'Watch on ${p.watch.provider}', 'Feels like you?', 'Add a note', 'Grow up in ${c.name} instead →', 'We couldn’t find picks local enough for your taste here. Try another city.', 'Not really local', 'Not my taste', 'Noted', 'Where-to-watch data: ']) assert.ok(app.includes(s), s);
  assert.ok(map.includes('Drag to wander. Stop on a light.') && map.includes("'Pull up'") && map.includes("'aria-label': 'Back to the map' }, '×'"));
});

test('HG-10: the why fallback names no vendor', () => {
  const w = whyLine([{ name: 'Breaking Bad', tags: [] }, { name: 'Radiohead', tags: [] }], { tags: [], category: 'tv' });
  assert.equal(w.text, 'Close to Breaking Bad and Radiohead.'); assert.equal(w.grounded, false);
});

test('HG-10: feedback events and flag payloads are unchanged', () => {
  for (const e of ["event: 'flag', flag: f", "event: 'rating'", "event: 'tap', action: 'watch'", "event: 'tap', action: 'listen'", "event: 'try_city'"]) assert.ok(app.includes(e), e);
  assert.ok(app.includes("item('not_local'") && app.includes("item('not_my_taste'"));
});

test('HG-10: palette tokens and per-city accents; no traffic-light dots', () => {
  for (const t of ['--paper:#F5F1EA', '--card:#FFFCF7', '--ink:#1A1917', '--ink-2:#5E5953', '--ink-3:#8F8981', '--line:#E4DDD2', '--board:#17161A', '--board-2:#24232A', '--chalk:#F1E7D3']) assert.ok(css.includes(t), t);
  assert.match(css, /\[data-city=madrid\]\{--accent:#C8102E\}/);
  assert.doesNotMatch(css, /#3aa655|#e0a100|#d0453a|#eee\b/);
});

test('HG-10: motion animates transform/opacity only and reduced motion is honoured', () => {
  const kf = [...css.matchAll(/@keyframes [\w-]+\{([^@]*?\})\}/g)].map((m) => m[1]);
  assert.ok(kf.length >= 6);
  for (const k of kf) for (const prop of k.matchAll(/([a-z-]+):/g)) assert.ok(['transform', 'opacity'].includes(prop[1]), `keyframe animates ${prop[1]}`);
  assert.match(app, /const reduced = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(app, /if \(reduced\) \{ row\.cells\.forEach/); // board shows final text at once
  assert.match(app, /visibilitychange[\s\S]*?iterations === Infinity/); // loops pause when hidden
  assert.match(app, /flapSteps\(cell\.textContent, target\[k\], 7\)/); // ≤ 6 intermediate characters
});

test('HG-10: fonts — two families on first load, Korean only after ko', () => {
  assert.match(html, /family=Fraunces:opsz,wght@9\.\.144,600&family=Inter:wght@400;500&display=swap/);
  assert.doesNotMatch(html, /Noto\+Serif\+KR/);
  assert.match(app, /if \(l\.id === 'ko'\) loadKorean\(\)/);
});

test('HG-10: back button goes one step; HG-5 data model intact', () => {
  for (const s of ["nav('lang')", "nav('city')", "nav('fav', i)", "nav('reveal')", "addEventListener('popstate'"]) assert.ok(app.includes(s), s);
  assert.match(app, /settleFavourites\(S\.favs, S\.pending, matches\)/);
  assert.match(app, /const key = `\$\{pick\}\|\$\{S\.pending\.length \+ S\.favs\.length\}`/);
  assert.match(app, /results\.slice\(0, 3\)/);
});
