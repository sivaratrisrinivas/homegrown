import COVERAGE from '../config/coverage.json' with { type: 'json' };
import { supported, BANDS, profileProblem } from '../public/coverage.js';

// HG-22: precomputed subtitle word profiles (config/coverage.json, written by scripts/coverage.mjs).
// No profile, an unsupported language, a short file, counts that don't add up or >40% unmatched words -> null, and the UI shows no line.
export function coverageFor(tmdbId, lang, data = COVERAGE) {
  if (!tmdbId || !supported(lang)) return null;
  const p = data?.films?.[`${tmdbId}:${lang}`];
  if (profileProblem(p) || p.bands.length !== BANDS) return null;
  return { lang, tokens: p.tokens, bands: p.bands, beyond: p.beyond };
}
