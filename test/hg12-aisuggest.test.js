import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiSuggest, AI_LABEL, MAX_SUGGEST_USD, aiKey } from '../lib/aisuggest.js';
import { createClaudeBudget } from '../lib/claudebudget.js';
import { parseFilms } from '../lib/anthropic.js';
import { aiView } from '../public/aisuggest-client.js';
import { loadGate } from '../lib/gate.js';

const LANGS = () => [{ language: 'kn', name: 'Kannada' }, { language: 'mr', name: 'Marathi' }];
const movie = (title, lang, countries = ['IN']) => ({ row: { id: title, title, original_title: title, original_language: lang, release_date: '2020-01-01' }, countries });
function svc({ films, catalog, budget = createClaudeBudget({ usdPerDay: 0.25 }), caps } = {}) {
  const calls = { claude: 0 };
  const claude = { suggestFilms: async () => { calls.claude++; return { films, usage: { input_tokens: 100, output_tokens: 100 } }; } };
  const byTitle = Object.fromEntries(catalog.map((m) => [m.row.title, m]));
  const tmdb = { searchMovie: async (q) => (byTitle[q] ? [byTitle[q].row] : []), movieDetails: async (id) => ({ origin_country: byTitle[id].countries }) };
  return { s: createAiSuggest({ claude, tmdb, budget, languages: LANGS, ...(caps ? { caps } : {}) }), calls, budget };
}
const F = (...t) => t.map((title) => ({ title, year: 2020 }));

test('HG-12: verification drops wrong-language, non-Indian and unknown titles; keeps the verified ones, labelled', async () => {
  const { s } = svc({ films: F('K1', 'K2', 'K3', 'Hindi1', 'Tamil1', 'Foreign1', 'Ghost'),
    catalog: [movie('K1', 'kn'), movie('K2', 'kn'), movie('K3', 'kn'), movie('Hindi1', 'hi'), movie('Tamil1', 'ta'), movie('Foreign1', 'kn', ['US'])] });
  const r = await s({ language: 'kn', favourites: ['Parasite', 'Radiohead'], ip: '1' });
  assert.equal(r.status, 'ok');
  assert.equal(r.label, AI_LABEL);
  assert.deepEqual(r.films.map((f) => f.title), ['K1', 'K2', 'K3']);
});

test('HG-12: fewer than 3 verified -> "Not enough films yet for <language>. Try Hindi meanwhile."', async () => {
  const { s } = svc({ films: F('M1', 'M2', 'H1'), catalog: [movie('M1', 'mr'), movie('M2', 'mr'), movie('H1', 'hi')] });
  const r = await s({ language: 'mr', favourites: ['Sanju'], ip: '1' });
  assert.equal(r.status, 'thin');
  assert.equal(r.message, 'Not enough films yet for Marathi. Try Hindi meanwhile.');
  assert.deepEqual(aiView(r, { name: 'Marathi' }), { kind: 'note', text: 'Not enough films yet for Marathi. Try Hindi meanwhile.' });
});

test('HG-12: the reveal is labelled "Suggested by AI, not taste-matched" and never uses Qloo wording', async () => {
  const v = aiView({ status: 'ok', films: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }, { name: 'Kannada' });
  assert.equal(v.label, 'Suggested by AI, not taste-matched');
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync('public/aisuggest-client.js', 'utf8'), /qloo|people in|grew up/i);
});

test('HG-12: budget cap -> capped, no Claude call; the ledger is shared with alt names', async () => {
  const budget = createClaudeBudget({ usdPerDay: 0.25 });
  budget.add(0.25 - MAX_SUGGEST_USD / 2); // e.g. alt names already spent nearly all of today's $0.25
  const { s, calls } = svc({ films: F('K1'), catalog: [], budget });
  const r = await s({ language: 'kn', favourites: ['x'], ip: '1' });
  assert.equal(r.status, 'capped');
  assert.equal(calls.claude, 0);
  assert.deepEqual(aiView(r, { name: 'Kannada' }).kind, 'note');
});

test('HG-12: per-IP cap, cache by language + sorted favourites, unsupported languages refused', async () => {
  const { s, calls } = svc({ films: F('K1', 'K2', 'K3'), catalog: [movie('K1', 'kn'), movie('K2', 'kn'), movie('K3', 'kn')], caps: { perIpPerDay: 1, maxIps: 10, maxTitles: 8 } });
  await s({ language: 'kn', favourites: ['B', 'A'], ip: '9' });
  const again = await s({ language: 'kn', favourites: ['a', 'b'], ip: '9' });
  assert.equal(again.status, 'ok'); assert.equal(calls.claude, 1, 'cache hit, no second call');
  assert.equal(aiKey('kn', ['B', 'A']), aiKey('kn', ['a', 'b']));
  assert.equal((await s({ language: 'kn', favourites: ['C'], ip: '9' })).status, 'capped');
  assert.equal((await s({ language: 'bho', favourites: ['C'], ip: '8' })).status, 'unsupported');
});

test('HG-12: only coming-soon languages get AI suggestions; not-supported ones stay off', () => {
  const g = loadGate();
  assert.deepEqual(g.comingSoon.map((l) => l.language).sort(), ['as', 'gu', 'kn', 'ks', 'mr', 'ne', 'or']);
  assert.ok(g.notSupported.every((l) => !g.comingSoon.some((c) => c.language === l.language)));
});

test('HG-12: parseFilms tolerates fences, dedupes and drops bad years', () => {
  assert.deepEqual(parseFilms('```json\n{"films":[{"title":"Kantara","year":2022},{"title":"kantara","year":2022},{"title":"X","year":"soon"}]}\n```'), [{ title: 'Kantara', year: 2022 }, { title: 'X', year: undefined }]);
  assert.deepEqual(parseFilms('nope'), []);
});
