// HG-22: word coverage. Pure code shared by the browser, the server and scripts/coverage.mjs.
// A film's subtitle tokens are counted into frequency-rank bands once (offline); the browser turns
// those band counts plus the learner's estimated vocabulary into "~N% of the words".

export const TOP_N = 20000;
export const BAND = 500; // rank band width for film histograms: 40 bands cover the top 20k
export const BANDS = TOP_N / BAND;

// Frequency list per app language (hermitdave/FrequencyWords 2018, CC-BY-SA-4.0) and the
// OpenSubtitles language code. A language is supported only where our tokeniser reproduces the
// list's own words (see scripts/freqlists.mjs, "consistency"); elsewhere we show no line.
export const LANGS = {
  es: { list: 'es', os: 'es' }, fr: { list: 'fr', os: 'fr' }, it: { list: 'it', os: 'it' }, de: { list: 'de', os: 'de' },
  pt: { list: 'pt_br', os: 'pt-br' }, en: { list: 'en', os: 'en' }, ru: { list: 'ru', os: 'ru' }, tr: { list: 'tr', os: 'tr' },
  id: { list: 'id', os: 'id' }, tl: { list: 'tl', os: 'tl' }, ar: { list: 'ar', os: 'ar' }, fa: { list: 'fa', os: 'fa' },
  hi: { list: 'hi', os: 'hi' }, bn: { list: 'bn', os: 'bn' }, ta: { list: 'ta', os: 'ta' }, te: { list: 'te', os: 'te' },
  ml: { list: 'ml', os: 'ml' }, ko: { list: 'ko', os: 'ko', particles: true }, zh: { list: 'zh_tw', os: 'zh-tw', segment: 'zh' },
};
// Measured unsupported (reason shown in the support table, never a number in the UI).
export const UNSUPPORTED = {
  ja: 'frequency list was cut by a different tokeniser (verb stems like 言, 行); Intl.Segmenter words do not line up',
  th: 'frequency list has unsegmented phrases and fragments; Intl.Segmenter words do not line up',
  cn: 'no free Cantonese frequency list',
  pa: 'no free Punjabi frequency list',
};
export const supported = (lang) => Object.hasOwn(LANGS, lang);

// Korean: Intl.Segmenter splits on spaces, so a word keeps its particle (친구를). The same common
// particles are stripped from the frequency list and from subtitles, so both sides count the stem.
const KO_PARTICLES = ['에서는', '에게서', '한테서', '으로는', '에서', '에게', '한테', '께서', '으로', '까지', '부터', '보다', '처럼', '마다', '이나', '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '만', '나'];
export function stripKo(w) {
  for (const p of KO_PARTICLES) if (w.length > p.length && w.endsWith(p)) return w.slice(0, -p.length);
  return w;
}

const segs = new Map();
const LETTER = /\p{L}/u;
// Word tokens of a text: Intl.Segmenter words, NFC, lower case, letters required, no digits.
export function tokenize(text, lang) {
  const cfg = LANGS[lang];
  if (!cfg) return [];
  const loc = cfg.segment || lang;
  let seg = segs.get(loc);
  if (!seg) { seg = new Intl.Segmenter(loc, { granularity: 'word' }); segs.set(loc, seg); }
  const out = [];
  for (const s of seg.segment(String(text || '').normalize('NFC'))) {
    if (!s.isWordLike) continue;
    let w = s.segment.toLocaleLowerCase(lang);
    if (!LETTER.test(w) || /\p{N}/u.test(w)) continue;
    if (cfg.particles) w = stripKo(w);
    out.push(w);
  }
  return out;
}

// Subtitle file (SRT or WebVTT) -> spoken text only: no cue numbers, timings, tags or [sound] notes.
export function subtitleText(srt) {
  return String(srt || '').replace(/\r/g, '').split('\n')
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l))
    .map((l) => l.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' '))
    .join('\n');
}

