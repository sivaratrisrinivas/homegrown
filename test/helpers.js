import { readFileSync } from 'node:fs';
export const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
// Routes a URL to a handler by first matching substring; records calls.
export function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    for (const [pat, fn] of routes) if (u.includes(pat)) return typeof fn === 'function' ? fn(u, init, calls) : json(fn);
    throw new Error('unmocked ' + u);
  };
  f.calls = calls; return f;
}
export const FAVS = [
  { id: 'q-bb', name: 'Breaking Bad', tags: [{ id: 'urn:tag:keyword:crime', name: 'crime' }, { id: 'urn:tag:keyword:moral_decay', name: 'moral_decay' }] },
  { id: 'q-rad', name: 'Radiohead', tags: [{ id: 'urn:tag:genre:alt', name: 'alternative' }] },
  { id: 'q-noma', name: 'Noma', tags: [] },
];

// HG-14 fixture: a copy of the gate where the given cities just reach the readiness threshold on every
// live category, as if a future measuring run brought them back. Never touches config/gate.json.
export function liftCities(gate, ids) {
  const g = structuredClone(gate);
  const cats = Array.isArray(g.liveCategories) && g.liveCategories.length ? g.liveCategories : g.categories;
  for (const id of ids) for (const k of cats) { const r = g.results[id][k]; r.accepted = Math.max(r.accepted, Math.ceil(g.threshold * r.seen)); }
  return g;
}
// HG-14: the cities the primary-origin re-measure put below the gate (kept in the catalogue, not served).
export const HG14_GATED = ['kolkata', 'london', 'dublin'];
