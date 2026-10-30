import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { whyLine, phrase, plural } from '../lib/why.js';
import { createSuggest, normaliseKind } from '../lib/suggest.js';
import { present, bestQlooMatch, DEBOUNCE_MS, settleFavourites, favouriteIds } from '../public/logic.js';
import { createServer } from '../server.js';
import { setSuggest, suggestCache } from '../api/suggest.js';

const BB = 'Breaking Bad';
const tag = (kind, name) => ({ id: `urn:tag:${kind}:media:${name.toLowerCase().replace(/ /g, '_')}`, name });

test('a) null view parts are dropped, never rendered as "null"', () => {
  assert.deepEqual(present(['a', null, undefined, false, ['b', null]]), ['a', 'b']);
});

test('b) reasons read naturally for nouns, plurals, adjectives and subjects', () => {
  const f = BB;
  assert.equal(phrase({ favourite: f, tag: 'Drug dealer', kind: 'keyword' }, 'tv', 0), 'Shares drug-dealer drama with Breaking Bad');
  assert.equal(phrase({ favourite: f, tag: 'Friend', kind: 'keyword' }, 'tv', 1), "Like Breaking Bad, it's about friends");
  assert.equal(phrase({ favourite: f, tag: 'Cinematic', kind: 'style' }, 'tv', 0), 'Just as cinematic as Breaking Bad');
  assert.equal(phrase({ favourite: f, tag: 'Crime', kind: 'theme' }, 'tv', 0), 'A crime show, like Breaking Bad');
  assert.equal(phrase({ favourite: f, tag: 'Crime thriller', kind: 'plot' }, 'movie', 0), 'A crime thriller, like Breaking Bad');
  assert.equal(phrase({ favourite: 'IU', tag: 'k_pop', kind: 'genre' }, 'music', 0), 'A k-pop act, like IU');
  assert.equal(phrase({ favourite: f, tag: 'Secret', kind: 'keyword' }, 'tv', 0), 'Shares the secret thread with Breaking Bad');
  assert.equal(plural('thriller'), null); assert.equal(plural('family'), 'families'); assert.equal(plural('murder'), null);
  for (const [t, k] of [['Drug dealer', 'keyword'], ['Friend', 'keyword'], ['Cinematic', 'style'], ['Protective', 'character'], ['Survival', 'theme']]) {
    for (const v of [0, 1]) assert.doesNotMatch(phrase({ favourite: f, tag: t, kind: k }, 'tv', v), /both are|: both|\ba friend\b drama/i);
  }
});

test('b) neighbouring picks get different reasons; junk tags are skipped', () => {
  const tags = [tag('keyword', 'Breaking bad'), tag('keyword', 'Scene before opening credits'), tag('style', 'Cinematic'), tag('theme', 'Crime'), tag('keyword', 'Drug dealer')];
  const favs = [{ name: BB, tags }];
  const lines = [0, 1, 2, 3, 4, 5].map((i) => whyLine(favs, { tags, category: 'tv' }, i).text);
  assert.equal(new Set(lines).size, 6, lines.join(' | '));
  assert.ok(lines.every((l) => !/opening credits|Breaking bad thread/i.test(l)));
  assert.ok(lines.every((l) => l.includes(BB)));
});

test('e) suggestions come from TMDB/iTunes/Open Library in parallel, never Qloo', async () => {
  const calls = []; let inflight = 0, peak = 0;
  const fetch = async (url) => {
    calls.push(String(url)); inflight++; peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 20)); inflight--;
    const u = String(url);
    const body = u.includes('itunes') ? { results: [{ artistName: 'Radiohead' }] }
      : u.includes('openlibrary') ? { docs: [{ title: 'Rebecca', first_publish_year: 1938 }] } : {};
    return { ok: true, status: 200, json: async () => body };
  };
  const tmdb = { searchTv: async () => [{ name: 'Breaking Bad', first_air_date: '2008-01-20' }], searchMovie: async () => [{ title: 'Parasite', release_date: '2019-05-30' }] };
  const s = createSuggest({ fetch, tmdb }); const all = async (q, k) => (await s.suggest(q, k)).results;
  const any = await all('ra', 'any');
  assert.deepEqual(any.map((r) => r.kind).sort(), ['band', 'book', 'movie', 'show']);
  assert.equal(peak, 2, 'iTunes and Open Library ran concurrently');
  assert.ok(calls.every((u) => !u.includes('qloo')));
  assert.deepEqual(await all('br', 'show'), [{ name: 'Breaking Bad', year: 2008, kind: 'show' }]);
});

test('e) one failing source does not sink the others', async () => {
  const s = createSuggest({ fetch: async () => ({ ok: false, status: 500 }), tmdb: { searchTv: async () => [{ name: 'X', first_air_date: '2001' }], searchMovie: async () => [] } });
  const r = await s.suggest('xx', 'any');
  assert.equal(r.results[0].name, 'X'); assert.equal(r.partial, true);
  assert.deepEqual(await s.suggest('xx', 'constructor'), { results: [], partial: false }, 'prototype keys are not sources');
  assert.deepEqual(await s.suggest('xx', '__proto__'), { results: [], partial: false });
});

