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
    set(k, v) {
      if (m.size >= max) m.delete(m.keys().next().value);
      m.set(k, { v, exp: now() + ttlMs });
    },
  };
}
export function twinKey(favIds, city, category) {
  return [city, category, [...favIds].sort().join(',')].join('|');
}
