import { getCity, UserError } from './cities.js';
import { QLOO_TYPES } from './qloo.js';
import { verifyShow, showDifficulty, pickWatchLink } from './tmdb.js';
import { verifyArtist } from './musicbrainz.js';
import { podcastDifficulty } from './itunes.js';
import { verifyPlace } from './places.js';
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

// Captain rule (strict): a podcast passes only if its feed <language> carries the city's region,
// e.g. es-MX / ko-KR / fr-FR (case-insensitive, '-' or '_'). Language-only tags are rejected.
export function podcastOrigin(lang, city) {
  if (!lang) return { ok: false, reason: 'no_language_tag' };
  const [l, region] = String(lang).trim().toLowerCase().split(/[-_]/);
  if (l !== city.language) return { ok: false, reason: 'not_native' };
  if (!region) return { ok: false, reason: 'no_region_subtag' };
  if (region !== city.country.toLowerCase()) return { ok: false, reason: 'wrong_region' };
  return { ok: true };
}

export const CATEGORIES = ['tv', 'music', 'podcast', 'place'];
const WANT = { tv: 2, music: 1, podcast: 1, place: 1 };

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
  const what = { tv: 'shows', music: 'bands', podcast: 'podcasts', place: 'places' }[category];
  return got === 0
    ? `No ${lang} ${what} from ${city.name} passed our origin check for your taste, so we're not showing a fake.`
    : `Few ${lang} ${what} from ${city.name} match you; here's what passed our origin check.`;
}

// A serverless function has 60 s; each category stops verifying after ~45 s and returns what passed.
export const CATEGORY_BUDGET_MS = 45000;
export const SHORT_TTL_MS = 10 * 60 * 1000;
export const MAX_MUSIC_CHECKS = 6;
const FEED_CONCURRENCY = 4;
// Incomplete runs (errors or deadline) are cached briefly, not for 7 days.
const INCOMPLETE = new Set(['verify_error', 'deadline']);

