import { getDeps, sendError, sendJson } from '../lib/deps.js';
import { QLOO_TYPES } from '../lib/qloo.js';
import { createCache } from '../lib/cache.js';

// Short-lived typeahead cache by (q, kind): saves scarce Qloo calls while the user types.
export const searchCache = createCache({ ttlMs: 10 * 60 * 1000, max: 1000 });

// GET /api/search?q=...&kind=show|movie|band|book|any  (Qloo typeahead)
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const kind = String(req.query?.kind || 'any');
    if (q.length < 2) return sendJson(res, { results: [] });
    const key = `${kind}|${q.toLowerCase()}`;
    let out = searchCache.get(key);
    if (!out) {
      const results = await getDeps().qloo.search(q, QLOO_TYPES[kind] || QLOO_TYPES.any);
      out = results.slice(0, 5).map(({ id, name, type, year, tags, image }) => ({ id, name, type, year, tags: tags.slice(0, 20), image }));
      searchCache.set(key, out);
    }
    sendJson(res, { results: out });
  } catch (e) { sendError(res, e); }
}
