import { getCity, UserError, languageName } from './cities.js';
import { QLOO_TYPES } from './qloo.js';
import { verifyShow, verifyMovie, showDifficulty, pickWatchLink } from './tmdb.js';
import { verifyArtist, musicLanguageSignal } from './musicbrainz.js';
import { whyLine } from './why.js';
import { twinKey } from './cache.js';

// One failing candidate check must not sink the category; missing keys still surface.
async function safe(fn, log) {
  try { return await fn(); } catch (e) {
    if (e.code === 'missing_key') throw e;
    // A call skipped because the deadline was too close counts as 'deadline', not a check failure.
    if (e.reason === 'deadline') return { ok: false, reason: 'deadline' };
    log({ event: 'verify_error', status: e.status });
    return { ok: false, reason: 'verify_error' };
  }
}

// Version 1 (captain scope): music, TV and movies only, strict native rule.
export const CATEGORIES = ['tv', 'movie', 'music'];
// Captain: aim for 5 strict-local picks per category; fewer than 3 means local picks are scarce.
export const WANT = { tv: 5, movie: 5, music: 5 };
export const SCARCE_BELOW = 3;
export const CANDIDATES = 15; // measured top-N per category, taken after the language filter
export const POOL = 50; // Qloo candidates fetched; filtered by language before the top 15 (HG-9)
// Pool-filter reason: the candidate's language is wrong, so it never enters the top 15.
// no_tmdb_match is not a prefilter: an unmatched title counts in `seen` as a failure.
export const PREFILTER = new Set(['off_language']);

// Favourites arrive from the client as {id, name, tags}. Validate shape and count (3-5).
export function parseFavourites(input) {
  if (!Array.isArray(input) || input.length < 3 || input.length > 5) throw new UserError('Pick 3 to 5 favourites.');
  return input.map((f) => {
    if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') throw new UserError('Bad favourite.');
    return {
      id: f.id.slice(0, 100), name: f.name.slice(0, 200),
      tags: Array.isArray(f.tags) ? f.tags.slice(0, 40).filter((t) => t && t.name).map((t) => ({ id: String(t.id || ''), name: String(t.name) })) : [],
    };
  });
}

// Reasons that mean "we never got an answer", as opposed to "it failed the origin check".
const UNCHECKED = new Set(['verify_error', 'deadline', 'check_cap']);
function honest(category, city, got, want, rejected = []) {
  if (got >= want) return null;
  if (rejected.length && rejected.every((r) => PREFILTER.has(r.reason))) {
    const lang0 = languageName(city.language);
    const what0 = { tv: 'shows', movie: 'films', music: 'bands' }[category];
    return got === 0
      ? `No ${lang0} ${what0} came up for your taste: Qloo only suggested ${what0} in other languages for ${city.name}.`
      : `${lang0} ${what0} are scarce for your taste: Qloo mostly suggested ${what0} in other languages for ${city.name}.${got < SCARCE_BELOW ? ` Only ${got} passed, so they're left off your postcard.` : ''}`;
  }
  if (got === 0 && rejected.length && rejected.every((r) => UNCHECKED.has(r.reason))) {
    return "We couldn't check these right now. Please try again in a minute.";
  }
  const lang = languageName(city.language);
  const what = { tv: 'shows', movie: 'films', music: 'bands' }[category];
  return got === 0
    ? `No ${lang} ${what} from ${city.name} passed our origin check for your taste, so we're not showing a fake.`
    : got < SCARCE_BELOW
      ? `Local ${what} are scarce in ${city.name} for your taste: only ${got} passed our origin check, so they're shown here but left off your postcard.`
      : `Few ${lang} ${what} from ${city.name} match you; here's what passed our origin check.`;
}

// A serverless function has 60 s. The deadline is fixed at request entry: verification loops stop
// at +45 s and Qloo stops retrying near +50 s, so the whole request fits.
// Native rate over candidates actually checked (deadline-skipped ones weren't checked).
// Only counts, category and city id: no titles, no user text, no secrets.
// Why-lines are rebuilt from the requester's own favourites on every response, cache hit or not.
export function personalise(result, favs) {
  const used = new Set();
  return { ...result, picks: result.picks.map(({ tags, ...p }, i) => ({ ...p, why: whyLine(favs, { tags, category: p.category }, i, used) })) };
}

export function nativeRate(picks, rejected) {
  const seen = picks.length + rejected.filter((r) => r.reason !== 'deadline' && r.reason !== 'check_cap' && !PREFILTER.has(r.reason)).length;
  return { seen, accepted: picks.length, pct: seen ? Math.round((100 * picks.length) / seen) : null };
}

