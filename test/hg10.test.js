import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whyLine } from '../lib/why.js';
import { validateFeedback } from '../lib/feedback.js';
import { journeyFor, revealHeader, journeyPicks, encodeShare, decodeShare, JOURNEY_FAVS, MAX_ROWS } from '../public/logic.js';
import { CATEGORY } from '../public/config.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const app = read('app.js'), css = read('styles.css'), html = read('index.html');
const madrid = { id: 'madrid', name: 'Madrid', header: 'Tu yo madrileño', language: 'es' };
const pick = (category, n, extra = {}) => ({ category, title: `${category}-${n}`, ...extra });
const cat = (c, k) => ({ picks: Array.from({ length: k }, (_, i) => pick(c, i)) });

test('HG-10 journey: cut copy and cut features are gone from the client journey', () => {
  const all = app + html;
  for (const s of ['Sound off', 'Coming soon', 'On your postcard', 'Availability:', 'made in', 'Save my', 'Skip, that', 'That’s enough', 'Where to watch ·', 'How did we do?', 'Start typing', 'Add a note', 'See it as a map', 'Not really local']) assert.ok(!all.includes(s), s);
  assert.doesNotMatch(app, /\.lead\b|c\.lead|postcardCategories|AudioContext|flagMenu|stampIn|rateStrip|difficulty/);
  assert.doesNotMatch(app, /👎/);
});

test('HG-10 journey: copy from the revised spec', () => {
  assert.match(html, /Pick 3 things you love\. Meet the local you\./);
  for (const s of ['You’re learning…', ' · Best match', '‹ Language', 'Not ready yet — we only open a city when its picks are truly local.', '`Choose ${c.name}`',
    'Watch on ${p.watch.provider}', 'Feels like you?', "'Yes'", "'Not really'", '`Send my ${c.name} self`', 'I grew up in ${c.name} (apparently). Who are you there?', "'Copy link'", "'Save image'", "'Find yours'",
    'Grow up in ${o.name} instead →', 'We couldn’t find picks local enough for your taste here. Try another city.', 'Where-to-watch data: ', 'Try other names for ${m.name}']) assert.ok(app.includes(s), s);
});

test('HG-10 category config: one value, mixed by default until HG-9', () => {
  assert.equal(CATEGORY, 'mixed');
  assert.match(app, /const J = journeyFor\(CATEGORY\)/);
  const mixed = journeyFor('mixed');
  assert.equal(mixed.single, false); assert.deepEqual(mixed.order, ['tv', 'movie', 'music']);
  assert.deepEqual(mixed.prompts.map((p) => p.kind), ['show', 'band', 'movie']); assert.equal(mixed.prompts.length, JOURNEY_FAVS);
  assert.equal(revealHeader(mixed, madrid), 'Tu yo madrileño');
  assert.equal(journeyFor('nonsense').single, false, 'unknown values fall back to mixed');
});

test('HG-10 category config: single-category renders "Your TV self, in Madrid" with that category only', () => {
  const tv = journeyFor('tv');
  assert.equal(tv.single, true); assert.deepEqual(tv.order, ['tv']);
  assert.deepEqual(tv.prompts.map((p) => p.kind), ['show', 'show', 'show']);
  assert.deepEqual(tv.prompts.map((p) => p.placeholder), ['e.g. Breaking Bad', 'e.g. Fleabag', 'e.g. Dark']);
  assert.equal(revealHeader(tv, madrid), 'Your TV self, in Madrid');
  assert.equal(revealHeader(journeyFor('music'), madrid), 'Your music self, in Madrid');
  const byCat = { tv: cat('tv', 6), movie: cat('movie', 4), music: cat('music', 4) };
  const r = journeyPicks(byCat, tv);
  assert.equal(r.hero.title, 'tv-0'); assert.deepEqual(r.rows.map((p) => p.category), ['tv', 'tv', 'tv', 'tv']);
  assert.equal(r.rows.length, MAX_ROWS);
  const m = journeyPicks({ tv: cat('tv', 3), movie: cat('movie', 3) }, journeyFor('mixed'));
  assert.deepEqual(m.rows.map((p) => p.title), ['tv-1', 'movie-0', 'tv-2', 'movie-1'], 'mixed: categories take turns in one list');
});

test('HG-10 share link: result rides in ?r=, round-trips, stays short, rejects junk', () => {
  const hero = pick('tv', 0, { title: 'Las chicas del cable', englishTitle: 'Cable Girls', image: 'https://image.tmdb.org/t/p/w500/abcD_1-x.jpg' });
  const rows = [pick('tv', 1, { title: 'Élite' }), pick('tv', 2, { title: 'La casa de papel', englishTitle: 'Money Heist' }), pick('music', 3, { title: 'Rosalía', image: 'https://qloo.example/x.png' })];
  const code = encodeShare({ lang: 'es', city: 'madrid', category: 'tv', favs: ['Breaking Bad', 'Fleabag', 'Dark'], hero, rows });
  assert.match(code, /^[\w-]+$/); assert.ok(`/?r=${code}`.length < 600, `${code.length}`);
  const d = decodeShare(code, [madrid]);
  assert.equal(d.city.id, 'madrid'); assert.equal(d.lang, 'es'); assert.equal(d.category, 'tv');
  assert.deepEqual(d.favs, ['Breaking Bad', 'Fleabag', 'Dark']);
  assert.equal(d.hero.title, 'Las chicas del cable'); assert.equal(d.hero.englishTitle, 'Cable Girls');
  assert.equal(d.hero.image, 'https://image.tmdb.org/t/p/w342/abcD_1-x.jpg');
  assert.equal(d.rows[2].image, null, 'only TMDB poster paths survive');
  for (const bad of ['', 'x', '!!!', 'e30', encodeShare({ lang: 'es', city: 'atlantis', category: 'tv', favs: [], hero, rows: [] })]) assert.equal(decodeShare(bad, [madrid]), null, bad);
  assert.equal(decodeShare('a'.repeat(3000), [madrid]), null);
});

