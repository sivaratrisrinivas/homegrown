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
const mockQloo = (db) => { const q = { calls: [], async search(n, t, o) { o?.beforeAttempt?.(); q.calls.push(n); return db[n] || []; } }; return q; };

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
  await handler({ query: { q: 'typed name', kind: 'movie' }, headers: { 'x-vercel-forwarded-for': '1.2.3.4' } }, res);
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
  const claude = { calls: 0, async altNames() { claude.calls++; await gate; return { names: [], usage: { input_tokens: 0, output_tokens: 0 } }; } };
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

// Review round 2
test('deadline fixed at entry is passed to qloo.search; a deadline stop is incomplete and not cached', async () => {
  let t = 0; const seen = [];
  const qloo = { async search(n, types, o) { seen.push(o); t += 30000; if (seen.length === 2) throw Object.assign(new Error('late'), { status: 504, notSent: true }); return []; } };
  const claude = mockClaude(['A', 'B']);
  const f = createAltNames({ qloo, claude, now: () => t + Date.parse('2026-10-30T00:00:00Z') });
  assert.deepEqual((await f({ q: 'foo', kind: 'show', ip: 'x' })).results, []);
  assert.equal(seen[0].deadline, Date.parse('2026-10-30T00:00:00Z') + 45000); assert.equal(seen[1].deadline, seen[0].deadline);
  assert.ok(seen[0].maxRetries <= 1);
  const again = await f({ q: 'foo', kind: 'show', ip: 'x' }); assert.equal(again.cached, undefined); // not cached
  // A loop-level deadline stop (time already past) is also incomplete.
  const g = createAltNames({ qloo: mockQloo({}), claude: mockClaude(['A']), deadlineMs: -1 });
  await g({ q: 'bar', kind: 'show', ip: 'x' }); assert.equal((await g({ q: 'bar', kind: 'show', ip: 'x' })).cached, undefined);
});
test('real Qloo client: no 429 retry, every HTTP attempt counts against the daily budget', async () => {
  const qf = fakeFetch([['/search', () => json({}, 429)]]);
  const qloo = createQloo({ fetch: qf, env: { QLOO_API_KEY: 'k' }, sleep: async () => {}, gapMs: 0 });
  const f = createAltNames({ qloo, claude: mockClaude(['A', 'B']), caps: { ...ALT_CAPS, perIpPerDay: 1e6, qlooPerDay: 2 } });
  await f({ q: 'one', kind: 'show', ip: 'x' }); assert.equal(qf.calls.length, 1); // a 429 ends the request, no retry
  await f({ q: 'two', kind: 'show', ip: 'x' }); assert.equal(qf.calls.length, 2);
  assert.equal((await f({ q: 'three', kind: 'show', ip: 'x' })).capped, 'qloo'); assert.equal(qf.calls.length, 2);
  assert.equal(ALT_CAPS.maxNames * (1 + 0), 2); // <= 2 throttle slots per request
});
test("Claude's names are cached per key: a retry after a Qloo failure skips Claude", async () => {
  let fail = true; const claude = mockClaude(['Alt']);
  const qloo = { calls: 0, async search(n) { qloo.calls++; if (fail) throw Object.assign(new Error('x'), { status: 502 }); return [ent('q-a', 'Alt')]; } };
  const f = createAltNames({ qloo, claude });
  assert.deepEqual((await f({ q: 'foo', kind: 'show', ip: 'x' })).results, []);
  fail = false;
  assert.deepEqual((await f({ q: 'foo', kind: 'show', ip: 'x' })).results.map((e) => e.id), ['q-a']);
  assert.equal(claude.calls, 1); assert.equal(qloo.calls, 2);
});
test('client eligible(): only the latest no-result query; cleared on input', () => {
  const t = createAltTrigger({ fetch: () => assert.fail() });
  assert.equal(t.eligible('foo'), false);
  t.noteResults('foo', 0); assert.equal(t.eligible('foo'), true); assert.equal(t.eligible('bar'), false);
  t.onInput(); assert.equal(t.eligible('foo'), false);
});
test('missing usage keeps the full reservation instead of settling to $0', async () => {
  const caps = { ...ALT_CAPS, perIpPerDay: 1e6, globalUsdPerDay: MAX_CALL_USD * 2 };
  for (const usage of [undefined, {}, { output_tokens: 5 }]) {
    const claude = { calls: 0, async altNames() { claude.calls++; return { names: [], usage }; } };
    const f = createAltNames({ qloo: mockQloo({}), claude, caps });
    for (let i = 0; i < 5; i++) await f({ q: 'q' + i, kind: 'show', ip: 'x' });
    assert.equal(claude.calls, 2);
  }
});
test('missing_key / notSent refund the per-IP counter; a sent failure does not', async () => {
  const caps = { ...ALT_CAPS, perIpPerDay: 2 };
  for (const [err, expected] of [[{ code: 'missing_key' }, 5], [{ notSent: true }, 5], [{ status: 502 }, 2]]) {
    const claude = { calls: 0, async altNames() { claude.calls++; throw Object.assign(new Error('x'), err); } };
    const f = createAltNames({ qloo: mockQloo({}), claude, caps });
    for (let i = 0; i < 5; i++) await f({ q: 'q' + i, kind: 'show', ip: 'x' });
    assert.equal(claude.calls, expected);
  }
});

