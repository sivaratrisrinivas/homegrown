import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAltNames, ALT_CAPS } from '../lib/altnames.js';
import { createAnthropic, parseNames, costOf, CLAUDE_MODEL, CLAUDE_MAX_TOKENS } from '../lib/anthropic.js';
import { createQloo } from '../lib/qloo.js';
import { fakeFetch, json } from './helpers.js';
import handler from '../api/altnames.js';
import { setDeps } from '../lib/deps.js';

const ent = (id, name) => ({ id, name, type: 'urn:entity:tv_show', tags: [] });
const mockClaude = (names, usage = { input_tokens: 80, output_tokens: 20 }) => {
  const c = { calls: 0, async altNames() { c.calls++; return { names, usage }; } }; return c;
};
const mockQloo = (db) => { const q = { calls: [], async search(n) { q.calls.push(n); return db[n] || []; } }; return q; };

test('re-resolves alt names with Qloo and returns only a genuine same-name match', async () => {
  const qloo = mockQloo({ 'Dark Desire': [ent('q-x', 'Something Else')], 'Oscuro Deseo': [ent('q-od', 'Oscuro deseo')] });
  const r = await createAltNames({ qloo, claude: mockClaude(['Dark Desire', 'Oscuro Deseo', 'Nope']) })({ q: 'oscuro deseo show', kind: 'show', ip: 'a' });
  assert.deepEqual(r.results.map((e) => e.id), ['q-od']);
  assert.deepEqual(qloo.calls, ['Dark Desire', 'Oscuro Deseo']); // stops at the first genuine match
});
test('non-matching Qloo results are never returned (Claude never sources picks)', async () => {
  const r = await createAltNames({ qloo: mockQloo({ A: [ent('1', 'B')] }), claude: mockClaude(['A', 'Made Up Show']) })({ q: 'zz', kind: 'show', ip: 'a' });
  assert.deepEqual(r.results, []);
});
test('caches positive and negative results (no repeat Claude or Qloo calls)', async () => {
  const claude = mockClaude(['A']); const qloo = mockQloo({});
  const f = createAltNames({ qloo, claude });
  await f({ q: 'Foo', kind: 'show', ip: 'a' }); const r = await f({ q: ' foo ', kind: 'show', ip: 'b' });
  assert.equal(r.cached, true); assert.equal(claude.calls, 1); assert.equal(qloo.calls.length, 1);
});
test('per-IP daily cap, reset at UTC midnight', async () => {
  let t = Date.parse('2026-10-30T10:00:00Z');
  const claude = mockClaude([]); const f = createAltNames({ qloo: mockQloo({}), claude, now: () => t });
  for (let i = 0; i < ALT_CAPS.perIpPerDay; i++) await f({ q: 'q' + i, kind: 'show', ip: 'a' });
  assert.equal((await f({ q: 'over', kind: 'show', ip: 'a' })).capped, 'ip');
  assert.equal((await f({ q: 'other', kind: 'show', ip: 'b' })).capped, undefined);
  t = Date.parse('2026-10-31T00:00:01Z');
  assert.equal((await f({ q: 'over', kind: 'show', ip: 'a' })).capped, undefined);
  assert.equal(claude.calls, ALT_CAPS.perIpPerDay + 2);
});
test('global daily spend cap estimated from usage tokens', async () => {
  const claude = mockClaude([], { input_tokens: 100000, output_tokens: 0 }); // $0.05 per call at the conservative rate
  const f = createAltNames({ qloo: mockQloo({}), claude });
  for (let i = 0; i < 20; i++) await f({ q: 'q' + i, kind: 'show', ip: 'ip' + i });
  assert.equal(claude.calls, Math.ceil(ALT_CAPS.globalUsdPerDay / 0.05));
  assert.ok(ALT_CAPS.globalUsdPerDay <= 0.5);
  assert.ok(Math.abs(costOf({ input_tokens: 1e6, output_tokens: 1e6 }) - 3) < 1e-9);
});
test('fails closed on Claude error, missing key, and Qloo error', async () => {
  const boom = { async altNames() { throw Object.assign(new Error('x'), { status: 502 }); } };
  assert.deepEqual((await createAltNames({ qloo: mockQloo({}), claude: boom })({ q: 'aa', kind: 'show', ip: 'a' })).results, []);
  const nokey = createAnthropic({ env: {}, fetch: () => assert.fail('no call without key') });
  assert.deepEqual((await createAltNames({ qloo: mockQloo({}), claude: nokey })({ q: 'aa', kind: 'show', ip: 'a' })).results, []);
  const badQ = { async search() { throw new Error('429'); } };
  assert.deepEqual((await createAltNames({ qloo: badQ, claude: mockClaude(['X']) })({ q: 'aa', kind: 'show', ip: 'a' })).results, []);
});
test('anthropic client: cheap Haiku, small max_tokens, JSON-only parse, HTTP error throws', async () => {
  const f = fakeFetch([['anthropic.com', () => json({ content: [{ type: 'text', text: '```json\n{"names":["A","B","C","D"]}\n```' }], usage: { input_tokens: 50, output_tokens: 12 } })]]);
  const r = await createAnthropic({ fetch: f, env: { ANTHROPIC_API_KEY: 'k' } }).altNames('Foo', 'show');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.model, CLAUDE_MODEL); assert.equal(body.max_tokens, CLAUDE_MAX_TOKENS); assert.ok(CLAUDE_MAX_TOKENS <= 100);
  assert.deepEqual(r.names, ['A', 'B', 'C']); assert.equal(r.usage.output_tokens, 12);
  const bad = createAnthropic({ fetch: fakeFetch([['anthropic.com', () => json({}, 500)]]), env: { ANTHROPIC_API_KEY: 'k' } });
  await assert.rejects(bad.altNames('x', 'show'), /HTTP 500/);
  assert.deepEqual(parseNames('not json'), []); assert.deepEqual(parseNames('{"names": "x"}'), []);
});
test('end to end with mocked Qloo fetch (7 s throttle mocked) and handler output shape', async () => {
  const qf = fakeFetch([['/search', (u) => json({ results: new URL(u).searchParams.get('query') === 'Alt Name' ? [{ entity_id: 'q-1', name: 'Alt Name', types: ['urn:entity:movie'], tags: [] }] : [] })]]);
  const qloo = createQloo({ fetch: qf, env: { QLOO_API_KEY: 'k' }, sleep: async () => {} });
  setDeps({ altnames: createAltNames({ qloo, claude: mockClaude(['Wrong', 'Alt Name']) }) });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await handler({ query: { q: 'typed name', kind: 'movie' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
  assert.deepEqual(res.body.results.map((e) => e.id), ['q-1']); assert.equal(qf.calls.length, 2);
  setDeps({ altnames: async () => { throw new Error('boom'); } });
  await handler({ query: { q: 'xx', kind: 'movie' }, headers: {} }, res);
  assert.deepEqual(res.body, { results: [] });
  setDeps(undefined);
});

// Review round 1
import { MAX_CALL_USD } from '../lib/altnames.js';
import { clientIp } from '../api/altnames.js';
import { createAltTrigger } from '../public/altnames-client.js';

test('spend is reserved before the await: concurrent calls cannot overshoot the global cap', async () => {
  let release; const gate = new Promise((r) => (release = r));
  const claude = { calls: 0, async altNames() { claude.calls++; await gate; return { names: [], usage: {} }; } };
  const caps = { ...ALT_CAPS, perIpPerDay: 1e6, globalUsdPerDay: MAX_CALL_USD * 3 };
  const f = createAltNames({ qloo: mockQloo({}), claude, caps });
  const ps = Array.from({ length: 10 }, (_, i) => f({ q: 'q' + i, kind: 'show', ip: 'x' }));
  release(); await Promise.all(ps);
  assert.equal(claude.calls, 3);
  // Settled to actual (0) cost afterwards, so more calls are allowed again.
  await f({ q: 'later', kind: 'show', ip: 'x' }); assert.equal(claude.calls, 4);
});
test('failed-after-send keeps the full reservation; missing key releases it', async () => {
  const caps = { ...ALT_CAPS, perIpPerDay: 1e6, globalUsdPerDay: MAX_CALL_USD * 2 };
  const sent = { calls: 0, async altNames() { sent.calls++; throw Object.assign(new Error('x'), { status: 502 }); } };
  const f = createAltNames({ qloo: mockQloo({}), claude: sent, caps });
  for (let i = 0; i < 5; i++) await f({ q: 'q' + i, kind: 'show', ip: 'x' });
  assert.equal(sent.calls, 2);
  const nokey = { calls: 0, async altNames() { nokey.calls++; throw Object.assign(new Error('k'), { code: 'missing_key' }); } };
  const g = createAltNames({ qloo: mockQloo({}), claude: nokey, caps });
  for (let i = 0; i < 5; i++) await g({ q: 'q' + i, kind: 'show', ip: 'x' });
  assert.equal(nokey.calls, 5);
});
test('clientIp prefers x-vercel-forwarded-for / x-real-ip and ignores spoofable x-forwarded-for', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 1.1.1.1', 'x-vercel-forwarded-for': '1.1.1.1' } }), '1.1.1.1');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '2.2.2.2' } }), '2.2.2.2');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6' }, socket: { remoteAddress: '3.3.3.3' } }), '3.3.3.3');
  assert.equal(clientIp({ headers: {} }), 'unknown');
});
test('empty normalised query returns early; identical in-flight requests share one call', async () => {
  const claude = mockClaude(['A']);
  const f = createAltNames({ qloo: mockQloo({}), claude });
  assert.deepEqual(await f({ q: '!!! ---', kind: 'show', ip: 'a' }), { results: [] });
  assert.equal(claude.calls, 0);
  const [a, b] = await Promise.all([f({ q: 'Foo', kind: 'show', ip: 'a' }), f({ q: 'foo!', kind: 'show', ip: 'b' })]);
  assert.equal(claude.calls, 1); assert.deepEqual(a, b);
});
test('Qloo re-resolve: at most 2 names per call and a separate daily Qloo budget', async () => {
  const qloo = mockQloo({});
  const f = createAltNames({ qloo, claude: mockClaude(['A', 'B', 'C']), caps: { ...ALT_CAPS, perIpPerDay: 1e6, qlooPerDay: 5 } });
  await f({ q: 'one', kind: 'show', ip: 'x' }); assert.deepEqual(qloo.calls, ['A', 'B']);
  await f({ q: 'two', kind: 'show', ip: 'x' }); await f({ q: 'three', kind: 'show', ip: 'x' });
  assert.equal(qloo.calls.length, 5); // 2 + 2 + 1, budget hit mid-request
  assert.equal((await f({ q: 'four', kind: 'show', ip: 'x' })).capped, 'qloo');
  // 'three' was only partly checked, so its negative result isn't cached.
  const r = await f({ q: 'three', kind: 'show', ip: 'x' }); assert.equal(r.cached, undefined);
});
test('client trigger: only on explicit submit of a no-result query; typing aborts it', async () => {
  const urls = []; let pending;
  const fetch = (u, { signal }) => { urls.push(u); return new Promise((res, rej) => { pending = () => res(json({ results: [{ id: 'q1', name: 'X' }] })); signal.addEventListener('abort', () => rej(new Error('aborted'))); }); };
  const t = createAltTrigger({ fetch });
  assert.equal(await t.submit('show', 'foo'), null); // never seen empty results
  t.noteResults('foo', 3); assert.equal(await t.submit('show', 'foo'), null); // had results
  t.noteResults('foo', 0);
  const p = t.submit('show', 'foo'); t.onInput(); assert.equal(await p, null); // superseded
  t.noteResults('foo', 0); const p2 = t.submit('show', 'foo'); pending();
  assert.deepEqual((await p2).map((e) => e.id), ['q1']);
  assert.equal(urls.length, 2); assert.match(urls[0], /\/api\/altnames\?kind=show&q=foo/);
});
test('app wires altnames only through the Enter handler, outside qlooGate', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('/api/altnames')); // only altnames-client.js builds that URL
  assert.match(src, /key !== 'Enter'/); assert.match(src, /alt\.onInput\(\)/);
});
