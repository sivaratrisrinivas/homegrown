import { createHash } from 'node:crypto';
import { createCache } from './cache.js';
import { costOf, WHY_SYSTEM, WHY_TOKENS_PER_PICK } from './anthropic.js';
import { createIpLimiter } from './budget.js';
import { sharedTags } from './why.js';

// HG-7: Claude-written why-lines and difficulty signals for one reveal, in ONE batched call.
// Grounding: Claude sees only the favourite name, the shared Qloo tags, the pick title, genres and
// the TMDB overview, all as delimited untrusted data. Every returned line is validated here;
// anything that fails keeps the heuristic line from lib/why.js.
export const WHY_CAPS = { perIpPerDay: 20, maxIps: 10000, maxPicks: 6 };
export const WHY_WAIT_MS = 3000; // fresh movie list: the reveal waits at most this long
export const WHY_WAIT_CACHED_MS = 1500; // movie list from cache: the reveal would otherwise be instant
export const WHY_CALL_TIMEOUT_MS = 8000; // a late answer still fills the cache for the next view
const DAY = 24 * 3600 * 1000;
export const TTL = { good: 7 * DAY, rejected: DAY, skip: 10 * 60 * 1000 };
const F = { feature: 'why' };

const words = (s) => String(s || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
// Word matching against the sources (S = exact source words). A line word matches when it is in
// S, is a plural of a word in S (or S has its plural: -s, -es, -ies/-y), or, after stripping -ing,
// -ed or -ion, its stem is itself a word in S (turned -> turn). Nothing else: no partial stems, so
// mission != missing, passion != passing, station != states, singly != singing.
// -es only after s, x, z, ch, sh or o (boxes, heroes): stat+es is not "states".
const ES = /(s|x|z|ch|sh|o)$/;
const plurals = (w) => [w + 's', ...(ES.test(w) ? [w + 'es'] : []), ...(w.endsWith('y') ? [w.slice(0, -1) + 'ies'] : [])];
const singulars = (w) => [...(w.endsWith('s') ? [w.slice(0, -1)] : []), ...(w.endsWith('es') && ES.test(w.slice(0, -2)) ? [w.slice(0, -2)] : []), ...(w.endsWith('ies') ? [w.slice(0, -3) + 'y'] : [])];
export function matchesSource(w, S) {
  if (S.has(w) || singulars(w).some((x) => S.has(x)) || plurals(w).some((x) => S.has(x))) return true;
  for (const base of [w, ...singulars(w)]) {
    for (const suf of ['ing', 'ed', 'ion']) {
      if (!base.endsWith(suf)) continue;
      const st = base.slice(0, -suf.length);
      // -ing/-ed also try a dropped e (chasing -> chase) and a doubled consonant (planned -> plan).
      const cands = suf === 'ion' ? [st] : [st, st + 'e', ...(/([b-df-hj-np-tv-z])\1$/.test(st) ? [st.slice(0, -1)] : [])];
      if (cands.some((c) => c.length >= 3 && (S.has(c) || plurals(c).some((x) => S.has(x))))) return true;
    }
  }
  return false;
}
export const MIN_GROUNDED_WORDS = 2;
// Words a natural sentence needs that carry no facts. Content words must come from the sources.
// Negations, than/if and contraction tails are rejected earlier, so they are not listed here.
export const STOP = new Set(`a an the and or but so yet of in on at to for from by with into onto about as then this that these those it its
he his him she her they them their you your who whom whose which what when where while how why is are was were
be been being has have had do does did will would can could should may might like just also too very more most
much many same similar another other both each such only even still all any some own up out over through after
before against between during under again here there fans fan viewers anyone lovers love loved loves enjoy
enjoyed liked appreciate drawn find follows follow story stories film movie feel echoes share shares sharing
tale kind way because get gets getting become becomes finds take takes tries try around along together within
toward towards across someone something`.split(/\s+/));
const NUMBER_WORDS = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|millions|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|once|twice|dozen|dozens|single|double|triple)$/;
const URLISH = /(https?:|www\.|[\p{L}\p{N}-]+\.[\p{L}]{2,}|@)/iu;

