// In-memory TTL cache. Results are cached per (favourites set, city) for 7 days (brief §9).
export const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
export function createCache({ ttlMs = SEVEN_DAYS, now = () => Date.now(), max = 500 } = {}) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (e.exp < now()) { m.delete(k); return undefined; }
      return e.v;
    },
    set(k, v, ttl = ttlMs) {
      if (m.size >= max) m.delete(m.keys().next().value);
      m.set(k, { v, exp: now() + ttl });
    },
  };
}
import { createHash } from 'node:crypto';
// Key covers ids AND the client-supplied tags, so tampered tags can't poison other users' cached results.
export function twinKey(favs, city, category) {
  const canon = [...favs].map((f) => [f.id, (f.tags || []).map((t) => `${t.id}|${t.name}`).sort()]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return [city, category, createHash('sha256').update(JSON.stringify(canon)).digest('hex')].join('|');
}
