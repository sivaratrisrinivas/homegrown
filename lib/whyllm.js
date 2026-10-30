import { createHash } from 'node:crypto';
import { createCache } from './cache.js';
import { costOf, WHY_MAX_TOKENS } from './anthropic.js';
import { sharedTags } from './why.js';

// HG-7: Claude-written why-lines and difficulty signals for one reveal, in ONE batched call.
// Grounding: Claude sees only the favourite name, the shared Qloo tags and the TMDB overview, and
// every line it returns is validated here. Anything that fails keeps the heuristic line (lib/why.js).
export const WHY_CAPS = { perIpPerDay: 20, maxIps: 10000, maxPicks: 6 };
export const WHY_WAIT_MS = 3000; // the reveal waits at most this long; a late answer still fills the cache
export const WHY_CALL_TIMEOUT_MS = 8000;
// Worst case per batch: ~400 input tokens per pick, padded, plus the full output cap.
export const MAX_WHY_USD = costOf({ input_tokens: 3000, output_tokens: WHY_MAX_TOKENS });
const DAY = 24 * 3600 * 1000;
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const clean = (s) => String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => String(s || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
// Sentence openers allowed even though they are not in the source data.
const OPENERS = new Set('like if fans for just as with both much the a an this it its here where while another same expect more anyone those viewers lovers'.split(' '));

// One sentence, 8-28 words (40-220 chars), names the favourite, and every proper-noun-looking
// word, number or non-Latin word appears in the input data. Returns the line or null.
export function validateWhy(text, { favourite, sources }) {
  let t = clean(text).replace(/^["'“”]+|["'“”]+$/g, '');
  if (t.length < 40 || t.length > 220) return null;
  if (!/[.]$/.test(t)) t += '.';
  if (/[!?;]|\.\s+\S/.test(t.slice(0, -1))) return null; // one sentence only
  const n = t.split(/\s+/).length;
  if (n < 8 || n > 28) return null;
  if (!t.toLowerCase().includes(String(favourite).toLowerCase())) return null;
  const allowed = new Set(sources.flatMap(words));
  const tokens = t.match(/[\p{L}\p{M}\p{N}'’-]+/gu) || [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/['’]s$/u, '').replace(/^['’-]+|['’-]+$/gu, '');
    if (!tok) continue;
    const parts = words(tok);
    const known = parts.length && parts.every((w) => allowed.has(w));
    const named = /^\p{Lu}/u.test(tok) || /\p{N}/u.test(tok) || /[^\p{Script=Latin}\p{N}'’-]/u.test(tok);
    if (!named || known) continue;
    if (i === 0 && OPENERS.has(tok.toLowerCase())) continue;
    return null;
  }
  return t;
}

export function parseBatch(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { const v = JSON.parse(m[0]).picks; return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []; } catch { return []; }
}

// The favourite that shares the most tags with the pick, and those tags.
export function bestFavourite(favs, pick) {
  const shared = sharedTags(favs, pick);
  const by = new Map();
  for (const s of shared) by.set(s.favourite, [...(by.get(s.favourite) || []), clean(s.tag)]);
  let best = null;
  for (const f of favs) if (by.get(f.name)?.length > (best ? by.get(best.name).length : 0)) best = f;
  return best ? { favourite: best, tags: [...new Set(by.get(best.name))].slice(0, 8) } : null;
}

export function createWhyWriter({ claude, budget, log = () => {}, now = () => Date.now(), caps = WHY_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 3000, now }), waitMs = WHY_WAIT_MS } = {}) {
  let day = '', perIp = new Map();
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; perIp = new Map(); } };

  async function call(batch, ip) {
    roll();
    if (!perIp.has(ip) && perIp.size >= caps.maxIps) return 'ips';
    const used = perIp.get(ip) || 0;
    if (used >= caps.perIpPerDay) return 'ip';
    if (!budget.reserve(MAX_WHY_USD)) return 'global';
    perIp.set(ip, used + 1);
    let r;
    try {
      r = await claude.whyBatch({ picks: batch.map((b) => b.input) }, { timeoutMs: WHY_CALL_TIMEOUT_MS });
    } catch (e) {
      if (e?.code === 'missing_key' || e?.notSent) { budget.adjust(-MAX_WHY_USD); perIp.set(ip, used); }
      log({ event: 'why_llm_error', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return 'error';
    }
    if (Number.isFinite(r.usage?.input_tokens)) budget.adjust(costOf(r.usage) - MAX_WHY_USD);
    const out = new Map(parseBatch(r.text).map((x) => [String(x.id), x]));
    let ok = 0;
    for (const b of batch) {
      const x = out.get(b.input.id) || {};
      const why = validateWhy(x.why, b.ground);
      if (why) ok++;
      // Rejected lines are cached as null so the same pick doesn't spend again; signals kept if valid.
      cache.set(b.key, { why, favourite: b.ground.favourite, pace: ['slow', 'steady', 'fast'].includes(x.pace) ? x.pace : null, dialogue: ['light', 'moderate', 'heavy'].includes(x.dialogue) ? x.dialogue : null });
    }
    log({ event: 'why_llm', picks: batch.length, valid: ok, spentUsd: Number(budget.spent().toFixed(5)) });
    return 'ok';
  }

  // picks: [{ qlooId, title, englishTitle, tags, src: { overview, genreIds, runtime } }].
  // -> array (same order) of { why, pace, dialogue } or null. Never throws, never waits > waitMs.
  return async function enrich(picks, favs, { ip = 'unknown' } = {}) {
    const slots = picks.map((p) => {
      const overview = clean(p.src?.overview).slice(0, 700);
      const bf = overview ? bestFavourite(favs, p) : null;
      if (!bf) return null;
      const titles = [p.title, p.englishTitle].filter(Boolean);
      const key = createHash('sha256').update(JSON.stringify([p.qlooId, bf.favourite.id, bf.favourite.name, bf.tags, overview])).digest('hex');
      return {
        key,
        input: { id: '', favourite: bf.favourite.name, shared_tags: bf.tags, pick_title: titles[0], overview, genres: p.src?.genreNames || [] },
        ground: { favourite: bf.favourite.name, sources: [bf.favourite.name, ...titles, ...bf.tags, overview, ...(p.src?.genreNames || [])] },
      };
    });
    const missing = slots.filter((s) => s && cache.get(s.key) === undefined).slice(0, caps.maxPicks);
    missing.forEach((s, i) => { s.input = { ...s.input, id: `p${i}` }; });
    if (missing.length) {
      const p = call(missing, ip).catch(() => 'error');
      let timer;
      const res = await Promise.race([p, new Promise((r) => { timer = setTimeout(() => r('timeout'), waitMs); })]);
      clearTimeout(timer);
      if (res === 'timeout') log({ event: 'why_llm_slow' }); // the call keeps going and fills the cache
    }
    return slots.map((s) => (s ? cache.get(s.key) ?? null : null));
  };
}
