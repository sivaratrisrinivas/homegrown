import { getCity, UserError } from './cities.js';
import { QLOO_TYPES } from './qloo.js';
import { verifyShow, verifyMovie, showDifficulty, pickWatchLink } from './tmdb.js';
import { verifyArtist } from './musicbrainz.js';
import { whyLine } from './why.js';
import { twinKey } from './cache.js';

// One failing candidate check must not sink the category; missing keys still surface.
async function safe(fn, log) {
  try { return await fn(); } catch (e) {
    if (e.code === 'missing_key') throw e;
    log({ event: 'verify_error', status: e.status });
    return { ok: false, reason: 'verify_error' };
  }
}

// Version 1 (captain scope): music, TV and movies only, strict native rule.
export const CATEGORIES = ['tv', 'movie', 'music'];
const WANT = { tv: 2, movie: 1, music: 1 };

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

function honest(category, city, got, want) {
  if (got >= want) return null;
  const lang = { es: 'Spanish', ko: 'Korean', fr: 'French' }[city.language];
  const what = { tv: 'shows', movie: 'films', music: 'bands' }[category];
  return got === 0
    ? `No ${lang} ${what} from ${city.name} passed our origin check for your taste, so we're not showing a fake.`
    : `Few ${lang} ${what} from ${city.name} match you; here's what passed our origin check.`;
}

// A serverless function has 60 s. The deadline is fixed at request entry: verification loops stop
// at +45 s and Qloo stops retrying near +50 s, so the whole request fits.
// Native rate over candidates actually checked (deadline-skipped ones weren't checked).
// Only counts, category and city id: no titles, no user text, no secrets.
// Why-lines are rebuilt from the requester's own favourites on every response, cache hit or not.
export function personalise(result, favs) {
  return { ...result, picks: result.picks.map(({ tags, ...p }) => ({ ...p, why: whyLine(favs, { tags }) })) };
}

export function nativeRate(picks, rejected) {
  const seen = picks.length + rejected.filter((r) => r.reason !== 'deadline').length;
  return { seen, accepted: picks.length, pct: seen ? Math.round((100 * picks.length) / seen) : null };
}

export const CATEGORY_BUDGET_MS = 45000;
export const REQUEST_BUDGET_MS = 50000;
export const SHORT_TTL_MS = 10 * 60 * 1000;
export const MAX_MUSIC_CHECKS = 6;
// Incomplete runs (errors or deadline) are cached briefly, not for 7 days.
const INCOMPLETE = new Set(['verify_error', 'deadline']);

export function createTwinService({ qloo, tmdb, mb, itunes, cache, log = () => {}, now = () => Date.now(), budgetMs = CATEGORY_BUDGET_MS, requestBudgetMs = REQUEST_BUDGET_MS }) {
  const signals = (favs) => favs.map((f) => f.id);

  // Shows and movies share one path: Qloo by release country, then a strict TMDB check per candidate.
  function screen({ category, type, verify, providers }) {
    return async (favs, city, ctx) => {
      const cands = await qloo.insights({
        type, signalIds: signals(favs), take: 10, deadline: ctx.qlooDeadline,
        extra: { 'signal.location.query': city.name, 'filter.release_country': city.releaseCountry },
      });
      const picks = []; const rejected = [];
      for (const c of cands) {
        if (picks.length >= WANT[category]) break;
        if (now() > ctx.deadline) { rejected.push({ name: c.name, reason: 'deadline' }); continue; }
        const v = await safe(() => verify(tmdb, c, city), log);
        if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
        let watch = null;
        try { watch = pickWatchLink(await providers(v.tmdb.id), ctx.userCountry); } catch { /* optional */ }
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
      type: QLOO_TYPES.band, signalIds: signals(favs), take: 10, deadline: ctx.qlooDeadline,
      extra: { 'signal.location.query': city.name, 'filter.tags': `urn:tag:genre:music:${city.musicTag}` },
    });
    const picks = []; const rejected = [];
    let checks = 0;
    for (const c of cands) {
      if (picks.length >= WANT.music) break;
      if (now() > ctx.deadline || checks >= MAX_MUSIC_CHECKS) { rejected.push({ name: c.name, reason: 'deadline' }); continue; }
      checks++;
      const v = await safe(() => verifyArtist(mb, c, city), log);
      if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
      const preview = await itunes.previewForArtist(c.name, city.itunesCountry).catch(() => null);
      picks.push({
        category: 'music', qlooId: c.id, title: c.name, image: c.image, tags: c.tags || [],
        difficulty: 'medium', madeIn: city.country, preview, verification: { source: 'musicbrainz', mbid: v.mbid },
      });
    }
    return { picks, rejected };
  }

  const handlers = {
    tv: screen({ category: 'tv', type: QLOO_TYPES.show, verify: verifyShow, providers: (id) => tmdb.watchProviders(id) }),
    movie: screen({ category: 'movie', type: QLOO_TYPES.movie, verify: verifyMovie, providers: (id) => tmdb.movieWatchProviders(id) }),
    music,
  };

  return {
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
        log({ event: 'native_rate', category, city: city.id, ...nativeRate(hit.picks, hit.rejected || []), cached: true });
        return { ...personalise(hit, favs), cached: true };
      }
      const ctx = { userCountry: uc, deadline: start + budgetMs, qlooDeadline: start + requestBudgetMs };
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
      const result = { category, city: city.id, picks, note: honest(category, city, picks.length, WANT[category]), rejected };
      const incomplete = rejected.some((r) => INCOMPLETE.has(r.reason));
      cache?.set(key, result, incomplete ? SHORT_TTL_MS : undefined);
      return personalise(result, favs);
    },
  };
}
