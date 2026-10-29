import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdb, verifyShow } from '../lib/tmdb.js';
import { createQloo, QLOO_MAX_BACKOFF_MS } from '../lib/qloo.js';
import { createItunes } from '../lib/itunes.js';
import { verifyPlace } from '../lib/places.js';
import { createTwinService } from '../lib/twin.js';
import { createCache } from '../lib/cache.js';
import { normaliseEntity } from '../lib/qloo.js';
import { CITIES } from '../lib/cities.js';
import { fakeFetch, json, fixture, FAVS } from './helpers.js';

const MX = CITIES.mexico_city;

test('TMDB: no results[0] fallback when the title does not match', async () => {
  const f = fakeFetch([['/search/tv', { results: [{ id: 9, name: 'Something Else', original_name: 'Otra Cosa', original_language: 'es', origin_country: ['MX'] }] }]]);
  const v = await verifyShow(createTmdb({ fetch: f, env: { TMDB_API_KEY: 'k' } }), { name: 'Diablero', year: 2018 }, MX);
  assert.equal(v.ok, false); assert.equal(v.reason, 'no_tmdb_match');
  assert.equal(f.calls.length, 2, 'retries without year before giving up');
});

test('Qloo backoff is capped', async () => {
  let n = 0; const sleeps = [];
  const f = fakeFetch([['/search', () => (++n === 1 ? json({}, 429, { 'retry-after': '3600' }) : json(fixture('qloo_search')))]]);
  await createQloo({ fetch: f, env: { QLOO_API_KEY: 'k' }, sleep: async (ms) => sleeps.push(ms), gapMs: 0 }).search('a');
  assert.ok(sleeps.every((s) => s <= QLOO_MAX_BACKOFF_MS)); assert.ok(sleeps.includes(QLOO_MAX_BACKOFF_MS));
});

test('iTunes: Range retry gets its own timeout signal', async () => {
  const signals = [];
  const f = async (u, init) => { signals.push(init.signal); return signals.length === 1 ? new Response('', { status: 500 }) : new Response('<language>fr</language>'); };
  assert.equal(await createItunes({ fetch: f, timeoutMs: 1000 }).feedLanguage('http://feed'), 'fr');
  assert.equal(signals.length, 2); assert.notEqual(signals[0], signals[1]); assert.equal(signals[1].aborted, false);
});

test('places: "New Mexico" does not pass for Mexico City', () => {
  assert.equal(verifyPlace({ name: 'Taco Hut', address: '1 Main St, Santa Fe, New Mexico 87501' }, MX).ok, false);
  assert.equal(verifyPlace({ name: 'Taco Hut', address: 'Albuquerque, NM, USA' }, MX).ok, false);
  assert.equal(verifyPlace({ name: 'Contramar', address: 'Durango 200, Roma Nte., 06700 Ciudad de México, CDMX, Mexico' }, MX).ok, true);
  assert.equal(verifyPlace({ name: 'Le Comptoir', address: '9 Carrefour de l\'Odéon, 75006 Paris, France' }, CITIES.paris).ok, true);
});

function svc(tmdbFetch, cache) {
  const qcalls = [];
  const qloo = { insights: async (a) => { qcalls.push(a); return fixture('qloo_tv').results.entities.map(normaliseEntity); } };
  const tmdb = createTmdb({ env: { TMDB_API_KEY: 'k' }, fetch: tmdbFetch });
  return { s: createTwinService({ qloo, tmdb, mb: {}, itunes: {}, cache }), qcalls };
}
const tmdbFix = fixture('tmdb_search');

test('one failing candidate check does not sink the category', async () => {
  const f = fakeFetch([
    ['query=Attack', () => json({}, 500)],
    ['/search/tv', (u) => json({ results: tmdbFix[new URL(u).searchParams.get('query')] || [] })],
    ['/watch/providers', () => json({}, 500)],
  ]);
  const r = await svc(f).s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'tv' });
  assert.deepEqual(r.picks.map((p) => p.title), ['Diablero', 'Club de Cuervos']);
  assert.equal(r.rejected.find((x) => x.name === 'Attack on Titan').reason, 'verify_error');
  assert.equal(r.picks[0].watch, null);
});

test('TV cache key includes userCountry; bad userCountry defaults to US', async () => {
  const f = fakeFetch([
    ['/search/tv', (u) => json({ results: tmdbFix[new URL(u).searchParams.get('query')] || [] })],
    ['/watch/providers', { results: { IN: { link: 'https://in' }, US: { link: 'https://us' } } }],
  ]);
  const { s, qcalls } = svc(f, createCache());
  const a = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'tv', userCountry: 'in' });
  const b = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'tv', userCountry: 'US' });
  const c = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'tv', userCountry: '<script>' });
  assert.equal(a.picks[0].watch.url, 'https://in'); assert.equal(b.picks[0].watch.url, 'https://us');
  assert.equal(c.cached, true); assert.equal(qcalls.length, 2);
});

import { createMusicBrainz } from '../lib/musicbrainz.js';
test('MusicBrainz 503 is retried with backoff', async () => {
  let n = 0; const sleeps = [];
  const f = async () => (++n < 3 ? new Response('', { status: 503 }) : json({ artists: [{ name: 'IU' }] }));
  const r = await createMusicBrainz({ fetch: f, sleep: async (ms) => sleeps.push(ms) }).searchArtist('IU');
  assert.equal(r[0].name, 'IU'); assert.equal(n, 3); assert.ok(sleeps.includes(2000) && sleeps.includes(4000));
});
test('TV uses Qloo country names for filter.release_country', () => {
  assert.deepEqual(Object.values(CITIES).map((c) => c.releaseCountry), ['Mexico', 'South Korea', 'France']);
});
