import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, canSkip, flapSteps, padTo, rankPicks, userCountryFromLocale } from '../public/logic.js';
import { sharedTags, whyLine } from '../lib/why.js';

test('prompts rotate show, band, place, book, wildcard; skip only after 3', () => {
  assert.deepEqual(PROMPTS.map((p) => p.kind), ['show', 'band', 'place', 'book', 'any']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(canSkip), [false, false, false, true, true, false]);
});
test('split-flap steps land on target', () => {
  const s = flapSteps('A', 'D'); assert.deepEqual(s, ['B', 'C', 'D']);
  assert.equal(flapSteps('A', '서').at(-1), '서');
  assert.equal(flapSteps('A', 'Z', 5).at(-1), 'Z');
  assert.deepEqual(padTo('ab', 4), ['a', 'b', ' ', ' ']);
});
test('rankPicks: hero is top show, then show/band/podcast/place', () => {
  const r = rankPicks({ tv: { picks: [{ t: 1 }, { t: 2 }] }, music: { picks: [{ t: 3 }] }, podcast: { picks: [] }, place: { picks: [{ t: 5 }] } });
  assert.deepEqual(r.hero, { t: 1 }); assert.deepEqual(r.rest.map((x) => x.t), [2, 3, 5]);
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