// Names and tags go to Claude only as plain words: 60 chars, letters/digits/space/basic punctuation.
export const safeText = (s, n) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N} '’&:,.!?-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
const esc = (s) => String(s || '').replace(/[<>]/g, ' ');
const favRe = (fav) => new RegExp(`(?<![\\p{L}\\p{N}])${fav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');

// Valid line: one sentence, 8-28 words, contains the favourite exactly (case-sensitive, whole
// words), no URL/domain, no digits or number words, and every other word is a stopword or appears
// (exact, plural, or -ing/-ed/-ion of a source word) in the sources; at least 2 distinct such words, not counting title words: overview, tags, genres (title words allowed). The favourite is NOT a source.
// 's and n't are grammar; words under 3 letters (a, of, tv) are never grounding.
const sourceWords = (list) => (list || []).flatMap((x) => words(String(x || '').replace(/['’]s(?![\p{L}\p{N}])/gu, '').replace(/n['’]t(?![\p{L}\p{N}])/gu, ''))).filter((w) => w.length >= 3);
// A line that negates ("not a crime drama", "no revenge") can invert grounded facts: reject it.
// Comparisons and conditionals ("better than", "if you like") make claims words can't ground.
const HEDGE = /(?<![\p{L}\p{N}])(than|if)(?![\p{L}\p{N}])/iu;
const NEGATION = /(?<![\p{L}\p{N}])(not|no|nor|without|never|cannot|nobody|nothing|none|neither)(?![\p{L}\p{N}])|n['’]t(?![\p{L}\p{N}])/iu;
// titles: allowed words that do NOT count toward the grounded minimum (naming the pick isn't a reason).
export function validateWhy(text, { favourite, sources, titles = [] }) {
  favourite = String(favourite || '').replace(/’/g, "'");
  let t = String(text || '').replace(/’/g, "'").replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (!favourite || t.length < 40 || t.length > 220) return null;
  if (!/\.$/.test(t)) t += '.';
  const body = t.slice(0, -1);
  const n = t.split(/\s+/).length;
  if (n < 8 || n > 28) return null;
  if (!favRe(favourite).test(body)) return null;
  // Digit/punctuation checks run on the line without the favourite: 3 Idiots, Mr. Robot, Airplane!
  // The favourite (and its possessive 's) is removed before the remaining checks.
  const favPos = new RegExp(favRe(favourite).source + "(?:'s(?![\\p{L}\\p{N}]))?", 'gu');
  const rest = body.replace(favPos, ' ');
  if (/[!?;:()[\]{}\/"“”—–]|\.\s|\s-\s|^\s*-|-\s*$/.test(rest) || URLISH.test(rest) || /\p{N}/u.test(rest)) return null;
  if (NEGATION.test(rest) || HEDGE.test(rest)) return null;
  const T = new Set(sourceWords(titles));
  const S = new Set([...sourceWords(sources), ...T]);
  const grounded = new Set();
  // Possessive 's is grammar, not a word to ground (Breaking Bad's, the killer's).
  // No contractions: an apostrophe tail is allowed only as a noun possessive 's on a grounded word.
  for (const [, word, tail] of rest.matchAll(/([\p{L}\p{N}]+)'([\p{L}]*)/gu)) {
    const w = word.toLowerCase();
    if (tail.toLowerCase() !== 's' || STOP.has(w) || !matchesSource(w, S)) return null;
  }
  for (const w of words(rest.replace(/'s(?![\p{L}\p{N}])/gu, ''))) {
    if (NUMBER_WORDS.test(w)) return null;
    if (STOP.has(w)) continue;
    if (!matchesSource(w, S)) return null;
    if (!matchesSource(w, T)) grounded.add(w);
  }
  // A generic line made only of allowed words ("Fans of X will love this film") says nothing.
  return grounded.size >= MIN_GROUNDED_WORDS ? t : null;
}

export function parseBatch(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { const v = JSON.parse(m[0]).picks; return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []; } catch { return []; }
}

// The favourite that shares the most tags with the pick, and those tags.
export function bestFavourite(favs, pick) {
  const by = new Map();
  for (const s of sharedTags(favs, pick)) by.set(s.favourite, [...(by.get(s.favourite) || []), safeText(String(s.tag).replace(/_/g, ' '), 40)]);
  let best = null;
  for (const f of favs) if (by.get(f.name)?.length > (best ? by.get(best.name).length : 0)) best = f;
  return best ? { favourite: best, tags: [...new Set(by.get(best.name))].filter(Boolean).slice(0, 8) } : null;
}

export function buildContent(batch) {
  return batch.map(({ input: p }) => {
    if (!/^p\d+$/.test(p.id)) throw new Error('bad pick id');
    return `<pick id="${p.id}">\n<favourite>${p.favourite}</favourite>\n<tags>${p.tags.join('; ')}</tags>\n<title>${p.title}</title>\n<genres>${p.genres.join(', ')}</genres>\n<overview>${p.overview}</overview>\n</pick>`;
  }).join('\n');
}
// Worst-case cost of this exact request: input from its length (<= 2 chars per token, which
// over-counts English and covers Hangul/Indic), output at its max_tokens.
export function reservationFor(content, picks) {
  const maxTokens = 40 + WHY_TOKENS_PER_PICK * picks;
  const inputTokens = Math.ceil((WHY_SYSTEM.length + content.length) / 2) + 20;
  return { maxTokens, usd: costOf({ input_tokens: inputTokens, output_tokens: maxTokens }) };
}

export function createWhyWriter({ claude, budget, log = () => {}, now = () => Date.now(), caps = WHY_CAPS, cache = createCache({ ttlMs: TTL.good, max: 3000, now }), waitMs = WHY_WAIT_MS } = {}) {
  const ips = createIpLimiter({ perIpPerDay: caps.perIpPerDay, maxIps: caps.maxIps, now });
  const skip = (batch) => batch.forEach((b) => cache.set(b.key, { skip: true }, TTL.skip));

  async function call(batch, ip) {
    const capped = ips.check(ip);
    if (capped) return capped;
    const content = buildContent(batch);
    const { maxTokens, usd } = reservationFor(content, batch.length);
    if (!budget.reserve(usd, F)) return 'global';
    ips.take(ip);
    // In-flight / failed marker, only once this caller has really started a call: a capped caller
    // must not switch the feature off for everyone else. No second call for 10 minutes.
    skip(batch);
    let r;
    try {
      r = await claude.whyBatch(content, { timeoutMs: WHY_CALL_TIMEOUT_MS, maxTokens });
    } catch (e) {
      if (e?.code === 'missing_key' || e?.notSent) { budget.adjust(-usd, F); ips.refund(ip); }
      log({ event: 'why_llm_error', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return 'error';
    }
    if (Number.isFinite(r.usage?.input_tokens)) budget.adjust(costOf(r.usage) - usd, F);
    const out = new Map(parseBatch(r.text).map((x) => [String(x.id), x]));
    let ok = 0;
    for (const b of batch) {
      const x = out.get(b.input.id) || {};
      const why = validateWhy(x.why, b.ground);
      if (why) ok++;
      cache.set(b.key, {
        why, favourite: b.ground.favourite,
        pace: ['slow', 'steady', 'fast'].includes(x.pace) ? x.pace : null,
        dialogue: ['light', 'moderate', 'heavy'].includes(x.dialogue) ? x.dialogue : null,
      }, why ? TTL.good : TTL.rejected); // rejected lines: 1 day, so a bad answer isn't re-bought all week
    }
    log({ event: 'why_llm', picks: batch.length, valid: ok, spentUsd: Number(budget.spent('why').toFixed(5)) });
    return 'ok';
  }

  // picks: [{ qlooId, title, englishTitle, tags, src: { overview, genreNames } }].
  // -> array (same order) of { why, favourite, pace, dialogue } or null. Never throws.
  return async function enrich(picks, favs, { ip = 'unknown', waitMs: wait = waitMs } = {}) {
    const slots = picks.map((p) => {
      const overview = esc(String(p.src?.overview || '').replace(/\s+/g, ' ').trim()).slice(0, 700);
      const bf = overview ? bestFavourite(favs, p) : null;
      const favourite = bf && safeText(bf.favourite.name, 60);
      if (!favourite) return null;
      const title = safeText(p.englishTitle || p.title, 100);
      const genres = (p.src?.genreNames || []).map((g) => safeText(g, 30));
      const key = createHash('sha256').update(JSON.stringify([p.qlooId, bf.favourite.id, favourite, bf.tags, overview])).digest('hex');
      return {
        key,
        input: { id: '', favourite, tags: bf.tags, title, genres, overview },
        ground: { favourite, titles: [title, safeText(p.title, 100)], sources: [...bf.tags, ...genres, overview] },
      };
    });
    const missing = slots.filter((s) => s && cache.get(s.key) === undefined).slice(0, caps.maxPicks);
    missing.forEach((s, i) => { s.input.id = `p${i}`; });
    if (missing.length) {
      const p = call(missing, ip).catch(() => 'error');
      let timer;
      const res = await Promise.race([p, new Promise((r) => { timer = setTimeout(() => r('timeout'), wait); })]);
      clearTimeout(timer);
      if (res === 'timeout') log({ event: 'why_llm_slow' });
    }
    return slots.map((s) => { const v = s && cache.get(s.key); return v && !v.skip ? v : null; });
  };
}
