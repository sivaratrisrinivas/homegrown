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
