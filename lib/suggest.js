import { timedFetch } from './fetch.js';
import { createTmdb } from './tmdb.js';

// Fast typeahead from free/cheap catalogues (TMDB, iTunes, Open Library), so typing never waits on
// Qloo's ~7 s rate limit. Qloo is asked once, only when a favourite is chosen (see /api/search).
export const ITUNES_SEARCH = 'https://itunes.apple.com/search';
export const OPENLIBRARY_SEARCH = 'https://openlibrary.org/search.json';
const year = (d) => (d ? Number(String(d).slice(0, 4)) || undefined : undefined);

export const SUGGEST_KINDS = ['show', 'movie', 'band', 'book', 'any'];
export const normaliseKind = (k) => (SUGGEST_KINDS.includes(String(k)) ? String(k) : 'any');

export function createSuggest({ fetch = globalThis.fetch, tmdb = createTmdb({ fetch, timeoutMs: 4000 }), timeoutMs = 4000 } = {}) {
  const json = async (url, label) => {
    const res = await timedFetch(fetch, url, {}, { timeoutMs, label });
    if (!res.ok) { const e = new Error(`${label} failed: HTTP ${res.status}`); e.status = 502; throw e; }
    return res.json();
  };
  const sources = {
    show: async (q) => (await tmdb.searchTv(q)).slice(0, 5).map((r) => ({ name: r.name, year: year(r.first_air_date), kind: 'show' })),
    movie: async (q) => (await tmdb.searchMovie(q)).slice(0, 5).map((r) => ({ name: r.title, year: year(r.release_date), kind: 'movie' })),
    band: async (q) => {
      const u = new URL(ITUNES_SEARCH);
      for (const [k, v] of Object.entries({ term: q, media: 'music', entity: 'musicArtist', limit: '5' })) u.searchParams.set(k, v);
      return ((await json(u, 'iTunes')).results || []).map((r) => ({ name: r.artistName, kind: 'band' }));
    },
    book: async (q) => {
      const u = new URL(OPENLIBRARY_SEARCH);
      for (const [k, v] of Object.entries({ q, limit: '5', fields: 'title,first_publish_year' })) u.searchParams.set(k, v);
      return ((await json(u, 'Open Library')).docs || []).map((r) => ({ name: r.title, year: r.first_publish_year, kind: 'book' }));
    },
  };
  return {
    // Returns { results, partial }; partial = some source failed, so the caller mustn't cache it long.
    // Independent sources run in parallel; one failing source doesn't sink the rest.
    async suggest(q, kind) {
      const kinds = kind === 'any' ? ['show', 'movie', 'band', 'book'] : Object.hasOwn(sources, kind) ? [kind] : [];
      const settled = await Promise.allSettled(kinds.map((k) => sources[k](q)));
      const ok = settled.filter((s) => s.status === 'fulfilled');
      if (!ok.length && settled.length) throw settled[0].reason;
      const lists = ok.map((s) => s.value);
      const out = []; const seen = new Set();
      // Interleave so 'any' shows a mix, and drop duplicates.
      for (let i = 0; out.length < 6 && lists.some((l) => l[i]); i++) {
        for (const l of lists) {
          const r = l[i]; if (!r?.name) continue;
          const k = `${r.kind}|${r.name.toLowerCase()}|${r.year || ''}`;
          if (!seen.has(k)) { seen.add(k); out.push(r); }
        }
      }
      return { results: out.slice(0, 6), partial: ok.length < settled.length };
    },
  };
}
