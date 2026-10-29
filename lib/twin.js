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

export function createTwinService({ qloo, tmdb, mb, itunes, cache, log = () => {} }) {
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

  async function music(favs, city) {
    const cands = await qloo.insights({
      type: QLOO_TYPES.band, signalIds: favs.map((f) => f.id), take: 10,
      extra: { 'signal.location.query': city.name, 'filter.tags': `urn:tag:genre:music:${city.musicTag}` },
    });
    const picks = []; const rejected = [];
    for (const c of cands) {
      if (picks.length >= WANT.music) break;
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

  async function podcast(favs, city) {
    const tagTerms = [...new Set(favs.flatMap((f) => f.tags.map((t) => t.name.toLowerCase())))];
    const terms = [...tagTerms.slice(0, 2), city.podcastFallbackTerm];
    const seen = new Set(); const pool = [];
    for (const term of terms) {
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
    for (const r of pool.slice(0, 8)) {
      if (picks.length >= WANT.podcast) break;
      const lang = await itunes.feedLanguage(r.feedUrl).catch(() => null);
      if (!lang || lang.split(/[-_]/)[0] !== city.language) { rejected.push({ name: r.collectionName, reason: lang ? 'not_native' : 'no_language_tag' }); continue; }
      const fav = r.matchedTerm && favs.find((f) => f.tags.some((t) => t.name.toLowerCase() === r.matchedTerm));
      picks.push({
        category: 'podcast', title: r.collectionName, author: r.artistName, image: r.artworkUrl600 || r.artworkUrl100,
        why: fav ? { text: `Because you liked ${fav.name}: both are ${r.matchedTerm}.`, tag: r.matchedTerm, favourite: fav.name, grounded: true }
          : { text: `Popular in ${city.name}'s Apple Podcasts store.`, grounded: false },
        difficulty: podcastDifficulty(r.genres), madeIn: city.country, listen: r.collectionViewUrl,
        verification: { source: 'itunes_feed_language', language: lang },
      });
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
      const key = twinKey(favs.map((f) => f.id), city.id, category === 'tv' ? `tv:${uc}` : category);
      const hit = cache?.get(key);
      if (hit) return { ...hit, cached: true };
      const { picks, rejected } = await handlers[category](favs, city, { userCountry: uc });
      log({ event: 'category', category, city: city.id, kept: picks.length, rejected: rejected.length });
      const result = { category, city: city.id, picks, note: honest(category, city, picks.length, WANT[category]), rejected };
      cache?.set(key, result);
      return result;
    },
  };
}
