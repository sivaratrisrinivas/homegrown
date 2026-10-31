import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, stripKo, subtitleText, profile, coverage, coveragePct, coverageDifficulty, estimateVocab, readVocab, saveVocab, supported, UNSUPPORTED, LANGS, BANDS, BAND, TEST_BANDS, WORDS_PER_BAND, MIN_TOKENS } from '../public/coverage.js';
import { coverageFor } from '../lib/coverage.js';
import { personalise } from '../lib/twin.js';
import { bestFile, profileOf } from '../scripts/coverage.mjs';

test('HG-22: subtitles become spoken words only (no timings, tags, sound notes or numbers)', () => {
  const t = tokenize(subtitleText(readFileSync('test/fixtures/hg22.es.srt', 'utf8')), 'es');
  assert.deepEqual(t, ['dónde', 'estabas', 'anoche', 'estaba', 'en', 'casa', 'con', 'mi', 'hermano', 'no', 'te', 'creo']);
});

test('HG-22: Korean strips particles; Chinese and Hindi use Intl.Segmenter words', () => {
  assert.equal(stripKo('친구를'), '친구'); assert.equal(stripKo('학교에서'), '학교'); assert.equal(stripKo('를'), '를');
  assert.deepEqual(tokenize('나는 친구를 만났어요', 'ko'), ['나', '친구', '만났어요']);
  assert.deepEqual(tokenize('我們明天去看電影', 'zh').length > 3, true);
  assert.deepEqual(tokenize('मैं घर जा रहा हूँ', 'hi'), ['मैं', 'घर', 'जा', 'रहा', 'हूँ']);
});

test('HG-22: Japanese, Thai, Cantonese and Punjabi are unsupported: no tokens, no line', () => {
  for (const l of ['ja', 'th', 'cn', 'pa']) { assert.equal(supported(l), false); assert.ok(UNSUPPORTED[l]); assert.deepEqual(tokenize('テスト', l), []); }
  assert.equal(coverageFor(1, 'ja', { films: { '1:ja': { tokens: 5000, bands: new Array(BANDS).fill(0) } } }), null);
});

test('HG-22: coverage is the share of tokens within the vocabulary, the cut-off band pro rata', () => {
  const bands = new Array(BANDS).fill(0); bands[0] = 60; bands[1] = 20; bands[10] = 10;
  const p = { tokens: 100, bands, beyond: 10 };
  assert.equal(coverage(p, 0), 0);
  assert.equal(coverage(p, 500), 0.6);
  assert.equal(coverage(p, 750), 0.7);
  assert.equal(coverage(p, 20000), 0.9); // words beyond the list stay unknown
  assert.equal(coverage(null, 500), null); assert.equal(coverage(p, null), null);
  assert.equal(coveragePct(0.9), 90); assert.equal(coveragePct(0.82), 80); assert.equal(coveragePct(0.999), 99); assert.equal(coveragePct(null), null);
  assert.equal(coverageDifficulty(0.96), 'easy'); assert.equal(coverageDifficulty(0.9), 'medium'); assert.equal(coverageDifficulty(0.5), 'hard'); assert.equal(coverageDifficulty(null), null);
});

test('HG-22: profile counts tokens into 500-rank bands and stores no words', () => {
  const rank = new Map([['a', 1], ['b', 501], ['c', 19999]]);
  const p = profile(['a', 'a', 'b', 'c', 'zz'], rank);
  assert.equal(p.tokens, 5); assert.equal(p.bands[0], 2); assert.equal(p.bands[1], 1); assert.equal(p.bands[BANDS - 1], 1); assert.equal(p.beyond, 1);
  assert.ok(!JSON.stringify(p).includes('"a"'));
  const f = profileOf(readFileSync('test/fixtures/hg22.es.srt', 'utf8'), 'es');
  assert.equal(f.tokens, 12); assert.ok(f.bands[0] >= 10, 'common Spanish words sit in the top band');
});

test('HG-22: vocabulary estimate from 6 bands; stored in localStorage only', () => {
  const all = TEST_BANDS.flatMap((_, band) => Array.from({ length: 5 }, () => ({ band, known: true })));
  assert.equal(estimateVocab(all), 20000);
  assert.equal(estimateVocab(all.map((x) => ({ ...x, known: x.band === 0 }))), 1000);
  assert.equal(estimateVocab(all.map((x, i) => ({ ...x, known: x.band <= 1 || (x.band === 2 && i % 5 < 2) }))), 3500);
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readVocab(st, 'es'), null); saveVocab(st, 'es', 3500, 1); assert.equal(readVocab(st, 'es'), 3500); assert.equal(readVocab(st, 'ko'), null);
  assert.equal(readVocab({ getItem: () => { throw new Error('blocked'); } }, 'es'), null);
});

test('HG-22: committed data: 20k-word lists, 30 test words per supported language', () => {
  const t = JSON.parse(readFileSync('public/vocab-test.json', 'utf8'));
  for (const l of Object.keys(LANGS)) {
    const n = readFileSync(`data/freq/${l}.txt`, 'utf8').trim().split('\n').length;
    assert.ok(n > 9000 && n <= 20000, `${l} list size ${n}`);
    assert.equal(t[l].length, TEST_BANDS.length);
    assert.ok(t[l].every((b) => b.length <= WORDS_PER_BAND));
  }
  assert.equal(t.es.flat().length, 30);
});

test('HG-22: server attaches a coverage profile only when it exists, is supported and long enough', () => {
  const bands = new Array(BANDS).fill(0); bands[0] = MIN_TOKENS;
  const data = { films: { '7:es': { tokens: MIN_TOKENS, bands, beyond: 0 }, '8:es': { tokens: 10, bands, beyond: 0 } } };
  assert.equal(coverageFor(7, 'es', data).tokens, MIN_TOKENS);
  assert.equal(coverageFor(8, 'es', data), null);
  assert.equal(coverageFor(9, 'es', data), null);
  assert.equal(coverageFor(7, 'es', {}), null);
  const res = { picks: [{ title: 'X', category: 'movie', tags: [], verification: { tmdbId: 7, language: 'es' }, src: { genreIds: [], language: 'es' } }, { title: 'Y', category: 'movie', tags: [], verification: { tmdbId: 9, language: 'es' }, src: { genreIds: [], language: 'es' } }] };
  const out = personalise(res, [], [], (p) => coverageFor(p.verification.tmdbId, p.verification.language, data));
  assert.equal(out.picks[0].coverage.lang, 'es'); assert.equal('coverage' in out.picks[1], false);
  assert.equal(BAND * BANDS, 20000);
});

test('HG-22: OpenSubtitles file choice skips machine/AI translations and foreign-parts-only files', () => {
  const r = (id, n, a = {}) => ({ attributes: { download_count: n, files: [{ file_id: id }], ...a } });
  assert.equal(bestFile([r(1, 900, { machine_translated: true }), r(2, 50), r(3, 800, { ai_translated: true }), r(4, 100), r(5, 999, { foreign_parts_only: true })]), 4);
  assert.equal(bestFile([]), null);
});
