import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwinService, POOL, CANDIDATES, nativeRate } from '../lib/twin.js';
import { musicLanguageSignal } from '../lib/musicbrainz.js';
import { verifyShow, verifyMovie } from '../lib/tmdb.js';
import { CITIES, LANGUAGES } from '../lib/cities.js';
import { cityStatus, loadGate } from '../lib/gate.js';
import { FAVS } from './helpers.js';

const g = (slug) => ({ id: `urn:tag:genre:music:${slug}`, name: slug });
const KOL = { id: 'kolkata', name: 'Kolkata', localName: 'কলকাতা', country: 'IN', language: 'bn', countryNames: ['india'], musicLanguageTags: ['bengali', 'bangla'], musicConflictTags: ['hindi', 'bollywood', 'tamil'] };

test('HG-9 music: a language tag is required; country alone is not enough', () => {
  assert.equal(musicLanguageSignal({ tags: [g('indian')] }, KOL).ok, false, 'Indian but no Bengali signal');
  assert.equal(musicLanguageSignal({ tags: [g('bengali'), g('indian')] }, KOL).ok, true);
  assert.equal(musicLanguageSignal({ tags: [g('bangla_rock')] }, KOL).ok, true, 'prefix stem match');
  assert.equal(musicLanguageSignal({ tags: [g('bengalis')] }, KOL).ok, false, 'no loose substring match');
  assert.equal(musicLanguageSignal({ tags: [{ id: 'urn:tag:keyword:qloo:bengali', name: 'b' }] }, KOL).ok, false, 'only genre tags count');
});

test('HG-9 music: another language of the same country is a conflict (Vishal Dadlani in Kolkata)', () => {
  const r = musicLanguageSignal({ tags: [g('hindi'), g('bengali'), g('bollywood')] }, KOL);
  assert.equal(r.ok, false); assert.deepEqual(r.conflict, ['hindi', 'bollywood']);
});

test('HG-9 music: language filter runs on the Qloo pool before the top 15 and before MusicBrainz', async () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'h' + i, name: 'Hindi' + i, tags: [g('hindi')] })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, name: 'Tamil' + i, tags: [g('tamil')] })),
  ];
  const asked = []; const calls = [];
  const qloo = { insights: async (a) => { calls.push(a); return pool; } };
  const mb = { searchArtist: async (n) => { asked.push(n); return [{ id: n, name: n, score: 100, country: 'IN' }]; } };
  const s = createTwinService({ qloo, tmdb: {}, mb, itunes: { previewForArtist: async () => null } });
  const m = await s.measure({ favourites: FAVS, cityId: 'chennai', category: 'music' });
  assert.equal(calls[0].take, POOL); assert.equal(calls[0].extra['filter.tags'], 'urn:tag:genre:music:tamil');
  assert.equal(asked.length, CANDIDATES); assert.ok(asked.every((n) => n.startsWith('Tamil')));
  assert.deepEqual([m.seen, m.accepted, m.filtered], [15, 15, 10]);
});

const tv = (rows) => ({ searchTv: async (q) => rows.filter((r) => r.name === q) });
const show = (name, lang, cc = ['IN']) => ({ id: name, name, original_language: lang, origin_country: cc });

test('HG-9 TV: language is checked before country; Hindi from India is off_language in Chennai', async () => {
  const t = tv([show('A', 'hi'), show('B', 'ta', ['LK']), show('C', 'ta')]);
  assert.equal((await verifyShow(t, { name: 'A' }, CITIES.chennai)).reason, 'off_language');
  assert.equal((await verifyShow(t, { name: 'B' }, CITIES.chennai)).reason, 'not_native', 'Tamil but Sri Lankan');
  assert.equal((await verifyShow(t, { name: 'C' }, CITIES.chennai)).ok, true);
  const mv = { searchMovie: async () => [{ id: 1, title: 'M', original_language: 'hi' }], movieDetails: async () => { throw new Error('not needed'); } };
  assert.equal((await verifyMovie(mv, { name: 'M' }, CITIES.chennai)).reason, 'off_language');
});

test('HG-9 TV: Qloo pool of 50 with the language tag; top 15 counted only from the language-matched pool', async () => {
  const names = [...Array.from({ length: 20 }, (_, i) => 'H' + i), 'Nope', ...Array.from({ length: 25 }, (_, i) => 'T' + i)];
  const rows = [...names.filter((n) => n[0] === 'H').map((n) => show(n, 'hi')), ...names.filter((n) => n[0] === 'T').map((n, i) => show(n, 'ta', i % 5 === 0 ? ['LK'] : ['IN']))];
  const calls = []; const searched = [];
  const qloo = { insights: async (a) => { calls.push(a); return names.map((n) => ({ id: n, name: n, tags: [] })); } };
  const tmdb = { ...tv(rows), searchTv: async (q) => { searched.push(q); return rows.filter((r) => r.name === q); }, watchProviders: async () => ({}) };
  const s = createTwinService({ qloo, tmdb, mb: {}, itunes: {} });
  const m = await s.measure({ favourites: FAVS, cityId: 'chennai', category: 'tv' });
  assert.equal(calls[0].take, POOL);
  assert.equal(calls[0].extra['signal.interests.tags'], 'urn:tag:keyword:qloo:tamil_cinema');
  assert.equal(calls[0].extra['filter.release_country'], 'India');
  assert.equal(m.seen, CANDIDATES, 'exactly 15 language-matched candidates measured');
  assert.equal(m.accepted, 12, 'T0, T5, T10 are Tamil but not Indian');
  assert.equal(m.filtered, 21, '20 Hindi + 1 no TMDB match never enter the 15');
  assert.ok(!searched.includes('T15'), 'stops after the 15th language match');
});

test('HG-9: prefilter reasons stay out of the native rate', () => {
  assert.deepEqual(nativeRate([{}], [{ reason: 'off_language' }, { reason: 'no_tmdb_match' }, { reason: 'not_native' }]), { seen: 2, accepted: 1, pct: 50 });
});

test('HG-9 config: every city has music language tags; Indian cities list the other languages as conflicts', () => {
  for (const id of ['hi', 'ta', 'es', 'ko', 'fr']) assert.ok(LANGUAGES.some((l) => l.id === id), id);
  for (const c of Object.values(CITIES)) {
    assert.ok(c.musicLanguageTags?.length, `${c.id}.musicLanguageTags`);
    for (const t of c.musicConflictTags || []) assert.ok(!c.musicLanguageTags.includes(t), `${c.id} conflicts with itself: ${t}`);
    if (c.country === 'IN') assert.ok(c.musicConflictTags?.length && c.screenTag, c.id);
  }
});

test('HG-9 gate: a tiny language-filtered pool (2/2) is not enough to go live', () => {
  const r = (seen, accepted) => ({ seen, accepted });
  const g = { threshold: 0.6, minSeen: 5, categories: ['tv', 'movie', 'music'], results: { x: { tv: r(2, 2), movie: r(15, 15), music: r(15, 12) }, y: { tv: r(5, 3), movie: r(15, 15), music: r(15, 12) } } };
  assert.equal(cityStatus(g, 'x').live, false); assert.equal(cityStatus(g, 'y').live, true);
});

test('HG-9 measured gate: Mumbai is live; Chennai stays gated (TV pool of 4)', () => {
  const g = loadGate();
  for (const id of ['mexico_city', 'madrid', 'buenos_aires', 'seoul', 'paris', 'mumbai']) assert.equal(cityStatus(g, id).live, true, id);
  assert.equal(cityStatus(g, 'chennai').live, false);
  assert.equal(CITIES.mumbai.language, 'hi');
});
