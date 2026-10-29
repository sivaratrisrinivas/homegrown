import { requireEnv } from './cities.js';
import { createThrottle, realSleep } from './throttle.js';

// Qloo throttles ~5 calls / 20 s, so calls go one at a time ~7 s apart with 429 backoff.
export const QLOO_BASE = 'https://hackathon.api.qloo.com';
export const QLOO_GAP_MS = 7000;

export function createQloo({ fetch = globalThis.fetch, env = process.env, sleep = realSleep, gapMs = QLOO_GAP_MS, maxRetries = 3, base = QLOO_BASE } = {}) {
  const throttle = createThrottle({ minGapMs: gapMs, sleep });

  async function call(path, params) {
    const key = requireEnv('QLOO_API_KEY', env);
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await throttle(() => fetch(url, { headers: { 'X-Api-Key': key, accept: 'application/json' } }));
      if (res.status === 429 && attempt < maxRetries) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : gapMs * 2 ** (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const e = new Error(`Qloo ${path} failed: HTTP ${res.status}`);
        e.status = res.status === 429 ? 429 : 502;
        throw e;
      }
      return res.json();
    }
  }

  return {
    async search(query, types) {
      const data = await call('/search', { query, types, take: 5 });
      return (data.results || []).map(normaliseEntity);
    },
    async insights({ type, signalIds, extra = {}, take = 10 }) {
      const data = await call('/v2/insights', {
        'filter.type': type,
        'signal.interests.entities': signalIds.join(','),
        take,
        ...extra,
      });
      return (data.results?.entities || []).map(normaliseEntity);
    },
  };
}

export function normaliseEntity(e) {
  const p = e.properties || {};
  return {
    id: e.entity_id || e.id,
    name: e.name,
    type: e.types?.[0] || e.subtype || e.type,
    year: p.release_year || (p.release_date ? Number(String(p.release_date).slice(0, 4)) : undefined),
    tags: (e.tags || []).map((t) => ({ id: t.tag_id || t.id, name: t.name })).filter((t) => t.name),
    image: p.image?.url,
    address: p.address,
    countryCode: e.location?.country_code || p.geocode?.country_code,
    neighborhood: p.neighborhood || p.geocode?.city_district,
    affinity: e.query?.affinity,
    popularity: e.popularity,
    raw: undefined,
  };
}

export const QLOO_TYPES = {
  show: 'urn:entity:tv_show', band: 'urn:entity:artist', place: 'urn:entity:place',
  book: 'urn:entity:book', any: 'urn:entity:tv_show,urn:entity:artist,urn:entity:movie,urn:entity:book,urn:entity:place',
};
