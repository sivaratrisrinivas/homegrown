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
toward towards across someone something
explores explore features centres centers set plot`.split(/\s+/));
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
// HG-16: checkWhy gives the rule that rejected a line (rule names only; never line text), so
// production logs can explain the pass rate. validateWhy keeps its old contract.
export function checkWhy(text, { favourite, sources, titles = [] }) {
  const no = (reason, word = null) => ({ line: null, reason, word });
  favourite = String(favourite || '').replace(/’/g, "'");
  if (text == null || String(text).trim() === '') return no('empty');
  let t = String(text).replace(/’/g, "'").replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (!favourite) return no('no_favourite');
  if (t.length < 40 || t.length > 220) return no('length');
  if (!/\.$/.test(t)) t += '.';
  const body = t.slice(0, -1);
  const n = t.split(/\s+/).length;
  if (n < 8 || n > 28) return no('word_count');
  if (!favRe(favourite).test(body)) return no('favourite_missing');
  // Digit/punctuation checks run on the line without the favourite: 3 Idiots, Mr. Robot, Airplane!
  // The favourite (and its possessive 's) is removed before the remaining checks.
  const favPos = new RegExp(favRe(favourite).source + "(?:'s(?![\\p{L}\\p{N}]))?", 'gu');
  const rest = body.replace(favPos, ' ');
  if (URLISH.test(rest)) return no('url');
  if (/\p{N}/u.test(rest)) return no('digit');
  if (/[!?;:()[\]{}\/"“”—–]|\.\s|\s-\s|^\s*-|-\s*$/.test(rest)) return no('punctuation');
  if (NEGATION.test(rest)) return no('negation');
  if (HEDGE.test(rest)) return no('hedge');
  const T = new Set(sourceWords(titles));
  const S = new Set([...sourceWords(sources), ...T]);
  const grounded = new Set();
  // Possessive 's is grammar, not a word to ground (Breaking Bad's, the killer's).
  // No contractions: an apostrophe tail is allowed only as a noun possessive 's on a grounded word.
  for (const [, word, tail] of rest.matchAll(/([\p{L}\p{N}]+)'([\p{L}]*)/gu)) {
    const w = word.toLowerCase();
    if (tail.toLowerCase() !== 's' || STOP.has(w) || !matchesSource(w, S)) return no('contraction');
  }
  let ungrounded = 0; const off = [];
  for (const w of words(rest.replace(/'s(?![\p{L}\p{N}])/gu, ''))) {
    if (NUMBER_WORDS.test(w)) return no('number_word', w);
    if (STOP.has(w)) continue;
    if (!matchesSource(w, S)) { ungrounded++; off.push(w); continue; }
    if (!matchesSource(w, T)) grounded.add(w);
  }
  if (ungrounded) return no(`ungrounded:${ungrounded}`, [...new Set(off)].join(', '));
  // A generic line made only of allowed words ("Fans of X will love this film") says nothing.
  if (grounded.size < MIN_GROUNDED_WORDS) return no(`too_few_grounded:${grounded.size}`);
  return { line: t, reason: null };
}
export const validateWhy = (text, ground) => checkWhy(text, ground).line;

// HG-15: the content words Claude may use for one pick, in source order (tags, genres, overview),
// minus grammar/framing words, number words and 1-2 letter fragments. Letters only, so safe to embed.
export const WORD_LIST_MAX = 60;
// HG-18: words that only make sense next to a number ("ten year absence", "seventeen year old"). Offering
// them invites a number word; the validator still accepts them if they are in the sources.
const AGE_WORDS = new Set(['year', 'years', 'old', 'aged', 'decade', 'decades', 'month', 'months', 'week', 'weeks', 'hour', 'hours', 'minute', 'minutes', 'day', 'days']);
export function allowedWords(sources) {
  return [...new Set(sourceWords(sources))].filter((w) => !STOP.has(w) && !NUMBER_WORDS.test(w) && !AGE_WORDS.has(w) && !/\p{N}/u.test(w)).slice(0, WORD_LIST_MAX);
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

// HG-18: the regenerate tells Claude exactly which rule its last line broke, and the word(s) that broke it.
// Only rule names and words from Claude's own rejected line (letters only), never the line itself.
export function feedbackFor(reason, word) {
  const w = String(word || '').replace(/[^\p{L}\p{M}, ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const r = String(reason || '').split(':')[0];
  const m = {
    number_word: `It used the number word "${w}". Use no numbers or number words at all: write "teenagers", not "two teenagers".`,
    ungrounded: `It used ${w ? `"${w}", which is` : 'a word that is'} not in the words list. Use only words copied from the words list, the favourite name and the allowed function and framing words. Do not swap in a synonym or a related form.`,
    digit: 'It contained a digit. Use no digits or number words.',
    word_count: 'It was too long or too short. Write 12 to 20 words with one short idea after "about".',
    length: 'It was too long or too short. Write 12 to 20 words with one short idea after "about".',
    favourite_missing: 'It did not contain the favourite name exactly as given.',
    too_few_grounded: 'It used too few words from the words list. Use at least three different words from the words list.',
    negation: 'It used a negation. Use no negation.',
    hedge: 'It used "than" or "if". Use neither.',
    punctuation: 'It used forbidden punctuation. Use only commas and one final full stop.',
    contraction: 'It used a contraction or a possessive on a word not in <words>.',
    url: 'It contained a link or domain.',
  }[r];
  return m ? `Your previous line for this pick was rejected. ${m}` : '';
}
export function buildContent(batch) {
  return batch.map(({ input: p }) => {
    if (!/^p\d+$/.test(p.id)) throw new Error('bad pick id');
    const fb = p.feedback ? `\n<feedback>${esc(p.feedback)}</feedback>` : '';
    return `<pick id="${p.id}">\n<favourite>${p.favourite}</favourite>\n<words>${(p.words || []).join(', ')}</words>\n<tags>${p.tags.join('; ')}</tags>\n<title>${p.title}</title>\n<genres>${p.genres.join(', ')}</genres>\n<overview>${p.overview}</overview>${fb}\n</pick>`;
  }).join('\n');
}
// Worst-case cost of this exact request: input from its length (<= 2 chars per token, which
// over-counts English and covers Hangul/Indic), output at its max_tokens.
export function reservationFor(content, picks) {
  const maxTokens = 40 + WHY_TOKENS_PER_PICK * picks;
  const inputTokens = Math.ceil((WHY_SYSTEM.length + content.length) / 2) + 20;
  return { maxTokens, usd: costOf({ input_tokens: inputTokens, output_tokens: maxTokens }) };
}

// Vercel keeps the function alive for promises given to waitUntil after the response is sent. This
// reads the same request context @vercel/functions uses, so no dependency; outside Vercel it is a no-op.
export function vercelWaitUntil(p) {
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  if (typeof ctx?.waitUntil === 'function') { ctx.waitUntil(p); return true; }
  return false;
}

export function createWhyWriter({ waitUntil = vercelWaitUntil, retry = true, claude, budget, log = () => {}, now = () => Date.now(), caps = WHY_CAPS, cache = createCache({ ttlMs: TTL.good, max: 3000, now }), waitMs = WHY_WAIT_MS } = {}) {
  const ips = createIpLimiter({ perIpPerDay: caps.perIpPerDay, maxIps: caps.maxIps, now });
  const skip = (batch) => batch.forEach((b) => cache.set(b.key, { skip: true }, TTL.skip));

  // attempt 1 is the reveal's call; attempt 2 is one regenerate for only the rejected picks. It
  // reserves its own budget but does not take another per-IP call (same reveal).
  async function call(batch, ip, attempt = 1) {
    if (attempt === 1) { const capped = ips.check(ip); if (capped) return capped; }
    const content = buildContent(batch);
    const { maxTokens, usd } = reservationFor(content, batch.length);
    if (!budget.reserve(usd, F)) return 'global';
    if (attempt === 1) ips.take(ip);
    // In-flight / failed marker, only once this caller has really started a call: a capped caller
    // must not switch the feature off for everyone else. No second call for 10 minutes.
    if (attempt === 1) skip(batch); // a regenerate keeps the rejected entries until it beats them
    let r;
    try {
      r = await claude.whyBatch(content, { timeoutMs: WHY_CALL_TIMEOUT_MS, maxTokens });
    } catch (e) {
      if (e?.code === 'missing_key' || e?.notSent) { budget.adjust(-usd, F); if (attempt === 1) ips.refund(ip); }
      log({ event: 'why_llm_error', status: e?.upstreamStatus ?? e?.status ?? null, code: e?.code ?? null });
      return 'error';
    }
    if (Number.isFinite(r.usage?.input_tokens)) budget.adjust(costOf(r.usage) - usd, F);
    const out = new Map(parseBatch(r.text).map((x) => [String(x.id), x]));
    let ok = 0;
    const rejected = [];
    const reasons = [];
    for (const b of batch) {
      const x = out.get(b.input.id) || {};
      const { line: why, reason, word } = out.has(b.input.id) ? checkWhy(x.why, b.ground) : { line: null, reason: 'missing' };
      if (reason) reasons.push(reason);
      if (why) ok++;
      else if (attempt === 1 && x.why) rejected.push({ ...b, input: { ...b.input, feedback: feedbackFor(reason, word) } });
      if (attempt === 2 && !why) continue;
      cache.set(b.key, {
        why, favourite: b.ground.favourite,
        pace: ['slow', 'steady', 'fast'].includes(x.pace) ? x.pace : null,
        dialogue: ['light', 'moderate', 'heavy'].includes(x.dialogue) ? x.dialogue : null,
      }, why ? TTL.good : TTL.rejected); // rejected lines: 1 day, so a bad answer isn't re-bought all week
    }
    log({ event: 'why_llm', attempt, picks: batch.length, valid: ok, rejected: reasons, spentUsd: Number(budget.spent('why').toFixed(5)) });
    if (retry && rejected.length) {
      // Rejected lines stay cached (1 day) unless the regenerate produces a valid one.
      const again = rejected.map((b, i) => ({ ...b, input: { ...b.input, id: `p${i}` } }));
      await call(again, ip, 2);
    }
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
        input: { id: '', favourite, words: allowedWords([...bf.tags, ...genres, overview]), tags: bf.tags, title, genres, overview },
        ground: { favourite, titles: [title, safeText(p.title, 100)], sources: [...bf.tags, ...genres, overview] },
      };
    });
    const missing = slots.filter((s) => s && cache.get(s.key) === undefined).slice(0, caps.maxPicks);
    missing.forEach((s, i) => { s.input.id = `p${i}`; });
    if (missing.length) {
      // First pass, regenerate and cache fill all live in p; waitUntil keeps them running after
      // the reveal is answered at the wait deadline.
      const p = call(missing, ip).catch(() => 'error');
      try { waitUntil(p); } catch { /* never block the reveal */ }
      let timer;
      const res = await Promise.race([p, new Promise((r) => { timer = setTimeout(() => r('timeout'), wait); })]);
      clearTimeout(timer);
      if (res === 'timeout') log({ event: 'why_llm_slow' });
    }
    return slots.map((s) => { const v = s && cache.get(s.key); return v && !v.skip ? v : null; });
  };
}
