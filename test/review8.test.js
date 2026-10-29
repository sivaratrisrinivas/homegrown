import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTwinService, REQUEST_BUDGET_MS } from '../lib/twin.js';
import { createCache } from '../lib/cache.js';
import { shouldMemoTwin } from '../public/logic.js';
import { FAVS } from './helpers.js';

const qloo = { insights: async () => [{ id: 'a', name: 'A', tags: [] }] };
const svc = (searchArtist) => createTwinService({ qloo, tmdb: {}, mb: { searchArtist }, itunes: { previewForArtist: async () => null }, cache: createCache() });
const req = { favourites: FAVS, cityId: 'mexico_city', category: 'music' };

test('review 8: server marks incomplete results, fresh and cached', async () => {
  const bad = svc(async () => { const e = new Error('x'); e.status = 502; throw e; });
  assert.equal((await bad.category(req)).incomplete, true);
  const hit = await bad.category(req);
  assert.equal(hit.cached, true); assert.equal(hit.incomplete, true);
  const good = svc(async () => [{ id: 'm', name: 'A', score: 100, country: 'MX' }]);
  assert.equal((await good.category(req)).incomplete, false);
});

test('review 8: browser does not memoise incomplete or failed answers', () => {
  assert.equal(shouldMemoTwin({ ok: true, body: { incomplete: false } }), true);
  assert.equal(shouldMemoTwin({ ok: true, body: { incomplete: true } }), false);
  assert.equal(shouldMemoTwin({ ok: false, body: {} }), false);
  assert.match(readFileSync('public/app.js', 'utf8'), /shouldMemoTwin\(r\)/);
});

test('review 8: api/twin.js maxDuration 60 covers the request deadline', () => {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(v.functions['api/twin.js'].maxDuration, 60);
  assert.ok(REQUEST_BUDGET_MS < 60000);
});

test('review 8: README says three categories and the real backoff', () => {
  const r = readFileSync('README.md', 'utf8');
  assert.doesNotMatch(r, /four categories/);
  assert.match(r, /14 s, 28 s, then 30 s/);
});