// Review round 4 (HG-5 integration)
import { verifiedFavourite } from '../public/altnames-client.js';
import { pickKey } from '../public/logic.js';
test('verifiedFavourite: pushes {id,name,pick,tags}; rejects already picked/pending or same id', () => {
  const e = { id: 'q-mh', name: 'Money Heist', year: 2017, tags: [{ id: 't', name: 'heist' }] };
  assert.deepEqual(verifiedFavourite(e, 'show', [], []).fav, { id: 'q-mh', name: 'Money Heist', pick: pickKey('show', 'Money Heist', 2017), tags: e.tags });
  assert.equal(verifiedFavourite(e, 'show', [], [{ pick: pickKey('show', 'Money Heist', 2017) }]).dup, true);
  assert.equal(verifiedFavourite(e, 'show', [{ id: 'q-mh', pick: 'other' }], []).dup, true);
  assert.equal(verifiedFavourite({ name: 'x' }, 'show', [], []).invalid, true);
});
test('client lookup (primary trigger) needs no eligibility; a keystroke aborts it', async () => {
  let resolve; const fetch = (u, { signal }) => new Promise((res, rej) => { resolve = () => res(json({ results: [{ id: 'q1', name: 'X' }] })); signal.addEventListener('abort', () => rej(new Error('a'))); });
  const t = createAltTrigger({ fetch });
  const p = t.lookup('show', 'Oscuro'); t.onInput(); assert.equal(await p, null);
  const p2 = t.lookup('show', 'Oscuro'); resolve(); assert.deepEqual((await p2).map((e) => e.id), ['q1']);
});
const appSrc = async () => (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('app integration: missed favourites get Try other names; verified match never goes through bestQlooMatch', async () => {
  const src = await appSrc();
  assert.match(src, /We couldn't match \$\{missed\.join\(', '\)\}\. Pick \$\{3 - S\.favs\.length\} more\.`, missedPicks\)/);
  assert.match(src, /Try other names for \$\{m\.name\}/);
  assert.match(src, /alt\.lookup\(m\.kind, m\.name\)/);
  const add = src.slice(src.indexOf('const addVerified'), src.indexOf('// Secondary trigger'));
  assert.match(add, /verifiedFavourite\(e, kind, S\.favs, S\.pending, from\)/); assert.match(add, /S\.favs\.push\(v\.fav\)/);
  assert.ok(!add.includes('bestQlooMatch') && !add.includes('pendingMatches'));
  assert.match(src, /const i = S\.favs\.length \+ S\.pending\.length;/);
  assert.ok(!src.includes('qlooGate(() => alt') && !src.includes('/api/altnames')); // outside the gate, URL only in client module
});
test('app integration: keeps /api/suggest + AbortController + DEBOUNCE_MS; seq bumped on keystroke; restore keeps main copy', async () => {
  const src = await appSrc();
  assert.match(src, /\/api\/suggest\?kind=/); assert.match(src, /\}, DEBOUNCE_MS\);/); assert.match(src, /'aria-live': 'polite' \}, note \|\| ''\)/);
  const inp = src.slice(src.indexOf("input.addEventListener('input'"));
  assert.match(inp, /^input\.addEventListener\('input', \(\) => \{\n(\s*\/\/.*\n)*\s*const my = \+\+seq; alt\.onInput\(\);/);
  assert.match(inp.slice(0, inp.indexOf('DEBOUNCE_MS')), /if \(my !== seq\) return;\n\s*if \(q\.length < 2\)/);
  const enter = src.slice(src.indexOf("key !== 'Enter'"), src.indexOf("input.addEventListener('input'"));
  assert.match(enter, /found === null\) \{ msg\.textContent = prev; return; \}/);
  assert.ok(enter.indexOf('!alt.eligible(q)') < enter.indexOf("'Looking for other names…'"));
});
test('server keeps /api/suggest, .ico and /api/altnames', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /'\/api\/suggest': suggest/); assert.match(src, /'\/api\/altnames': altnames/); assert.match(src, /'\.ico': 'image\/x-icon'/);
});

