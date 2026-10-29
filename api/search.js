import { getDeps, sendError, sendJson } from '../lib/deps.js';
import { QLOO_TYPES } from '../lib/qloo.js';

// GET /api/search?q=...&kind=show|band|place|book|any  (Qloo typeahead)
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const kind = String(req.query?.kind || 'any');
    if (q.length < 2) return sendJson(res, { results: [] });
    const results = await getDeps().qloo.search(q, QLOO_TYPES[kind] || QLOO_TYPES.any);
    sendJson(res, { results: results.slice(0, 5).map(({ id, name, type, year, tags, image }) => ({ id, name, type, year, tags: tags.slice(0, 20), image })) });
  } catch (e) { sendError(res, e); }
}
