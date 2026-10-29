import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, SHORT_TTL_MS, MAX_MUSIC_CHECKS } from '../lib/twin.js';
import { createCache, SEVEN_DAYS } from '../lib/cache.js';
import { createItunes } from '../lib/itunes.js';
import { normaliseEntity } from '../lib/qloo.js';
import { createSpacer, SKIP } from '../public/logic.js';
import { FAVS } from './helpers.js';

const base = { favourites: FAVS, cityId: 'mexico_city' };
const artists = (n) => Array.from({ length: n }, (_, i) => normaliseEntity({ entity_id: 'a' + i, name: 'A' + i }));

test('verify_error results cached for 10 min, not 7 days', async () => {
  let t = 0, calls = 0;
  const cache = createCache({ now: () => t });
  const mb = { searchArtist: async () => { calls++; throw Object.assign(new Error('x'), { status: 502 }); } };
  const s = createTwinService({ qloo: { insights: async () => artists(2) }, mb, itunes: {}, cache, now: () => t });
  await s.category({ ...base, category: 'music' });
  t = SHORT_TTL_MS - 1; assert.equal((await s.category({ ...base, category: 'music' })).cached, true);
  t = SHORT_TTL_MS + 1; assert.notEqual((await s.category({ ...base, category: 'music' })).cached, true);
  assert.ok(SHORT_TTL_MS < SEVEN_DAYS);
});

test('clean results still cached for 7 days', async () => {
  let t = 0; const cache = createCache({ now: () => t });
  const mb = { searchArtist: async (n) => [{ id: 'm', name: n, score: 100, country: 'MX' }] };
  const s = createTwinService({ qloo: { insights: async () => artists(1) }, mb, itunes: { previewForArtist: async () => null }, cache, now: () => t });
  await s.category({ ...base, category: 'music' });
  t = SEVEN_DAYS - 1; assert.equal((await s.category({ ...base, category: 'music' })).cached, true);
});

test('music: deadline and verified-candidate cap', async () => {
  let t = 0, checks = 0;
  const mb = { searchArtist: async () => { checks++; t += 1000; return []; } };
  const s = createTwinService({ qloo: { insights: async () => artists(10) }, mb, itunes: {}, now: () => t });
  const r = await s.category({ ...base, category: 'music' });
  assert.equal(checks, MAX_MUSIC_CHECKS);
  assert.equal(r.rejected.filter((x) => x.reason === 'deadline').length, 10 - MAX_MUSIC_CHECKS);
  t = 0; checks = 0;
  const slow = { searchArtist: async () => { checks++; t += 20000; return []; } };
  const s2 = createTwinService({ qloo: { insights: async () => artists(10) }, mb: slow, itunes: {}, now: () => t, budgetMs: 45000 });
  await s2.category({ ...base, category: 'music' });
  assert.equal(checks, 3, 'stops once past 45 s');
});

test('podcast: feeds checked in bounded parallel batches with a deadline', async () => {
  let inflight = 0, peak = 0, t = 0;
  const pods = Array.from({ length: 8 }, (_, i) => ({ collectionId: i, collectionName: 'P' + i, feedUrl: 'f' + i }));
  const itunes = {
    searchPodcasts: async () => pods,
    feedLanguage: async (u) => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 5)); inflight--; t += 30000; return u === 'f6' ? 'es' : 'en'; },
  };
  const r = await createTwinService({ qloo: {}, itunes, now: () => t }).category({ ...base, category: 'podcast' });
  assert.ok(peak > 1 && peak <= 4, `peak ${peak}`);
  assert.equal(r.picks.length, 0, 'second batch skipped after deadline');
  assert.equal(r.rejected.filter((x) => x.reason === 'deadline').length, 4);
  t = 0;
  const r2 = await createTwinService({ qloo: {}, itunes, now: () => 0 }).category({ ...base, category: 'podcast' });
  assert.deepEqual(r2.picks.map((p) => p.title), ['P6'], 'rank order kept within batches');
});

test('iTunes search and preview time out', async () => {
  const hang = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  const it = createItunes({ fetch: hang, timeoutMs: 20 });
  await assert.rejects(it.searchPodcasts('x', 'mx'), (e) => e.status === 504);
  assert.equal(await it.previewForArtist('x', 'mx'), null);
});

test('spacer: skipped requests do not push back the next slot', async () => {
  let t = 0; const starts = [];
  const gate = createSpacer({ now: () => t, sleep: async (ms) => { t += ms; } });
  await gate(async () => { starts.push(t); return 1; });
  await gate(async () => SKIP); // waits for its slot (t=7000) but sends nothing
  await gate(async () => { starts.push(t); return 2; });
  assert.deepEqual(starts, [0, 7000], 'no extra wait after a skip');
});
