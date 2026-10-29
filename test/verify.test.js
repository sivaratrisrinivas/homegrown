import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdb, verifyShow, showDifficulty, pickWatchLink } from '../lib/tmdb.js';
import { createMusicBrainz, verifyArtist, MB_USER_AGENT } from '../lib/musicbrainz.js';
import { createItunes } from '../lib/itunes.js';
import { CITIES } from '../lib/cities.js';
import { fakeFetch, json, fixture } from './helpers.js';

const MX = CITIES.mexico_city, KR = CITIES.seoul, FR = CITIES.paris;
const tmdbFix = fixture('tmdb_search');
const tmdbFetch = () => fakeFetch([['/search/tv', (u) => json({ results: tmdbFix[new URL(u).searchParams.get('query')] || [] })]]);

test('TMDB: missing key fails gracefully', async () => {
  await assert.rejects(createTmdb({ fetch: tmdbFetch(), env: {} }).searchTv('x'), (e) => e.code === 'missing_key' && e.keyName === 'TMDB_API_KEY');
});
test('TMDB: v3 key as param, v4 token as bearer', async () => {
  const f = tmdbFetch();
  await createTmdb({ fetch: f, env: { TMDB_API_KEY: 'short' } }).searchTv('Diablero');
  assert.ok(f.calls[0].url.includes('api_key=short'));
  const g = tmdbFetch();
  await createTmdb({ fetch: g, env: { TMDB_API_KEY: 'x'.repeat(60) } }).searchTv('Diablero');
  assert.ok(g.calls[0].init.headers.authorization.startsWith('Bearer '));
  assert.ok(!g.calls[0].url.includes('api_key'));
});
test('TMDB: native accepted, anime and US shows rejected', async () => {
  const t = createTmdb({ fetch: tmdbFetch(), env: { TMDB_API_KEY: 'k' } });
  assert.equal((await verifyShow(t, { name: 'Diablero', year: 2018 }, MX)).ok, true);
  assert.equal((await verifyShow(t, { name: 'Attack on Titan' }, MX)).reason, 'not_native');
  assert.equal((await verifyShow(t, { name: 'Narcos' }, MX)).reason, 'not_native');
  assert.equal((await verifyShow(t, { name: 'Nope' }, MX)).reason, 'no_tmdb_match');
  assert.equal((await verifyShow(t, { name: 'Diablero' }, KR)).ok, false);
});
test('difficulty + watch link', () => {
  assert.equal(showDifficulty([16]), 'easy'); assert.equal(showDifficulty([80]), 'hard'); assert.equal(showDifficulty([18]), 'medium');
  const p = { IN: { link: 'https://tmdb/in', flatrate: [{ provider_name: 'Netflix' }] }, US: { link: 'https://tmdb/us' } };
  assert.deepEqual(pickWatchLink(p, 'IN'), { url: 'https://tmdb/in', provider: 'Netflix', country: 'IN', attribution: 'JustWatch via TMDB' });
  assert.equal(pickWatchLink(p, 'GB').country, 'US');
  assert.equal(pickWatchLink({}, 'GB'), null);
});

test('MusicBrainz: User-Agent, <=1 req/s, country check', async () => {
  const artists = {
    'Natalia Lafourcade': [{ id: 'mb1', name: 'Natalia Lafourcade', score: 100, country: 'MX' }],
    'BTS': [{ id: 'mb2', name: 'BTS', score: 100, area: { name: 'South Korea', 'iso-3166-1-codes': ['KR'] } }],
    'Daft Punk': [{ id: 'mb3', name: 'Daft Punk', score: 100, country: 'FR' }],
    'Bad Bunny': [{ id: 'mb4', name: 'Bad Bunny', score: 100, country: 'PR' }],
  };
  const f = fakeFetch([['musicbrainz.org', (u) => json({ artists: artists[/artist:"(.+)"/.exec(new URL(u).searchParams.get('query'))[1]] || [] })]]);
  let t = 0; const sleeps = [];
  const mb = createMusicBrainz({ fetch: f, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  assert.equal((await verifyArtist(mb, { name: 'Natalia Lafourcade' }, MX)).ok, true);
  assert.equal((await verifyArtist(mb, { name: 'BTS' }, KR)).ok, true);
  assert.equal((await verifyArtist(mb, { name: 'Daft Punk' }, FR)).ok, true);
  assert.equal((await verifyArtist(mb, { name: 'Bad Bunny' }, MX)).ok, false);
  assert.equal((await verifyArtist(mb, { name: 'Unknown' }, MX)).reason, 'no_musicbrainz_match');
  assert.ok(f.calls.every((c) => c.init.headers['User-Agent'] === MB_USER_AGENT));
  assert.match(MB_USER_AGENT, /^Homegrown\/[\d.]+ \( https?:\/\/.+ \)$/);
  assert.ok(sleeps.length >= 4 && sleeps.every((s) => s >= 1000), 'spaced at least 1 s');
});

test('iTunes: preview search params', async () => {
  const f = fakeFetch([['itunes.apple.com', { results: [{ previewUrl: 'https://p', trackName: 'T' }] }]]);
  assert.deepEqual(await createItunes({ fetch: f }).previewForArtist('IU', 'kr'), { url: 'https://p', track: 'T' });
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get('media'), 'music'); assert.equal(u.searchParams.get('country'), 'kr');
});
