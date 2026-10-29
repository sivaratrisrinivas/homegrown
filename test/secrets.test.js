import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQloo } from '../lib/qloo.js';
import { createTmdb } from '../lib/tmdb.js';
import { sendError } from '../lib/deps.js';
import { fakeFetch, json } from './helpers.js';

const SECRET = 'sk_live_SUPERSECRET_12345';
function fakeRes() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; }

test('upstream errors never echo the key', async () => {
  for (const [mk, pat] of [[() => createQloo({ fetch: fakeFetch([['', () => json({ echo: SECRET }, 500)]]), env: { QLOO_API_KEY: SECRET }, sleep: async () => {} }).search('x'), 'q'],
    [() => createTmdb({ fetch: fakeFetch([['', () => json({}, 401)]]), env: { TMDB_API_KEY: SECRET } }).searchTv('x'), 't']]) {
    try { await mk(); assert.fail(pat); } catch (e) {
      const res = fakeRes(); sendError(res, e);
      assert.ok(!e.message.includes(SECRET) && !res.body.includes(SECRET));
    }
  }
});
