import { createCache } from './cache.js';
import { costOf, SUGGEST_MAX_TOKENS } from './anthropic.js';
import { verifyMovie } from './tmdb.js';
import { norm } from './altnames.js';

// HG-12: film suggestions from Claude for 'coming soon' Indian languages (measured but too thin for Qloo).
// Every title is verified in TMDB (exists, original_language = the language, India among its countries);
// the rest are dropped. Shares the HG-8 Claude budget ($0.25/UTC day) through the same ledger.
export const AI_LABEL = 'Suggested by AI, not taste-matched';
export const AI_MIN_FILMS = 3;
export const AI_CAPS = { perIpPerDay: 5, maxIps: 10000, maxTitles: 8 };
export const MAX_SUGGEST_USD = costOf({ input_tokens: 500, output_tokens: SUGGEST_MAX_TOKENS });
const DAY = 24 * 3600 * 1000;
export const thinMessage = (name) => `Not enough films yet for ${name}. Try Hindi meanwhile.`;
export const aiKey = (language, favourites) => `${language}|${[...new Set(favourites.map(norm).filter(Boolean))].sort().join('|')}`;

export function createAiSuggest({ claude, tmdb, budget, languages, log = () => {}, now = () => Date.now(), caps = AI_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 2000, now }) }) {
  let day = '', perIp = new Map();
  const roll = () => { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; perIp = new Map(); } };
  const inflight = new Map();

  async function run({ language, favourites, ip }, key) {
    roll();
    const lang = languages().find((l) => l.language === language);
    if (!lang) return { status: 'unsupported' };
    if (!perIp.has(ip) && perIp.size >= caps.maxIps) return { status: 'capped' };
    const used = perIp.get(ip) || 0;
    if (used >= caps.perIpPerDay) return { status: 'capped' };
    if (!budget.canSpend(MAX_SUGGEST_USD)) return { status: 'capped' };
    perIp.set(ip, used + 1);
    budget.add(MAX_SUGGEST_USD); // reserve the worst case before awaiting
    let films;
    try {
      const r = await claude.suggestFilms({ languageName: lang.name, favourites });
      if (Number.isFinite(r.usage?.input_tokens)) budget.add(costOf(r.usage) - MAX_SUGGEST_USD);
      films = r.films.slice(0, caps.maxTitles);
    } catch (e) {
      if (e?.code === 'missing_key' || e?.notSent) { budget.add(-MAX_SUGGEST_USD); perIp.set(ip, (perIp.get(ip) || 1) - 1); }
      log({ event: 'aisuggest_error', stage: 'claude', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return { status: 'error' };
    }
    const verified = []; const dropped = {}; let errors = 0;
    for (const f of films) {
      let v;
      try { v = await verifyMovie(tmdb, { name: f.title, year: f.year }, { language, country: 'IN' }); } catch { v = { ok: false, reason: 'verify_error' }; errors++; }
      if (!v.ok) { dropped[v.reason] = (dropped[v.reason] || 0) + 1; continue; }
      const t = v.tmdb;
      verified.push({ title: t.original_title || t.title, englishTitle: t.title, year: f.year || Number(String(t.release_date || '').slice(0, 4)) || undefined,
        image: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null, tmdbId: t.id });
    }
    const out = verified.length >= AI_MIN_FILMS
      ? { status: 'ok', label: AI_LABEL, language, name: lang.name, films: verified }
      : { status: 'thin', language, name: lang.name, films: [], message: thinMessage(lang.name) };
    log({ event: 'aisuggest', language, asked: films.length, verified: verified.length, dropped, spentUsd: Number(budget.spent().toFixed(5)) });
    if (!errors) cache.set(key, out); // a TMDB error could hide good titles: retry next time
    return out;
  }

  return function suggest(req) {
    const favourites = (req.favourites || []).filter((f) => typeof f === 'string').map((f) => f.trim().slice(0, 100)).filter(Boolean).slice(0, 5);
    const key = aiKey(req.language, favourites);
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    if (!inflight.has(key)) inflight.set(key, run({ ...req, favourites }, key).finally(() => inflight.delete(key)));
    return inflight.get(key);
  };
}
