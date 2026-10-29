import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, parseFavourites } from '../lib/twin.js';
import { createTmdb } from '../lib/tmdb.js';
import { createCache } from '../lib/cache.js';
import { normaliseEntity } from '../lib/qloo.js';
import { fakeFetch, json, fixture, FAVS } from './helpers.js';

const tmdbFix = fixture('tmdb_search');
function svc({ qlooEntities = {}, mbArtists = {}, cache } = {}) {
  const qcalls = [];
  const qloo = { insights: async (a) => { qcalls.push(a); return (qlooEntities[a.type] || []).map(normaliseEntity); } };
  const tmdb = createTmdb({ env: { TMDB_API_KEY: 'k' }, fetch: fakeFetch([
    ['/search/tv', (u) => json({ results: tmdbFix[new URL(u).searchParams.get('query')] || [] })],
    ['/watch/providers', { results: { US: { link: 'https://w', flatrate: [{ provider_name: 'Netflix' }] } } }],
  ]) });
  const mb = { searchArtist: async (n) => mbArtists[n] || [] };
  const itunes = { previewForArtist: async () => ({ url: 'https://p.m4a' }) };
  return { s: createTwinService({ qloo, tmdb, mb, itunes, cache }), qcalls };
}
const base = { favourites: FAVS, cityId: 'mexico_city' };

test('TV: keeps only TMDB-native, applies country filter, grounded why-line', async () => {
  const { s, qcalls } = svc({ qlooEntities: { 'urn:entity:tv_show': fixture('qloo_tv').results.entities } });
  const r = await s.category({ ...base, category: 'tv' });
  assert.deepEqual(r.picks.map((p) => p.title), ['Diablero', 'Club de Cuervos']);
  assert.ok(r.picks.every((p) => p.verification.language === 'es' && p.verification.origin.includes('MX')));
  assert.equal(r.picks[0].why.grounded, true);
  assert.match(r.picks[0].why.text, /Breaking Bad.*moral decay/);
  assert.equal(r.picks[1].difficulty, 'easy');
  assert.equal(r.picks[0].watch.provider, 'Netflix');
  assert.equal(r.note, null);
  assert.equal(qcalls[0].extra['filter.release_country'], 'Mexico');
  assert.equal(qcalls[0].extra['signal.location.query'], 'Mexico City');
  assert.deepEqual(r.rejected.map((x) => x.name), ['Attack on Titan', 'Narcos']);
});

test('never pads: fewer native picks -> fewer results + honest note', async () => {
  const ents = fixture('qloo_tv').results.entities.filter((e) => e.name !== 'Club de Cuervos');
  const { s } = svc({ qlooEntities: { 'urn:entity:tv_show': ents } });
  const r = await s.category({ ...base, category: 'tv' });
  assert.equal(r.picks.length, 1);
  assert.match(r.note, /Few Spanish shows/);
  const { s: s0 } = svc({ qlooEntities: { 'urn:entity:tv_show': ents.filter((e) => e.name !== 'Diablero') } });
  const r0 = await s0.category({ ...base, category: 'tv' });
  assert.equal(r0.picks.length, 0); assert.match(r0.note, /not showing a fake/);
});

test('music: genre tag filter + MusicBrainz country', async () => {
  const { s, qcalls } = svc({
    qlooEntities: { 'urn:entity:artist': [{ entity_id: 'a1', name: 'Bad Bunny' }, { entity_id: 'a2', name: 'Café Tacvba', tags: [{ tag_id: 'urn:tag:genre:alt', name: 'alternative' }] }] },
    mbArtists: { 'Bad Bunny': [{ id: 'x', name: 'Bad Bunny', score: 100, country: 'PR' }], 'Café Tacvba': [{ id: 'y', name: 'Café Tacvba', score: 100, country: 'MX' }] },
  });
  const r = await s.category({ ...base, category: 'music' });
  assert.deepEqual(r.picks.map((p) => p.title), ['Café Tacvba']);
  assert.equal(r.picks[0].preview.url, 'https://p.m4a');
  assert.match(r.picks[0].why.text, /Radiohead/);
  assert.equal(qcalls[0].extra['filter.tags'], 'urn:tag:genre:music:latin');
});

test('results cached per (favourites set, city, category)', async () => {
  const cache = createCache();
  const { s, qcalls } = svc({ cache, qlooEntities: { 'urn:entity:tv_show': fixture('qloo_tv').results.entities } });
  await s.category({ ...base, category: 'tv' });
  const r2 = await s.category({ ...base, favourites: [...FAVS].reverse(), category: 'tv' });
  assert.equal(r2.cached, true); assert.equal(qcalls.length, 1);
  await s.category({ ...base, cityId: 'seoul', category: 'tv' });
  assert.equal(qcalls.length, 2);
});

test('input validation', async () => {
  assert.throws(() => parseFavourites(FAVS.slice(0, 2)), /3 to 5/);
  assert.throws(() => parseFavourites([...FAVS, ...FAVS]), /3 to 5/);
  const { s } = svc();
  await assert.rejects(s.category({ ...base, cityId: 'tokyo', category: 'tv' }), (e) => e.status === 400);
  await assert.rejects(s.category({ ...base, category: 'books' }), (e) => e.status === 400);
});
