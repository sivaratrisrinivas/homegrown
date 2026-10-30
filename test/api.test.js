import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { FAVS } from './helpers.js';

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
test('twin TV without keys -> 503', async () => {
  const r = await post('/api/twin', { favourites: FAVS, city: 'seoul', category: 'tv' });
  assert.equal(r.status, 503); assert.equal((await r.json()).key, 'QLOO_API_KEY');
  assert.equal((await post('/api/twin', { favourites: FAVS.slice(0, 1), city: 'seoul', category: 'tv' })).status, 400);
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
