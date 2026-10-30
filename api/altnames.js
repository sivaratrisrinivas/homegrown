import { getDeps, sendJson } from '../lib/deps.js';
import { QLOO_TYPES } from '../lib/qloo.js';

// GET /api/altnames?q=...&kind=...  Called only when /api/search found no same-name entity.
// Asks Claude for alternate names, re-resolves each with Qloo; returns genuine Qloo matches only.
// Fails closed: any error, cap or missing key -> { results: [] }.
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const kind = Object.hasOwn(QLOO_TYPES, req.query?.kind) ? req.query.kind : 'any';
    if (q.length < 2) return sendJson(res, { results: [] });
    const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const { results } = await getDeps().altnames({ q, kind, types: QLOO_TYPES[kind], ip });
    sendJson(res, { results: results.map(({ id, name, type, year, tags, image }) => ({ id, name, type, year, tags: (tags || []).slice(0, 20), image })) });
  } catch { sendJson(res, { results: [] }); }
}
