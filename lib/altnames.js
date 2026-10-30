import { createCache } from './cache.js';
import { costOf, CLAUDE_MAX_TOKENS } from './anthropic.js';

// Claude fallback for favourites Qloo can't find by the typed name (HG-8).
// Hard caps (all state is in-memory, per serverless instance: it resets on cold starts and isn't
// shared across instances, so the global cap is set well under the $0.50/UTC-day budget):
export const ALT_CAPS = { perIpPerDay: 10, globalUsdPerDay: 0.25, maxNames: 3 };
// Worst-case cost of one call (prompt ~100 tokens, padded to 500; output capped at max_tokens):
// a call starts only if it can't push the day's estimate past the cap.
export const MAX_CALL_USD = costOf({ input_tokens: 500, output_tokens: CLAUDE_MAX_TOKENS });
const DAY = 24 * 3600 * 1000;
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createAltNames({ qloo, claude, log = () => {}, now = () => Date.now(), caps = ALT_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 2000, now }) } = {}) {
  let day = '', spent = 0, perIp = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; spent = 0; perIp = new Map(); } };

  // -> { results: [entity] } with only genuine Qloo matches (name equals an alt name), or [] ('no match').
  return async function resolve({ q, kind, types, ip }) {
    const key = `${kind}|${norm(q)}`;
    const hit = cache.get(key);
    if (hit) return { results: hit, cached: true };
    roll();
    const used = perIp.get(ip) || 0;
    if (used >= caps.perIpPerDay) return { results: [], capped: 'ip' };
    if (spent + MAX_CALL_USD > caps.globalUsdPerDay) return { results: [], capped: 'global' };
    perIp.set(ip, used + 1);
    let names;
    try {
      const r = await claude.altNames(q, kind);
      spent += costOf(r.usage);
      names = r.names.filter((n) => norm(n) && norm(n) !== norm(q)).slice(0, caps.maxNames);
    } catch (e) {
      log({ event: 'altnames_error', stage: 'claude', status: e.upstreamStatus ?? e.status ?? null, code: e.code ?? null });
      return { results: [] }; // fail closed; not cached so a transient error can be retried tomorrow-ish
    }
    let results = [];
    try {
      for (const n of names) {
        const found = (await qloo.search(n, types)).find((e) => norm(e.name) === norm(n));
        if (found) { results = [found]; break; } // one genuine match is enough: saves 7 s Qloo slots
      }
    } catch (e) {
      log({ event: 'altnames_error', stage: 'qloo', status: e.upstreamStatus ?? e.status ?? null });
      return { results: [] };
    }
    cache.set(key, results); // negative results cached too
    log({ event: 'altnames', tried: names.length, matched: results.length, spentUsd: Number(spent.toFixed(5)) });
    return { results };
  };
}
