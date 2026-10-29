import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podcastOrigin, createTwinService } from '../lib/twin.js';
import { CITIES } from '../lib/cities.js';
import { FAVS } from './helpers.js';

const { mexico_city: MX, seoul: KR, paris: FR } = CITIES;

test('strict podcast origin: region subtag must match the city', () => {
  for (const [lang, city] of [['es-MX', MX], ['es_mx', MX], ['ES-mx', MX], ['ko-KR', KR], ['ko_kr', KR], ['fr-FR', FR], [' fr-fr ', FR]]) {
    assert.deepEqual(podcastOrigin(lang, city), { ok: true }, lang);
  }
  assert.equal(podcastOrigin('es', MX).reason, 'no_region_subtag');
  assert.equal(podcastOrigin('ko', KR).reason, 'no_region_subtag');
  assert.equal(podcastOrigin('fr', FR).reason, 'no_region_subtag');
  assert.equal(podcastOrigin('es-ES', MX).reason, 'wrong_region');
  assert.equal(podcastOrigin('es-AR', MX).reason, 'wrong_region');
  assert.equal(podcastOrigin('fr-CA', FR).reason, 'wrong_region');
  assert.equal(podcastOrigin('en-MX', MX).reason, 'not_native');
  assert.equal(podcastOrigin(null, MX).reason, 'no_language_tag');
});

test('podcast category never pads with language-only or wrong-region feeds', async () => {
  const pods = ['es', 'es-ES', 'es-AR', 'en-US'].map((l, i) => ({ collectionId: i, collectionName: 'P' + i, feedUrl: l }));
  const s = createTwinService({ qloo: {}, itunes: { searchPodcasts: async () => pods, feedLanguage: async (u) => u } });
  const r = await s.category({ favourites: FAVS, cityId: 'mexico_city', category: 'podcast' });
  assert.equal(r.picks.length, 0);
  assert.ok(r.note);
  assert.deepEqual(r.rejected.map((x) => x.reason), ['no_region_subtag', 'wrong_region', 'wrong_region', 'not_native']);
  const ok = createTwinService({ qloo: {}, itunes: { searchPodcasts: async () => [...pods, { collectionId: 9, collectionName: 'Nativo', feedUrl: 'es-MX' }], feedLanguage: async (u) => u } });
  const r2 = await ok.category({ favourites: FAVS, cityId: 'mexico_city', category: 'podcast' });
  assert.deepEqual(r2.picks.map((p) => p.title), ['Nativo']);
});
