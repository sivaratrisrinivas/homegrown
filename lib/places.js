// Place verification: address country must match, drop known chains (brief §11).
export const CHAINS = [
  'starbucks', 'mcdonald', 'burger king', 'kfc', 'subway', 'domino', 'pizza hut', 'vips', 'sanborns', 'toks',
  'paris baguette', 'tous les jours', 'lotteria', 'mom\'s touch', 'ediya', 'twosome', 'mega coffee', 'compose coffee',
  'paul', 'brioche dorée', 'hippopotamus', 'flunch', 'buffalo grill', 'big mamma', 'léon de bruxelles', 'five guys',
  'hard rock cafe', 'taco bell', 'chili\'s', 'olive garden', 'outback',
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

export function isChain(name) {
  const n = norm(name);
  return CHAINS.some((c) => n === norm(c) || n.startsWith(norm(c) + ' ') || n.includes(' ' + norm(c) + ' '));
}

export function verifyPlace(place, city) {
  if (isChain(place.name)) return { ok: false, reason: 'chain' };
  if (place.countryCode) {
    return place.countryCode.toUpperCase() === city.country ? { ok: true } : { ok: false, reason: 'not_in_country' };
  }
  const addr = norm(place.address);
  if (!addr) return { ok: false, reason: 'no_address' };
  const hit = city.countryNames.some((c) => addr.includes(norm(c))) || addr.includes(norm(city.name)) || addr.includes(norm(city.localName));
  return hit ? { ok: true } : { ok: false, reason: 'not_in_country' };
}
