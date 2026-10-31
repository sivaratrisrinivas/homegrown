import COVERAGE from '../config/coverage.json' with { type: 'json' };
import { supported, MIN_TOKENS, BANDS } from '../public/coverage.js';

// HG-22: precomputed subtitle word profiles (config/coverage.json, written by scripts/coverage.mjs).
// No profile, an unsupported language or a short subtitle file -> null, and the UI shows no line.
export function coverageFor(tmdbId, lang, data = COVERAGE) {
  if (!tmdbId || !supported(lang)) return null;
  const p = data?.films?.[`${tmdbId}:${lang}`];
  if (!p || !(p.tokens >= MIN_TOKENS) || !Array.isArray(p.bands) || p.bands.length !== BANDS) return null;
  return { lang, tokens: p.tokens, bands: p.bands, beyond: p.beyond };
}
