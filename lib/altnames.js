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
// Request budget for the Qloo re-resolve (like twin's qlooDeadline); 429s are not retried here.
export const ALT_DEADLINE_MS = 45000;
export const ALT_QLOO_RETRIES = 0; // no 429 retry: one request holds at most 2 throttle slots (~14 s)
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createAltNames({ qloo, claude, log = () => {}, now = () => Date.now(), caps = ALT_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 2000, now }), namesCache = createCache({ ttlMs: 7 * DAY, max: 2000, now }), deadlineMs = ALT_DEADLINE_MS } = {}) {
  let day = '', spent = 0, qlooUsed = 0, perIp = new Map();
  const inflight = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; spent = 0; qlooUsed = 0; perIp = new Map(); } };

  async function run({ q, kind, types, ip }, key) {
    roll();
    const deadline = now() + deadlineMs;
    // Claude's names are cached on their own: a retry after a Qloo failure redoes only the Qloo step.
    let names = namesCache.get(key);
    if (!names) {
      const used = perIp.get(ip) || 0;
      if (used >= caps.perIpPerDay) return { results: [], capped: 'ip' };
      if (spent + MAX_CALL_USD > caps.globalUsdPerDay) return { results: [], capped: 'global' };
      if (qlooUsed >= caps.qlooPerDay) return { results: [], capped: 'qloo' };
      perIp.set(ip, used + 1);
      // Reserve the worst case before awaiting so concurrent calls can't overshoot the cap together.
      spent += MAX_CALL_USD;
      try {
        const r = await claude.altNames(q, kind);
        // Settle to the actual cost only when usage is reported; otherwise keep the full reservation.
        if (Number.isFinite(r.usage?.input_tokens)) spent += costOf(r.usage) - MAX_CALL_USD;
        names = r.names.filter((n) => norm(n) && norm(n) !== norm(q)).slice(0, caps.maxNames);
        namesCache.set(key, names);
      } catch (e) {
        // Not sent (e.g. missing key): release the spend and refund the IP's call. Sent then failed: keep the full reservation (it may have billed).
        if (e?.code === 'missing_key' || e?.notSent) { spent -= MAX_CALL_USD; perIp.set(ip, (perIp.get(ip) || 1) - 1); }
        log({ event: 'altnames_error', stage: 'claude', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
        return { results: [] }; // fail closed; not cached so a transient error can be retried
      }
    } else if (qlooUsed >= caps.qlooPerDay) return { results: [], capped: 'qloo' };
    let results = [], complete = true;
    // Every real HTTP attempt (including a 429 retry) counts against the daily Qloo budget.
    const beforeAttempt = () => {
      if (qlooUsed >= caps.qlooPerDay) { const e = new Error('altnames Qloo budget reached'); e.notSent = true; e.status = 429; throw e; }
      qlooUsed++;
    };
    try {
      for (const n of names) {
        if (qlooUsed >= caps.qlooPerDay || now() >= deadline) { complete = false; break; }
        const found = (await qloo.search(n, types, { deadline, maxRetries: ALT_QLOO_RETRIES, beforeAttempt })).find((e) => norm(e.name) === norm(n));
        if (found) { results = [found]; break; } // one genuine match is enough: saves 7 s Qloo slots
      }
    } catch (e) {
      // Deadline / budget stops (notSent or 504) and Qloo errors: incomplete, never cached.
      log({ event: 'altnames_error', stage: 'qloo', status: e?.upstreamStatus ?? e?.status ?? null, notSent: !!e?.notSent });
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
