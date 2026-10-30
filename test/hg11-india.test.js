import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestSeedMatch } from '../lib/qloo.js';
import { loadGate, catalogue, cityStatus, thinNote } from '../lib/gate.js';
import { indiaGroups, matchState, indiaLabel } from '../public/india.js';

test('HG-11 seed: exact title beats a longer first result (Parasite, not Parasite Dolls)', () => {
  const res = [{ id: 'a', name: 'Parasite Dolls', popularity: 0.5 }, { id: 'b', name: 'Parasite', popularity: 0.99 }, { id: 'c', name: 'Parasite', popularity: 0.2 }];
  assert.equal(bestSeedMatch(res, 'Parasite').id, 'b', 'exact match, most popular');
  assert.equal(bestSeedMatch(res, 'parasite ').id, 'b', 'case/space-insensitive');
  assert.equal(bestSeedMatch([{ id: 'x', name: 'Foo 2', popularity: 0.1 }, { id: 'y', name: 'Foo III', popularity: 0.9 }], 'Foo').id, 'y', 'no exact: most popular');
  assert.equal(bestSeedMatch([], 'Foo'), null);
  assert.match(readFileSync('scripts/measure.mjs', 'utf8'), /bestSeedMatch\(/);
});

test('HG-11 config: Kochi and Amritsar are live from the committed gate; Amritsar has the thin-pool note', () => {
  const g = loadGate();
  assert.equal(cityStatus(g, 'kochi').live, true);
  assert.equal(cityStatus(g, 'amritsar').live, true);
  assert.equal(thinNote(g, 'kochi'), null);
  assert.match(thinNote(g, 'amritsar'), /Punjabi/);
});

test('HG-11 India picker: live languages labelled with states, then coming soon; state search', () => {
  const cat = catalogue(loadGate());
  const g = indiaGroups(cat);
  assert.deepEqual(g.live.map((l) => l.id).sort(), ['bn', 'hi', 'ml', 'pa', 'ta', 'te']);
  assert.equal(indiaLabel(g.live.find((l) => l.id === 'te')), 'Telugu, Andhra Pradesh & Telangana');
  assert.ok(g.soon.length >= 10 && g.soon.every((l) => !l.live));
  assert.ok(!g.live.some((l) => ['es', 'ko', 'fr'].includes(l.id)), 'non-Indian languages stay out');
  assert.deepEqual(matchState(g, 'kerala').live.map((l) => l.id), ['ml']);
  assert.deepEqual(matchState(g, 'karnataka').soon.map((l) => l.id).sort(), ['kn', 'tcy']);
  assert.deepEqual(matchState(g, 'telangana').live.map((l) => l.id), ['te']);
  assert.equal(matchState(g, '').live.length, g.live.length);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /from '\.\/india\.js'/);
  assert.match(readFileSync('public/india.js', 'utf8'), /try Hindi meanwhile/);
});
