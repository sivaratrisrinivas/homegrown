import { getDeps, sendError, sendJson } from '../lib/deps.js';
import { loadGate, requireLiveCity, requireLiveCategory } from '../lib/gate.js';
import { UserError } from '../lib/cities.js';
import { clientIp } from './altnames.js';

// POST /api/twin {favourites, city, category, userCountry} -> verified native picks for one category.
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, { error: 'method_not_allowed' }, 405);
  try {
    const b = req.body || {};
    // Data gate: only cities that passed the measuring run are served.
    // Only a plain string city id; anything else (array, object, number) is rejected before the gate.
    if (typeof b.city !== 'string') throw new UserError('city must be a string', 400);
    const gate = loadGate();
    requireLiveCity(gate, b.city);
    // v1 is movies only (gate.liveCategories): other categories are refused before any Qloo call.
    requireLiveCategory(gate, b.category);
    const out = await getDeps().twin.category({ favourites: b.favourites, cityId: b.city, category: b.category, userCountry: b.userCountry, ip: clientIp(req) });
    sendJson(res, out);
  } catch (e) { sendError(res, e); }
}
