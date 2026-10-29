import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityStatus, cultureLead, suggestCity, catalogue, loadGate, requireLiveCity } from '../lib/gate.js';
import { createTwinService, WANT, SCARCE_BELOW, CANDIDATES } from '../lib/twin.js';
import { postcardCategories, scarcePicks, cityForLanguage } from '../public/logic.js';
import { FAVS } from './helpers.js';

const r = (seen, accepted) => ({ seen, accepted });
const gate = (results, threshold = 0.6) => ({ threshold, categories: ['tv', 'movie', 'music'], results });

test('captain 1: aim for 5 picks from a Qloo top 15; under 3 is scarce and off the postcard', async () => {
  assert.deepEqual(WANT, { tv: 5, movie: 5, music: 5 }); assert.equal(SCARCE_BELOW, 3); assert.equal(CANDIDATES, 15);
  const qcalls = [];
  const names = Array.from({ length: 15 }, (_, i) => ({ id: 'q' + i, name: 'B' + i, tags: [] }));
  const qloo = { insights: async (a) => { qcalls.push(a); return names; } };
  const mb = { searchArtist: async (n) => (['B1', 'B4'].includes(n) ? [{ id: n, name: n, score: 100, country: 'KR' }] : []) };
  const s = createTwinService({ qloo, tmdb: {}, mb, itunes: { previewForArtist: async () => null } });
  const out = await s.category({ favourites: FAVS, cityId: 'seoul', category: 'music' });
  assert.equal(qcalls[0].take, 15);
  assert.equal(out.picks.length, 2); assert.equal(out.scarce, true);
  assert.match(out.note, /scarce in Seoul.*left off your postcard/);
  const byCat = { tv: { picks: [1, 2, 3, 4, 5].map((t) => ({ t })) }, movie: { picks: [{ t: 'm' }] }, music: out };
  assert.deepEqual(postcardCategories(byCat), ['tv']);
  assert.deepEqual(scarcePicks(byCat).map((p) => p.t || p.title), ['m', 'B1', 'B4']);
});

test('captain 1: measuring run checks every candidate (no early stop, no cap)', async () => {
  const names = Array.from({ length: 15 }, (_, i) => ({ id: 'q' + i, name: 'B' + i, tags: [] }));
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
  for (const c of ['mexico_city', 'seoul', 'paris']) for (const k of ['tv', 'movie', 'music']) assert.ok(g.results[c][k].seen >= 10, 'enough candidates measured');
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
  assert.deepEqual(cat.languages.map((l) => l.id), ['es', 'ko', 'fr']);
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
