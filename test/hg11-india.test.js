import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestSeedMatch } from '../lib/qloo.js';
import { loadGate, catalogue, cityStatus, thinNote } from '../lib/gate.js';
import { liftCities } from './helpers.js';
import { indiaGroups, matchState, indiaLabel, meanwhileHint, matchStatus, indiaSection } from '../public/india.js';

test('HG-11 seed: exact title beats a longer first result (Parasite, not Parasite Dolls)', () => {
  const res = [{ id: 'a', name: 'Parasite Dolls', popularity: 0.5 }, { id: 'b', name: 'Parasite', popularity: 0.99 }, { id: 'c', name: 'Parasite', popularity: 0.2 }];
  assert.equal(bestSeedMatch(res, 'Parasite').id, 'b', 'exact match, most popular');
  assert.equal(bestSeedMatch(res, 'parasite ').id, 'b', 'case/space-insensitive');
  assert.equal(bestSeedMatch([{ id: 'x', name: 'Foo 2', popularity: 0.1 }, { id: 'y', name: 'Foo III', popularity: 0.9 }], 'Foo').id, 'y', 'no exact: most popular');
  assert.equal(bestSeedMatch([], 'Foo'), null);
});

test('HG-11 seed: names that both normalise to empty are not an exact match', () => {
  const res = [{ id: 'ko', name: '기생충', popularity: 0.1 }, { id: 'pop', name: 'Parasite', popularity: 0.9 }];
  assert.equal(bestSeedMatch(res, '!!!').id, 'pop', 'empty query falls back to most popular');
  assert.equal(bestSeedMatch(res, '기생충').id, 'pop', 'non-Latin query is not "exactly" another non-Latin name');
});

test('HG-11 config: Kochi and Amritsar are live from the committed gate; Amritsar has the thin-pool note', () => {
  const g = loadGate();
  assert.equal(cityStatus(g, 'kochi').live, true);
  assert.equal(cityStatus(g, 'amritsar').live, true);
  assert.equal(thinNote(g, 'kochi'), null);
  assert.match(thinNote(g, 'amritsar'), /Punjabi/);
});

const G = () => indiaGroups(catalogue(loadGate()));
// HG-14: Kolkata (Bengali) is gated today; this fixture is the gate once it passes again.
const GK = () => indiaGroups(catalogue(liftCities(loadGate(), ['kolkata'])));

test('HG-11 India picker: live languages with states; coming soon vs not supported are separate', () => {
  const g = G();
  assert.deepEqual(g.live.map((l) => l.id).sort(), ['hi', 'ml', 'pa', 'ta', 'te'], 'HG-14: Bengali hidden while Kolkata is gated');
  assert.deepEqual(GK().live.map((l) => l.id).sort(), ['bn', 'hi', 'ml', 'pa', 'ta', 'te'], 'Bengali returns once Kolkata passes');
  assert.equal(indiaLabel(g.live.find((l) => l.id === 'te')), 'Telugu, Andhra Pradesh & Telangana');
  assert.deepEqual(g.soon.map((l) => l.id).sort(), ['as', 'gu', 'kn', 'ks', 'mr', 'ne', 'or']);
  assert.deepEqual(g.unsupported.map((l) => l.id).sort(), ['bho', 'kha', 'kok', 'lus', 'mni', 'tcy']);
  assert.ok(!g.live.some((l) => ['es', 'ko', 'fr'].includes(l.id)), 'non-Indian languages stay out');
});

test('HG-11 India picker: Hindi lists only Hindi-majority states; stateless states get one hint', () => {
  const g = G();
  const hi = g.live.find((l) => l.id === 'hi').states;
  for (const s of ['Maharashtra', 'Jammu & Kashmir', 'Ladakh', 'Arunachal Pradesh', 'Nagaland', 'Andaman & Nicobar Islands']) assert.ok(!hi.includes(s), s);
  const m = matchState(g, 'nagaland');
  assert.equal(m.live.length + m.soon.length + m.unsupported.length, 0);
  assert.equal(meanwhileHint(m), 'No film language for your state yet, try Hindi meanwhile.');
  assert.equal(matchStatus(m), '0 languages match');
});

