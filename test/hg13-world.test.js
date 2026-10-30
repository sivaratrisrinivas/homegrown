// HG-13: world cities are config; every new entry is complete, readable, and gated by its measured movie result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITIES, LANGUAGES } from '../lib/cities.js';
import { loadGate, cityStatus, thinNote, catalogue, THIN_SEEN, THIN_SHARE } from '../lib/gate.js';

const gate = loadGate();
const css = readFileSync('public/styles.css', 'utf8');
const PAPER = css.match(/--paper:(#[0-9A-Fa-f]{6})/)[1];
const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// Cities that predate HG-13 keep their accents (out of scope here); every newer city must be AA.
const LEGACY = new Set(['mexico_city', 'madrid', 'buenos_aires', 'seoul', 'paris', 'chennai', 'mumbai', 'hyderabad', 'kolkata', 'kochi', 'amritsar']);
const NEW = Object.values(CITIES).filter((c) => !LEGACY.has(c.id));

test('HG-13: new cities are complete config entries with a native local name and header', () => {
  assert.ok(NEW.length >= 15);
  for (const c of NEW) {
    for (const k of ['name', 'localName', 'country', 'releaseCountry', 'countryNames', 'language', 'flag', 'accent', 'header', 'itunesCountry', 'subtitleTip', 'musicTag']) assert.ok(c[k], `${c.id}.${k}`);
    assert.ok(c.musicLanguageTags.length, c.id);
    assert.match(c.accent, /^#[0-9A-F]{6}$/i);
    assert.ok(LANGUAGES.some((l) => l.id === c.language), c.id);
    assert.ok(c.countryNames.includes(c.name.toLowerCase()), c.id);
    assert.match(c.subtitleTip, new RegExp(LANGUAGES.find((l) => l.id === c.language).name));
  }
});

test('HG-13: accents are WCAG AA (4.5:1) as text on paper and under light text', () => {
  for (const c of NEW) {
    assert.ok(ratio(c.accent, PAPER) >= 4.5, `${c.id} on paper ${ratio(c.accent, PAPER).toFixed(2)}`);
    assert.ok(ratio(c.accent, '#FFFFFF') >= 4.5, `${c.id} under white ${ratio(c.accent, '#FFFFFF').toFixed(2)}`);
  }
});

test('HG-13: every configured city is gated by its measured result; thin note follows the thresholds', () => {
  for (const c of NEW) {
    const m = gate.results[c.id]?.movie;
    assert.ok(m, `${c.id} measured`);
    const expectLive = m.seen >= gate.minSeen && m.accepted / m.seen >= gate.threshold;
    assert.equal(cityStatus(gate, c.id).live, expectLive, c.id);
    const thin = m.seen < THIN_SEEN || (m.languageShare ?? 1) < THIN_SHARE;
    assert.equal(!!thinNote(gate, c.id), thin, `${c.id} thin note`);
  }
  const cat = catalogue(gate);
  for (const c of NEW) assert.ok(cat.languages.find((l) => l.id === c.language).live, c.language);
});

test('HG-13 review: RTL-safe headers, provenance, no combining-dot aliases', () => {
  const app = readFileSync('public/app.js', 'utf8');
  // HG-10 redesign: the city name, the board header and the reveal/friend headers all carry dir=auto.
  assert.match(app, /h\('h2', \{ class: `city-name \$\{serif\(c\.language\)\}`, lang: c\.language, dir: 'auto'/);
  assert.match(app, /hdr\.dir = 'auto'; await flipHeader\(hdr, revealHeader\(J, c\)/);
  assert.match(app, /lang: J\.single \? 'en' : S\.city\.language, dir: 'auto' \}/);
  const raw = JSON.parse(readFileSync(gate.hg13.raw, 'utf8'));
  for (const c of NEW) {
    const r = raw.scout.results.find((x) => x.id === c.id);
    assert.ok(r, c.id); assert.equal(gate.results[c.id].movie.seen, r.seen); assert.equal(gate.results[c.id].movie.accepted, r.accepted);
    assert.equal(r.releaseCountry, c.releaseCountry, c.id);
  }
  assert.ok(raw.retry.results.every((r) => r.seen === 0));
  assert.doesNotMatch(readFileSync('config/cities.json', 'utf8'), /\u0307/);
  assert.match(CITIES.tehran.itunesNote, /ir/);
});

// Captain (HG-13): English is only for people who pick English to learn.
import { cityForLanguage, liveCitiesForLanguage, otherCities, languageGroups } from '../public/logic.js';
import { suggestCity } from '../lib/gate.js';
const EN_CITIES = Object.values(CITIES).filter((c) => c.language === 'en').map((c) => c.id);

test('English: learnable, London first, Dublin one tap away (best-score rule)', () => {
  assert.deepEqual(EN_CITIES, ['london', 'dublin']);
  const cat = catalogue(gate);
  assert.ok(languageGroups(cat).live.some((l) => l.id === 'en'), 'English is a live, learnable language');
  assert.equal(suggestCity(gate, 'en').city, 'london');
  assert.equal(cityForLanguage(cat, 'en').id, 'london');
  assert.deepEqual(liveCitiesForLanguage(cat, 'en').map((c) => c.id), ['london', 'dublin']);
  // The rule is the score, not the order: give Dublin the better floor and it leads.
  const g2 = structuredClone(gate); g2.results.dublin.movie = { ...g2.results.dublin.movie, accepted: 15 };
  assert.equal(suggestCity(g2, 'en').city, 'dublin');
});

test('English: never an auto-route, default or fallback for any other language', () => {
  const cat = catalogue(gate);
  assert.equal(cat.languages.find((l) => l.id === 'en').explicitOnly, true);
  for (const l of LANGUAGES.filter((x) => x.id !== 'en')) {
    assert.ok(!EN_CITIES.includes(suggestCity(gate, l.id).city), `suggested for ${l.id}`);
    assert.ok(!EN_CITIES.includes(cityForLanguage(cat, l.id)?.id), `default for ${l.id}`);
    assert.ok(liveCitiesForLanguage(cat, l.id).every((c) => !EN_CITIES.includes(c.id)), `switch list for ${l.id}`);
    // Reveal "Try X" links from every live city of a non-English pick.
    for (const c of cat.cities.filter((x) => x.live)) assert.ok(otherCities(cat, c.id, l.id).every((o) => !EN_CITIES.includes(o.id)), `try links ${l.id}/${c.id}`);
    assert.ok(otherCities(cat, c0(cat), undefined).every((o) => !EN_CITIES.includes(o.id)), 'no language picked');
  }
  // Picking English keeps the other English city one tap away from the reveal.
  assert.ok(otherCities(cat, 'london', 'en').some((c) => c.id === 'dublin'));
  // A language with no live city falls back to "not live yet", never another city.
  const off = structuredClone(gate); for (const id of Object.keys(off.results)) if (CITIES[id]?.language === 'ja') off.results[id].movie.accepted = 0;
  assert.equal(cityForLanguage(catalogue(off), 'ja'), null);
  // Client wiring: the reveal uses otherCities with the picked language; the India hint only offers Indian languages.
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /otherCities\(S\.catalogue, S\.city\.id, S\.lang\?\.id\)/);
  assert.doesNotMatch(app, /filter\(\(c\) => c\.live && c\.id !== S\.city\.id\)/);
  assert.doesNotMatch(readFileSync('public/india.js', 'utf8'), /English|london|dublin/i);
});
const c0 = (cat) => cat.cities.find((c) => c.live && c.language !== 'en').id;

// Round 5: a native-script RTL header (Cairo, Tehran) keeps dir=auto everywhere a native header renders,
// and the share board never forces lang="en" onto native-script text. v1's English single-category header is fine.
test('HG-13 r5: RTL native city headers render with dir=auto; the share board keeps the city language', async () => {
  const { revealHeader, journeyFor } = await import('../public/logic.js');
  const app = readFileSync('public/app.js', 'utf8');
  const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  for (const id of ['cairo', 'tehran']) {
    const c = CITIES[id]; assert.ok(c, id);
    const native = revealHeader(journeyFor('mixed'), c);
    assert.equal(native, c.header, `${id}: mixed mode shows the native header`);
    assert.match(native, RTL, `${id}: header is in an RTL script`);
    assert.match(revealHeader(journeyFor('movies'), c), /^Your film self, in /, `${id}: v1 single-category header is English`);
  }
  // Every element that can show a native header carries dir=auto.
  assert.match(app, /hdr\.dir = 'auto'; await flipHeader\(hdr, revealHeader\(J, c\)/, 'matching board header');
  assert.match(app, /h\('h2', \{ class: `hdr \$\{ko \? 'ko' : ''\}`, lang: J\.single \? 'en' : S\.city\.language, dir: 'auto' \}, revealHeader\(J, S\.city\)\)/, 'share board header');
  assert.match(app, /h\('h2', \{ class: `city-name \$\{serif\(c\.language\)\}`, lang: c\.language, dir: 'auto'/, 'city name');
  // lang="en" is only ever used for English copy: never on revealHeader output unless the journey is single.
  for (const m of app.matchAll(/h\('[a-z0-9]+', \{[^}]*lang: 'en'[^}]*\}, ([^)]*\)?)/g)) assert.doesNotMatch(m[1], /revealHeader|\.header\b|\.local\b/, `lang=en forced on native text: ${m[0].slice(0, 80)}`);
});

