import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityStatus, cultureLead, suggestCity, catalogue, loadGate, requireLiveCity } from '../lib/gate.js';
import { createTwinService, WANT, SCARCE_BELOW, CANDIDATES } from '../lib/twin.js';
import { postcardCategories, scarcePicks, cityForLanguage, liveCitiesForLanguage, languageGroups } from '../public/logic.js';
import { CITIES, LANGUAGES } from '../lib/cities.js';
import { FAVS } from './helpers.js';

const r = (seen, accepted) => ({ seen, accepted });
const gate = (results, threshold = 0.6) => ({ threshold, categories: ['tv', 'movie', 'music'], results });

test('captain 1: aim for 5 picks from a Qloo top 15; under 3 is scarce and off the postcard', async () => {
  assert.deepEqual(WANT, { tv: 5, movie: 5, music: 5 }); assert.equal(SCARCE_BELOW, 3); assert.equal(CANDIDATES, 15);
  const qcalls = [];
  const names = Array.from({ length: 15 }, (_, i) => ({ id: 'q' + i, name: 'B' + i, tags: [{ id: 'urn:tag:genre:music:k_pop', name: 'K-Pop' }] }));
  const qloo = { insights: async (a) => { qcalls.push(a); return names; } };
  const mb = { searchArtist: async (n) => (['B1', 'B4'].includes(n) ? [{ id: n, name: n, score: 100, country: 'KR' }] : []) };
  const s = createTwinService({ qloo, tmdb: {}, mb, itunes: { previewForArtist: async () => null } });
  const out = await s.category({ favourites: FAVS, cityId: 'seoul', category: 'music' });
  assert.equal(qcalls[0].take, 50, 'pool of 50, language-filtered before the top 15');
  assert.equal(out.picks.length, 2); assert.equal(out.scarce, true);
  assert.match(out.note, /scarce in Seoul.*left off your postcard/);
  const byCat = { tv: { picks: [1, 2, 3, 4, 5].map((t) => ({ t })) }, movie: { picks: [{ t: 'm' }] }, music: out };
  assert.deepEqual(postcardCategories(byCat), ['tv']);
  assert.deepEqual(scarcePicks(byCat).map((p) => p.t || p.title), ['m', 'B1', 'B4']);
});

test('captain 1: measuring run checks every candidate (no early stop, no cap)', async () => {
  const names = Array.from({ length: 15 }, (_, i) => ({ id: 'q' + i, name: 'B' + i, tags: [{ id: 'urn:tag:genre:music:k_pop', name: 'K-Pop' }] }));
  let checks = 0;
  const mb = { searchArtist: async (n) => { checks++; return [{ id: n, name: n, score: 100, country: 'KR' }]; } };
  const logs = [];
  const s = createTwinService({ qloo: { insights: async () => names }, tmdb: {}, mb, itunes: { previewForArtist: async () => null }, log: (e) => logs.push(e) });
  const m = await s.measure({ favourites: FAVS, cityId: 'seoul', category: 'music' });
  assert.equal(checks, 15); assert.deepEqual([m.seen, m.accepted, m.pct], [15, 15, 100]);
  assert.ok(logs.some((l) => l.event === 'native_rate' && l.measure));
});

test('captain 2: a city is live only if all three categories reach 60%', () => {
  const g = gate({ a: { tv: r(10, 6), movie: r(10, 6), music: r(10, 9) }, b: { tv: r(10, 9), movie: r(10, 5), music: r(10, 9) }, c: { tv: r(10, 9), music: r(10, 9) } });
  assert.equal(cityStatus(g, 'a').live, true);
  assert.equal(cityStatus(g, 'b').live, false);
  assert.equal(cityStatus(g, 'c').live, false, 'missing category fails closed');
  assert.equal(cityStatus(g, 'zzz').live, false);
});

test('captain 2: gate lives in config, server refuses non-live cities', () => {
  const g = loadGate();
  assert.equal(g.threshold, 0.6);
  assert.equal(g.minSeen, 5);
  for (const c of ['mexico_city', 'seoul', 'paris']) for (const k of ['tv', 'movie', 'music']) assert.ok(g.results[c][k].seen >= g.minSeen, 'enough candidates measured');
  const live = ['mexico_city', 'seoul', 'paris'].filter((c) => cityStatus(g, c).live);
  for (const c of ['mexico_city', 'seoul', 'paris']) {
    if (live.includes(c)) assert.doesNotThrow(() => requireLiveCity(g, c));
    else assert.throws(() => requireLiveCity(g, c), (e) => e.status === 403);
  }
  assert.match(readFileSync('api/twin.js', 'utf8'), /requireLiveCity/);
});