test('HG-10 share: navigator.share with files, then url, then Copy link + Save image; postcard is type-only canvas', () => {
  assert.match(app, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(app, /navigator\.share\(\{ url, text \}\)/);
  assert.match(app, /download: `homegrown-\$\{c\.id\}\.png`/);
  assert.match(app, /document\.fonts\.load/); assert.match(app, /canvas/);
  assert.doesNotMatch(app.slice(app.indexOf('async function postcard'), app.indexOf('function shareBlock')), /drawImage/, 'no posters on the canvas');
  assert.match(html, /property="og:image" content="\/og\.png"/);
  assert.match(app, /track\(\{ event: 'share', method: 'files' \}\)/); assert.match(app, /event: 'share_open'/);
});

test('HG-10 feedback: share events validated; old events and flag payloads unchanged', () => {
  for (const m of ['files', 'link', 'copy', 'image']) assert.equal(validateFeedback({ event: 'share', method: m, city: 'madrid' }).ok, true, m);
  assert.equal(validateFeedback({ event: 'share', method: 'fax' }).ok, false);
  assert.equal(validateFeedback({ event: 'share_open', city: 'madrid' }).ok, true);
  assert.equal(validateFeedback({ event: 'flag', flag: 'not_local' }).ok, true);
  assert.equal(validateFeedback({ event: 'rating', rating: 5 }).ok, true);
  for (const e of ["event: 'rating', rating: yes ? 5 : 1", "event: 'tap', action: 'watch'", "event: 'tap', action: 'listen'", "event: 'try_city'"]) assert.ok(app.includes(e), e);
});

test('HG-10 why fallback names no vendor', () => {
  const w = whyLine([{ name: 'Breaking Bad', tags: [] }, { name: 'Radiohead', tags: [] }], { tags: [], category: 'tv' });
  assert.equal(w.text, 'Close to Breaking Bad and Radiohead.'); assert.equal(w.grounded, false);
});

test('HG-10 VS palette, type and tokens', () => {
  for (const t of ['--paper:#F5F1EA', '--card:var(--paper)', '--ink:#1B1813', '--ink-2:#5E5953', '--ink-3:#8F8981', '--line:#E4DDD2', '--board:#17161A', '--board-2:#24232A', '--chalk:#F1E7D3', '--t-display:clamp(40px,11vw,96px)', '--t-body:18px', '--mono:ui-monospace', '--ease-reveal:cubic-bezier(.19,1,.22,1)', '--d-share-delay:1200ms', '--d-share:280ms']) assert.ok(css.includes(t), t);
  assert.match(css, /\[data-city=madrid\]\{--accent:#C8102E\}/);
  assert.doesNotMatch(css, /#3aa655|#e0a100|#d0453a|feTurbulence/, 'no traffic lights, no grain');
  assert.match(html, /family=Fraunces:opsz,wght@9\.\.144,400&family=Inter:wght@400;500&display=swap/);
  assert.doesNotMatch(html, /Noto\+Serif\+KR/); assert.match(app, /if \(l\.id === 'ko'\) loadKorean\(\)/);
});

test('HG-10 motion: tokens in CSS, transform/opacity only, reduced motion honoured', () => {
  const kf = [...css.matchAll(/@keyframes [\w-]+\{([^@]*?\})\}/g)].map((m) => m[1]);
  assert.ok(kf.length >= 3);
  for (const k of kf) for (const prop of k.matchAll(/([a-z-]+):/g)) assert.ok(['transform', 'opacity'].includes(prop[1]), `keyframe animates ${prop[1]}`);
  // No hard-coded durations in JS animations: every duration/delay reads a CSS token.
  for (const m of app.matchAll(/(duration|delay): ([^,}]+)/g)) assert.match(m[2], /T\(|^(ms|step|half)$/, m[0]);
  assert.doesNotMatch(app, /wait\(\d/); assert.doesNotMatch(app, /EASE_|cubic-bezier/);
  for (const t of ['d-flap', 'd-flap-stagger', 'd-row-gap', 'd-header', 'd-hold', 'd-shrink', 'd-share-delay', 'd-share', 'd-exit', 'd-enter', 'd-develop']) { assert.ok(css.includes(`--${t}:`), t); assert.ok(app.includes(`T('${t}')`), t); }
  assert.match(css, /prefers-reduced-motion:reduce\)\{:root\{--d-hover:0ms;[^}]*--d-share-delay:0ms;--d-share:0ms\}\}/);
  assert.match(app, /const reduced = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(app, /if \(reduced\) \{ row\.cells\.forEach/);
  assert.match(app, /visibilitychange[\s\S]*?iterations === Infinity/);
  assert.match(app, /flapSteps\(cell\.textContent, target\[k\], 7\)/);
});

test('HG-10 journey: back goes one step; exactly 3 favourites; HG-5 data model intact', () => {
  for (const s of ["nav('lang')", "nav('city')", "nav('fav', i)", "nav('reveal')", "addEventListener('popstate'", 'if (i >= JOURNEY_FAVS) return morph();']) assert.ok(app.includes(s), s);
  assert.equal(JOURNEY_FAVS, 3);
  assert.match(app, /settleFavourites\(S\.favs, S\.pending, matches\)/);
  assert.match(app, /const key = `\$\{pick\}\|\$\{S\.pending\.length \+ S\.favs\.length\}`/);
  assert.match(app, /results\.slice\(0, 3\)/);
});
