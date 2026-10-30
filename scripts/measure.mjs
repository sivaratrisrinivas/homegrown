// Measuring run for the city gate (captain): checks EVERY Qloo candidate (top 15) per city and
// category through the app's own code path (throttled Qloo ~7 s apart, TMDB, MusicBrainz with retry),
// then writes config/gate.json. Logs counts only: no keys, no URLs, no user text.
//   QLOO_API_KEY=… TMDB_API_KEY=… npm run measure
import { writeFileSync } from 'node:fs';
import { getDeps } from '../lib/deps.js';
import { QLOO_TYPES, retryable, bestSeedMatch } from '../lib/qloo.js';
import { CITIES } from '../lib/cities.js';
import { CATEGORIES } from '../lib/twin.js';
import { loadGate, cityStatus, liveCategories } from '../lib/gate.js';

const SEEDS = [['Breaking Bad', 'show'], ['Radiohead', 'band'], ['Parasite', 'movie']];
const { qloo, twin } = getDeps();
const favourites = [];
for (const [q, kind] of SEEDS) {
  let r;
  for (let i = 0; ; i++) {
    try { r = bestSeedMatch(await qloo.search(q, QLOO_TYPES[kind]), q); break; } catch (e) { if (!retryable(e) || i >= 2) throw e; await new Promise((ok) => setTimeout(ok, 15000)); }
  }
  if (!r) throw new Error(`seed not found: ${q}`);
  favourites.push({ id: r.id, name: r.name, tags: r.tags });
}
const old = loadGate();
const results = {};
for (const cityId of Object.keys(CITIES)) {
  // Only the live categories are re-measured; earlier results for the others are kept for reference.
  results[cityId] = { ...(old.results?.[cityId] || {}) };
  for (const category of CATEGORIES.filter((c) => liveCategories(old).includes(c))) {
    // Qloo sometimes times out (504); retry the category up to 3 times, 15 s apart (measuring run only).
    let r;
    for (let i = 0; ; i++) {
      try { r = await twin.measure({ favourites, cityId, category }); break; } catch (e) {
        if (!retryable(e) || i >= 2) throw e;
        console.log(JSON.stringify({ city: cityId, category, retry: i + 1, status: e.status }));
        await new Promise((ok) => setTimeout(ok, 15000));
      }
    }
    results[cityId][category] = { seen: r.seen, accepted: r.accepted, errors: r.errors, filtered: r.filtered, languageShare: r.seen + r.filtered ? Math.round((100 * r.seen) / (r.seen + r.filtered)) / 100 : null };
    console.log(JSON.stringify({ city: cityId, category, seen: r.seen, accepted: r.accepted, pct: r.pct, errors: r.errors, filtered: r.filtered, languageShare: results[cityId][category].languageShare, reasons: r.rejected.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {}) }));
  }
}
const gate = { ...old, measuredAt: new Date().toISOString(), source: `npm run measure (HG-9 language-aware): Qloo pool of 50 filtered by language (TMDB original_language for tv/movie, Qloo genre tags for music), then top 15 per category, every candidate checked, MusicBrainz errors retried (1.1 s backoff) and excluded from the denominator; seeds ${SEEDS.map((s) => s[0]).join(', ')}`, results };
writeFileSync(new URL('../config/gate.json', import.meta.url), JSON.stringify(gate, null, 2) + '\n');
for (const id of Object.keys(CITIES)) console.log(JSON.stringify({ city: id, live: cityStatus(gate, id).live }));
