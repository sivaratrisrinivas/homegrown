import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, CATEGORIES, SHORT_TTL_MS } from '../lib/twin.js';
import { createTmdb, verifyMovie } from '../lib/tmdb.js';
import { createQloo, normaliseEntity } from '../lib/qloo.js';
import { createCache } from '../lib/cache.js';
import { validateFeedback } from '../lib/feedback.js';
import { CITIES } from '../lib/cities.js';
import { fakeFetch, json, fixture, FAVS } from './helpers.js';

const MX = CITIES.mexico_city;
const base = { favourites: FAVS, cityId: 'mexico_city' };
const MOVIES = {
  'Roma': { s: [{ id: 1, title: 'Roma', original_title: 'Roma', original_language: 'es', genre_ids: [18], poster_path: '/r.jpg' }], d: { origin_country: ['MX'], production_countries: [{ iso_3166_1: 'MX' }, { iso_3166_1: 'US' }] } },
  'Pan\'s Labyrinth': { s: [{ id: 2, title: 'Pan\'s Labyrinth', original_title: 'El laberinto del fauno', original_language: 'es', genre_ids: [14] }], d: { origin_country: ['ES'], production_countries: [{ iso_3166_1: 'ES' }] } },
  'Coco': { s: [{ id: 3, title: 'Coco', original_title: 'Coco', original_language: 'en', genre_ids: [16] }], d: { production_countries: [{ iso_3166_1: 'US' }] } },
  'Amores Perros': { s: [{ id: 4, title: 'Love\'s a Bitch', original_title: 'Amores perros', original_language: 'es', genre_ids: [80] }], d: { production_countries: [{ iso_3166_1: 'MX' }] } },
  'Y Tu Mamá También': { s: [{ id: 5, title: 'Something Else', original_title: 'Otra', original_language: 'es' }], d: {} },
};
const tmdbFetch = () => fakeFetch([
  ['/search/movie', (u) => json({ results: MOVIES[new URL(u).searchParams.get('query')]?.s || [] })],
  ['/watch/providers', { results: { US: { link: 'https://w', flatrate: [{ provider_name: 'Netflix' }] } } }],
  ['/movie/', (u) => { const id = Number(/movie\/(\d+)/.exec(u)[1]); return json(Object.values(MOVIES).find((m) => m.s[0].id === id).d); }],
]);
const tmdb = () => createTmdb({ fetch: tmdbFetch(), env: { TMDB_API_KEY: 'k' } });

test('categories: v1 is TV, movies and music only', () => {
  assert.deepEqual(CATEGORIES, ['tv', 'movie', 'music']);
});

test('verifyMovie: exact title, language, production/origin country; no fallback', async () => {
  const t = tmdb();
  const roma = await verifyMovie(t, { name: 'Roma', year: 2018 }, MX);
  assert.equal(roma.ok, true); assert.ok(roma.countries.includes('MX'));
  assert.equal((await verifyMovie(t, { name: 'Pan\'s Labyrinth' }, MX)).reason, 'not_native', 'Spanish but made in Spain');
  assert.equal((await verifyMovie(t, { name: 'Coco' }, MX)).reason, 'off_language', 'US film about Mexico');
  assert.equal((await verifyMovie(t, { name: 'Amores Perros' }, MX)).ok, true, 'matches original_title');
  assert.equal((await verifyMovie(t, { name: 'Y Tu Mamá También', year: 2001 }, MX)).reason, 'no_tmdb_match');
});

test('movie year: searched with primary_release_year, retried without', async () => {
  const f = tmdbFetch();
  await verifyMovie(createTmdb({ fetch: f, env: { TMDB_API_KEY: 'k' } }), { name: 'Nope', year: 1999 }, MX);
  const urls = f.calls.map((c) => new URL(c.url));
  assert.equal(urls[0].searchParams.get('primary_release_year'), '1999');
  assert.equal(urls[1].searchParams.get('primary_release_year'), null);
});

function movieSvc({ ents, now, cache, tmdbImpl } = {}) {
  const qcalls = [];
  const qloo = { insights: async (a) => { qcalls.push(a); return ents.map((n, i) => normaliseEntity({ entity_id: 'm' + i, name: n })); } };
  return { s: createTwinService({ qloo, tmdb: tmdbImpl || tmdb(), cache, now }), qcalls };
}

test('movie category: Qloo filter by country name, strict no padding, watch link', async () => {
  const { s, qcalls } = movieSvc({ ents: ['Coco', 'Pan\'s Labyrinth', 'Roma'] });
  const r = await s.category({ ...base, category: 'movie' });
  assert.equal(qcalls[0].type, 'urn:entity:movie');
  assert.equal(qcalls[0].extra['filter.release_country'], 'Mexico');
  assert.deepEqual(r.picks.map((p) => p.title), ['Roma']);
  assert.equal(r.picks[0].watch.provider, 'Netflix');
  assert.equal(r.picks[0].category, 'movie');
  const { s: s0 } = movieSvc({ ents: ['Coco', 'Pan\'s Labyrinth'] });
  const r0 = await s0.category({ ...base, category: 'movie' });
  assert.equal(r0.picks.length, 0); assert.match(r0.note, /films.*not showing a fake/);
});

