// Pure UI logic, shared by app.js and the tests.
export const PROMPTS = [
  { kind: 'show', label: "A show you'd rewatch" },
  { kind: 'band', label: 'A band you always come back to' },
  { kind: 'movie', label: 'A film you could quote' },
  { kind: 'book', label: 'A book you pressed on a friend' },
  { kind: 'any', label: 'Wildcard: anything you love' },
];
export const MIN_FAVS = 3, MAX_FAVS = 5;
export const canSkip = (n) => n >= MIN_FAVS && n < MAX_FAVS;
export const QLOO_ORDER = ['tv', 'movie', 'music'];
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

export const SCARCE_BELOW = 3;
// Postcard = the categories with at least 3 strict-local picks; scarce ones are shown but left off.
export const isScarce = (r) => !r || (r.picks || []).length < SCARCE_BELOW;
export const postcardCategories = (byCat) => QLOO_ORDER.filter((c) => byCat[c] && !isScarce(byCat[c]));

export function rankPicks(byCat) {
  // Hero = first pick of the first postcard category; then the rest of the postcard, category by category.
  const order = postcardCategories(byCat).flatMap((c) => byCat[c].picks);
  return { hero: order[0] || null, rest: order.slice(1) };
}
export const scarcePicks = (byCat) => QLOO_ORDER.filter((c) => byCat[c] && isScarce(byCat[c])).flatMap((c) => byCat[c].picks || []);

// Step 1 is the language; step 2 is the suggested live city for it (from /api/cities).
export function cityForLanguage(catalogue, languageId) {
  const lang = catalogue.languages.find((l) => l.id === languageId);
  if (!lang?.suggested) return null;
  return catalogue.cities.find((c) => c.id === lang.suggested && c.live) || null;
}
export function liveCitiesForLanguage(catalogue, languageId) {
  const lang = catalogue.languages.find((l) => l.id === languageId);
  return (lang?.liveCities || []).map((id) => catalogue.cities.find((c) => c.id === id && c.live)).filter(Boolean);
}
export const languageGroups = (catalogue) => ({ live: catalogue.languages.filter((l) => l.live), soon: catalogue.languages.filter((l) => !l.live) });
export function userCountryFromLocale(locale) {
  const m = /[-_]([A-Za-z]{2})\b/.exec(locale || '');
  return m ? m[1].toUpperCase() : 'US';
}
// Generation guard: responses from an older run (e.g. a previous city) are ignored.
export function createRunGuard() {
  let gen = 0;
  return { start() { const my = ++gen; return () => my === gen; } };
}

// Option A (captain decision): every Qloo-backed request from this browser is serialised and
// spaced >= 7 s apart, so separate serverless instances can't burst Qloo together.
export const CLIENT_QLOO_GAP_MS = 7000;
export function createSpacer({ gapMs = CLIENT_QLOO_GAP_MS, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity, chain = Promise.resolve();
  return (fn) => {
    const p = chain.then(async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      let out = SKIP;
      try { out = await fn(); return out; } finally { if (out !== SKIP) last = now(); }
    });
    chain = p.catch(() => {});
    return p;
  };
}
// Return SKIP from a gated fn when no request was sent; it then doesn't push back the next slot.
export const SKIP = Symbol('skip');
// Client-side memo so repeat queries, favourites and cities never re-hit the network.
export function createMemo() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => { if (m.size > 300) m.delete(m.keys().next().value); m.set(k, v); } };
}
export const searchKey = (kind, q) => `${kind}|${q.trim().toLowerCase()}`;
export const twinClientKey = (favs, city, category, uc) => `${city}|${category}|${uc}|${favs.map((f) => f.id).sort().join(',')}`;

// Runs categories in order; a thrown request lands as {ok:false} so later categories still run.
export async function runCategories(order, request, land) {
  for (const cat of order) {
    let r;
    try { r = await request(cat); } catch { r = { ok: false, body: {} }; }
    land(cat, r);
  }
}

// A stale city run returns SKIP inside the gate, so it spends no Qloo call and doesn't push back the next slot.
export async function gatedIfCurrent(gate, isCurrent, send) {
  const r = await gate(() => (isCurrent() ? send() : SKIP));
  return r === SKIP ? { ok: false, stale: true, body: {} } : r;
}

// Incomplete answers (a check errored or hit the deadline) are not memoised, so a retry asks again.
export const shouldMemoTwin = (r) => Boolean(r?.ok && !r.body?.incomplete);

// Optional view parts are passed as null; drop them, or replaceChildren would render the text 'null'.
export const present = (els) => els.flat().filter((e) => e != null && e !== false);
// Typeahead is cheap (no Qloo), so a short debounce keeps it snappy without a request per key.
export const DEBOUNCE_MS = 250;
const nm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// The Qloo entity for a chosen suggestion: exact name, and the same year when both have one.
// Never falls back to an unrelated first result.
export function bestQlooMatch(results, { name, year }) {
  const same = results.filter((r) => nm(r.name) === nm(name));
  // No name match means Qloo doesn't know this title: return null so the user is asked for another.
  return same.find((r) => !year || !r.year || r.year === year) || same[0] || null;
}

// Pending favourites become real ones only with a valid Qloo id; the user's chosen name is kept.
// Identity of a picked suggestion, so the same pick can't be added twice.
export const pickKey = (kind, name, year) => `${kind}|${String(name || '').trim().toLowerCase()}|${year || ''}`;
export const isPicked = (pick, favs, pending) => [...favs, ...pending].some((f) => f.pick === pick);

