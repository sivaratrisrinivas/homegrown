import { createCache } from './cache.js';
import { costOf, CLAUDE_MAX_TOKENS } from './anthropic.js';

// Claude fallback for favourites Qloo can't find by the typed name (HG-8).
// Hard caps. All state is in-memory, per serverless instance: it resets on cold starts and isn't
// shared across instances, so the global cap is set well under the $0.50/UTC-day budget.
//  - perIpPerDay: Claude calls per client IP per UTC day.
//  - globalUsdPerDay: estimated Claude spend per UTC day (reserved before each call).
//  - maxNames: alternate names re-resolved with Qloo per request.
//  - qlooPerDay: Qloo searches this feature may spend per UTC day, so it can't starve /api/search and /api/twin.
export const ALT_CAPS = { perIpPerDay: 10, globalUsdPerDay: 0.25, maxNames: 2, qlooPerDay: 40 };
// Worst-case cost of one call (prompt ~100 tokens, padded to 500; output capped at max_tokens).
export const MAX_CALL_USD = costOf({ input_tokens: 500, output_tokens: CLAUDE_MAX_TOKENS });
const DAY = 24 * 3600 * 1000;
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createAltNames({ qloo, claude, log = () => {}, now = () => Date.now(), caps = ALT_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 2000, now }) } = {}) {
  let day = '', spent = 0, qlooUsed = 0, perIp = new Map();
  const inflight = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; spent = 0; qlooUsed = 0; perIp = new Map(); } };

  async function run({ q, kind, types, ip }, key) {
    roll();
    const used = perIp.get(ip) || 0;
    if (used >= caps.perIpPerDay) return { results: [], capped: 'ip' };
    if (spent + MAX_CALL_USD > caps.globalUsdPerDay) return { results: [], capped: 'global' };
    if (qlooUsed >= caps.qlooPerDay) return { results: [], capped: 'qloo' };
    perIp.set(ip, used + 1);
    // Reserve the worst case before awaiting so concurrent calls can't overshoot the cap together.
    spent += MAX_CALL_USD;
    let names;
    try {
      const r = await claude.altNames(q, kind);
      spent += costOf(r.usage) - MAX_CALL_USD; // settle to the actual cost
      names = r.names.filter((n) => norm(n) && norm(n) !== norm(q)).slice(0, caps.maxNames);
    } catch (e) {
      // Not sent (e.g. missing key): release. Sent then failed: keep the full reservation (it may have billed).
      if (e?.code === 'missing_key' || e?.notSent) spent -= MAX_CALL_USD;
      log({ event: 'altnames_error', stage: 'claude', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return { results: [] }; // fail closed; not cached so a transient error can be retried
    }
    let results = [], complete = true;
    try {
      for (const n of names) {
        if (qlooUsed >= caps.qlooPerDay) { complete = false; break; }
        qlooUsed++;
        const found = (await qloo.search(n, types)).find((e) => norm(e.name) === norm(n));
        if (found) { results = [found]; break; } // one genuine match is enough: saves 7 s Qloo slots
      }
    } catch (e) {
      log({ event: 'altnames_error', stage: 'qloo', status: e?.upstreamStatus ?? e?.status ?? null });
      return { results: [] };
    }
    if (results.length || complete) cache.set(key, results); // negative results cached too (only when fully checked)
    log({ event: 'altnames', tried: names.length, matched: results.length, spentUsd: Number(spent.toFixed(5)), qlooUsed });
    return { results };
  }

  // -> { results: [entity] } with only genuine Qloo matches (name equals an alt name), or [] ('no match').
  return function resolve(req) {
    const nq = norm(req.q);
    if (!nq) return Promise.resolve({ results: [] });
    const key = `${req.kind}|${nq}`;
    const hit = cache.get(key);
    if (hit) return Promise.resolve({ results: hit, cached: true });
    // Identical concurrent requests share one Claude call (and one IP charge).
    if (inflight.has(key)) return inflight.get(key);
    const p = run(req, key).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