test('HG-11 India picker: state search, live status, one meanwhile hint with the nearest live language', () => {
  const g = G();
  assert.deepEqual(matchState(g, 'kerala').live.map((l) => l.id), ['ml']);
  const k = matchState(g, 'karnataka');
  assert.deepEqual([k.soon.map((l) => l.id), k.unsupported.map((l) => l.id)], [['kn'], ['tcy']]);
  assert.equal(matchStatus(k), '2 languages match');
  assert.equal(meanwhileHint(k), 'Try Hindi meanwhile.');
  // Assamese points to Bengali only while Bengali is live (HG-14: Kolkata gated today -> Hindi).
  assert.equal(meanwhileHint(matchState(g, 'assam')), 'Try Hindi meanwhile.');
  assert.equal(meanwhileHint(matchState(GK(), 'assam')), 'Try Bengali for Assamese, meanwhile.');
  assert.equal(meanwhileHint(matchState(g, 'kerala')), null, 'no hint when everything shown is live');
  assert.equal(matchStatus(matchState(g, 'telangana')), '1 language matches');
});

test('HG-11 India picker: stateless hint only when no language row matches; unsupported-only copy', () => {
  const g = G();
  const p = matchState(g, 'pradesh');
  assert.ok(p.live.length > 0);
  assert.equal(p.stateless, false);
  assert.notEqual(meanwhileHint(p), 'No film language for your state yet, try Hindi meanwhile.');
  assert.equal(meanwhileHint(matchState(g, 'goa')), "We can't match films in this language yet. Try Hindi meanwhile.");
  assert.equal(meanwhileHint(matchState(g, 'maharashtra')), 'Try Hindi meanwhile.');
});

// Minimal DOM stand-in, enough for indiaSection.
function stubH(tag, attrs = {}, ...kids) {
  const el = { tag, attrs: {}, children: [], listeners: {}, textContent: '',
    addEventListener(t, f) { this.listeners[t] = f; },
    replaceChildren(...k) { this.children = k.flat().filter((x) => x != null); } };
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('on')) el.listeners[k.slice(2)] = v; else if (v != null) el.attrs[k] = v;
  el.children = kids.flat().filter((x) => x != null);
  return el;
}
const walk = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); for (const c of el.children || []) walk(c, out); } return out; };

test('HG-11 India picker render: lang= on native names, no aria-disabled, polite status, one hint', () => {
  const picked = [];
  const sec = indiaSection(catalogue(loadGate()), { h: stubH, onPick: (l) => picked.push(l.id) });
  const all = walk(sec);
  const natives = all.filter((e) => e.attrs.class === 'india-local');
  // 5 live + 7 coming soon + 6 not supported (HG-14: Bengali hidden while Kolkata is gated).
  assert.ok(natives.length >= 18 && natives.every((e) => e.attrs.lang));
  assert.ok(all.every((e) => !('aria-disabled' in e.attrs)));
  const status = all.find((e) => e.attrs.role === 'status');
  assert.equal(status.attrs['aria-live'], 'polite');
  assert.equal(status.textContent, '18 languages match');
  assert.equal(all.filter((e) => e.attrs.class?.includes('india-hint')).length, 1);
  all.find((e) => e.tag === 'button').listeners.click();
  assert.equal(picked.length, 1);
  const input = all.find((e) => e.tag === 'input');
  input.value = 'nagaland'; input.listeners.input();
  assert.equal(status.textContent, '0 languages match');
  assert.match(all.find((e) => e.attrs.class?.includes('india-hint')).textContent, /No film language for your state yet/);
  assert.doesNotMatch(readFileSync('public/styles.css', 'utf8').split('HG-11')[1], /opacity/);
});

test('HG-12: no hint at all when the search results include a live language', () => {
  const g = G();
  const p = matchState(g, 'pradesh');
  assert.ok(p.live.length > 0 && p.unsupported.length + p.soon.length > 0, 'pradesh mixes live and waiting rows');
  assert.equal(meanwhileHint(p), null);
  for (const q of ['telangana', 'kerala', 'punjab']) assert.equal(meanwhileHint(matchState(g, q)), null, q);
});
