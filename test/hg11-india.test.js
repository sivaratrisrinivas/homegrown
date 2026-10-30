import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestSeedMatch } from '../lib/qloo.js';
import { loadGate, catalogue, cityStatus, thinNote } from '../lib/gate.js';
import { indiaGroups, matchState, indiaLabel, meanwhileHint, matchStatus } from '../public/india.js';

test('HG-11 seed: exact title beats a longer first result (Parasite, not Parasite Dolls)', () => {
  const res = [{ id: 'a', name: 'Parasite Dolls', popularity: 0.5 }, { id: 'b', name: 'Parasite', popularity: 0.99 }, { id: 'c', name: 'Parasite', popularity: 0.2 }];
  assert.equal(bestSeedMatch(res, 'Parasite').id, 'b', 'exact match, most popular');
  assert.equal(bestSeedMatch(res, 'parasite ').id, 'b', 'case/space-insensitive');
  assert.equal(bestSeedMatch([{ id: 'x', name: 'Foo 2', popularity: 0.1 }, { id: 'y', name: 'Foo III', popularity: 0.9 }], 'Foo').id, 'y', 'no exact: most popular');
  assert.equal(bestSeedMatch([], 'Foo'), null);
});

test('HG-11 seed: names that both normalise to empty are not an exact match', () => {
  const res = [{ id: 'ko', name: '기생충', popularity: 0.1 }, { id: 'pop', name: 'Parasite', popularity: 0.9 }];
  assert.equal(bestSeedMatch(res, '!!!').id, 'pop', 'empty query falls back to most popular');
  assert.equal(bestSeedMatch(res, '기생충').id, 'pop', 'non-Latin query is not "exactly" another non-Latin name');
});

test('HG-11 config: Kochi and Amritsar are live from the committed gate; Amritsar has the thin-pool note', () => {
  const g = loadGate();
  assert.equal(cityStatus(g, 'kochi').live, true);
  assert.equal(cityStatus(g, 'amritsar').live, true);
  assert.equal(thinNote(g, 'kochi'), null);
  assert.match(thinNote(g, 'amritsar'), /Punjabi/);
});

const G = () => indiaGroups(catalogue(loadGate()));

test('HG-11 India picker: live languages with states; coming soon vs not supported are separate', () => {
  const g = G();
  assert.deepEqual(g.live.map((l) => l.id).sort(), ['bn', 'hi', 'ml', 'pa', 'ta', 'te']);
  assert.equal(indiaLabel(g.live.find((l) => l.id === 'te')), 'Telugu, Andhra Pradesh & Telangana');
  assert.deepEqual(g.soon.map((l) => l.id).sort(), ['as', 'gu', 'kn', 'ks', 'mr', 'ne', 'or']);
  assert.deepEqual(g.unsupported.map((l) => l.id).sort(), ['bho', 'kha', 'kok', 'lus', 'mni', 'tcy']);
  assert.ok(!g.live.some((l) => ['es', 'ko', 'fr'].includes(l.id)), 'non-Indian languages stay out');
});

test('HG-11 India picker: Hindi lists only Hindi-majority states; stateless states get one hint', () => {
  const g = G();
  const hi = g.live.find((l) => l.id === 'hi').states;
  for (const s of ['Maharashtra', 'Jammu & Kashmir', 'Ladakh', 'Arunachal Pradesh', 'Nagaland', 'Andaman & Nicobar Islands']) assert.ok(!hi.includes(s), s);
  const m = matchState(g, 'nagaland');
  assert.equal(m.live.length + m.soon.length + m.unsupported.length, 0);
  assert.equal(meanwhileHint(m), 'No film language for your state yet, try Hindi meanwhile.');
  assert.equal(matchStatus(m), '0 languages match');
});

test('HG-11 India picker: state search, live status, one meanwhile hint with the nearest live language', () => {
  const g = G();
  assert.deepEqual(matchState(g, 'kerala').live.map((l) => l.id), ['ml']);
  const k = matchState(g, 'karnataka');
  assert.deepEqual([k.soon.map((l) => l.id), k.unsupported.map((l) => l.id)], [['kn'], ['tcy']]);
  assert.equal(matchStatus(k), '2 languages match');
  assert.equal(meanwhileHint(k), 'Not live yet? Try Hindi meanwhile.');
  assert.equal(meanwhileHint(matchState(g, 'assam')), 'Not live yet? Try Bengali for Assamese, meanwhile.');
  assert.equal(meanwhileHint(matchState(g, 'kerala')), null, 'no hint when everything shown is live');
  assert.equal(matchStatus(matchState(g, 'telangana')), '1 language matches');
});

test('HG-11 India picker markup: native names carry lang=, no aria-disabled, status is polite', () => {
  const src = readFileSync('public/india.js', 'utf8');
  assert.match(src, /lang: l\.id/);
  assert.doesNotMatch(src, /aria-disabled/);
  assert.match(src, /'aria-live': 'polite'/);
  assert.doesNotMatch(readFileSync('public/styles.css', 'utf8').split('HG-11')[1], /opacity/);
});
