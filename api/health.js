import { sendJson } from '../lib/deps.js';
// Reports whether keys are present, plus their trimmed and raw LENGTHS (never values) to catch stray whitespace.
const info = (v) => ({ set: !!(v && String(v).trim()), length: v ? String(v).trim().length : 0, rawLength: v ? String(v).length : 0 });
export default function handler(req, res) {
  const q = info(process.env.QLOO_API_KEY), t = info(process.env.TMDB_API_KEY);
  sendJson(res, { ok: true, keys: { QLOO_API_KEY: q.set, TMDB_API_KEY: t.set }, keyLengths: { QLOO_API_KEY: q, TMDB_API_KEY: t } });
}