test('movie: per-candidate errors + short TTL', async () => {
  let t = 0; const cache = createCache({ now: () => t });
  const bad = fakeFetch([['query=Coco', () => json({}, 500)], ['/search/movie', (u) => json({ results: MOVIES[new URL(u).searchParams.get('query')]?.s || [] })],
    ['/watch/providers', () => json({}, 500)], ['/movie/', () => json(MOVIES.Roma.d)]]);
  const { s } = movieSvc({ ents: ['Coco', 'Roma'], cache, now: () => t, tmdbImpl: createTmdb({ fetch: bad, env: { TMDB_API_KEY: 'k' }, now: () => t }) });
  const r = await s.category({ ...base, category: 'movie' });
  assert.deepEqual(r.picks.map((p) => p.title), ['Roma']); assert.equal(r.picks[0].watch, null);
  assert.equal(r.rejected[0].reason, 'verify_error');
  t = SHORT_TTL_MS + 1;
  assert.notEqual((await s.category({ ...base, category: 'movie' })).cached, true);
});

test('review 4: TV loop honours the deadline', async () => {
  let t = 0;
  const slow = { searchTv: async () => { t += 30000; return []; }, watchProviders: async () => ({}) };
  const qloo = { insights: async () => fixture('qloo_tv').results.entities.map(normaliseEntity) };
  const r = await createTwinService({ qloo, tmdb: slow, now: () => t }).category({ ...base, category: 'tv' });
  assert.ok(r.rejected.some((x) => x.reason === 'deadline'));
});

test('review 4: deadline fixed at request entry and passed to Qloo', async () => {
  let t = 1000; const seen = [];
  const qloo = { insights: async (a) => { seen.push(a.deadline); return []; } };
  await createTwinService({ qloo, now: () => t }).category({ ...base, category: 'music' });
  assert.equal(seen[0], 1000 + 50000);
});

test('review 4: Qloo stops retrying near the deadline', async () => {
  let t = 0, n = 0;
  const f = fakeFetch([['/v2/insights', () => { n++; return json({}, 429); }]]);
  const q = createQloo({ fetch: f, env: { QLOO_API_KEY: 'k' }, now: () => t, sleep: async (ms) => { t += ms; }, gapMs: 7000 });
  await assert.rejects(q.insights({ type: 'x', signalIds: ['a'], deadline: 20000 }), (e) => e.status === 429);
  assert.ok(n <= 2, `calls ${n}`); assert.ok(t < 20000);
  t = 30000;
  await assert.rejects(q.insights({ type: 'x', signalIds: ['a'], deadline: 20000 }), (e) => e.status === 504);
});

test('review 4: feedback shown -> bounded strings, max 10', () => {
  const v = validateFeedback({ event: 'rating', rating: 5, shown: [...Array(15)].map((_, i) => (i === 0 ? { category: 'tv', title: 'x'.repeat(500), verification: 'tmdb' } : i === 1 ? { evil: { deep: 1 } } : 'p' + i)) });
  assert.equal(v.value.shown.length, 10);
  assert.ok(v.value.shown.every((s) => typeof s === 'string' && s.length <= 200));
  assert.match(v.value.shown[0], /^tv:x+/);
});

test('podcast and place categories are gone from the API', async () => {
  for (const category of ['podcast', 'place']) await assert.rejects(createTwinService({ qloo: {} }).category({ ...base, category }), (e) => e.status === 400);
});

import { nativeRate } from '../lib/twin.js';
test('native rate logged per request: counts only, no titles or user text', async () => {
  assert.deepEqual(nativeRate([{}], [{ reason: 'not_native' }, { reason: 'deadline' }]), { seen: 2, accepted: 1, pct: 50 });
  assert.deepEqual(nativeRate([], []), { seen: 0, accepted: 0, pct: null });
  const logs = [];
  const { s } = { s: createTwinService({ qloo: { insights: async () => ['Coco', 'Roma'].map((n, i) => normaliseEntity({ entity_id: 'm' + i, name: n })) }, tmdb: tmdb(), log: (o) => logs.push(o) }) };
  await s.category({ ...base, category: 'movie' });
  const rate = logs.find((l) => l.event === 'native_rate');
  assert.deepEqual(rate, { event: 'native_rate', category: 'movie', city: 'mexico_city', seen: 1, accepted: 1, pct: 100 }, 'Coco is English, so the language filter drops it before the measured pool');
  const text = JSON.stringify(logs);
  for (const bad of ['Roma', 'Coco', 'Breaking Bad', 'Radiohead', 'TMDB_API_KEY']) assert.ok(!text.includes(bad), bad);
});
