// The single Claude spend ledger (HG-7). Every Claude feature reserves from it before calling, so
// together they stay under $0.25 per UTC day, and each feature has its own share so one can't starve
// the others. reserve() checks and books in one synchronous step (atomic within the instance).
// In-memory per serverless instance: resets on cold start, not shared across instances.
export const CLAUDE_USD_PER_DAY = 0.25;
export const FEATURE_SHARES = { why: 0.10, altnames: 0.08, aisuggest: 0.07 };
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

export function createClaudeBudget({ usdPerDay = CLAUDE_USD_PER_DAY, shares = FEATURE_SHARES, now = () => Date.now() } = {}) {
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  if (total > usdPerDay + 1e-9) throw new Error('Claude feature shares exceed the daily total');
  let day = '', spent = 0, byFeature = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; spent = 0; byFeature = new Map(); } };
  return {
    usdPerDay, shares,
    // true and booked, or false (nothing booked). Unknown features get no share.
    reserve(usd, { feature } = {}) {
      roll();
      const cap = shares[feature] ?? 0; const f = byFeature.get(feature) || 0;
      if (!(usd >= 0) || spent + usd > usdPerDay + 1e-12 || f + usd > cap + 1e-12) return false;
      spent += usd; byFeature.set(feature, f + usd);
      return true;
    },
    // Settle a reservation: (actual - reserved), or -reserved to release an unsent call.
    adjust(delta, { feature } = {}) {
      roll();
      spent = Math.max(0, spent + delta);
      byFeature.set(feature, Math.max(0, (byFeature.get(feature) || 0) + delta));
    },
    spent(feature) { roll(); return feature ? byFeature.get(feature) || 0 : spent; },
  };
}

// Per-IP daily call limiter shared by the Claude features. check() -> null | 'ip' | 'ips'.
export function createIpLimiter({ perIpPerDay, maxIps = 10000, now = () => Date.now() }) {
  let day = '', m = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; m = new Map(); } };
  return {
    check(ip) {
      roll();
      if (!m.has(ip) && m.size >= maxIps) return 'ips';
      return (m.get(ip) || 0) >= perIpPerDay ? 'ip' : null;
    },
    take(ip) { roll(); m.set(ip, (m.get(ip) || 0) + 1); },
    refund(ip) { roll(); if (m.has(ip)) m.set(ip, Math.max(0, m.get(ip) - 1)); },
  };
}
