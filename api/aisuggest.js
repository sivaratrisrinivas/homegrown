import { getDeps, sendJson } from '../lib/deps.js';
import { clientIp } from './altnames.js';

// POST /api/aisuggest {language, favourites:[names]} -> AI film suggestions for a 'coming soon' Indian
// language, every title TMDB-verified. Fails closed: any error or cap -> a status the UI can show.
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, { error: 'method_not_allowed' }, 405);
  try {
    const b = req.body || {};
    if (typeof b.language !== 'string' || !Array.isArray(b.favourites)) return sendJson(res, { status: 'unsupported' }, 400);
    sendJson(res, await getDeps().aisuggest({ language: b.language, favourites: b.favourites, ip: clientIp(req) }));
  } catch { sendJson(res, { status: 'error' }); }
}
