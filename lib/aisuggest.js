import { createCache } from './cache.js';
import { costOf, SUGGEST_MAX_TOKENS } from './anthropic.js';
import { verifySuggestedFilm } from './tmdb.js';
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
export const ERROR_MESSAGE = 'AI suggestions are unavailable right now. Try again soon.';
export const CAPPED_MESSAGE = 'AI suggestions are resting for today. Try Hindi meanwhile.';
export const AI_NOTE = 'Each title is checked against TMDB for language and country.';
export const THIN_TTL_MS = 3600 * 1000;
export const VERIFY_DEADLINE_MS = 10000;
export const normLang = (l) => String(l || '').trim().toLowerCase();
export const aiKey = (language, favourites) => `${normLang(language)}|${[...new Set(favourites.map(norm).filter(Boolean))].sort().join('|')}`;

export function createAiSuggest({ claude, tmdb, budget, languages, log = () => {}, now = () => Date.now(), caps = AI_CAPS, cache = createCache({ ttlMs: 7 * DAY, max: 2000, now }), verifyDeadlineMs = VERIFY_DEADLINE_MS }) {
  let day = '', perIp = new Map();
  const roll = () => { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; perIp = new Map(); } };
  const inflight = new Map();

  async function run({ lang, favourites, ip }, key) {
    roll();
    const language = lang.language;
    const capped = { status: 'capped', message: CAPPED_MESSAGE };
    if (!perIp.has(ip) && perIp.size >= caps.maxIps) return capped;
    const used = perIp.get(ip) || 0;
    if (used >= caps.perIpPerDay) return capped;
    if (!budget.canSpend(MAX_SUGGEST_USD)) return capped;
    perIp.set(ip, used + 1);
    const refundIp = () => perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
    budget.add(MAX_SUGGEST_USD); // reserve the worst case before awaiting
    let films;
    try {
      const r = await claude.suggestFilms({ languageName: lang.name, favourites });
      if (Number.isFinite(r.usage?.input_tokens)) budget.add(costOf(r.usage) - MAX_SUGGEST_USD);
      films = r.films.slice(0, caps.maxTitles);
    } catch (e) {
      if (e?.code === 'missing_key' || e?.notSent) { budget.add(-MAX_SUGGEST_USD); refundIp(); }
      log({ event: 'aisuggest_error', stage: 'claude', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return { status: 'error', message: ERROR_MESSAGE };
    }
    // TMDB checks run in parallel under one deadline; a timeout counts as an error, not a rejection.
    const deadline = now() + verifyDeadlineMs;
    const timeout = new Promise((ok) => { const t = setTimeout(() => ok('timeout'), verifyDeadlineMs); t.unref?.(); });
    const checks = await Promise.all(films.map((f) => Promise.race([
      verifySuggestedFilm(tmdb, f, { language, country: 'IN' }, { deadline }).catch(() => ({ ok: false, reason: 'verify_error' })),
      timeout.then(() => ({ ok: false, reason: 'verify_error' })),
    ])));
    const verified = []; const dropped = {}; let errors = 0;
    checks.forEach((v, i) => {
      if (!v.ok) { if (v.reason === 'verify_error') errors++; dropped[v.reason] = (dropped[v.reason] || 0) + 1; return; }
      const t = v.tmdb; const f = films[i];
      const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); // shown when spelled differently
      verified.push({ title: t.original_title || t.title, englishTitle: t.title !== t.original_title ? t.title : undefined,
        suggestedTitle: same(f.title, t.title) || same(f.title, t.original_title) ? undefined : f.title,
        year: v.year, image: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null, tmdbId: t.id });
    });
    log({ event: 'aisuggest', language, asked: films.length, verified: verified.length, dropped, spentUsd: Number(budget.spent().toFixed(5)) });
    if (errors) refundIp(); // our side failed: the user's daily count isn't spent on it
    if (verified.length >= AI_MIN_FILMS) {
      const out = { status: 'ok', label: AI_LABEL, note: AI_NOTE, language, name: lang.name, films: verified };
      if (!errors) cache.set(key, out);
      return out;
    }
    if (errors) return { status: 'error', message: ERROR_MESSAGE }; // not cached: retry soon
    const thin = { status: 'thin', language, name: lang.name, films: [], message: thinMessage(lang.name) };
    cache.set(key, thin, THIN_TTL_MS);
    return thin;
  }

  return function suggest(req) {
    const favourites = (req.favourites || []).filter((f) => typeof f === 'string').map((f) => f.trim().slice(0, 100)).filter(Boolean).slice(0, 5);
    // Validate the language before the cache: only 'coming soon' languages are served.
    const lang = languages().find((l) => l.language === normLang(req.language));
    if (!lang) return Promise.resolve({ status: 'unsupported' });
    const key = aiKey(lang.language, favourites);
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    if (!inflight.has(key)) inflight.set(key, run({ lang, favourites, ip: req.ip }, key).finally(() => inflight.delete(key)));
    return inflight.get(key);
  };
}
