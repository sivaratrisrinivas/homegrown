// HG-22: builds data/freq/<lang>.txt (top 20k words, one per line, rank order) and
// public/vocab-test.json (30 words per language) from hermitdave/FrequencyWords 2018 lists
// (content CC-BY-SA-4.0, code MIT; https://github.com/hermitdave/FrequencyWords).
// Usage: node scripts/freqlists.mjs <dir with <list>.txt files>   (prints a consistency table)
// Consistency = share of the list's top-20k token mass whose entry our tokeniser keeps as itself
// (after Korean particle stripping). Below 0.9 a language must stay unsupported.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { LANGS, TOP_N, TEST_BANDS, WORDS_PER_BAND, tokenize } from '../public/coverage.js';

const dir = process.argv[2];
const NON_LATIN = new Set(['ru', 'ar', 'fa', 'hi', 'bn', 'ta', 'te', 'ml', 'ko', 'zh']);
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const test = {};
// Names and English loans (mike, jim, clinton, camera) are common in every subtitle list; for Latin-script
// languages, test words must not be in the English top 20,000.
const EN = new Set(readFileSync(`${dir}/en.txt`, 'utf8').split('\n').slice(0, 20000).map((l) => l.split(/\s+/)[0]));
mkdirSync('data/freq', { recursive: true });
for (const [lang, cfg] of Object.entries(LANGS)) {
  const rows = readFileSync(`${dir}/${cfg.list}.txt`, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((r) => r.length === 2);
  const counts = new Map();
  let mass = 0, kept = 0;
  for (const [w, c] of rows.slice(0, TOP_N)) {
    const n = Number(c); mass += n;
    const t = tokenize(w, lang);
    if (t.length === 1 && (t[0] === w.normalize('NFC').toLocaleLowerCase(lang) || cfg.particles)) kept += n;
  }
  for (const [w, c] of rows) {
    const t = tokenize(w, lang);
    if (t.length !== 1) continue;
    counts.set(t[0], (counts.get(t[0]) || 0) + Number(c));
  }
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, TOP_N);
  writeFileSync(`data/freq/${lang}.txt`, words.join('\n') + '\n');
  // Test words: real-looking words of the language's own script, 3+ letters (2+ for Chinese).
  const ok = (w) => (NON_LATIN.has(lang) ? !/[a-z]/i.test(w) : /^[\p{Script=Latin}]+$/u.test(w) && (lang === 'en' || !EN.has(w))) && [...w].length >= (lang === 'zh' ? 2 : 3);
  const rnd = seeded(lang.charCodeAt(0) * 31 + lang.charCodeAt(1));
  test[lang] = TEST_BANDS.map(([lo, hi]) => {
    const pool = words.slice(lo - 1, hi).filter(ok);
    const out = new Set();
    while (out.size < WORDS_PER_BAND && out.size < pool.length) out.add(pool[Math.floor(rnd() * pool.length)]);
    return [...out];
  });
  console.log(lang.padEnd(3), 'list', cfg.list.padEnd(6), 'words', String(words.length).padStart(5), 'consistency', (kept / mass).toFixed(3));
}
writeFileSync('public/vocab-test.json', JSON.stringify(test) + '\n');
