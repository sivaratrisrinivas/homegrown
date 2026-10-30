import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQloo } from '../lib/qloo.js';
import { verifyArtist } from '../lib/musicbrainz.js';
import { createItunes } from '../lib/itunes.js';
import { createTwinService, nativeRate, MAX_MUSIC_CHECKS } from '../lib/twin.js';
import { createSpacer, gatedIfCurrent, SKIP } from '../public/logic.js';
import { CITIES } from '../lib/cities.js';
import { fakeFetch, FAVS } from './helpers.js';

const MX = CITIES.mexico_city;
const band = (n) => ({ id: 'q' + n, name: 'Band' + n, tags: [{ id: 'urn:tag:genre:music:mexican', name: 'Mexican' }] });

test('review 6: Qloo re-checks the deadline inside the throttle and skips the call', async () => {
  let t = 0; let fetched = 0;
  const fetch = async () => { fetched++; return { ok: true, status: 200, json: async () => ({ results: { entities: [] } }) }; };
  // The throttle's sleep advances the clock past the deadline while we wait for the slot.
  const q = createQloo({ fetch, env: { QLOO_API_KEY: 'k' }, now: () => t, sleep: async (ms) => { t += ms; }, gapMs: 7000, timeoutMs: 10000 });
  await q.insights({ type: 'x', signalIds: ['a'] });
  await assert.rejects(q.insights({ type: 'x', signalIds: ['a'], deadline: t + 12000 }), (e) => e.status === 504);
  assert.equal(fetched, 1, 'second call never sent');
});

test('review 6: a country-less exact match next to others is ambiguous', async () => {
  const mb = { searchArtist: async () => [{ id: 'a', name: 'Band1', score: 100, country: 'MX' }, { id: 'b', name: 'Band1', score: 95 }] };
  assert.equal((await verifyArtist(mb, band(1), MX)).reason, 'ambiguous_artist');
  const solo = { searchArtist: async () => [{ id: 'a', name: 'Band1', score: 100, area: { name: 'Mexico' } }] };
  assert.equal((await verifyArtist(solo, band(1), MX)).ok, true);
});

test('review 6: iTunes preview only for the verified artist name', async () => {
  const f = fakeFetch([['itunes.apple.com', { results: [{ artistName: 'Some Cover Band', previewUrl: 'https://x' }, { artistName: 'Café Tacvba', previewUrl: 'https://p', trackName: 'T' }] }]]);
  assert.deepEqual(await createItunes({ fetch: f }).previewForArtist('Cafe Tacvba', 'mx'), { url: 'https://p', track: 'T' });
  const g = fakeFetch([['itunes.apple.com', { results: [{ artistName: 'Someone Else', previewUrl: 'https://x' }] }]]);
  assert.equal(await createItunes({ fetch: g }).previewForArtist('Molotov', 'mx'), null);
});

test('review 6: stale run returns SKIP inside the gate and sends nothing', async () => {
  let sent = 0; let t = 0;
  const gate = createSpacer({ gapMs: 7000, now: () => t, sleep: async (ms) => { t += ms; } });
  let current = true;
  assert.equal((await gatedIfCurrent(gate, () => current, async () => { sent++; return { ok: true }; })).ok, true);
  current = false;
  const r = await gatedIfCurrent(gate, () => current, async () => { sent++; return { ok: true }; });
  assert.equal(r.stale, true); assert.equal(sent, 1);
  assert.notEqual(r, SKIP);
});

function musicSvc(verifyAll) {
  const qloo = { insights: async () => Array.from({ length: 10 }, (_, i) => band(i)) };
  return createTwinService({ qloo, tmdb: {}, mb: { searchArtist: verifyAll }, itunes: { previewForArtist: async () => null } });
}

test('review 6: check_cap is its own reason, outside the rate', async () => {
  const s = musicSvc(async () => []);
  const r = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  assert.equal(r.rejected.filter((x) => x.reason === 'check_cap').length, 10 - MAX_MUSIC_CHECKS);
  assert.equal(r.rejected.filter((x) => x.reason === 'deadline').length, 0);
  assert.equal(nativeRate(r.picks, r.rejected).seen, MAX_MUSIC_CHECKS);
});

test('review 6: all checks errored -> try-again note, not the origin-check note', async () => {
  const err = musicSvc(async () => { const e = new Error('x'); e.status = 502; throw e; });
  const r = await err.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  assert.equal(r.picks.length, 0);
  assert.match(r.note, /couldn't check these right now/i);
  const none = musicSvc(async () => []);
  const r2 = await none.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  assert.match(r2.note, /passed our origin check/);
});
