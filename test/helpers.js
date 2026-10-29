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
