import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, POOL, CANDIDATES, nativeRate, MAX_SCREEN_CHECKS, summariseRejected } from '../lib/twin.js';
import { createCache } from '../lib/cache.js';
import { musicLanguageSignal } from '../lib/musicbrainz.js';
import { verifyShow, verifyMovie } from '../lib/tmdb.js';
import { CITIES, LANGUAGES } from '../lib/cities.js';
import { cityStatus, loadGate, liveCategories, requireLiveCategory, catalogue, suggestCity, thinNote } from '../lib/gate.js';
import { retryable } from '../lib/qloo.js';
import { FAVS, liftCities } from './helpers.js';

const g = (slug) => ({ id: `urn:tag:genre:music:${slug}`, name: slug });
const KOL = { id: 'kolkata', name: 'Kolkata', localName: 'কলকাতা', country: 'IN', language: 'bn', countryNames: ['india'], musicLanguageTags: ['bengali', 'bangla'], musicConflictTags: ['hindi', 'bollywood', 'tamil'] };

test('HG-9 music: a language tag is required; country alone is not enough', () => {
  assert.equal(musicLanguageSignal({ tags: [g('indian')] }, KOL).ok, false, 'Indian but no Bengali signal');
  assert.equal(musicLanguageSignal({ tags: [g('bengali'), g('indian')] }, KOL).ok, true);
  assert.equal(musicLanguageSignal({ tags: [g('bangla_rock')] }, KOL).ok, true, 'prefix stem match');
  assert.equal(musicLanguageSignal({ tags: [g('bengalis')] }, KOL).ok, false, 'no loose substring match');
  assert.equal(musicLanguageSignal({ tags: [{ id: 'urn:tag:keyword:qloo:bengali', name: 'b' }] }, KOL).ok, false, 'only genre tags count');
});

test('HG-9 music: another language of the same country is a conflict (Vishal Dadlani in Kolkata)', () => {
  const r = musicLanguageSignal({ tags: [g('hindi'), g('bengali'), g('bollywood')] }, KOL);
  assert.equal(r.ok, false); assert.deepEqual(r.conflict, ['hindi', 'bollywood']);
});

test('HG-9 music: language filter runs on the Qloo pool before the top 15 and before MusicBrainz', async () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'h' + i, name: 'Hindi' + i, tags: [g('hindi')] })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, name: 'Tamil' + i, tags: [g('tamil')] })),
  ];
  const asked = []; const calls = [];
  const qloo = { insights: async (a) => { calls.push(a); return pool; } };
  const mb = { searchArtist: async (n) => { asked.push(n); return [{ id: n, name: n, score: 100, country: 'IN' }]; } };
  const s = createTwinService({ qloo, tmdb: {}, mb, itunes: { previewForArtist: async () => null } });
  const m = await s.measure({ favourites: FAVS, cityId: 'chennai', category: 'music' });
  assert.equal(calls[0].take, POOL); assert.equal(calls[0].extra['filter.tags'], 'urn:tag:genre:music:tamil');
  assert.equal(asked.length, CANDIDATES); assert.ok(asked.every((n) => n.startsWith('Tamil')));
  assert.deepEqual([m.seen, m.accepted, m.filtered], [15, 15, 10]);
});

const tv = (rows) => ({ searchTv: async (q) => rows.filter((r) => r.name === q) });
const show = (name, lang, cc = ['IN']) => ({ id: name, name, original_language: lang, origin_country: cc });

test('HG-9 TV: language is checked before country; Hindi from India is off_language in Chennai', async () => {
  const t = tv([show('A', 'hi'), show('B', 'ta', ['LK']), show('C', 'ta')]);
  assert.equal((await verifyShow(t, { name: 'A' }, CITIES.chennai)).reason, 'off_language');
  assert.equal((await verifyShow(t, { name: 'B' }, CITIES.chennai)).reason, 'not_native', 'Tamil but Sri Lankan');
  assert.equal((await verifyShow(t, { name: 'C' }, CITIES.chennai)).ok, true);
  const mv = { searchMovie: async () => [{ id: 1, title: 'M', original_language: 'hi' }], movieDetails: async () => { throw new Error('not needed'); } };
  assert.equal((await verifyMovie(mv, { name: 'M' }, CITIES.chennai)).reason, 'off_language');
});

