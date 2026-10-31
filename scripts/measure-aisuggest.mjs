// HG-14 measuring run for the AI-suggest path ('coming soon' Indian languages). Claude output varies
// between runs, so each language gets RUNS Claude calls (seeds as favourites). Every suggested title is run
// independently through verifySuggestedFilm twice, before any filtering:
//   new rule  = origin_country includes IN (production_countries only when origin_country is empty)
//   main rule = IN in origin_country OR production_countries (the rule on main before HG-14)
// Writes the aiSuggest block of config/hg14-origin-includes-measure.json. Logs counts only: no keys, no URLs.
//   ANTHROPIC_API_KEY=… TMDB_API_KEY=… node scripts/measure-aisuggest.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createAnthropic } from '../lib/anthropic.js';
import { createTmdb, verifySuggestedFilm } from '../lib/tmdb.js';
import { loadGate } from '../lib/gate.js';

const RUNS = 3, MAX_TITLES = 8;
const favourites = ['Breaking Bad', 'Radiohead', 'Parasite'];
const claude = createAnthropic(); const tmdb = createTmdb();
// main's rule expressed through the same verifier: merge production countries into origin_country.
const mainTmdb = { ...tmdb, movieDetails: async (...a) => { const d = await tmdb.movieDetails(...a); return { ...d, origin_country: [...(d.origin_country || []), ...(d.production_countries || []).map((c) => c.iso_3166_1)] }; } };
const check = (t, f, language) => verifySuggestedFilm(t, f, { language, country: 'IN' }).catch(() => ({ ok: false, reason: 'verify_error' }));
const mean = (xs) => Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100;
const languages = {};
for (const lang of loadGate().comingSoon || []) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const films = (await claude.suggestFilms({ languageName: lang.name, favourites })).films.slice(0, MAX_TITLES);
    const r = { asked: films.length, newRule: 0, mainRule: 0, droppedByNewOnly: 0, reasonsNew: {} };
    for (const f of films) {
      const [n, m] = [await check(tmdb, f, lang.language), await check(mainTmdb, f, lang.language)];
      if (n.ok) r.newRule++; else r.reasonsNew[n.reason] = (r.reasonsNew[n.reason] || 0) + 1;
      if (m.ok) r.mainRule++;
      if (m.ok && !n.ok) r.droppedByNewOnly++;
    }
    runs.push(r);
    console.log(JSON.stringify({ language: lang.language, run: i + 1, ...r }));
  }
  languages[lang.language] = { name: lang.name, city: lang.city, runs,
    mean: { asked: mean(runs.map((r) => r.asked)), newRule: mean(runs.map((r) => r.newRule)), mainRule: mean(runs.map((r) => r.mainRule)), droppedByNewOnly: mean(runs.map((r) => r.droppedByNewOnly)) } };
}
const file = new URL('../config/hg14-origin-includes-measure.json', import.meta.url);
const rec = JSON.parse(readFileSync(file, 'utf8'));
rec.aiSuggest = {
  measuredAt: new Date().toISOString(),
  method: `node scripts/measure-aisuggest.mjs: ${RUNS} Claude suggestFilms runs per coming-soon language (seeds ${favourites.join(', ')}), up to ${MAX_TITLES} titles per run; every title checked independently by verifySuggestedFilm (country IN) under the new rule and under main's rule (IN in origin_country or production_countries)`,
  note: 'Claude output varies between runs (different titles each call), so per-run counts differ; compare the means.',
  languages,
};
delete rec.aiSuggestMethod;
writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
