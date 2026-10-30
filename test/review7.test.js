import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTmdb, verifyShow } from '../lib/tmdb.js';
import { createMusicBrainz } from '../lib/musicbrainz.js';
import { createThrottle } from '../lib/throttle.js';
import { createQloo } from '../lib/qloo.js';
import { createTwinService } from '../lib/twin.js';
import { CITIES } from '../lib/cities.js';
import { FAVS } from './helpers.js';

const MX = CITIES.mexico_city;
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('review 7: TMDB skips a call past the deadline and shortens the timeout near it', async () => {
  let t = 1000; const seen = [];
  const fetch = async (u, init) => { seen.push(init.signal); return ok({ results: [] }); };
  const tmdb = createTmdb({ fetch, env: { TMDB_API_KEY: 'k' }, now: () => t });
  await assert.rejects(tmdb.searchTv('x', undefined, 1000), (e) => e.status === 504 && e.reason === 'deadline');
  assert.equal(seen.length, 0, 'nothing sent');
  // verifyShow threads the deadline through: past it, it throws a deadline skip before any fetch.
  await assert.rejects(verifyShow(tmdb, { name: 'x' }, MX, { deadline: 500 }), (e) => e.reason === 'deadline');
  await tmdb.searchTv('x', undefined, 1000 + 50);
  assert.equal(seen.length, 1);
});

test('review 7: TV providers get the deadline; skipped checks are "deadline", not verify_error', async () => {
  let t = 0; const got = [];
  const tmdb = {
    searchTv: async (q, y, d) => { got.push(['search', d]); t += 30000; return [{ id: 1, name: q, original_language: 'es', origin_country: ['MX'] }]; },
    watchProviders: async (id, d) => { got.push(['prov', d]); return {}; },
  };
  const qloo = { insights: async () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] };
  const s = createTwinService({ qloo, tmdb, now: () => t, budgetMs: 45000 });
  const r = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'tv' });
  assert.ok(got.every(([, d]) => d === 45000), 'deadline passed to every TMDB call');
  assert.ok(got.some(([k]) => k === 'prov'));
  assert.equal(r.picks.length, 2);
});

test('review 7: MusicBrainz budget capped by caller deadline; skip when none left', async () => {
  let t = 0; let calls = 0;
  const fetch = async () => { calls++; t += 3000; return { ok: false, status: 503, json: async () => ({}) }; };
  const mb = createMusicBrainz({ fetch, now: () => t, sleep: async (ms) => { t += ms; }, budgetMs: 60000, retryMs: 1000, timeoutMs: 2000 });
  await assert.rejects(mb.searchArtist('x', 0), (e) => e.reason === 'deadline');
  assert.equal(calls, 0);
  await assert.rejects(mb.searchArtist('x', t + 6000));
  assert.ok(calls <= 2, `retries stop at the caller deadline (calls=${calls})`);
});

test('review 7: no iTunes preview after the deadline', async () => {
  let t = 0; let previews = 0;
  const qloo = { insights: async () => [{ id: 'a', name: 'A', tags: [{ id: 'urn:tag:genre:music:mexican', name: 'Mexican' }] }] };
  const mb = { searchArtist: async () => { t = 50000; return [{ id: 'm', name: 'A', score: 100, country: 'MX' }]; } };
  const s = createTwinService({ qloo, tmdb: {}, mb, itunes: { previewForArtist: async () => { previews++; return { url: 'u' }; } }, now: () => t });
  const r = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'music' });
  assert.equal(r.picks.length, 1); assert.equal(r.picks[0].preview, null); assert.equal(previews, 0);
});

test('review 7: throttle slot only moves after a real call', async () => {
  let t = 0; const sleeps = [];
  const th = createThrottle({ minGapMs: 7000, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  await th(async () => 1);
  t = 7000;
  await assert.rejects(th(async () => { const e = new Error('skip'); e.notSent = true; throw e; }));
  t = 7001;
  await th(async () => 2);
  assert.deepEqual(sleeps, [], 'a not-sent call did not push back the next slot');
  await assert.rejects(th(async () => { throw new Error('real failure'); }));
  // a real failure still counts as a call
  assert.ok(sleeps.length === 1);
});

test('review 7: Qloo deadline skip inside the throttle does not consume the slot', async () => {
  let t = 0; let fetched = 0;
  const fetch = async () => { fetched++; return ok({ results: { entities: [] } }); };
  const q = createQloo({ fetch, env: { QLOO_API_KEY: 'k' }, now: () => t, sleep: async (ms) => { t += ms; }, gapMs: 7000, timeoutMs: 10000 });
  await q.insights({ type: 'x', signalIds: ['a'] });
  t = 7000;
  await assert.rejects(q.insights({ type: 'x', signalIds: ['a'], deadline: t + 5000 }));
  const before = t;
  await q.insights({ type: 'x', signalIds: ['a'] });
  assert.equal(t, before, 'next call not delayed by the skipped one');
  assert.equal(fetched, 2);
});

test('review 7: fallback watch link is labelled in the UI', () => {
  assert.match(readFileSync('public/app.js', 'utf8'), /p\.watch\.label/);
});
