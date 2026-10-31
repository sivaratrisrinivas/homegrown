import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMovie, verifySuggestedFilm, originCountries, isNativeFilm } from '../lib/tmdb.js';

// Real TMDB 466272 (2026-10-31): origin_country ['US'], production_countries CN, GB, US.
const OUATIH = { id: 466272, title: 'Once Upon a Time... in Hollywood', original_title: 'Once Upon a Time... in Hollywood', original_language: 'en', release_date: '2019-07-24' };
const fake = (row, details) => ({ searchMovie: async () => [row], movieDetails: async () => details });
const LONDON = { id: 'london', language: 'en', country: 'GB' };

test('HG-14: OUATIH (US film, UK co-production) is not native to London', async () => {
  const v = await verifyMovie(fake(OUATIH, { origin_country: ['US'], production_countries: [{ iso_3166_1: 'CN' }, { iso_3166_1: 'GB' }, { iso_3166_1: 'US' }] }), { name: OUATIH.title, year: 2019 }, LONDON);
  assert.equal(v.ok, false); assert.equal(v.reason, 'not_native'); assert.deepEqual(v.origin, ['US']);
});

test('HG-14: native = origin_country includes the city country; production_countries only when origin_country is empty', async () => {
  assert.deepEqual(originCountries({ origin_country: ['US', 'GB'], production_countries: [{ iso_3166_1: 'FR' }] }), ['US', 'GB']);
  assert.deepEqual(originCountries({ origin_country: [], production_countries: [{ iso_3166_1: 'US' }, { iso_3166_1: 'GB' }] }), ['US', 'GB']);
  assert.deepEqual(originCountries({}), []);
  assert.equal(isNativeFilm({ origin_country: ['US', 'GB'] }, 'GB'), true);
  assert.equal(isNativeFilm({ origin_country: ['US'], production_countries: [{ iso_3166_1: 'GB' }] }, 'GB'), false);
  const brit = { ...OUATIH, title: 'Paddington', original_title: 'Paddington' };
  assert.equal((await verifyMovie(fake(brit, { origin_country: ['FR', 'GB'] }), { name: 'Paddington' }, LONDON)).ok, true);
  assert.equal((await verifyMovie(fake(brit, { production_countries: [{ iso_3166_1: 'US' }, { iso_3166_1: 'GB' }] }), { name: 'Paddington' }, LONDON)).ok, true);
  assert.equal((await verifyMovie(fake(brit, { origin_country: ['US'], production_countries: [{ iso_3166_1: 'GB' }] }), { name: 'Paddington' }, LONDON)).ok, false);
});

test('HG-14: language check unchanged; AI-suggest path uses the same origin rule', async () => {
  assert.equal((await verifyMovie(fake({ ...OUATIH, original_language: 'fr' }, { origin_country: ['GB'] }), { name: OUATIH.title }, LONDON)).reason, 'off_language');
  const kn = { id: 1, title: 'Film', original_title: 'Film', original_language: 'kn', release_date: '2020-01-01' };
  const co = await verifySuggestedFilm({ searchMovie: async () => [kn], movieDetails: async () => ({ origin_country: ['US', 'IN'] }) }, { title: 'Film', year: 2020 }, { language: 'kn', country: 'IN' });
  assert.equal(co.ok, true);
  const us = await verifySuggestedFilm({ searchMovie: async () => [kn], movieDetails: async () => ({ origin_country: ['US'], production_countries: [{ iso_3166_1: 'IN' }] }) }, { title: 'Film', year: 2020 }, { language: 'kn', country: 'IN' });
  assert.equal(us.reason, 'not_native');
  const empty = await verifySuggestedFilm({ searchMovie: async () => [kn], movieDetails: async () => ({ origin_country: [], production_countries: [{ iso_3166_1: 'IN' }] }) }, { title: 'Film', year: 2020 }, { language: 'kn', country: 'IN' });
  assert.equal(empty.ok, true);
});
