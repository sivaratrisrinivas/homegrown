import { sendJson, sendError } from '../lib/deps.js';
import { loadGate, catalogue } from '../lib/gate.js';

// GET /api/cities -> languages with their suggested live city, per-city gate status and culture lead.
export default function handler(req, res) {
  try { sendJson(res, catalogue(loadGate())); } catch (e) { sendError(res, e); }
}
