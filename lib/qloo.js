import { requireEnv } from './cities.js';
import { createThrottle, realSleep } from './throttle.js';
import { timedFetch } from './fetch.js';

// Qloo throttles ~5 calls / 20 s, so calls go one at a time ~7 s apart with 429 backoff.
export const QLOO_BASE = 'https://hackathon.api.qloo.com';
export const QLOO_GAP_MS = 7000;
export const QLOO_MAX_BACKOFF_MS = 30000;

export function createQloo({ fetch = globalThis.fetch, env = process.env, sleep = realSleep, gapMs = QLOO_GAP_MS, maxRetries = 3, base = QLOO_BASE, timeoutMs = 10000, now = () => Date.now() } = {}) {
  const throttle = createThrottle({ minGapMs: gapMs, sleep, now });

  // deadline (ms epoch, optional): stop before starting or retrying a call that can't finish in time.
  async function call(path, params, deadline) {
    const key = requireEnv('QLOO_API_KEY', env);
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    const late = () => { const e = new Error(`Qloo ${path} skipped: request deadline reached`); e.status = 504; return e; };
    for (let attempt = 0; ; attempt++) {
      if (deadline && now() >= deadline) throw late();
      const res = await throttle(() => timedFetch(fetch, url, { headers: { 'X-Api-Key': key, accept: 'application/json' } }, { timeoutMs, label: `Qloo ${path}` }));
      if (res.status === 429 && attempt < maxRetries) {
        const ra = Number(res.headers?.get?.('retry-after'));
        const wait = Math.min(QLOO_MAX_BACKOFF_MS, Number.isFinite(ra) && ra > 0 ? ra * 1000 : gapMs * 2 ** (attempt + 1));
        if (deadline && now() + wait + timeoutMs > deadline) { const e = new Error(`Qloo ${path} rate limited`); e.status = 429; throw e; }
        await sleep(wait);
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
    async insights({ type, signalIds, extra = {}, take = 10, deadline }) {
      const data = await call('/v2/insights', {
        'filter.type': type,
        'signal.interests.entities': signalIds.join(','),
        take,
        ...extra,
      }, deadline);
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
    affinity: e.query?.affinity,
    popularity: e.popularity,
    raw: undefined,
  };
}

export const QLOO_TYPES = {
  show: 'urn:entity:tv_show', movie: 'urn:entity:movie', band: 'urn:entity:artist',
  book: 'urn:entity:book', any: 'urn:entity:tv_show,urn:entity:artist,urn:entity:movie,urn:entity:book',
};
