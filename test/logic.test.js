import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, canSkip, flapSteps, padTo, rankPicks, userCountryFromLocale } from '../public/logic.js';
import { sharedTags, whyLine } from '../lib/why.js';

test('prompts rotate show, band, film, book, wildcard; skip only after 3', () => {
  assert.deepEqual(PROMPTS.map((p) => p.kind), ['show', 'band', 'movie', 'book', 'any']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(canSkip), [false, false, false, true, true, false]);
});
test('split-flap steps land on target', () => {
  const s = flapSteps('A', 'D'); assert.deepEqual(s, ['B', 'C', 'D']);
  assert.equal(flapSteps('A', '서').at(-1), '서');
  assert.equal(flapSteps('A', 'Z', 5).at(-1), 'Z');
  assert.deepEqual(padTo('ab', 4), ['a', 'b', ' ', ' ']);
});
test('rankPicks: hero is top show, then show/film/band', () => {
  const r = rankPicks({ tv: { picks: [{ t: 1 }, { t: 2 }] }, movie: { picks: [{ t: 3 }] }, music: { picks: [{ t: 4 }] }, place: { picks: [{ t: 5 }] } });
  assert.deepEqual(r.hero, { t: 1 }); assert.deepEqual(r.rest.map((x) => x.t), [2, 3, 4]);
  assert.equal(rankPicks({}).hero, null);
});
test('locale -> country', () => { assert.equal(userCountryFromLocale('en-IN'), 'IN'); assert.equal(userCountryFromLocale('fr'), 'US'); });
test('why-line only quotes real shared tags', () => {
  const favs = [{ name: 'BB', tags: [{ id: 't1', name: 'slow_burn' }] }];
  assert.equal(sharedTags(favs, { tags: [{ id: 't1', name: 'slow_burn' }] }).length, 1);
  assert.match(whyLine(favs, { tags: [{ id: 't1', name: 'slow_burn' }] }).text, /BB: both are slow burn/);
  const w = whyLine(favs, { tags: [{ id: 't2', name: 'x' }] });
  assert.equal(w.grounded, false); assert.doesNotMatch(w.text, /Because/);
});
import { createRunGuard } from '../public/logic.js';
test('run guard drops stale city responses', () => {
  const g = createRunGuard(); const mx = g.start(); assert.equal(mx(), true);
  const kr = g.start(); assert.equal(mx(), false); assert.equal(kr(), true);
});

import { createSpacer, createMemo, searchKey, twinClientKey, CLIENT_QLOO_GAP_MS } from '../public/logic.js';
test('client Qloo spacer: serialised, >= 7 s apart', async () => {
  let t = 0; const starts = [];
  const gate = createSpacer({ now: () => t, sleep: async (ms) => { t += ms; } });
  await Promise.all([1, 2, 3].map((i) => gate(async () => { starts.push(t); t += 500; return i; })));
  assert.equal(CLIENT_QLOO_GAP_MS, 7000);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - (starts[i - 1] + 500) >= 7000);
  await assert.rejects(gate(async () => { throw new Error('x'); }));
  assert.equal(await gate(async () => 'still works'), 'still works');
});
test('client memo keys cover repeat queries, favourites and cities', () => {
  const m = createMemo(); m.set(searchKey('show', ' Breaking Bad '), 1);
  assert.equal(m.get(searchKey('show', 'breaking bad')), 1);
  const a = [{ id: 'x' }, { id: 'y' }], b = [{ id: 'y' }, { id: 'x' }];
  assert.equal(twinClientKey(a, 'seoul', 'tv', 'IN'), twinClientKey(b, 'seoul', 'tv', 'IN'));
  assert.notEqual(twinClientKey(a, 'seoul', 'tv', 'IN'), twinClientKey(a, 'paris', 'tv', 'IN'));
});
