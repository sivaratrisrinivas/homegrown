import { sendError, sendJson } from '../lib/deps.js';
import { createSuggest, normaliseKind } from '../lib/suggest.js';
import { createCache } from '../lib/cache.js';

export const suggestCache = createCache({ ttlMs: 60 * 60 * 1000, max: 2000 });
let svc;
export const setSuggest = (s) => { svc = s; };

// GET /api/suggest?q=...&kind=show|movie|band|book|any  (fast typeahead, no Qloo)
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const kind = normaliseKind(req.query?.kind);
    if (q.length < 2) return sendJson(res, { results: [] });
    const key = `${kind}|${q.toLowerCase()}`;
    let out = suggestCache.get(key); let partial = false;
    if (!out) {
      ({ results: out, partial } = await (svc ||= createSuggest()).suggest(q, kind));
      // A partial answer (a source failed) is served but never cached, here or at the edge.
      if (!partial) suggestCache.set(key, out);
    }
    res.setHeader('cache-control', partial ? 'no-store' : 'public, max-age=300, s-maxage=3600');
    sendJson(res, partial ? { results: out, partial: true } : { results: out });
  } catch (e) { sendError(res, e); }
}