// Review round 5
import { missedNote } from '../public/altnames-client.js';
import { settleFavourites } from '../public/logic.js';
test('R5.1: every favourite() re-render on the missed screen passes the missed list through', async () => {
  const src = await appSrc();
  const fav = src.slice(src.indexOf('function favourite('), src.indexOf('async function matchFavourites'));
  assert.ok(!/[^.\w]favourite\(\)/.test(fav), 'no bare favourite() re-render on this screen');
  assert.equal((fav.match(/favourite\(missNote\(rest\), rest\)/g) || []).length, 1); // after a verified match
  assert.equal((fav.match(/favourite\(missNote\(missed\), missed\)/g) || []).length, 1); // after picking a suggestion
});
test('R5.2: screenGen guards S.favs and every screen replace aborts the alt lookup', async () => {
  const src = await appSrc();
  assert.match(src, /const show = \(\.\.\.els\) => \{ screenGen\+\+; screenAbort\?\.\(\); screenAbort = null;/);
  assert.match(src, /const gen = screenGen; screenAbort = \(\) => alt\.onInput\(\);/);
  const add = src.slice(src.indexOf('const addVerified'), src.indexOf('// Secondary trigger'));
  assert.ok(add.indexOf('if (gen !== screenGen) return false;') < add.indexOf('S.favs.push'));
  // alt.onInput() aborts an in-flight lookup (resolves null, nothing added)
  const fetch = (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('a'))));
  const t = createAltTrigger({ fetch }); const p = t.lookup('show', 'x'); t.onInput(); assert.equal(await p, null);
});
test('R5.3: dup is not success: the button is reset, not left on "Looking…"', async () => {
  const src = await appSrc();
  const btn = src.slice(src.indexOf('const tryOthers'), src.indexOf('const shelf'));
  assert.match(btn, /if \(added === true\) return;/);
  assert.match(btn, /if \(added === 'dup'\) \{ b\.textContent = label; b\.disabled = false; return; \}/);
  assert.ok(!/if \(found\?\.length && addVerified/.test(btn));
});
test('R5.4: note after a match keeps "Pick N more." while fewer than 3 are chosen', () => {
  assert.equal(missedNote([{ name: 'A' }, { name: 'B' }], 1), "We couldn't match A, B. Pick 2 more.");
  assert.equal(missedNote([{ name: 'A' }], 3), "We couldn't match A.");
  assert.equal(missedNote([], 0), '');
});
test('R5.5: missed picks are matched by pending key, not by name', async () => {
  const pending = [{ key: 'k1', name: 'Dark', pick: 'show|dark|' }, { key: 'k2', name: 'Dark', pick: 'movie|dark|' }];
  const r = settleFavourites([], pending, new Map([['k1', { id: 'q-d', tags: [] }], ['k2', null]]));
  assert.deepEqual(r.missedKeys, ['k2']); assert.deepEqual(r.missed, ['Dark']);
  assert.match(await appSrc(), /S\.pending\.filter\(\(f\) => missedKeys\.includes\(f\.key\)\)/);
});
test('R5.6: verified favourite keeps the typed name for display, Qloo id/pick', () => {
  const v = verifiedFavourite({ id: 'q-mh', name: 'Money Heist', year: 2017, tags: [] }, 'show', [], [], 'La casa de papel');
  assert.equal(v.fav.name, 'La casa de papel'); assert.equal(v.fav.id, 'q-mh'); assert.equal(v.fav.pick, pickKey('show', 'Money Heist', 2017));
});
test('R5.7: per-IP map is capped; new IPs past the cap fail closed', async () => {
  const claude = mockClaude([]);
  const f = createAltNames({ qloo: mockQloo({}), claude, caps: { ...ALT_CAPS, maxIps: 3 } });
  for (let i = 0; i < 3; i++) await f({ q: 'q' + i, kind: 'show', ip: 'ip' + i });
  assert.deepEqual(await f({ q: 'new', kind: 'show', ip: 'ip9' }), { results: [], capped: 'ips' });
  assert.equal((await f({ q: 'again', kind: 'show', ip: 'ip0' })).capped, undefined); // known IP still served
  assert.equal(claude.calls, 4); assert.equal(ALT_CAPS.maxIps, 10000);
});
