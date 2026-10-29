// Pure UI logic, shared by app.js and the tests.
export const PROMPTS = [
  { kind: 'show', label: "A show you'd rewatch" },
  { kind: 'band', label: 'A band you always come back to' },
  { kind: 'place', label: 'A place you love to eat' },
  { kind: 'book', label: 'A book you pressed on a friend' },
  { kind: 'any', label: 'Wildcard: anything you love' },
];
export const MIN_FAVS = 3, MAX_FAVS = 5;
export const canSkip = (n) => n >= MIN_FAVS && n < MAX_FAVS;
export const QLOO_ORDER = ['tv', 'music', 'place'];
export const MORPH_BUDGET_MS = 8000;

export const FLAP_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Steps a single flap goes through from `from` to `to` (for non-Latin targets, a few random flaps then land).
export function flapSteps(from, to, max = 8) {
  const a = FLAP_CHARS.indexOf(String(from).toUpperCase()), b = FLAP_CHARS.indexOf(String(to).toUpperCase());
  if (a < 0 || b < 0) return [...FLAP_CHARS.slice(1, 4), to];
  const out = []; let i = a;
  while (i !== b && out.length < max - 1) { i = (i + 1) % FLAP_CHARS.length; out.push(FLAP_CHARS[i]); }
  if (out[out.length - 1] !== String(to).toUpperCase()) out.push(to);
  return out.map((c, k) => (k === out.length - 1 ? to : c));
}
export const padTo = (s, n) => [...String(s)].slice(0, n).concat(Array(Math.max(0, n - [...String(s)].length)).fill(' '));

export function rankPicks(byCat) {
  // Hero = first TV pick; then 2nd show, band, podcast, place.
  const tv = byCat.tv?.picks || [];
  const order = [tv[0], tv[1], byCat.music?.picks?.[0], byCat.podcast?.picks?.[0], byCat.place?.picks?.[0]].filter(Boolean);
  return { hero: order[0] || null, rest: order.slice(1) };
}
export function userCountryFromLocale(locale) {
  const m = /[-_]([A-Za-z]{2})\b/.exec(locale || '');
  return m ? m[1].toUpperCase() : 'US';
}
