import { requireEnv } from './cities.js';
import { timedFetch } from './fetch.js';

// Claude is only asked for alternate/official NAMES of a favourite; it never sources picks.
// Cheapest current Haiku (docs, Oct 2026): claude-haiku-5-5, $0.10 in / $0.50 out per MTok
// (prompts <= 100k tokens). Spend is estimated at the >100k tier ($0.50 / $2.50) to stay conservative.
export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const CLAUDE_MAX_TOKENS = 100;
export const PRICE_PER_TOKEN = { input: 0.5 / 1e6, output: 2.5 / 1e6 };
export const costOf = (u = {}) => (u.input_tokens || 0) * PRICE_PER_TOKEN.input
  + ((u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)) * PRICE_PER_TOKEN.input
  + (u.output_tokens || 0) * PRICE_PER_TOKEN.output;

const SYSTEM = 'You map a title to its other names. Reply with JSON only: {"names":["..."]}. At most 3 alternate, official, original-language or romanised names for the given show, film, band or book. No commentary. If unsure, {"names":[]}.';

export function createAnthropic({ fetch = globalThis.fetch, env = process.env, timeoutMs = 8000 } = {}) {
  return {
    // Returns { names, usage }. Throws on any HTTP/parse failure; the caller fails closed.
    async altNames(name, kind) {
      const key = requireEnv('ANTHROPIC_API_KEY', env);
      const res = await timedFetch(fetch, 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: CLAUDE_MODEL, max_tokens: CLAUDE_MAX_TOKENS, system: SYSTEM,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: JSON.stringify({ kind, title: name }) }],
        }),
      }, { timeoutMs, label: 'Anthropic' });
      if (!res.ok) { const e = new Error(`Anthropic failed: HTTP ${res.status}`); e.status = 502; e.upstreamStatus = res.status; e.source = 'anthropic'; throw e; }
      const data = await res.json();
      return { names: parseNames((data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')), usage: data.usage || {} };
    },
  };
}

// Tolerates code fences / stray prose around the JSON; anything malformed -> [].
export function parseNames(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]).names;
    return Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === 'string').map((s) => s.trim().slice(0, 100)).filter(Boolean))].slice(0, 3) : [];
  } catch { return []; }
}
