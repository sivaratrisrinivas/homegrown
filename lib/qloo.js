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
  // opts.maxRetries overrides the 429 retry count; opts.beforeAttempt() runs right before each real HTTP
  // attempt (it may throw an err with notSent to stop, e.g. a caller's own budget).
  async function call(path, params, deadline, opts = {}) {
    const retries = opts.maxRetries ?? maxRetries;
    const key = requireEnv('QLOO_API_KEY', env);
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    const late = () => { const e = new Error(`Qloo ${path} skipped: request deadline reached`); e.status = 504; e.reason = 'deadline'; return e; };
    for (let attempt = 0; ; attempt++) {
      if (deadline && now() >= deadline) throw late();
      // Re-check inside the throttle: waiting for the 7 s slot can eat the remaining budget.
      const res = await throttle(() => {
        if (deadline && now() + timeoutMs > deadline) { const e = late(); e.notSent = true; throw e; }
        opts.beforeAttempt?.();
        return timedFetch(fetch, url, { headers: { 'x-api-key': key, accept: 'application/json' } }, { timeoutMs, label: `Qloo ${path}` });
      });
      if (res.status === 429 && attempt < retries) {
        const ra = Number(res.headers?.get?.('retry-after'));
        const wait = Math.min(QLOO_MAX_BACKOFF_MS, Number.isFinite(ra) && ra > 0 ? ra * 1000 : gapMs * 2 ** (attempt + 1));
        if (deadline && now() + wait + timeoutMs > deadline) { const e = new Error(`Qloo ${path} rate limited`); e.status = 429; throw e; }
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const e = new Error(`Qloo ${path} failed: HTTP ${res.status}`);
        e.status = res.status === 429 ? 429 : 502;
        e.upstreamStatus = res.status; e.source = 'qloo';
        throw e;
      }
      return res.json();
    }
  }

  return {
    async search(query, types, { deadline, maxRetries: mr, beforeAttempt } = {}) {
      const data = await call('/search', { query, types, take: 5 }, deadline, { maxRetries: mr, beforeAttempt });
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

// Measuring run: retry only a real Qloo timeout (504 from the network or upstream), never our own deadline.
export const retryable = (e) => (e?.status === 504 || e?.upstreamStatus === 504) && e?.reason !== 'deadline';
