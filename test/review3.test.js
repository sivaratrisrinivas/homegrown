import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, SHORT_TTL_MS, MAX_MUSIC_CHECKS } from '../lib/twin.js';
import { createCache, SEVEN_DAYS } from '../lib/cache.js';
import { createItunes } from '../lib/itunes.js';
import { normaliseEntity } from '../lib/qloo.js';
import { createSpacer, SKIP } from '../public/logic.js';
import { FAVS } from './helpers.js';

const base = { favourites: FAVS, cityId: 'mexico_city' };
const artists = (n) => Array.from({ length: n }, (_, i) => normaliseEntity({ entity_id: 'a' + i, name: 'A' + i, tags: [{ tag_id: 'urn:tag:genre:music:mexican', name: 'Mexican' }] }));

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
  assert.equal(r.rejected.filter((x) => x.reason === 'check_cap').length, 10 - MAX_MUSIC_CHECKS);
  t = 0; checks = 0;
  const slow = { searchArtist: async () => { checks++; t += 20000; return []; } };
  const s2 = createTwinService({ qloo: { insights: async () => artists(10) }, mb: slow, itunes: {}, now: () => t, budgetMs: 45000 });
  await s2.category({ ...base, category: 'music' });
  assert.equal(checks, 3, 'stops once past 45 s');
});

test('iTunes preview times out', async () => {
  const hang = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  const it = createItunes({ fetch: hang, timeoutMs: 20 });
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
