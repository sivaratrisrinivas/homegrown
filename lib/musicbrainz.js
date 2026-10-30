import { createThrottle, realSleep } from './throttle.js';
import { timedFetch } from './fetch.js';

export const MB_BASE = 'https://musicbrainz.org/ws/2';
export const MB_USER_AGENT = 'Homegrown/0.1.0 ( https://github.com/sivaratrisrinivas/homegrown )';

// MusicBrainz: at most 1 request per second, with a descriptive User-Agent.
export function createMusicBrainz({ fetch = globalThis.fetch, sleep = realSleep, gapMs = 1100, base = MB_BASE, retries = 3, retryMs = 2000, timeoutMs = 8000, budgetMs = 20000, now = () => Date.now() } = {}) {
  const throttle = createThrottle({ minGapMs: gapMs, sleep, now });
  return {
    async searchArtist(name, callerDeadline) {
      const url = new URL(base + '/artist');
      url.searchParams.set('query', `artist:"${name.replace(/"/g, '')}"`);
      url.searchParams.set('fmt', 'json');
      url.searchParams.set('limit', '5');
      let res;
      // MusicBrainz answers 503 when its global rate limit trips; back off and retry (still serialised).
      // Total time per lookup is bounded by budgetMs so a category fits a 60 s function.
      // Capped at min(budgetMs, caller deadline - now).
      const deadline = Math.min(now() + budgetMs, callerDeadline ?? Infinity);
      if (deadline - now() <= 0) { const e = new Error('MusicBrainz skipped: deadline reached'); e.status = 504; e.reason = 'deadline'; throw e; }
      for (let attempt = 0; ; attempt++) {
        res = await throttle(() => timedFetch(fetch, url, { headers: { 'User-Agent': MB_USER_AGENT, accept: 'application/json' } }, { timeoutMs: Math.max(1, Math.min(timeoutMs, deadline - now())), label: 'MusicBrainz' }));
        const wait = retryMs * 2 ** attempt;
        if (res.status !== 503 || attempt >= retries || now() + wait + timeoutMs > deadline) break;
        await sleep(wait);
      }
      if (!res.ok) { const e = new Error(`MusicBrainz failed: HTTP ${res.status}`); e.status = 502; throw e; }
      return (await res.json()).artists || [];
    },
  };
}

export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();

export async function verifyArtist(mb, artist, city, { deadline } = {}) {
  const results = await mb.searchArtist(artist.name, deadline);
  const exact = results.filter((a) => norm(a.name) === norm(artist.name) && (a.score ?? 100) >= 90);
  if (!exact.length) return { ok: false, reason: 'no_musicbrainz_match' };
  // Strict rule: exact-name matches that disagree on country are ambiguous, so reject rather than guess.
  // A country-less match next to others could be a different act, so that is ambiguous too.
  const countryOf = (a) => a.country || a.area?.['iso-3166-1-codes']?.[0];
  const countries = new Set(exact.map(countryOf).filter(Boolean));
  if (countries.size > 1 || (exact.length > 1 && exact.some((a) => !countryOf(a)))) return { ok: false, reason: 'ambiguous_artist', country: null };
  const match = exact.find((a) => (a.country || a.area?.['iso-3166-1-codes']?.[0]) === city.country) || exact[0];
  const areas = [match.country, match.area?.['iso-3166-1-codes']?.[0], match['begin-area']?.['iso-3166-1-codes']?.[0]].filter(Boolean);
  const areaNames = [match.area?.name, match['begin-area']?.name].filter(Boolean).map(norm);
  const ok = areas.includes(city.country) || areaNames.some((n) => city.countryNames.includes(n) || n === norm(city.name) || n === norm(city.localName));
  return ok ? { ok: true, mbid: match.id } : { ok: false, reason: 'not_native', country: match.country || null };
}

// HG-9: music needs a language or scene signal, not country alone. The signal is the candidate's own
// Qloo genre tags (urn:tag:genre:*). A tag matches a stem if its last segment equals the stem or
// starts with "<stem>_". The city's musicLanguageTags must match and none of its musicConflictTags
// (other languages of the same country) may match.
const tagSlug = (t) => String(t?.id || '').startsWith('urn:tag:genre:') ? String(t.id).split(':').pop().toLowerCase() : null;
const hits = (slugs, stems = []) => stems.filter((st) => slugs.some((s) => s === st || s.startsWith(st + '_')));
export function musicLanguageSignal(artist, city) {
  const slugs = (artist.tags || []).map(tagSlug).filter(Boolean);
  const own = hits(slugs, city.musicLanguageTags || []);
  const other = hits(slugs, city.musicConflictTags || []);
  if (!own.length) return { ok: false, reason: 'off_language' };
  if (other.length) return { ok: false, reason: 'off_language', conflict: other };
  return { ok: true, signal: own };
}
