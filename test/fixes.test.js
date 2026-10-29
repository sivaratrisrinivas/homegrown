import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdb, verifyShow } from '../lib/tmdb.js';
import { createQloo, QLOO_MAX_BACKOFF_MS } from '../lib/qloo.js';
import { createItunes } from '../lib/itunes.js';
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
  assert.deepEqual(Object.values(CITIES).map((c) => c.releaseCountry), ['Mexico', 'Spain', 'Argentina', 'South Korea', 'France', 'India']);
});

import { twinKey } from '../lib/cache.js';
import { timedFetch } from '../lib/fetch.js';
import { searchCache } from '../api/search.js';
test('review 7: cache key hashes ids only; order-independent', () => {
  const a = [{ id: '1', name: 'A', tags: [{ id: 't', name: 'crime' }] }, { id: '2', tags: [] }];
  const other = [{ id: '1', name: 'EVIL', tags: [{ id: 'evil', name: 'evil' }] }, { id: '2', tags: [] }];
  assert.equal(twinKey(a, 'seoul', 'tv'), twinKey(other, 'seoul', 'tv'));
  assert.notEqual(twinKey(a, 'seoul', 'tv'), twinKey([{ id: '1' }, { id: '3' }], 'seoul', 'tv'));
  assert.equal(twinKey(a, 'seoul', 'tv'), twinKey([...a].reverse(), 'seoul', 'tv'));
});
test('review 2: timeouts map to 504 and never echo the URL', async () => {
  const hang = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  await assert.rejects(timedFetch(hang, 'https://x/?api_key=SECRET', {}, { timeoutMs: 20, label: 'TMDB' }), (e) => e.status === 504 && !e.message.includes('SECRET'));
  await assert.rejects(timedFetch(async () => { throw new TypeError('fetch failed https://x/?api_key=SECRET'); }, 'u', {}, { timeoutMs: 1000, label: 'TMDB' }), (e) => e.status === 502 && !e.message.includes('SECRET'));
  const q = createQloo({ fetch: hang, env: { QLOO_API_KEY: 'k' }, sleep: async () => {}, timeoutMs: 20 });
  await assert.rejects(q.search('a'), (e) => e.status === 504);
  const f = fakeFetch([['/search', fixture('qloo_search')]]);
  const q2 = createQloo({ fetch: f, env: { QLOO_API_KEY: 'k' }, sleep: async () => {} });
  assert.equal((await q2.search('a')).length, 1, 'throttle chain not stalled');
  await assert.rejects(createTmdb({ fetch: hang, env: { TMDB_API_KEY: 'k' }, timeoutMs: 20 }).searchTv('x'), (e) => e.status === 504);
});
test('review 2: MusicBrainz retries bounded by budget', async () => {
  let t = 0, n = 0;
  const mb = createMusicBrainz({ fetch: async () => { n++; t += 100; return new Response('', { status: 503 }); }, sleep: async (ms) => { t += ms; }, now: () => t, retries: 10, budgetMs: 20000, timeoutMs: 8000 });
  await assert.rejects(mb.searchArtist('x'));
  assert.ok(t <= 20000, `took ${t}`); assert.ok(n < 10);
});
test('review 2: typeahead cache by (q, kind)', async () => {
  const { setDeps } = await import('../lib/deps.js');
  const handler = (await import('../api/search.js')).default;
  let calls = 0;
  setDeps({ qloo: { search: async () => { calls++; return [{ id: 'a', name: 'A', tags: [] }]; } } });
  const res = () => ({ setHeader() {}, end(b) { this.body = b; } });
  await handler({ query: { q: 'Breaking', kind: 'show' } }, res());
  await handler({ query: { q: 'breaking', kind: 'show' } }, res());
  await handler({ query: { q: 'breaking', kind: 'band' } }, res());
  assert.equal(calls, 2);
  setDeps(undefined);
});
