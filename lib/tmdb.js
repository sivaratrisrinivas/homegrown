import { requireEnv } from './cities.js';
import { timedFetch } from './fetch.js';

export const TMDB_BASE = 'https://api.themoviedb.org/3';

// Supports both v3 api_key and v4 read-access tokens (JWT-ish, long) via env TMDB_API_KEY.
export function createTmdb({ fetch = globalThis.fetch, env = process.env, base = TMDB_BASE, timeoutMs = 8000, now = () => Date.now() } = {}) {
  // deadline (ms epoch, optional): skip a call that can't finish, else shorten its timeout to fit.
  async function get(path, params = {}, deadline) {
    let t = timeoutMs;
    if (deadline) {
      t = Math.min(timeoutMs, deadline - now());
      if (t <= 0) { const e = new Error('TMDB skipped: deadline reached'); e.status = 504; e.reason = 'deadline'; throw e; }
    }
    const key = requireEnv('TMDB_API_KEY', env);
    const url = new URL(base + path);
    const headers = { accept: 'application/json' };
    if (key.length > 40) headers.authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await timedFetch(fetch, url, { headers }, { timeoutMs: t, label: 'TMDB' });
    if (!res.ok) { const e = new Error(`TMDB failed: HTTP ${res.status}`); e.status = 502; throw e; }
    return res.json();
  }
  return {
    searchTv: (query, year, deadline) => get('/search/tv', { query, first_air_date_year: year }, deadline).then((d) => d.results || []),
    tvDetails: (id, deadline) => get(`/tv/${id}`, {}, deadline),
    watchProviders: (id, deadline) => get(`/tv/${id}/watch/providers`, {}, deadline).then((d) => d.results || {}),
    searchMovie: (query, year, deadline) => get('/search/movie', { query, primary_release_year: year }, deadline).then((d) => d.results || []),
    movieDetails: (id, deadline) => get(`/movie/${id}`, {}, deadline),
    movieWatchProviders: (id, deadline) => get(`/movie/${id}/watch/providers`, {}, deadline).then((d) => d.results || {}),
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Verify a Qloo show is native: match title (+ year), require original_language and origin_country.
export async function verifyShow(tmdb, show, city, { deadline } = {}) {
  const target = norm(show.name);
  const exact = (rs) => rs.find((r) => norm(r.name) === target || norm(r.original_name) === target);
  // Never fall back to an arbitrary first result: a wrong match could pass a non-native show.
  let match = exact(await tmdb.searchTv(show.name, show.year, deadline));
  if (!match && show.year) match = exact(await tmdb.searchTv(show.name, undefined, deadline));
  if (!match) return { ok: false, reason: 'no_tmdb_match' };
  // Language first (HG-9): a wrong-language title is 'off_language' and drops out of the measured pool.
  if (match.original_language !== city.language) return { ok: false, reason: 'off_language', tmdbId: match.id, language: match.original_language, origin: match.origin_country };
  if (!(match.origin_country || []).includes(city.country)) return { ok: false, reason: 'not_native', tmdbId: match.id, language: match.original_language, origin: match.origin_country };
  return { ok: true, tmdb: match };
}

// Verify a Qloo movie: exact title (+ year when known), original_language = city language, and the
// city's country in production_countries or origin_country (from /movie/{id}). No first-result fallback.
export async function verifyMovie(tmdb, movie, city, { deadline } = {}) {
  const target = norm(movie.name);
  const exact = (rs) => rs.find((r) => norm(r.title) === target || norm(r.original_title) === target);
  let match = exact(await tmdb.searchMovie(movie.name, movie.year, deadline));
  if (!match && movie.year) match = exact(await tmdb.searchMovie(movie.name, undefined, deadline));
  if (!match) return { ok: false, reason: 'no_tmdb_match' };
  if (match.original_language !== city.language) return { ok: false, reason: 'off_language', tmdbId: match.id, language: match.original_language };
  const d = await tmdb.movieDetails(match.id, deadline);
  const countries = [...(d.origin_country || []), ...(d.production_countries || []).map((c) => c.iso_3166_1)];
  if (!countries.includes(city.country)) return { ok: false, reason: 'not_native', tmdbId: match.id, language: match.original_language, origin: countries };
  return { ok: true, tmdb: { ...match, genre_ids: match.genre_ids || (d.genres || []).map((g) => g.id) }, countries };
}

// Difficulty heuristic (brief §11): kids/animation easy, period/legal/crime-drama hard, else medium.
const EASY_GENRES = new Set([16, 10762, 35, 10764]); // Animation, Kids, Comedy, Reality
const HARD_GENRES = new Set([10768, 36, 80, 9648, 99]); // War&Politics, History, Crime, Mystery, Documentary
export function showDifficulty(genreIds = []) {
  if (genreIds.some((g) => EASY_GENRES.has(g))) return 'easy';
  if (genreIds.some((g) => HARD_GENRES.has(g))) return 'hard';
  return 'medium';
}

export function pickWatchLink(providers, userCountry) {
  const r = providers[userCountry] || providers.US;
  if (!r) return null;
  const flat = r.flatrate?.[0] || r.free?.[0] || r.ads?.[0] || r.rent?.[0];
  const fallback = !providers[userCountry];
  // A fallback link is for another country's catalogue, so it carries a label like "US link".
  return { url: r.link, provider: flat?.provider_name || null, country: fallback ? 'US' : userCountry, fallback, label: fallback ? 'US link' : null, attribution: 'JustWatch via TMDB' };
}
