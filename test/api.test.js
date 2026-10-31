import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { FAVS, liftCities, HG14_GATED } from './helpers.js';
import { loadGate } from '../lib/gate.js';

let srv, base;
const saved = { q: process.env.QLOO_API_KEY, t: process.env.TMDB_API_KEY };
before(async () => {
  delete process.env.QLOO_API_KEY; delete process.env.TMDB_API_KEY;
  srv = createServer(); await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); if (saved.q) process.env.QLOO_API_KEY = saved.q; if (saved.t) process.env.TMDB_API_KEY = saved.t; });
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

test('serves the app', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200);
  assert.match(await r.text(), /what you'd love if you grew up there/i);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/nope.txt')).status, 404);
});
test('health reports key presence only', async () => {
  const h = await (await fetch(base + '/api/health')).json();
  assert.deepEqual(h.keys, { QLOO_API_KEY: false, TMDB_API_KEY: false }); assert.equal(h.keyLengths.QLOO_API_KEY.length, 0);
});
test('search without key -> 503 missing_key, no secret leakage', async () => {
  const r = await fetch(base + '/api/search?q=breaking&kind=show');
  assert.equal(r.status, 503);
  const b = await r.json(); assert.equal(b.error, 'missing_key'); assert.equal(b.key, 'QLOO_API_KEY');
});
test('twin movie without keys -> 503; TV is not live in v1 (403, no Qloo call)', async () => {
  assert.equal((await post('/api/twin', { favourites: FAVS, city: 'seoul', category: 'tv' })).status, 403);
  assert.equal((await post('/api/twin', { favourites: FAVS, city: 'seoul', category: 'music' })).status, 403);
  const r = await post('/api/twin', { favourites: FAVS, city: 'seoul', category: 'movie' });
  assert.equal(r.status, 503); assert.equal((await r.json()).key, 'QLOO_API_KEY');
  assert.equal((await post('/api/twin', { favourites: FAVS.slice(0, 1), city: 'seoul', category: 'movie' })).status, 400);
  assert.equal((await fetch(base + '/api/twin')).status, 405);
});
test('feedback validates and separates not_local from not_my_taste', async () => {
  assert.equal((await post('/api/feedback', { event: 'rating', rating: 4, city: 'seoul' })).status, 200);
  assert.equal((await post('/api/feedback', { event: 'rating', rating: 9 })).status, 400);
  assert.equal((await post('/api/feedback', { event: 'flag', flag: 'not_local', pick: 'X' })).status, 200);
  assert.equal((await post('/api/feedback', { event: 'flag', flag: 'meh' })).status, 400);
  assert.equal((await post('/api/feedback', { event: 'hack' })).status, 400);
});

test('review 10: a non-string city never bypasses the live-city gate', async () => {
  for (const city of [['chennai'], { id: 'chennai' }, 7, null, undefined]) {
    const r = await post('/api/twin', { favourites: FAVS, city, category: 'tv' });
    assert.equal(r.status, 400, JSON.stringify(city));
  }
  for (const city of ['toString', '__proto__', 'nowhere']) {
    assert.equal((await post('/api/twin', { favourites: FAVS, city, category: 'tv' })).status, 403, city);
  }
  assert.equal((await post('/api/feedback', { event: 'rating', rating: 4, city: ['seoul'] })).status, 400);
  assert.equal((await post('/api/feedback', { event: 'try_city', city: 'seoul', to: ['madrid'] })).status, 400);
  assert.equal((await post('/api/feedback', { event: 'try_city', city: 'seoul', to: 'madrid' })).status, 200);
});
// HG-14: lifts gated cities in the server's own gate object (same process) for one test, then restores it.
async function withLifted(ids, fn) {
  const gate = loadGate(); const saved = structuredClone(gate.results);
  gate.results = liftCities(gate, ids).results;
  try { await fn(); } finally { gate.results = saved; }
}

test('HG-14: gated cities stay in /api/cities, are refused, and come back once their numbers pass', async () => {
  const cat = async () => (await fetch(base + '/api/cities')).json();
  const c0 = await cat();
  assert.equal(c0.cities.length, 26, 'every configured city stays in the catalogue');
  assert.equal(c0.cities.filter((c) => c.live).length, 23);
  assert.deepEqual(c0.cities.filter((c) => !c.live).map((c) => c.id).sort(), [...HG14_GATED].sort());
  for (const id of ['en', 'bn']) assert.equal(c0.languages.find((l) => l.id === id).live, false, id);
  assert.equal((await post('/api/twin', { favourites: FAVS, city: 'kolkata', category: 'movie' })).status, 403);
  await withLifted(HG14_GATED, async () => {
    const c1 = await cat();
    assert.equal(c1.cities.filter((c) => c.live).length, 26);
    for (const id of ['en', 'bn']) assert.equal(c1.languages.find((l) => l.id === id).live, true, id);
    // Passes the gate and reaches the (keyless) service.
    assert.equal((await post('/api/twin', { favourites: FAVS, city: 'kolkata', category: 'movie' })).status, 503);
  });
  assert.equal((await cat()).cities.filter((c) => c.live).length, 23, 'restored');
});

test('HG-13: London/Dublin (explicit-only English) are served only to English learners', async () => {
  // HG-14: gated today, so refused for everyone, English learners included.
  for (const city of ['london', 'dublin']) for (const learnerLanguage of [undefined, 'en']) {
    assert.equal((await post('/api/twin', { favourites: FAVS, city, category: 'movie', learnerLanguage })).status, 403, `gated ${city}`);
  }
  // Once they pass the gate, the English-only rule applies.
  await withLifted(['london', 'dublin'], async () => {
    for (const city of ['london', 'dublin']) {
      for (const learnerLanguage of [undefined, 'ja', 'hi', 'EN', ['en']]) {
        const r = await post('/api/twin', { favourites: FAVS, city, category: 'movie', learnerLanguage });
        assert.equal(r.status, 403, `${city}/${JSON.stringify(learnerLanguage)}`);
      }
      // Picked English: passes the gate and reaches the (keyless) service.
      assert.equal((await post('/api/twin', { favourites: FAVS, city, category: 'movie', learnerLanguage: 'en' })).status, 503);
    }
  });
  // Other cities don't need the field (client contract unchanged for them).
  assert.equal((await post('/api/twin', { favourites: FAVS, city: 'tokyo', category: 'movie' })).status, 503);
  const app = (await import('node:fs')).readFileSync('public/app.js', 'utf8');
  assert.match(app, /learnerLanguage: S\.lang\?\.id/);
});
