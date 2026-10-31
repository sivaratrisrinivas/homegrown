import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverageDifficulty, coverageLabel, safeStorage, finishWordCheck, readVocab, seededShuffle, VOCAB_KEY } from '../public/coverage.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('HG-22 review: blocked localStorage gives no storage, and done() uses the guarded getter', () => {
  assert.equal(safeStorage(() => { throw new Error('SecurityError'); }), null);
  const st = mem(); assert.equal(safeStorage(() => st), st);
  assert.equal(finishWordCheck(null, 'es', [{ band: 0, known: true }]), false);
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(!/saveVocab\(localStorage/.test(app) && !/readVocab\(localStorage/.test(app));
});

test('HG-22 review: dot follows the rounded %, labels avoid ~0% and ~99%', () => {
  assert.equal(coverageLabel(0.01), '<5%'); assert.equal(coverageLabel(0.999), '95%+'); assert.equal(coverageLabel(0.95), '95%+');
  assert.equal(coverageLabel(0.82), '~80%'); assert.equal(coverageLabel(null), null);
  assert.equal(coverageDifficulty(0.948), 'easy'); // shown as 95%+
  assert.equal(coverageDifficulty(0.84), 'medium'); // shown as ~85%
  assert.equal(coverageDifficulty(0.82), 'hard');
});

test('HG-22 review: Done with nothing ticked saves no estimate; ticking saves one', () => {
  const st = mem(); const items = [0, 1, 2].map((band) => ({ w: 'x', band, known: false }));
  assert.equal(finishWordCheck(st, 'es', items), false); assert.equal(st.getItem(VOCAB_KEY), null); assert.equal(readVocab(st, 'es'), null);
  items[0].known = true;
  assert.equal(finishWordCheck(st, 'es', items, 1), true); assert.ok(readVocab(st, 'es') > 0);
  assert.match(readFileSync('public/app.js', 'utf8'), /Retake word check/);
});

test('HG-22 review: seeded shuffle is fixed and a permutation', () => {
  const a = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(seededShuffle(a), seededShuffle(a)); assert.deepEqual([...seededShuffle(a)].sort((x, y) => x - y), a); assert.notDeepEqual(seededShuffle(a), a);
});