export function createTwinService({ qloo, tmdb, mb, itunes, cache, log = () => {}, now = () => Date.now(), budgetMs = CATEGORY_BUDGET_MS }) {
  async function tv(favs, city, ctx) {
    const cands = await qloo.insights({
      type: QLOO_TYPES.show, signalIds: favs.map((f) => f.id), take: 10,
      extra: { 'signal.location.query': city.name, 'filter.release_country': city.releaseCountry },
    });
    const picks = []; const rejected = [];
    for (const c of cands) {
      if (picks.length >= WANT.tv) break;
      const v = await safe(() => verifyShow(tmdb, c, city), log);
      if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
      let watch = null;
      try { watch = pickWatchLink(await tmdb.watchProviders(v.tmdb.id), ctx.userCountry); } catch { /* optional */ }
      picks.push({
        category: 'tv', qlooId: c.id, title: v.tmdb.original_name || c.name, englishTitle: v.tmdb.name,
        year: c.year, image: v.tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${v.tmdb.poster_path}` : c.image,
        why: whyLine(favs, c), difficulty: showDifficulty(v.tmdb.genre_ids), madeIn: city.country,
        watch, tip: city.subtitleTip, verification: { source: 'tmdb', tmdbId: v.tmdb.id, language: v.tmdb.original_language, origin: v.tmdb.origin_country },
      });
    }
    return { picks, rejected };
  }

  async function music(favs, city, ctx) {
    const cands = await qloo.insights({
      type: QLOO_TYPES.band, signalIds: favs.map((f) => f.id), take: 10,
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
        category: 'music', qlooId: c.id, title: c.name, image: c.image, why: whyLine(favs, c),
        difficulty: 'medium', madeIn: city.country, preview, verification: { source: 'musicbrainz', mbid: v.mbid },
      });
    }
    return { picks, rejected };
  }

  async function podcast(favs, city, ctx) {
    const tagTerms = [...new Set(favs.flatMap((f) => f.tags.map((t) => t.name.toLowerCase())))];
    const terms = [...tagTerms.slice(0, 2), city.podcastFallbackTerm];
    const seen = new Set(); const pool = [];
    for (const term of terms) {
      if (now() > ctx.deadline) break;
      let found = [];
      try { found = await itunes.searchPodcasts(term, city.itunesCountry); } catch (e) { log({ event: 'podcast_search_error', status: e.status }); }
      for (const r of found) {
        if (!r.feedUrl || seen.has(r.collectionId)) continue;
        seen.add(r.collectionId); pool.push({ ...r, matchedTerm: tagTerms.includes(term) ? term : null });
      }
      if (pool.length >= 20) break;
    }
    // Rank by overlap between favourites' Qloo tags and the podcast's genres/term (deterministic).
    const score = (r) => (r.matchedTerm ? 2 : 0) + (r.genres || []).filter((g) => tagTerms.includes(g.toLowerCase())).length;
    pool.sort((a, b) => score(b) - score(a));
    const picks = []; const rejected = [];
    // Feeds are checked in bounded parallel batches, in rank order, until a pick passes or time runs out.
    const ranked = pool.slice(0, 8);
    const langs = new Map();
    for (let i = 0; i < ranked.length && picks.length < WANT.podcast; i += FEED_CONCURRENCY) {
      const batch = ranked.slice(i, i + FEED_CONCURRENCY);
      if (now() > ctx.deadline) { batch.forEach((r) => rejected.push({ name: r.collectionName, reason: 'deadline' })); continue; }
      const got = await Promise.all(batch.map((r) => itunes.feedLanguage(r.feedUrl).catch(() => null)));
      batch.forEach((r, k) => langs.set(r, got[k]));
      for (const r of batch) {
      if (picks.length >= WANT.podcast) break;
      const lang = langs.get(r);
      const origin = podcastOrigin(lang, city);
      if (!origin.ok) { rejected.push({ name: r.collectionName, reason: origin.reason, language: lang || null }); continue; }
      const fav = r.matchedTerm && favs.find((f) => f.tags.some((t) => t.name.toLowerCase() === r.matchedTerm));
      picks.push({
        category: 'podcast', title: r.collectionName, author: r.artistName, image: r.artworkUrl600 || r.artworkUrl100,
        why: fav ? { text: `Because you liked ${fav.name}: both are ${r.matchedTerm}.`, tag: r.matchedTerm, favourite: fav.name, grounded: true }
          : { text: `Popular in ${city.name}'s Apple Podcasts store.`, grounded: false },
        difficulty: podcastDifficulty(r.genres), madeIn: city.country, listen: r.collectionViewUrl,
        verification: { source: 'itunes_feed_language', language: lang },
      });
      }
    }
    return { picks, rejected };
  }

  async function place(favs, city) {
    const cands = await qloo.insights({
      type: QLOO_TYPES.place, signalIds: favs.map((f) => f.id), take: 10,
      extra: { 'filter.location.query': city.name, 'filter.tags': 'urn:tag:category:place:restaurant' },
    });
    const picks = []; const rejected = [];
    for (const c of cands) {
      if (picks.length >= WANT.place) break;
      const v = verifyPlace(c, city);
      if (!v.ok) { rejected.push({ name: c.name, reason: v.reason }); continue; }
      picks.push({
        category: 'place', qlooId: c.id, title: c.name, image: c.image, neighborhood: c.neighborhood || null,
        address: c.address || null, why: whyLine(favs, c), madeIn: city.country, verification: { source: 'qloo_address' },
      });
    }
    return { picks, rejected };
  }

  const handlers = { tv, music, podcast, place };

  return {
    async category({ favourites, cityId, category, userCountry = 'US' }) {
      const city = getCity(cityId);
      if (!handlers[category]) throw new UserError(`Unknown category: ${category}`);
      const favs = parseFavourites(favourites);
      const uc = /^[A-Za-z]{2}$/.test(String(userCountry)) ? String(userCountry).toUpperCase() : 'US';
      // Watch links depend on the user's country, so it is part of the TV cache key.
      const key = twinKey(favs, city.id, category === 'tv' ? `tv:${uc}` : category);
      const hit = cache?.get(key);
      if (hit) return { ...hit, cached: true };
      const { picks, rejected } = await handlers[category](favs, city, { userCountry: uc, deadline: now() + budgetMs });
      log({ event: 'category', category, city: city.id, kept: picks.length, rejected: rejected.length });
      const result = { category, city: city.id, picks, note: honest(category, city, picks.length, WANT[category]), rejected };
      const incomplete = rejected.some((r) => INCOMPLETE.has(r.reason));
      cache?.set(key, result, incomplete ? SHORT_TTL_MS : undefined);
      return result;
    },
  };
}