test('HG-9 TV: Qloo pool of 50 with the language tag; top 15 counted only from the language-matched pool', async () => {
  const names = [...Array.from({ length: 20 }, (_, i) => 'H' + i), 'Nope', ...Array.from({ length: 25 }, (_, i) => 'T' + i)];
  const rows = [...names.filter((n) => n[0] === 'H').map((n) => show(n, 'hi')), ...names.filter((n) => n[0] === 'T').map((n, i) => show(n, 'ta', i % 5 === 0 ? ['LK'] : ['IN']))];
  const calls = []; const searched = [];
  const qloo = { insights: async (a) => { calls.push(a); return names.map((n) => ({ id: n, name: n, tags: [] })); } };
  const tmdb = { ...tv(rows), searchTv: async (q) => { searched.push(q); return rows.filter((r) => r.name === q); }, watchProviders: async () => ({}) };
  const s = createTwinService({ qloo, tmdb, mb: {}, itunes: {} });
  const m = await s.measure({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(calls[0].take, POOL);
  assert.equal(calls[0].extra['signal.interests.tags'], 'urn:tag:keyword:qloo:tamil_cinema');
  assert.equal(calls[0].extra['filter.release_country'], 'India');
  assert.equal(m.seen, CANDIDATES, 'exactly 15 language-matched candidates measured');
  assert.equal(m.accepted, 11, 'Nope (no TMDB match) fails; T0, T5, T10 are Tamil but not Indian');
  assert.equal(m.filtered, 20, 'only the 20 Hindi titles are filtered');
  assert.ok(!searched.includes('T14'), 'stops after the 15th measured candidate');
});

test('HG-9: prefilter reasons stay out of the native rate', () => {
  assert.deepEqual(nativeRate([{}], [{ reason: 'off_language' }, { reason: 'no_tmdb_match' }, { reason: 'not_native' }]), { seen: 3, accepted: 1, pct: 33 }, 'no_tmdb_match counts as a failure');
});

test('HG-9 config: every city has music language tags; Indian cities list the other languages as conflicts', () => {
  for (const id of ['hi', 'ta', 'es', 'ko', 'fr']) assert.ok(LANGUAGES.some((l) => l.id === id), id);
  for (const c of Object.values(CITIES)) {
    assert.ok(c.musicLanguageTags?.length, `${c.id}.musicLanguageTags`);
    for (const t of c.musicConflictTags || []) assert.ok(!c.musicLanguageTags.includes(t), `${c.id} conflicts with itself: ${t}`);
    if (c.country === 'IN') assert.ok(c.musicConflictTags?.length, c.id); // screenTag optional (HG-11: no Punjabi tag)
  }
});

test('HG-9 gate: a tiny language-filtered pool (2/2) is not enough to go live', () => {
  const r = (seen, accepted) => ({ seen, accepted });
  const g = { threshold: 0.6, minSeen: 5, categories: ['tv', 'movie', 'music'], results: { x: { tv: r(2, 2), movie: r(15, 15), music: r(15, 12) }, y: { tv: r(5, 3), movie: r(15, 15), music: r(15, 12) } } };
  assert.equal(cityStatus(g, 'x').live, false); assert.equal(cityStatus(g, 'y').live, true);
});

test('HG-9 measured gate: all 9 cities live on movies; each live category has >= minSeen and records languageShare', () => {
  const g = loadGate();
  for (const id of ['mexico_city', 'madrid', 'buenos_aires', 'seoul', 'paris', 'chennai', 'mumbai', 'hyderabad']) assert.equal(cityStatus(g, id).live, true, id);
  // HG-14: Kolkata fell below 60% under the HG-14 origin rule (4/7); it is gated, not removed.
  assert.equal(cityStatus(g, 'kolkata').live, false); assert.ok(CITIES.kolkata);
  for (const [id, res] of Object.entries(g.results)) for (const k of liveCategories(g)) {
    assert.ok(res[k].seen >= g.minSeen, `${id}.${k}`);
    assert.equal(res[k].languageShare, Math.round((100 * res[k].seen) / (res[k].seen + res[k].filtered)) / 100, `${id}.${k} share`);
  }
  assert.equal(cityStatus({ ...g, results: { chennai: { ...g.results.chennai, tv: { ...g.results.chennai.tv, languageShare: 0.01 } } } }, 'chennai').live, true, 'language share is not gated');
  assert.equal(CITIES.mumbai.language, 'hi');
});

const screenSvc = (names, rows, extra = {}) => {
  const searched = [];
  const qloo = { insights: async () => names.map((n) => ({ id: n, name: n, tags: [] })) };
  const tmdb = { searchTv: async (q) => { searched.push(q); return rows.filter((r) => r.name === q); }, watchProviders: async () => ({}) };
  return { s: createTwinService({ qloo, tmdb, mb: {}, itunes: {}, ...extra }), searched };
};

test('HG-11 runtime: the same-language pool stops at CANDIDATES (15); measure checks every candidate', async () => {
  const names = Array.from({ length: 50 }, (_, i) => 'T' + i);
  // Same-language but not native (Tamil from Sri Lanka): 15 of them fill the pool.
  const a = screenSvc(names, names.map((n) => show(n, 'ta', ['LK'])));
  const r = await a.s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(a.searched.length, CANDIDATES);
  assert.equal(r.rejected.filter((x) => x.reason === 'check_cap').length, 0);
  const b = screenSvc(names, names.map((n) => show(n, 'hi')));
  await b.s.measure({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(b.searched.length, 50);
});

test('HG-11 runtime: check_cap fires at 40 TMDB checks on a realistic 50-item off-language pool', async () => {
  assert.equal(MAX_SCREEN_CHECKS, 40);
  const names = Array.from({ length: POOL }, (_, i) => 'H' + i);
  const a = screenSvc(names, names.map((n) => show(n, 'hi')));
  const r = await a.s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(a.searched.length, MAX_SCREEN_CHECKS);
  assert.equal(r.rejected.filter((x) => x.reason === 'check_cap').length, POOL - MAX_SCREEN_CHECKS);
});

test('HG-9 review: all-prefilter rejections give a language-scarcity note, not the origin-check note', async () => {
  const names = ['H1', 'H2', 'T1'];
  const { s } = screenSvc(names, [show('H1', 'hi'), show('H2', 'hi'), show('T1', 'ta')]);
  const r = await s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(r.picks.length, 1);
  assert.match(r.note, /Tamil shows are scarce for your taste: Qloo mostly suggested shows in other languages for Chennai/);
  assert.doesNotMatch(r.note, /origin check/);
  const z = screenSvc(['H1'], [show('H1', 'hi')]);
  assert.match((await z.s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' })).note, /^No Tamil shows came up/);
  const mixed = screenSvc(['H1', 'X'], [show('H1', 'hi')]);
  assert.match((await mixed.s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' })).note, /origin check/, 'a no_tmdb_match is not a prefilter');
});

test('HG-9 review: cache stores reason counts and at most 10 example names', async () => {
  const sum = summariseRejected(Array.from({ length: 30 }, (_, i) => ({ name: 'N' + i, reason: i < 20 ? 'off_language' : 'not_native', extra: 'x' })));
  assert.deepEqual(sum.counts, { off_language: 20, not_native: 10 });
  assert.equal(sum.examples.length, 10); assert.deepEqual(Object.keys(sum.examples[0]), ['name', 'reason']);
  const store = new Map();
  const cache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const names = Array.from({ length: 20 }, (_, i) => 'H' + i);
  const logs = [];
  const { s } = screenSvc(names, names.map((n) => show(n, 'hi')), { cache, log: (e) => logs.push(e) });
  await s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  const [stored] = [...store.values()];
  assert.equal(stored.rejected, undefined, 'no full rejected array in the cache');
  assert.deepEqual(stored.rejectedSummary.counts, { off_language: 20 });
  assert.equal(stored.rejectedSummary.examples.length, 10);
  const hit = await s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(hit.cached, true);
  assert.deepEqual(logs.filter((l) => l.event === 'native_rate').map((l) => l.seen), [0, 0]);
  void createCache;
});

test('HG-9 review: punjabi stays a Mumbai music conflict tag', () => {
  assert.ok(CITIES.mumbai.musicConflictTags.includes('punjabi'));
  assert.equal(musicLanguageSignal({ tags: [g('hindi'), g('punjabi')] }, CITIES.mumbai).ok, false);
});

test('v1 movies only: liveCategories switch, 403 guard, liveness judged on movies', () => {
  const g = loadGate();
  assert.deepEqual(liveCategories(g), ['movie']);
  assert.deepEqual(liveCategories({ categories: ['tv', 'movie'] }), ['tv', 'movie'], 'falls back to categories');
  assert.throws(() => requireLiveCategory(g, 'tv'), (e) => e.status === 403);
  assert.throws(() => requireLiveCategory(g, 'music'), (e) => e.status === 403);
  requireLiveCategory(g, 'movie');
  const bad = { ...g, results: { x: { movie: { seen: 10, accepted: 9 }, tv: { seen: 10, accepted: 0 }, music: { seen: 0, accepted: 0 } } } };
  assert.equal(cityStatus(bad, 'x').live, true, 'failing TV/music does not block a movie-live city');
  assert.equal(cityStatus({ ...bad, liveCategories: undefined }, 'x').live, false);
  assert.equal(cityStatus(g, 'hyderabad').live, true);
  assert.equal(cityStatus(g, 'kolkata').live, false, 'HG-14: gated on movies');
  assert.equal(cityStatus(liftCities(g, ['kolkata']), 'kolkata').live, true, 'back once movies pass');
  assert.equal(CITIES.hyderabad.language, 'te'); assert.equal(CITIES.kolkata.language, 'bn');
});

test('retryable: 504 from Qloo retries, the measure deadline and other statuses do not', () => {
  assert.equal(retryable({ status: 504 }), true);
  assert.equal(retryable({ upstreamStatus: 504 }), true);
  assert.equal(retryable({ status: 504, reason: 'deadline' }), false);
  assert.equal(retryable({ status: 502 }), false);
  assert.equal(retryable(undefined), false);
});

test('round 3: with only movie live, a reveal with movie landed is not pending', async () => {
  const { liveCats, pendingCats } = await import('../public/logic.js');
  const cat = catalogue(loadGate());
  const cats = liveCats(cat);
  assert.deepEqual(cats, ['movie']);
  assert.deepEqual(pendingCats(cats, { movie: { picks: [] } }), []);
  assert.deepEqual(pendingCats(cats, {}), ['movie']);
  assert.deepEqual(liveCats(null), ['tv', 'movie', 'music']);
  assert.ok(cat.cities.every((c) => c.lead === null), 'lead hidden with one live category');
});

test('round 3: suggestCity ignores dead categories', () => {
  const g = { threshold: 0.6, minSeen: 5, categories: ['tv', 'movie', 'music'], liveCategories: ['movie'], results: {
    madrid: { movie: { seen: 10, accepted: 7 }, tv: { seen: 10, accepted: 0 }, music: { seen: 10, accepted: 0 } },
    mexico_city: { movie: { seen: 10, accepted: 9 }, tv: { seen: 10, accepted: 10 }, music: { seen: 10, accepted: 10 } },
    buenos_aires: { movie: { seen: 10, accepted: 10 }, tv: { seen: 0, accepted: 0 }, music: { seen: 0, accepted: 0 } } } };
  const s = suggestCity(g, 'es');
  assert.equal(s.city, 'buenos_aires');
  assert.deepEqual(s.candidates.map((c) => c.floor), [100, 90, 70]);
});

test('round 3: thin-pool note comes from gate data (seen < 10 or share < 30%)', () => {
  const g = loadGate();
  const cat = catalogue(g);
  const by = Object.fromEntries(cat.cities.map((c) => [c.id, c.thinNote]));
  assert.equal(by.kolkata, 'Fewer Bengali films to draw from, so you may see only a few picks.');
  assert.equal(by.madrid, null);
  assert.equal(thinNote({ ...g, results: { ...g.results, madrid: { movie: { seen: 15, accepted: 14, languageShare: 0.2 } } } }, 'madrid'), 'Fewer Spanish films to draw from, so you may see only a few picks.');
  assert.equal(thinNote({ ...g, results: { ...g.results, seoul: { movie: { seen: 6, accepted: 6, languageShare: 1 } } } }, 'seoul'), 'Fewer Korean films to draw from, so you may see only a few picks.');
});

test('round 4: liveCats treats an empty list as missing; categoryWords has a default', async () => {
  const { liveCats, categoryWords } = await import('../public/logic.js');
  assert.deepEqual(liveCats({ categories: [] }), ['tv', 'movie', 'music']);
  assert.deepEqual(liveCats({}), ['tv', 'movie', 'music']);
  assert.deepEqual(liveCats({ categories: ['music', 'movie'] }), ['movie', 'music']);
  assert.equal(categoryWords(), 'TV, movies and music');
  assert.equal(categoryWords([]), 'TV, movies and music');
  assert.equal(categoryWords(['movie']), 'movies');
});

test('HG-11 runtime: native films after 20 off-language ones are still reached within the ceiling', async () => {
  const names = Array.from({ length: 50 }, (_, i) => (i < 20 ? 'H' : 'T') + i);
  const a = screenSvc(names, names.map((n) => show(n, n[0] === 'H' ? 'hi' : 'ta')));
  const r = await a.s.category({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(r.picks.length, 5);
  assert.equal(r.rejected.filter((x) => x.reason === 'check_cap').length, 0);
});
