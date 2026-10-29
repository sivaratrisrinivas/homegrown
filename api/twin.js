import { getDeps, sendError, sendJson } from '../lib/deps.js';
import { loadGate, requireLiveCity } from '../lib/gate.js';

// POST /api/twin {favourites, city, category, userCountry} -> verified native picks for one category.
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, { error: 'method_not_allowed' }, 405);
  try {
    const b = req.body || {};
    // Data gate: only cities that passed the measuring run are served.
    if (typeof b.city === 'string') requireLiveCity(loadGate(), b.city);
    const out = await getDeps().twin.category({ favourites: b.favourites, cityId: b.city, category: b.category, userCountry: b.userCountry });
    sendJson(res, out);
  } catch (e) { sendError(res, e); }
}
