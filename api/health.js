import { sendJson } from '../lib/deps.js';
// Reports only whether keys are present (booleans), never their values.
export default function handler(req, res) {
  sendJson(res, { ok: true, keys: { QLOO_API_KEY: !!process.env.QLOO_API_KEY, TMDB_API_KEY: !!process.env.TMDB_API_KEY } });
}
