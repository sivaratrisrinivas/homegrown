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
  const factor = +(0.9 - 0.0045 * p).toFixed(3); // 100% -> 0.45, 0% -> 0.9
  const heavy = p >= 80;
  return { pct: p, heavy, factor, tickEveryPx: heavy ? 18 : 0, label: heavy ? 'strict-native' : 'borderline' };
}
// Releasing midway springs back; once the card has risen OPEN_PX it comes out of the ground.
// A fixed card distance (not the card's height), so even the heaviest pull opens within
// ~310px of finger travel on any card size: heavier = more drag, never unreachable.
export const OPEN_PX = 140;
export const pullOutcome = (moved) => (moved >= OPEN_PX ? 'open' : 'spring');
// How far the sunk card sits below its open position, capped so long cards don't sink forever.
export const sinkDepth = (cardHeight) => Math.min(Math.max(OPEN_PX, (cardHeight || 0) * 0.85), OPEN_PX * 2);
export const dragToOpen = (pct) => Math.ceil(OPEN_PX / resistanceFor(pct).factor);

export const motionPlan = (reduced) => (reduced ? { spring: false, fadeMs: 150, pulse: false } : { spring: true, fadeMs: 0, pulse: true });

// Deterministic pseudo-random from a string, so a city always draws the same map.
export function seeded(str) {
  let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
export const MAP_W = 100, MAP_H = 140;
// Each spot is seeded from its own stable key, so spots never move when other categories land.
export const spotKey = (cityId, p) => `${cityId}|${p?.category ?? ''}|${p?.title ?? ''}`;
export const MIN_SPOT_GAP = 8;
// Spots are placed in key order (not arrival order), each nudged along its own seeded spiral
// until it is at least MIN_SPOT_GAP from every spot already placed. Same set = same layout.
export function pickSpots(picks, cityId) {
  const items = picks.map((p) => ({ key: spotKey(cityId, p), pick: p })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const placed = [];
  for (const it of items) {
    const r = seeded(`spot|${it.key}`); let x = 14 + r() * 72, y = 16 + r() * 110; const a0 = r() * Math.PI * 2;
    const clear = (cx, cy) => placed.every((s) => Math.hypot(s.x - cx, s.y - cy) >= MIN_SPOT_GAP);
    for (let k = 1; k < 400 && !clear(x, y); k++) {
      const rad = MIN_SPOT_GAP * 0.5 * Math.sqrt(k), ang = a0 + k * 2.39996;
      const nx = Math.min(94, Math.max(6, x + rad * Math.cos(ang))), ny = Math.min(134, Math.max(6, y + rad * Math.sin(ang)));
      if (clear(nx, ny)) { x = nx; y = ny; break; }
    }
    placed.push({ ...it, x: +x.toFixed(2), y: +y.toFixed(2) });
  }
  const byKey = new Map(placed.map((s) => [s.key, s]));
  return picks.map((p) => byKey.get(spotKey(cityId, p)));
}
// Same spot = same key, so a re-render mid-walk doesn't count as passing a new pick.
export const sameSpot = (a, b) => Boolean(a && b && a.key === b.key);
// Three lit starter paths so the map is never blank. They are drawn separately (dashed, dimmer),
// never stored in the walk array, and never trimmed by MAX_PATHS.
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
// Every path is an array of [x, y] pairs of finite numbers; anything else falls back to the seeds.
const isPoint = (pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number' && Number.isFinite(n));
export const isValidWalk = (v) => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.every(isPoint));
// Returns only the user's own walked paths ([] when none or invalid); seeds are separate.
// Paths identical to a seed (stored by an older build) are dropped.
export function loadWalk(storage, cityId) {
  let v = null;
  try { v = JSON.parse(storage?.getItem(walkKey(cityId)) || 'null'); } catch {}
  if (!isValidWalk(v)) return [];
  const seeds = new Set(seedPaths(cityId).map((p) => JSON.stringify(p)));
  return v.filter((p) => !seeds.has(JSON.stringify(p)));
}
export function saveWalk(storage, cityId, paths) {
  const trimmed = paths.filter((p) => p.length > 1).slice(-MAX_PATHS).map((p) => p.slice(-MAX_POINTS).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]));
  try { storage?.setItem(walkKey(cityId), JSON.stringify(trimmed)); } catch {}
  return trimmed;
}
// Walks brighten and widen by recency: the newest paths (last in the list) are the widest and brightest.
export const SEED_STYLE = { width: 1, opacity: 0.35, dash: '1.5 2' };
export const pathStyle = (index, total) => ({ width: +(1.2 + Math.min(2.4, (index / Math.max(1, total)) * 2.4)).toFixed(2), opacity: +(0.45 + 0.55 * (index + 1) / Math.max(1, total)).toFixed(2) });
export const nearSpot = ([x, y], spots, radius = 6) => spots.find((s) => Math.hypot(s.x - x, s.y - y) <= radius) || null;
// localStorage can throw on access (privacy modes, sandboxed iframes); read it through a guard.
export function safeStorage(get = () => globalThis.localStorage) { try { return get() || null; } catch { return null; } }
// Map mode: everything picksView shows except the pick cards themselves (those live on the map).
export const mapFraming = (els) => els.filter((el) => !(el?.matches?.('article') || el?.querySelector?.('article')));
