import { CITIES, LANGUAGES, UserError } from './cities.js';
import GATE from '../config/gate.json' with { type: 'json' };

// Data-gated cities (captain): a city goes live only if every category reached the threshold
// (60%) of strict-local picks in the measuring run. The numbers live in config/gate.json and are
// written by scripts/measure.mjs; nothing here is hand-tuned per city.
// A static JSON import so the serverless bundler always ships the config.
export function loadGate() { return GATE; }

// v1 switch (config/gate.json `liveCategories`): which categories are served and judged for liveness.
// Measured categories (`categories`) stay in the gate so TV/music can return without code changes.
export const liveCategories = (gate) => (Array.isArray(gate.liveCategories) && gate.liveCategories.length ? gate.liveCategories : gate.categories);

export function requireLiveCategory(gate, category) {
  if (typeof category !== 'string' || !liveCategories(gate).includes(category)) throw new UserError(`Category not live yet: ${category}`, 403);
}

export function requireLiveCity(gate, cityId) {
  if (typeof cityId !== 'string' || !Object.hasOwn(CITIES, cityId) || !cityStatus(gate, cityId).live) throw new UserError(`City not live yet: ${cityId}`, 403);
}

const pct = (r) => (r && r.seen ? r.accepted / r.seen : 0);

export function cityStatus(gate, cityId) {
  const res = gate.results?.[cityId] || {};
  const perCat = Object.fromEntries(gate.categories.map((c) => [c, { ...res[c], pct: Math.round(100 * pct(res[c])) }]));
  // HG-9: the language filter can leave a tiny pool (e.g. 2/2), so a category also needs minSeen measured candidates.
  const minSeen = Math.max(1, gate.minSeen || 1);
  const live = liveCategories(gate).every((c) => res[c]?.seen >= minSeen && pct(res[c]) >= gate.threshold);
  return { live, perCat };
}

// Which category Qloo surfaced the most native picks for: computed from the measured counts only.
const LEAD_WORD = { tv: 'dramas', movie: 'films', music: 'music' };
export function cultureLead(gate, cityId) {
  const res = gate.results?.[cityId];
  if (!res) return null;
  // Ranked by native % (accepted/seen), the same measure the gate uses, rounded to whole percent.
  const ranked = liveCategories(gate).filter((c) => res[c]?.seen).map((c) => [c, Math.round((100 * res[c].accepted) / res[c].seen)]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] === 0) return null;
  // Ties share the lead; still computed from the counts, never chosen by hand.
  const top = ranked.filter(([, n]) => n === ranked[0][1]).map(([c]) => c);
  const words = top.map((c) => LEAD_WORD[c]);
  const verb = top.length === 1 && top[0] === 'music' ? 'leads' : 'lead';
  return { categories: top, text: `${CITIES[cityId].name}: ${words.join(' and ')} ${verb}` };
}

// Best city for a language: the live city with the highest weakest-category %. null if none is live.
export function suggestCity(gate, languageId) {
  const cands = Object.values(CITIES).filter((c) => c.language === languageId).map((c) => {
    const s = cityStatus(gate, c.id);
    return { id: c.id, name: c.name, live: s.live, floor: Math.min(...liveCategories(gate).map((k) => s.perCat[k]?.pct ?? 0)) };
  });
  const live = cands.filter((c) => c.live).sort((a, b) => b.floor - a.floor);
  return { city: live[0]?.id || null, candidates: cands.sort((a, b) => b.live - a.live || b.floor - a.floor) };
}

// Thin pools: a calm, honest note driven by the measured gate data (any city, never hard-coded).
export const THIN_SEEN = 10, THIN_SHARE = 0.3;
const THIN_NOUN = { tv: 'shows', movie: 'films', music: 'songs' };
export function thinNote(gate, cityId) {
  const city = CITIES[cityId]; const res = gate.results?.[cityId] || {};
  const thin = liveCategories(gate).filter((k) => res[k] && (res[k].seen < THIN_SEEN || (res[k].languageShare ?? 1) < THIN_SHARE));
  if (!thin.length) return null;
  const lang = LANGUAGES.find((l) => l.id === city.language)?.name || '';
  return `Fewer ${lang} ${thin.map((k) => THIN_NOUN[k]).join(' and ')} to draw from, so you may see only a few picks.`;
}

export function catalogue(gate) {
  return {
    threshold: gate.threshold, measuredAt: gate.measuredAt, categories: liveCategories(gate),
    // v1 shows only languages with at least one live city; the rest are 'coming soon'.
    languages: LANGUAGES.map((l) => { const s = suggestCity(gate, l.id); return { ...l, suggested: s.city, live: !!s.city, liveCities: s.candidates.filter((c) => c.live).map((c) => c.id) }; }),
    cities: Object.values(CITIES).map((c) => ({
      id: c.id, name: c.name, local: c.localName, flag: c.flag, accent: c.accent, header: c.header, language: c.language,
      ...cityStatus(gate, c.id),
      // A lead needs two categories to compare; with one live category it is hidden.
      lead: liveCategories(gate).length > 1 ? cultureLead(gate, c.id) : null,
      thinNote: thinNote(gate, c.id),
    })),
  };
}