// A Qloo lookup that couldn't be done (HTTP error, network error, timeout). Distinct from null,
// which means Qloo answered and doesn't know the title.
export const LOOKUP_FAILED = Object.freeze({ failed: true });
export const QLOO_LOOKUP_TIMEOUT_MS = 15000;
export function lookupOutcome(r, sug) {
  if (!r || !r.ok) return LOOKUP_FAILED;
  return bestQlooMatch(r.body?.results || [], sug);
}
export const matchingProgress = (done, total) => `Matching ${Math.min(done + 1, total)} of ${total}`;

export function settleFavourites(favs, pending, matches) {
  const out = [...favs]; const missed = []; const missedKeys = []; const failed = []; const ids = new Set(favouriteIds(favs));
  for (const f of pending) {
    const m = matches.get(f.key);
    if (m === LOOKUP_FAILED || m?.failed) { failed.push(f); continue; } // keep the pick; let the user retry
    if (!(m && typeof m.id === 'string' && m.id)) { missed.push(f.name); missedKeys.push(f.key); continue; }
    if (ids.has(m.id)) continue; // two picks resolved to the same Qloo entity: keep the first
    ids.add(m.id);
    out.push({ id: m.id, name: f.name, pick: f.pick, tags: Array.isArray(m.tags) ? m.tags : [] });
  }
  return { favs: out, missed, missedKeys, failed };
}
export const favouriteIds = (favs) => favs.map((f) => f.id).filter((id) => typeof id === 'string' && id);

// HG-10: the single journey asks for exactly 3 favourites. `category` is config.js CATEGORY.
// Single-category: three prompts of that kind, one Qloo category, header "Your TV self, in Madrid".
// 'mixed' (default until HG-9): today's show / band / film prompts and every Qloo category.
export const JOURNEY_FAVS = 3;
const SINGLE = {
  tv: { kind: 'show', noun: 'TV', labels: ["A show you'd rewatch", 'Another show you love', 'One more show'], examples: ['e.g. Breaking Bad', 'e.g. Fleabag', 'e.g. Dark'] },
  movie: { kind: 'movie', noun: 'film', labels: ['A film you could quote', 'Another film you love', 'One more film'], examples: ['e.g. Amélie', 'e.g. Parasite', 'e.g. Spirited Away'] },
  music: { kind: 'band', noun: 'music', labels: ['A band you always come back to', 'Another artist you love', 'One more artist'], examples: ['e.g. Radiohead', 'e.g. Daft Punk', 'e.g. Bad Bunny'] },
};
const MIXED_EXAMPLES = ['e.g. Breaking Bad', 'e.g. Radiohead', 'e.g. Amélie'];
export function journeyFor(category) {
  const s = SINGLE[category];
  if (!s) return { single: false, category: 'mixed', order: QLOO_ORDER, prompts: PROMPTS.slice(0, JOURNEY_FAVS).map((p, i) => ({ ...p, placeholder: MIXED_EXAMPLES[i] })) };
  return { single: true, category, noun: s.noun, order: [category], prompts: s.labels.map((label, i) => ({ kind: s.kind, label, placeholder: s.examples[i] })) };
}
// Reveal header: single-category says what the list is; mixed keeps the city's own line.
export const revealHeader = (j, city) => (j.single ? `Your ${j.noun} self, in ${city.name}` : city.header);
// Reveal list: hero + up to 4 rows. Single-category: that category only. Mixed: all categories, one list.
export const MAX_ROWS = 4;
export function journeyPicks(byCat, j) {
  const only = Object.fromEntries(Object.entries(byCat).filter(([c]) => j.order.includes(c)));
  const { hero, rest } = rankPicks(only);
  return { hero, rows: rest.slice(0, MAX_ROWS) };
}

// Share link (§S): the result itself rides in ?r= (base64url JSON), no storage.
// Titles are encoded directly: Qloo results aren't deterministic, so IDs can't be re-resolved.
const b64u = { enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))) };
const posterPath = (url) => (String(url || '').match(/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/[\w-]+\.(?:jpg|png))$/) || [])[1] || '';
const clip = (s, n) => String(s || '').slice(0, n);
export function encodeShare({ lang, city, category, favs, hero, rows }) {
  const p = [hero, ...rows].filter(Boolean).slice(0, 1 + MAX_ROWS)
    .map((x) => [clip(x.title, 60), x.englishTitle && x.englishTitle !== x.title ? clip(x.englishTitle, 60) : '', x.category || '', posterPath(x.image)]);
  return b64u.enc(JSON.stringify({ v: 1, l: lang, c: city, cat: category, f: favs.slice(0, 3).map((f) => clip(f, 40)), p }));
}
// Returns null for anything malformed: a friend's link must never break the app.
export function decodeShare(r, cities = []) {
  try {
    if (typeof r !== 'string' || r.length > 2000) return null;
    const o = JSON.parse(b64u.dec(r));
    if (!o || o.v !== 1 || typeof o.c !== 'string' || !Array.isArray(o.p) || !o.p.length) return null;
    const city = cities.find((c) => c.id === o.c); if (!city) return null;
    const str = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
    const picks = o.p.slice(0, 1 + MAX_ROWS).filter(Array.isArray).map(([title, en, category, img]) => ({
      title: str(title, 60), englishTitle: str(en, 60) || null, category: ['tv', 'movie', 'music'].includes(category) ? category : null,
      image: /^\/[\w-]+\.(jpg|png)$/.test(img || '') ? `https://image.tmdb.org/t/p/w342${img}` : null,
    })).filter((p) => p.title);
    if (!picks.length) return null;
    return { city, lang: str(o.l, 8), category: str(o.cat, 8), favs: (Array.isArray(o.f) ? o.f : []).slice(0, 3).map((f) => str(f, 40)).filter(Boolean), hero: picks[0], rows: picks.slice(1) };
  } catch { return null; }
}