// Film profile: how many subtitle tokens fall in each 500-rank band of the list, plus beyond it.
// rank: Map word -> 1-based rank. Only these counts are stored, never the subtitle text.
export function profile(tokens, rank) {
  const bands = new Array(BANDS).fill(0);
  let beyond = 0;
  for (const w of tokens) {
    const r = rank.get(w);
    if (r && r <= TOP_N) bands[Math.floor((r - 1) / BAND)]++; else beyond++;
  }
  return { tokens: tokens.length, bands, beyond };
}

// Share of a film's tokens whose rank is within the learner's vocabulary size (step model, the
// band containing the cut-off counted proportionally). Words beyond the list count as unknown.
export function coverage(p, vocab) {
  if (!p || !(p.tokens > 0) || !Array.isArray(p.bands) || !Number.isFinite(vocab) || vocab < 0) return null;
  let known = 0;
  for (let i = 0; i < p.bands.length; i++) {
    const lo = i * BAND, hi = lo + BAND;
    if (vocab >= hi) known += p.bands[i];
    else if (vocab > lo) known += p.bands[i] * ((vocab - lo) / BAND);
  }
  return known / p.tokens;
}
// Shown as "~N%": rounded to 5, never above 99, so the number never looks more exact than it is.
export const coveragePct = (c) => (c == null ? null : Math.min(99, Math.round((c * 100) / 5) * 5));
export const MIN_TOKENS = 1500; // shorter subtitle files (partial / forced) give no line
// Personal difficulty from coverage (around 95% of words known, films become comfortable).
// Based on the same rounded number the learner sees, so "95%+" is never shown with a "medium" dot.
export function coverageDifficulty(c) {
  if (c == null) return null;
  const r = Math.round((c * 100) / 5) * 5;
  return r >= 95 ? 'easy' : r >= 85 ? 'medium' : 'hard';
}
// Display text: "<5%" and "95%+" at the ends, "~N%" in between (never a fake-exact ~0% or ~99%).
export function coverageLabel(c) {
  const r = c == null ? null : Math.round((c * 100) / 5) * 5;
  return r == null ? null : r < 5 ? '<5%' : r >= 95 ? '95%+' : `~${r}%`;
}
// Fixed seeded shuffle (mulberry32 + Fisher-Yates): same order every time, bands mixed.
export function seededShuffle(arr, seed = 22) {
  const a = arr.slice(); let t = seed >>> 0;
  const rnd = () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Storage that may be blocked (privacy mode, sandboxed iframes): touching localStorage can throw.
export function safeStorage(get = () => globalThis.localStorage) { try { return get() || null; } catch { return null; } }
// Finishing the word check: nothing ticked means no estimate (never save 0). Returns whether saved.
export function finishWordCheck(storage, lang, items, now = Date.now()) {
  if (!storage || !items.some((x) => x.known)) return false;
  return saveVocab(storage, lang, estimateVocab(items), now);
}

// Vocabulary check: 6 rank bands, 5 words each. Estimate = sum of band width x share ticked.
export const TEST_BANDS = [[1, 1000], [1001, 2500], [2501, 5000], [5001, 10000], [10001, 15000], [15001, 20000]];
export const WORDS_PER_BAND = 5;
export function estimateVocab(answers) {
  // answers: [{ band: index, known: bool }]
  let v = 0;
  TEST_BANDS.forEach(([lo, hi], i) => {
    const a = answers.filter((x) => x.band === i);
    if (a.length) v += (hi - lo + 1) * (a.filter((x) => x.known).length / a.length);
  });
  return Math.round(v);
}
// localStorage only: { [lang]: { vocab, at } }. No accounts, nothing sent to the server.
export const VOCAB_KEY = 'hg.vocab.v1';
export function readVocab(storage, lang) {
  try { const v = JSON.parse(storage.getItem(VOCAB_KEY) || '{}')[lang]; return Number.isFinite(v?.vocab) ? v.vocab : null; } catch { return null; }
}
export function saveVocab(storage, lang, vocab, now = Date.now()) {
  try { const all = JSON.parse(storage.getItem(VOCAB_KEY) || '{}'); all[lang] = { vocab, at: now }; storage.setItem(VOCAB_KEY, JSON.stringify(all)); return true; } catch { return false; }
}
