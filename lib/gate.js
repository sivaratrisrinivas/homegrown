import { CITIES, UserError } from './cities.js';
import GATE from '../config/gate.json' with { type: 'json' };

// Data-gated cities (captain): a city goes live only if every category reached the threshold
// (60%) of strict-local picks in the measuring run. The numbers live in config/gate.json and are
// written by scripts/measure.mjs; nothing here is hand-tuned per city.
// A static JSON import so the serverless bundler always ships the config.
export function loadGate() { return GATE; }

export function requireLiveCity(gate, cityId) {
  if (!cityStatus(gate, cityId).live) throw new UserError(`City not live yet: ${cityId}`, 403);
}

const pct = (r) => (r && r.seen ? r.accepted / r.seen : 0);

export function cityStatus(gate, cityId) {
  const res = gate.results?.[cityId] || {};
  const perCat = Object.fromEntries(gate.categories.map((c) => [c, { ...res[c], pct: Math.round(100 * pct(res[c])) }]));
  const live = gate.categories.every((c) => res[c]?.seen > 0 && pct(res[c]) >= gate.threshold);
  return { live, perCat };
}

// Which category Qloo surfaced the most native picks for: computed from the measured counts only.
const LEAD_WORD = { tv: 'dramas', movie: 'films', music: 'music' };
export function cultureLead(gate, cityId) {
  const res = gate.results?.[cityId];
  if (!res) return null;
  const ranked = gate.categories.filter((c) => res[c]?.seen).map((c) => [c, res[c].accepted]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] === 0) return null;
  // Ties share the lead; still computed from the counts, never chosen by hand.
  const top = ranked.filter(([, n]) => n === ranked[0][1]).map(([c]) => c);
  const words = top.map((c) => LEAD_WORD[c]);
  const verb = top.length === 1 && top[0] === 'music' ? 'leads' : 'lead';
  return { categories: top, text: `${CITIES[cityId].name}: ${words.join(' and ')} ${verb}` };
}

export const LANGUAGES = [
  { id: 'es', name: 'Spanish', local: 'Español' },
  { id: 'ko', name: 'Korean', local: '한국어' },
  { id: 'fr', name: 'French', local: 'Français' },
];

// Best city for a language: the live city with the highest weakest-category %. null if none is live.
export function suggestCity(gate, languageId) {
  const cands = Object.values(CITIES).filter((c) => c.language === languageId).map((c) => {
    const s = cityStatus(gate, c.id);
    return { id: c.id, name: c.name, live: s.live, floor: Math.min(...Object.values(s.perCat).map((x) => x.pct)) };
  });
  const live = cands.filter((c) => c.live).sort((a, b) => b.floor - a.floor);
  return { city: live[0]?.id || null, candidates: cands };
}

export function catalogue(gate) {
  return {
    threshold: gate.threshold, measuredAt: gate.measuredAt,
    languages: LANGUAGES.map((l) => ({ ...l, suggested: suggestCity(gate, l.id).city })),
    cities: Object.values(CITIES).map((c) => ({ id: c.id, language: c.language, ...cityStatus(gate, c.id), lead: cultureLead(gate, c.id) })),
  };
}