export const CATEGORY_BUDGET_MS = 45000;
export const REQUEST_BUDGET_MS = 50000;
export const SHORT_TTL_MS = 10 * 60 * 1000;
export const MAX_MUSIC_CHECKS = 10;
export const MAX_SCREEN_CHECKS = 25; // runtime TMDB verifications per TV/movie category (unlimited in measure)
export const MAX_EXAMPLES = 10;
// Cache only reason counts and a few example names, not the whole rejected array.
export function summariseRejected(rejected) {
  const counts = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] || 0) + 1;
  return { counts, examples: rejected.slice(0, MAX_EXAMPLES).map((r) => ({ name: r.name, reason: r.reason })) };
}
const expandCounts = (counts = {}) => Object.entries(counts).flatMap(([reason, n]) => Array.from({ length: n }, () => ({ reason })));
// Incomplete runs (errors or deadline) are cached briefly, not for 7 days.
const INCOMPLETE = new Set(['verify_error', 'deadline']);

export function createTwinService({ qloo, tmdb, mb, itunes, cache, log = () => {}, now = () => Date.now(), budgetMs = CATEGORY_BUDGET_MS, requestBudgetMs = REQUEST_BUDGET_MS }) {
  const signals = (favs) => favs.map((f) => f.id);

  // Shows and movies share one path: Qloo by release country, then a strict TMDB check per candidate.
  function screen({ category, type, verify, providers }) {
    return async (favs, city, ctx) => {
      const cands = await qloo.insights({
        type, signalIds: signals(favs), take: POOL, deadline: ctx.qlooDeadline,
        extra: { 'signal.location.query': city.name, 'filter.release_country': city.releaseCountry, ...(city.screenTag ? { 'signal.interests.tags': city.screenTag } : {}) },
      });
      const picks = []; const rejected = [];
      let inPool = 0; // candidates that passed the language filter (TMDB original_language)
      let checks = 0;
      for (const c of cands) {
        if (picks.length >= ctx.want || inPool >= CANDIDATES) break;
        if (now() >= ctx.deadline) { rejected.push({ name: c.name, reason: 'deadline' }); continue; }
        if (checks >= (ctx.maxScreenChecks ?? Infinity)) { rejected.push({ name: c.name, reason: 'check_cap' }); continue; }
        checks++;
        const v = await safe(() => verify(tmdb, c, city, { deadline: ctx.deadline }), log);
        if (!PREFILTER.has(v.reason)) inPool++;
        if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
        let watch = null;
        try { watch = pickWatchLink(await providers(v.tmdb.id, ctx.deadline), ctx.userCountry); } catch { /* optional */ }
        const t = v.tmdb;
        picks.push({
          category, qlooId: c.id, title: t.original_name || t.original_title || c.name, englishTitle: t.name || t.title,
          year: c.year, image: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : c.image,
          tags: c.tags || [], difficulty: showDifficulty(t.genre_ids), madeIn: city.country,
          watch, tip: city.subtitleTip,
          verification: { source: 'tmdb', tmdbId: t.id, language: t.original_language, origin: v.countries || t.origin_country },
        });
      }
      return { picks, rejected };
    };
  }

  async function music(favs, city, ctx) {
    const cands = await qloo.insights({
      type: QLOO_TYPES.band, signalIds: signals(favs), take: POOL, deadline: ctx.qlooDeadline,
      extra: { 'signal.location.query': city.name, ...(city.musicTag ? { 'filter.tags': `urn:tag:genre:music:${city.musicTag}` } : {}) },
    });
    const picks = []; const rejected = [];
    // Language filter before the top 15: no MusicBrainz call for an artist without the language signal.
    const pool = [];
    for (const c of cands) {
      const lang = musicLanguageSignal(c, city);
      if (lang.ok) pool.push(c); else rejected.push({ name: c.name, reason: lang.reason });
    }
    let checks = 0;
    for (const c of pool.slice(0, CANDIDATES)) {
      if (picks.length >= ctx.want) break;
      if (now() > ctx.deadline || checks >= ctx.maxChecks) { rejected.push({ name: c.name, reason: now() > ctx.deadline ? 'deadline' : 'check_cap' }); continue; }
      checks++;
      let v = await safe(() => verifyArtist(mb, c, city, { deadline: ctx.deadline }), log);
      // Measuring run only: retry MusicBrainz errors with backoff. The app itself stays strict (no retry).
      for (let i = 0; v.reason === 'verify_error' && i < (ctx.mbRetries || 0); i++) {
        await ctx.sleep(1100 * 2 ** i);
        v = await safe(() => verifyArtist(mb, c, city, { deadline: ctx.deadline }), log);
      }
      if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
      // No preview after the deadline: it is optional and must not push the response past it.
      const preview = now() < ctx.deadline ? await itunes.previewForArtist(c.name, city.itunesCountry).catch(() => null) : null;
      picks.push({
        category: 'music', qlooId: c.id, title: c.name, image: c.image, tags: c.tags || [],
        difficulty: 'medium', madeIn: city.country, preview, verification: { source: 'musicbrainz', mbid: v.mbid },
      });
    }
    return { picks, rejected };
  }

  const handlers = {
    tv: screen({ category: 'tv', type: QLOO_TYPES.show, verify: verifyShow, providers: (id, d) => tmdb.watchProviders(id, d) }),
    movie: screen({ category: 'movie', type: QLOO_TYPES.movie, verify: verifyMovie, providers: (id, d) => tmdb.movieWatchProviders(id, d) }),
    music,
  };

  return {
    // Measuring run for the city gate: every candidate is checked (no early stop, no cap, no cache)
    // so the native % is meaningful. Not exposed over HTTP.
    async measure({ favourites, cityId, category, deadlineMs = 10 * 60 * 1000, mbRetries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
      const city = getCity(cityId);
      if (!handlers[category]) throw new UserError(`Unknown category: ${category}`);
      const start = now();
      const ctx = { userCountry: 'US', deadline: start + deadlineMs, qlooDeadline: start + deadlineMs, want: Infinity, maxChecks: Infinity, mbRetries, sleep };
      const { picks, rejected } = await handlers[category](parseFavourites(favourites), city, ctx);
      // Errors that survived the retries are reported separately and kept out of the denominator.
      const errors = rejected.filter((r) => r.reason === 'verify_error').length;
      const rate = nativeRate(picks, rejected.filter((r) => r.reason !== 'verify_error'));
      log({ event: 'native_rate', category, city: city.id, ...rate, errors, measure: true });
      const filtered = rejected.filter((r) => PREFILTER.has(r.reason)).length;
      return { ...rate, errors, filtered, rejected: rejected.map((r) => r.reason) };
    },
    async category({ favourites, cityId, category, userCountry = 'US' }) {
      const start = now();
      const city = getCity(cityId);
      if (!handlers[category]) throw new UserError(`Unknown category: ${category}`);
      const favs = parseFavourites(favourites);
      const uc = /^[A-Za-z]{2}$/.test(String(userCountry)) ? String(userCountry).toUpperCase() : 'US';
      // Watch links depend on the user's country, so it is part of the screen cache keys.
      const screenCat = category === 'tv' || category === 'movie';
      const key = twinKey(favs, city.id, screenCat ? `${category}:${uc}` : category);
      const hit = cache?.get(key);
      if (hit) {
        log({ event: 'native_rate', category, city: city.id, ...nativeRate(hit.picks, expandCounts(hit.rejectedSummary?.counts)), cached: true });
        return { ...personalise(hit, favs), cached: true };
      }
      const ctx = { userCountry: uc, deadline: start + budgetMs, qlooDeadline: start + requestBudgetMs, want: WANT[category], maxChecks: MAX_MUSIC_CHECKS, maxScreenChecks: MAX_SCREEN_CHECKS };
      let out;
      try {
        out = await handlers[category](favs, city, ctx);
      } catch (e) {
        log({ event: 'native_rate', category, city: city.id, seen: 0, accepted: 0, pct: null, error: true });
        throw e;
      }
      const { picks, rejected } = out;
      log({ event: 'native_rate', category, city: city.id, ...nativeRate(picks, rejected) });
      // The cached result holds no why-text: favourite names are client-supplied and not in the key.
      // incomplete is computed once and stored, so cache hits carry the same flag.
      const incomplete = rejected.some((r) => INCOMPLETE.has(r.reason));
      const result = { category, city: city.id, picks, note: honest(category, city, picks.length, WANT[category], rejected), scarce: picks.length < SCARCE_BELOW, rejectedSummary: summariseRejected(rejected), incomplete };
      cache?.set(key, result, incomplete ? SHORT_TTL_MS : undefined);
      return { ...personalise(result, favs), rejected };
    },
  };
}
