// City config: the single source of truth for locality filters (brief §11).
export const CITIES = {
  mexico_city: {
    id: 'mexico_city', name: 'Mexico City', localName: 'Ciudad de México',
    country: 'MX', countryNames: ['mexico', 'méxico'], language: 'es', flag: '🇲🇽',
    accent: '#E4007C', header: 'Tu yo chilango', musicTag: 'latin',
    itunesCountry: 'mx', podcastFallbackTerm: 'historias',
    subtitleTip: 'Start with subtitles in Spanish.',
  },
  seoul: {
    id: 'seoul', name: 'Seoul', localName: '서울',
    country: 'KR', countryNames: ['korea', 'south korea', 'republic of korea', '대한민국'], language: 'ko', flag: '🇰🇷',
    accent: '#2E8B57', header: '서울의 너', musicTag: 'k_pop',
    itunesCountry: 'kr', podcastFallbackTerm: '이야기',
    subtitleTip: 'Start with subtitles in Korean.',
  },
  paris: {
    id: 'paris', name: 'Paris', localName: 'Paris',
    country: 'FR', countryNames: ['france'], language: 'fr', flag: '🇫🇷',
    accent: '#1D4E89', header: 'Toi, version parisienne', musicTag: 'french',
    itunesCountry: 'fr', podcastFallbackTerm: 'histoire',
    subtitleTip: 'Start with subtitles in French.',
  },
};

export function getCity(id) {
  const c = CITIES[id];
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
  return v;
}
