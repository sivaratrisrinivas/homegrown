import { requireEnv } from './cities.js';

export const TMDB_BASE = 'https://api.themoviedb.org/3';

// Supports both v3 api_key and v4 read-access tokens (JWT-ish, long) via env TMDB_API_KEY.
export function createTmdb({ fetch = globalThis.fetch, env = process.env, base = TMDB_BASE } = {}) {
  async function get(path, params = {}) {
    const key = requireEnv('TMDB_API_KEY', env);
    const url = new URL(base + path);
    const headers = { accept: 'application/json' };
    if (key.length > 40) headers.authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await fetch(url, { headers });
    if (!res.ok) { const e = new Error(`TMDB ${path} failed: HTTP ${res.status}`); e.status = 502; throw e; }
    return res.json();
  }
  return {
    searchTv: (query, year) => get('/search/tv', { query, first_air_date_year: year }).then((d) => d.results || []),
    tvDetails: (id) => get(`/tv/${id}`),
    watchProviders: (id) => get(`/tv/${id}/watch/providers`).then((d) => d.results || {}),
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Verify a Qloo show is native: match title (+ year), require original_language and origin_country.
export async function verifyShow(tmdb, show, city) {
  let results = await tmdb.searchTv(show.name, show.year);
  if (!results.length && show.year) results = await tmdb.searchTv(show.name);
  const target = norm(show.name);
  const match = results.find((r) => norm(r.name) === target || norm(r.original_name) === target) || results[0];
  if (!match) return { ok: false, reason: 'no_tmdb_match' };
  const ok = match.original_language === city.language && (match.origin_country || []).includes(city.country);
  if (!ok) return { ok: false, reason: 'not_native', tmdbId: match.id, language: match.original_language, origin: match.origin_country };
  return { ok: true, tmdb: match };
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
  return { url: r.link, provider: flat?.provider_name || null, country: providers[userCountry] ? userCountry : 'US', attribution: 'JustWatch via TMDB' };
}
