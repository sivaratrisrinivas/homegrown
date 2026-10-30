import { getDeps, sendJson } from '../lib/deps.js';
import { validateFeedback } from '../lib/feedback.js';

// POST /api/feedback: stamp rating, per-pick flags ("not_local" vs "not_my_taste"), taps, city switches.
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, { error: 'method_not_allowed' }, 405);
  const v = validateFeedback(req.body);
  if (!v.ok) return sendJson(res, { error: 'bad_request', message: v.error }, 400);
  getDeps().log({ event: 'feedback', ...v.value });
  sendJson(res, { ok: true });
}
