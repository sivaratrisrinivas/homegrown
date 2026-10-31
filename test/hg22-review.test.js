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

test('HG-22 review 2: hero sentence reads under 5% / at least ~N% / 95% or more, never "at least 95%+"', async () => {
  const { coverageSentence } = await import('../public/coverage.js');
  assert.equal(coverageSentence(0.01), 'under 5%'); assert.equal(coverageSentence(0.82), 'at least ~80%');
  assert.equal(coverageSentence(0.948), '95% or more'); assert.equal(coverageSentence(1), '95% or more'); assert.equal(coverageSentence(null), null);
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(!/at least ~'\)/.test(app) && /coverageSentence\(c\)/.test(app));
});

test('HG-22 review 2: profiles with >40% unmatched words or counts that do not add up are rejected', async () => {
  const { profileProblem, BANDS, MIN_TOKENS } = await import('../public/coverage.js');
  const { coverageFor } = await import('../lib/coverage.js');
  const mk = (known, beyond) => { const bands = new Array(BANDS).fill(0); bands[0] = known; return { tokens: known + beyond, bands, beyond }; };
  assert.equal(profileProblem(mk(MIN_TOKENS, 0)), null);
  assert.equal(profileProblem(mk(600, 400)), 'too short');
  assert.equal(profileProblem(mk(3000, 2000)), null); // exactly 40% beyond is allowed
  assert.match(profileProblem(mk(3000, 2100)), /unmatched/);
  assert.match(profileProblem({ ...mk(3000, 0), tokens: 3001 }), /add up/);
  assert.equal(coverageFor(1, 'es', { films: { '1:es': mk(0, 5000) } }), null);
  assert.equal(coverageFor(1, 'es', { films: { '1:es': { ...mk(5000, 0), beyond: 1 } } }), null);
  const films = JSON.parse(readFileSync('config/coverage.json', 'utf8')).films;
  assert.equal(Object.keys(films).length, 16);
  for (const [k, p] of Object.entries(films)) { const [id, lang] = k.split(':'); assert.ok(coverageFor(id, lang), k); }
  assert.match(readFileSync('scripts/coverage.mjs', 'utf8'), /profileProblem\(p\)/);
});
