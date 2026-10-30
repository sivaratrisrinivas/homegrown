// Pure logic for the ?reveal=map prototype (HG-6). Shared by map.js and the tests; no DOM here.
export const isMapReveal = (search) => new URLSearchParams(search || '').get('reveal') === 'map';

// Native %: postcard (>= 3 strict-local) picks are strict-native; picks from a scarce category,
// or with no recorded origin check, are borderline. Uses the existing pick data unchanged.
export function nativePct(pick, byCat) {
  if (!pick?.verification) return 40;
  const cat = byCat?.[pick.category];
  return cat && !cat.scarce && (cat.picks || []).length >= 3 ? 100 : 60;
}
// Resistance from native %: heavy pull with haptic ticks when strict, light pull when borderline.
// factor = how far the card moves per pixel dragged (lower = heavier).
export function resistanceFor(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const factor = +(0.9 - 0.006 * p).toFixed(3); // 100% -> 0.3, 0% -> 0.9
  const heavy = p >= 80;
  return { pct: p, heavy, factor, tickEveryPx: heavy ? 18 : 0, label: heavy ? 'strict-native' : 'borderline' };
}
// Releasing midway springs back; past the threshold the pick comes out of the ground.
export const OPEN_AT = 0.55;
export const pullOutcome = (moved, travel) => (travel > 0 && moved / travel >= OPEN_AT ? 'open' : 'spring');

export const motionPlan = (reduced) => (reduced ? { spring: false, fadeMs: 150, pulse: false } : { spring: true, fadeMs: 0, pulse: true });

// Deterministic pseudo-random from a string, so a city always draws the same map.
export function seeded(str) {
  let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
export const MAP_W = 100, MAP_H = 140;
export function pickSpots(picks, cityId) {
  const r = seeded(`spots|${cityId}`);
  return picks.map((p, i) => ({ pick: p, x: 14 + r() * 72, y: 16 + ((i + r() * 0.8) / Math.max(1, picks.length)) * 110 }));
}
// Three lit starter paths so the map is never blank.
export function seedPaths(cityId) {
  const r = seeded(`seed|${cityId}`);
  return [0, 1, 2].map((k) => {
    let x = 20 + r() * 60, y = 20 + k * 40 + r() * 10; const pts = [[x, y]];
    for (let i = 0; i < 6; i++) { x = Math.max(4, Math.min(96, x + (r() - 0.5) * 22)); y = Math.max(4, Math.min(136, y + (r() - 0.3) * 10)); pts.push([+x.toFixed(1), +y.toFixed(1)]); }
    return pts;
  });
}

// Walked state, per city, in localStorage. Capped so storage never grows without bound.
export const MAX_PATHS = 40, MAX_POINTS = 200;
export const walkKey = (cityId) => `homegrown:walk:${cityId}`;
export function loadWalk(storage, cityId) {
  try {
    const v = JSON.parse(storage?.getItem(walkKey(cityId)) || 'null');
    if (Array.isArray(v) && v.every((p) => Array.isArray(p))) return v;
  } catch {}
  return seedPaths(cityId);
}
export function saveWalk(storage, cityId, paths) {
  const trimmed = paths.filter((p) => p.length > 1).slice(-MAX_PATHS).map((p) => p.slice(-MAX_POINTS).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]));
  try { storage?.setItem(walkKey(cityId), JSON.stringify(trimmed)); } catch {}
  return trimmed;
}
// Walks brighten and widen the more often they are walked: width grows with how many paths exist.
export const pathStyle = (index, total) => ({ width: +(1.2 + Math.min(2.4, (index / Math.max(1, total)) * 2.4)).toFixed(2), opacity: +(0.45 + 0.55 * (index + 1) / Math.max(1, total)).toFixed(2) });
export const nearSpot = ([x, y], spots, radius = 6) => spots.find((s) => Math.hypot(s.x - x, s.y - y) <= radius) || null;
