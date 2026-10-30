// City config: the single source of truth for locality filters (brief §11).
import CONFIG from '../config/cities.json' with { type: 'json' };
// Cities and languages are data (config/cities.json): adding a city is a config entry plus `npm run measure`.
export const LANGUAGES = CONFIG.languages;
export const CITIES = Object.fromEntries(CONFIG.cities.map((c) => [c.id, c]));
export const languageName = (id) => LANGUAGES.find((l) => l.id === id)?.name || id;

export function getCity(id) {
  const c = typeof id === 'string' && Object.hasOwn(CITIES, id) ? CITIES[id] : null;
  if (!c) throw new UserError(`Unknown city: ${id}`);
  return c;
}

export class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export class MissingKeyError extends Error {
  constructor(name) {
    super(`${name} is not configured`);
    this.status = 503; this.keyName = name; this.code = 'missing_key';
  }
}

export function requireEnv(name, env = process.env) {
  const v = env[name];
  if (!v || !String(v).trim()) throw new MissingKeyError(name);
  return String(v).trim();
}