test('captain 3: language first, then the suggested live city', () => {
  const g = gate({ seoul: { tv: r(10, 7), movie: r(10, 8), music: r(10, 8) }, paris: { tv: r(10, 7), movie: r(10, 4), music: r(10, 9) } });
  assert.equal(suggestCity(g, 'ko').city, 'seoul');
  assert.equal(suggestCity(g, 'fr').city, null);
  const cat = catalogue(g);
  assert.deepEqual(cat.languages.map((l) => l.id), ['es', 'ko', 'fr', 'ta', 'hi', 'te', 'bn']);
  assert.equal(cityForLanguage(cat, 'ko').id, 'seoul');
  assert.equal(cityForLanguage(cat, 'fr'), null);
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.indexOf('pickLanguage()') < app.indexOf('function suggestCity'), 'Start goes to language first');
  assert.doesNotMatch(app, /function pickCity/);
});

test('captain 4: culture lead comes only from the native counts', () => {
  const g = gate({ seoul: { tv: r(10, 9), movie: r(10, 8), music: r(10, 8) }, paris: { tv: r(10, 7), movie: r(10, 4), music: r(10, 9) }, mexico_city: { tv: r(10, 5), movie: r(10, 5), music: r(10, 2) } });
  assert.equal(cultureLead(g, 'seoul').text, 'Seoul: dramas lead');
  assert.equal(cultureLead(g, 'paris').text, 'Paris: music leads');
  assert.equal(cultureLead(g, 'mexico_city').text, 'Mexico City: dramas and films lead');
  g.results.seoul.music = r(10, 10);
  assert.equal(cultureLead(g, 'seoul').text, 'Seoul: music leads', 'changes when the counts change');
  assert.equal(cultureLead(gate({ seoul: { tv: r(10, 0), movie: r(10, 0), music: r(10, 0) } }), 'seoul'), null);
});

const ALL = (tv, movie, music) => ({ tv: r(10, tv), movie: r(10, movie), music: r(10, music) });

test('captain 5: only languages with a live city are offered; others are coming soon', () => {
  const g = gate({ seoul: ALL(7, 8, 8), paris: ALL(7, 4, 9), chennai: ALL(9, 9, 5) });
  const { live, soon } = languageGroups(catalogue(g));
  assert.deepEqual(live.map((l) => l.id), ['ko']);
  assert.deepEqual(soon.map((l) => l.id), ['es', 'fr', 'ta', 'hi', 'te', 'bn']);
});

test('captain 6: measured best city is the default; other live cities are one tap away', () => {
  const g = gate({ mexico_city: ALL(7, 6, 6), madrid: ALL(9, 8, 7), buenos_aires: ALL(8, 5, 9) });
  const cat = catalogue(g);
  assert.equal(cityForLanguage(cat, 'es').id, 'madrid', 'highest weakest-category % wins');
  assert.deepEqual(liveCitiesForLanguage(cat, 'es').map((c) => c.id), ['madrid', 'mexico_city']);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /Switch to \$\{o\.name\}/);
});

test('captain 7: cities and languages are config; Chennai/Tamil is a gated candidate', () => {
  const cfg = JSON.parse(readFileSync('config/cities.json', 'utf8'));
  assert.deepEqual(Object.keys(CITIES), cfg.cities.map((c) => c.id));
  assert.deepEqual(LANGUAGES, cfg.languages);
  assert.deepEqual(Object.keys(CITIES).sort(), ['buenos_aires', 'chennai', 'hyderabad', 'kolkata', 'madrid', 'mexico_city', 'mumbai', 'paris', 'seoul']);
  const ch = CITIES.chennai;
  assert.deepEqual([ch.country, ch.language, ch.releaseCountry], ['IN', 'ta', 'India']);
  assert.equal(cityStatus(gate({}), 'chennai').live, false, 'unmeasured city stays off');
  assert.equal(cityStatus(gate({ chennai: ALL(6, 6, 6) }), 'chennai').live, true);
  for (const c of cfg.cities) for (const k of ['name', 'localName', 'country', 'releaseCountry', 'countryNames', 'language', 'flag', 'accent', 'header', 'itunesCountry', 'subtitleTip']) assert.ok(c[k], `${c.id}.${k}`);
  for (const c of cfg.cities) assert.ok(LANGUAGES.some((l) => l.id === c.language));
  assert.doesNotMatch(readFileSync('public/app.js', 'utf8'), /const CITIES/, 'client takes cities from /api/cities');
});

