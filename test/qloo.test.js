import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQloo, QLOO_GAP_MS } from '../lib/qloo.js';
import { fakeFetch, json, fixture } from './helpers.js';

const env = { QLOO_API_KEY: 'test-key-not-real' };
function clock() { let t = 0; const sleeps = []; return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps }; }

test('missing key fails gracefully without network', async () => {
  const f = fakeFetch([]);
  await assert.rejects(createQloo({ fetch: f, env: {} }).search('x'), (e) => e.code === 'missing_key' && e.status === 503 && e.keyName === 'QLOO_API_KEY');
  assert.equal(f.calls.length, 0);
});

test('search sends key in header and normalises entities', async () => {
  const f = fakeFetch([['/search', fixture('qloo_search')]]);
  const c = clock();
  const r = await createQloo({ fetch: f, env, ...c }).search('breaking', 'urn:entity:tv_show');
  assert.equal(r[0].id, 'q-bb'); assert.equal(r[0].year, 2008); assert.equal(r[0].tags[0].name, 'crime');
  assert.equal(f.calls[0].init.headers['X-Api-Key'], 'test-key-not-real');
  assert.ok(!f.calls[0].url.includes('test-key'), 'key never in URL');
});

test('calls are spaced ~7 s apart', async () => {
  const c = clock();
  const f = fakeFetch([['/search', fixture('qloo_search')]]);
  const q = createQloo({ fetch: f, env, sleep: c.sleep, now: c.now });
  await Promise.all([q.search('a'), q.search('b'), q.search('c')]);
  assert.equal(QLOO_GAP_MS, 7000);
  assert.deepEqual(c.sleeps, [7000, 7000]);
});

test('429 backs off then succeeds; gives up after retries', async () => {
  let n = 0; const c = clock();
  const f = fakeFetch([['/search', () => (++n < 3 ? json({}, 429) : json(fixture('qloo_search')))]]);
  const r = await createQloo({ fetch: f, env, sleep: c.sleep }).search('a');
  assert.equal(r.length, 1); assert.equal(n, 3);
  const always = fakeFetch([['/search', () => json({}, 429)]]);
  await assert.rejects(createQloo({ fetch: always, env, sleep: async () => {} }).search('a'), (e) => e.status === 429);
});

test('honours Retry-After', async () => {
  let n = 0; const c = clock();
  const f = fakeFetch([['/search', () => (++n === 1 ? json({}, 429, { 'retry-after': '3' }) : json(fixture('qloo_search')))]]);
  await createQloo({ fetch: f, env, sleep: c.sleep, gapMs: 0 }).search('a');
  assert.ok(c.sleeps.includes(3000));
});

test('insights passes locality filters', async () => {
  const f = fakeFetch([['/v2/insights', fixture('qloo_tv')]]);
  const r = await createQloo({ fetch: f, env, sleep: async () => {} }).insights({ type: 'urn:entity:tv_show', signalIds: ['a', 'b'], extra: { 'filter.release_country': 'MX' } });
  assert.equal(r.length, 4);
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get('filter.release_country'), 'MX');
  assert.equal(u.searchParams.get('signal.interests.entities'), 'a,b');
});
