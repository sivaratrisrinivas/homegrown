// HG-14 measuring run for the AI-suggest path ('coming soon' Indian languages): one Claude call per
// language (seeds as favourites), every title through verifySuggestedFilm (country IN), then the same
// verified share under the old primary-origin rule for comparison. Logs counts only: no keys, no URLs.
//   ANTHROPIC_API_KEY=… TMDB_API_KEY=… node scripts/measure-aisuggest.mjs
import { createAnthropic } from '../lib/anthropic.js';
import { createTmdb, verifySuggestedFilm } from '../lib/tmdb.js';
import { loadGate } from '../lib/gate.js';

const favourites = ['Breaking Bad', 'Radiohead', 'Parasite'];
const claude = createAnthropic(); const tmdb = createTmdb();
const primaryOrigin = (d) => d?.origin_country?.[0] || d?.production_countries?.[0]?.iso_3166_1 || null;
const out = {};
for (const lang of loadGate().comingSoon || []) {
  const { films } = await claude.suggestFilms({ languageName: lang.name, favourites });
  const list = films.slice(0, 8); let ok = 0, oldOk = 0; const reasons = {};
  for (const f of list) {
    const v = await verifySuggestedFilm(tmdb, f, { language: lang.language, country: 'IN' }).catch(() => ({ ok: false, reason: 'verify_error' }));
    if (v.ok) { ok++; const d = await tmdb.movieDetails(v.tmdb.id); if (primaryOrigin(d) === 'IN') oldOk++; } else reasons[v.reason] = (reasons[v.reason] || 0) + 1;
  }
  out[lang.language] = { name: lang.name, city: lang.city, asked: list.length, verified: ok, verifiedOldRule: oldOk, reasons };
  console.log(JSON.stringify({ language: lang.language, ...out[lang.language] }));
}