test('e) the chosen suggestion maps to the right Qloo entity', () => {
  const rs = [{ id: 'a', name: 'Breaking Bad: Original Minisodes', year: 2009 }, { id: 'b', name: 'Breaking Bad', year: 2008 }, { id: 'c', name: 'Breaking Bad', year: 1999 }];
  assert.equal(bestQlooMatch(rs, { name: 'Breaking Bad', year: 2008 }).id, 'b');
  assert.equal(bestQlooMatch(rs, { name: 'breaking  bad' }).id, 'b');
  assert.equal(bestQlooMatch([], { name: 'x' }), null);
  assert.equal(bestQlooMatch(rs, { name: 'The Wire' }), null, 'no name match -> null, never results[0]');
  assert.ok(DEBOUNCE_MS <= 300);
});

let srv, base;
before(async () => { srv = createServer(); await new Promise((r) => srv.listen(0, r)); base = `http://127.0.0.1:${srv.address().port}`; });
after(() => srv.close());

test('c) /favicon.ico and /favicon.svg are served', async () => {
  const ico = await fetch(base + '/favicon.ico'); assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
  const buf = Buffer.from(await ico.arrayBuffer()); assert.deepEqual([...buf.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal((await fetch(base + '/favicon.svg')).status, 200);
});

test('d) first paint: Start is in the HTML and fonts cannot block or re-flow it', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<button id="start"[^>]*>Start<\/button>/);
  assert.match(html, /display=swap/);
  assert.equal((html.match(/rel="preload" as="font"/g) || []).length, 1, 'preload only the primary font');
  assert.match(html, /media="print" onload=/);
  assert.doesNotMatch(html, /filter id="grain"/);
  const css = await (await fetch(base + '/styles.css')).text();
  assert.doesNotMatch(css, /mix-blend-mode/);
  for (const fam of ['Fraunces Fallback', 'Noto Serif KR Fallback']) {
    const face = css.match(new RegExp(`@font-face\\{font-family:"${fam}"[^}]*\\}`))?.[0] || '';
    assert.match(face, /src:local\(/); assert.match(face, /size-adjust:/); assert.match(face, /ascent-override:/); assert.match(face, /descent-override:/);
  }
  assert.match(css, /h1,h2,\.serif\{font-family:Fraunces,"Fraunces Fallback"/);
});

test('e) /api/suggest caches by (kind, q) and needs no Qloo key', async () => {
  suggestCache.set('x', null);
  let n = 0; setSuggest({ suggest: async (q) => { n++; return { results: [{ name: q.toUpperCase(), kind: 'show' }], partial: false }; } });
  const a = await (await fetch(base + '/api/suggest?kind=show&q=lost')).json();
  const b = await (await fetch(base + '/api/suggest?kind=show&q=Lost')).json();
  assert.deepEqual(a, b); assert.equal(n, 1);
  setSuggest(undefined);
});

test('b) picks in one category avoid repeating a tag when others are shared', () => {
  const tags = [tag('style', 'Cinematic'), tag('theme', 'Crime'), tag('character', 'Protective')];
  const favs = [{ name: BB, tags }]; const used = new Set();
  const lines = [0, 1, 2].map((i) => whyLine(favs, { tags, category: 'tv' }, i, used).text);
  for (const t of ['cinematic', 'crime', 'protective']) assert.equal(lines.filter((l) => l.toLowerCase().includes(t)).length, 1, lines.join(' | '));
  assert.equal(phrase({ favourite: 'Parasite', tag: 'Family', kind: 'theme' }, 'movie', 0), 'A family film, like Parasite');
});

test('1) partial suggestions are served but not cached (server or edge)', async () => {
  let n = 0; setSuggest({ suggest: async () => { n++; return { results: [{ name: 'Only TMDB', kind: 'show' }], partial: true }; } });
  const r1 = await fetch(base + '/api/suggest?kind=any&q=partialq');
  assert.equal(r1.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r1.json(), { results: [{ name: 'Only TMDB', kind: 'show' }], partial: true });
  await fetch(base + '/api/suggest?kind=any&q=partialq');
  assert.equal(n, 2, 'second request asked the sources again');
  assert.equal(suggestCache.get('any|partialq'), undefined);
  setSuggest(undefined);
});

test('3) unknown kinds normalise to "any" before the cache key', async () => {
  const seen = []; setSuggest({ suggest: async (q, k) => { seen.push(k); return { results: [], partial: false }; } });
  await fetch(base + '/api/suggest?kind=__proto__&q=kindq');
  await fetch(base + '/api/suggest?kind=bogus&q=kindq');
  await fetch(base + '/api/suggest?kind=any&q=kindq');
  assert.deepEqual(seen, ['any'], 'one source call: all three share the any|kindq key');
  assert.equal(normaliseKind('constructor'), 'any'); assert.equal(normaliseKind('band'), 'band');
  setSuggest(undefined);
});

test('2) pending favourites become real only with a valid Qloo id; track() gets ids only', () => {
  const favs = [{ id: 'q1', name: 'BB', tags: [] }];
  const pending = [{ key: 'k1', name: 'Radiohead' }, { key: 'k2', name: 'Nope' }, { key: 'k3', name: 'Bad' }];
  const matches = new Map([['k1', { id: 'q2', name: 'Radiohead', tags: [{ id: 't', name: 'x' }] }], ['k2', null], ['k3', { name: 'no id' }]]);
  const { favs: out, missed } = settleFavourites(favs, pending, matches);
  assert.deepEqual(out.map((f) => f.id), ['q1', 'q2']);
  assert.deepEqual(missed, ['Nope', 'Bad']);
  assert.ok(out.every((f) => !('match' in f) && Array.isArray(f.tags)));
  assert.deepEqual(favouriteIds([{ id: 'a' }, { name: 'pending' }, { id: '' }, { id: 'b' }]), ['a', 'b']);
});