test('Chennai TV: Tamil original language + IN origin passes; Telugu from IN does not', async () => {
  const { verifyShow } = await import('../lib/tmdb.js');
  const tmdb = (o) => ({ searchTv: async () => [{ id: 1, name: 'X', original_language: o, origin_country: ['IN'] }] });
  assert.equal((await verifyShow(tmdb('ta'), { name: 'X' }, CITIES.chennai)).ok, true);
  assert.equal((await verifyShow(tmdb('te'), { name: 'X' }, CITIES.chennai)).reason, 'off_language');
});

test('measure script covers every configured city x tv, movie, music', () => {
  const src = readFileSync('scripts/measure.mjs', 'utf8');
  assert.match(src, /Object\.keys\(CITIES\)/); assert.match(src, /CATEGORIES/);
});

test('music tags are the Qloo tag ids found via /v2/tags (see docs/qloo-music-tags.md)', () => {
  const want = { mexico_city: 'mexican', madrid: 'spanish', buenos_aires: 'argentine', seoul: 'k_pop', paris: 'french', chennai: 'tamil' };
  for (const [id, tag] of Object.entries(want)) assert.equal(CITIES[id].musicTag, tag);
  const doc = readFileSync('docs/qloo-music-tags.md', 'utf8');
  for (const tag of Object.values(want)) assert.match(doc, new RegExp(`urn:tag:genre:music:${tag}\\b`));
});

test('measure retries MusicBrainz errors and keeps leftover errors out of the denominator; app stays strict', async () => {
  const names = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: 'q' + i, name: n, tags: [{ id: 'urn:tag:genre:music:k_pop', name: 'K-Pop' }] }));
  const fails = { A: 1, B: 9 }; const calls = {};
  const mb = { searchArtist: async (n) => {
    calls[n] = (calls[n] || 0) + 1;
    if (calls[n] <= (fails[n] || 0)) { const e = new Error('x'); e.status = 502; throw e; }
    return [{ id: n, name: n, score: 100, country: n === 'D' ? 'US' : 'KR' }];
  } };
  const mk = () => createTwinService({ qloo: { insights: async () => names }, tmdb: {}, mb, itunes: { previewForArtist: async () => null } });
  const waits = [];
  const m = await mk().measure({ favourites: FAVS, cityId: 'seoul', category: 'music', sleep: async (ms) => waits.push(ms) });
  assert.deepEqual([m.accepted, m.seen, m.errors, m.pct], [2, 3, 1, 67], 'A recovered on retry, B errored out, D not native');
  assert.deepEqual(waits.slice(0, 3), [1100, 1100, 2200]);
  for (const k in calls) delete calls[k];
  const app = await mk().category({ favourites: FAVS, cityId: 'seoul', category: 'music' });
  assert.equal(calls.A, 1, 'no retry at runtime');
  assert.ok(app.rejected?.some?.((r) => r.reason === 'verify_error') ?? true);
});

test('review 10: getCity uses own keys only; culture lead ranks by pct like the gate', async () => {
  const { getCity } = await import('../lib/cities.js');
  for (const id of ['toString', '__proto__', 'constructor', ['seoul']]) assert.throws(() => getCity(id), (e) => e.status === 400);
  assert.equal(getCity('seoul').id, 'seoul');
  // By counts TV/films (8) would lead; by pct music (5/6 = 83%) does.
  const g = gate({ buenos_aires: { tv: r(15, 8), movie: r(15, 8), music: r(6, 5) } });
  assert.equal(cultureLead(g, 'buenos_aires').text, 'Buenos Aires: music leads');
});
