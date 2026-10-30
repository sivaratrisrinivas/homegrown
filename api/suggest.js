import { sendError, sendJson } from '../lib/deps.js';
import { createSuggest } from '../lib/suggest.js';
import { createCache } from '../lib/cache.js';

export const suggestCache = createCache({ ttlMs: 60 * 60 * 1000, max: 2000 });
let svc;
export const setSuggest = (s) => { svc = s; };

// GET /api/suggest?q=...&kind=show|movie|band|book|any  (fast typeahead, no Qloo)
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const kind = String(req.query?.kind || 'any');
    if (q.length < 2) return sendJson(res, { results: [] });
    const key = `${kind}|${q.toLowerCase()}`;
    let out = suggestCache.get(key);
    if (!out) { out = await (svc ||= createSuggest()).suggest(q, kind); suggestCache.set(key, out); }
    res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600');
    sendJson(res, { results: out });
  } catch (e) { sendError(res, e); }
}
