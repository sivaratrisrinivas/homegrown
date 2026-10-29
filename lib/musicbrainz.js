import { createThrottle, realSleep } from './throttle.js';

export const MB_BASE = 'https://musicbrainz.org/ws/2';
export const MB_USER_AGENT = 'Homegrown/0.1.0 ( https://github.com/sivaratrisrinivas/homegrown )';

// MusicBrainz: at most 1 request per second, with a descriptive User-Agent.
export function createMusicBrainz({ fetch = globalThis.fetch, sleep = realSleep, gapMs = 1100, base = MB_BASE } = {}) {
  const throttle = createThrottle({ minGapMs: gapMs, sleep });
  return {
    async searchArtist(name) {
      const url = new URL(base + '/artist');
      url.searchParams.set('query', `artist:"${name.replace(/"/g, '')}"`);
      url.searchParams.set('fmt', 'json');
      url.searchParams.set('limit', '5');
      const res = await throttle(() => fetch(url, { headers: { 'User-Agent': MB_USER_AGENT, accept: 'application/json' } }));
      if (!res.ok) { const e = new Error(`MusicBrainz failed: HTTP ${res.status}`); e.status = 502; throw e; }
      return (await res.json()).artists || [];
    },
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();

export async function verifyArtist(mb, artist, city) {
  const results = await mb.searchArtist(artist.name);
  const match = results.find((a) => norm(a.name) === norm(artist.name) && (a.score ?? 100) >= 90);
  if (!match) return { ok: false, reason: 'no_musicbrainz_match' };
  const areas = [match.country, match.area?.['iso-3166-1-codes']?.[0], match['begin-area']?.['iso-3166-1-codes']?.[0]].filter(Boolean);
  const areaNames = [match.area?.name, match['begin-area']?.name].filter(Boolean).map(norm);
  const ok = areas.includes(city.country) || areaNames.some((n) => city.countryNames.includes(n) || n === norm(city.name) || n === norm(city.localName));
  return ok ? { ok: true, mbid: match.id } : { ok: false, reason: 'not_native', country: match.country || null };
}
