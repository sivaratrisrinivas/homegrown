import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTwinService } from '../lib/twin.js';
import { createCache } from '../lib/cache.js';
import { verifyArtist } from '../lib/musicbrainz.js';
import { runCategories } from '../public/logic.js';
import { CITIES } from '../lib/cities.js';
import { FAVS } from './helpers.js';

const MX = CITIES.mexico_city;
const band = { id: 'q-mol', name: 'Molotov', tags: [{ id: 'urn:tag:keyword:crime', name: 'crime' }] };
const mbOk = { searchArtist: async () => [{ id: 'mb1', name: 'Molotov', score: 100, country: 'MX' }] };

function svc({ qlooFail = false } = {}) {
  const logs = [];
  const qloo = { insights: async () => { if (qlooFail) { const e = new Error('Qloo failed'); e.status = 502; throw e; } return [band]; } };
  const s = createTwinService({ qloo, tmdb: {}, mb: mbOk, itunes: { previewForArtist: async () => null }, cache: createCache(), log: (e) => logs.push(e) });
  return { s, logs };
}

test('review 5: native_rate logged on cache hit (cached:true) and on error', async () => {
  const { s, logs } = svc();
  await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  const rates = logs.filter((l) => l.event === 'native_rate');
  assert.equal(rates.length, 2);
  assert.equal(rates[1].cached, true);
  assert.equal(rates[1].accepted, 1);
  const bad = svc({ qlooFail: true });
  await assert.rejects(bad.s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' }));
  const err = bad.logs.find((l) => l.event === 'native_rate');
  assert.equal(err.error, true);
  assert.equal(err.category, 'music');
  assert.ok(!JSON.stringify(bad.logs).includes('Breaking Bad'), 'no user text in logs');
});

test('review 5: cached why-lines use the requester names, not the first caller', async () => {
  const { s } = svc();
  const evil = FAVS.map((f, i) => (i === 0 ? { ...f, name: 'EVIL <script>' } : f));
  const a = await s.category({ favourites: evil, cityId: 'mexico_city', category: 'music' });
  assert.match(a.picks[0].why.text, /EVIL/);
  const b = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  assert.equal(b.cached, true);
  assert.equal(b.picks[0].why.text, 'Because you liked Breaking Bad: both are crime.');
  assert.equal(b.picks[0].tags, undefined, 'internal tags are not exposed');
});

test('review 5: runCategories keeps going after a thrown request', async () => {
  const landed = [];
  await runCategories(['tv', 'movie', 'music'], async (c) => { if (c === 'tv') throw new Error('net'); return { ok: true, body: { picks: [] } }; }, (c, r) => landed.push([c, r.ok]));
  assert.deepEqual(landed, [['tv', false], ['movie', true], ['music', true]]);
});

test('review 5: MusicBrainz exact matches that disagree on country are ambiguous', async () => {
  const mb = (arts) => ({ searchArtist: async () => arts });
  const two = [{ id: 'a', name: 'Molotov', score: 100, country: 'US' }, { id: 'b', name: 'Molotov', score: 95, country: 'MX' }];
  assert.equal((await verifyArtist(mb(two), band, MX)).reason, 'ambiguous_artist');
  const agree = [{ id: 'a', name: 'Molotov', score: 100, area: { 'iso-3166-1-codes': ['MX'] } }, { id: 'b', name: 'Molotov', score: 95, country: 'MX' }];
  assert.deepEqual(await verifyArtist(mb(agree), band, MX), { ok: true, mbid: 'a' });
  const lowScore = [{ id: 'a', name: 'Molotov', score: 100, country: 'MX' }, { id: 'b', name: 'Molotov', score: 40, country: 'US' }];
  assert.equal((await verifyArtist(mb(lowScore), band, MX)).ok, true);
  const prefer = [{ id: 'x', name: 'Molotov', score: 100 }, { id: 'y', name: 'Molotov', score: 92, country: 'MX' }];
  assert.deepEqual(await verifyArtist(mb(prefer), band, MX), { ok: true, mbid: 'y' });
});

test('review 5: no places/podcast leftovers', () => {
  assert.doesNotMatch(readFileSync('lib/qloo.js', 'utf8'), /address/);
  const app = readFileSync('public/app.js', 'utf8');
  assert.doesNotMatch(app, /p\.author/);
  assert.doesNotMatch(app, /const all\b/);
});
