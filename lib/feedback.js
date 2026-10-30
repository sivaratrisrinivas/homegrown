import { CITIES } from './cities.js';
// Each shown pick becomes a bounded string (<=200 chars) so clients can't log arbitrary objects.
export function shownString(s) {
  const v = s && typeof s === 'object' ? [s.category, s.title, s.verification].filter(Boolean).join(':') : s;
  return String(v ?? '').slice(0, 200);
}
const EVENTS = new Set(['rating', 'flag', 'tap', 'try_city', 'share', 'share_open']);
const SHARE_METHODS = new Set(['files', 'link', 'copy', 'image']);
const FLAGS = new Set(['not_local', 'not_my_taste']);
const clean = (b) => ({ ...b, city: typeof b.city === 'string' && Object.hasOwn(CITIES, b.city) ? b.city : undefined, // → '' in base
  favourites: Array.isArray(b.favourites) ? b.favourites.slice(0, 5).map((f) => String(f).slice(0, 40)) : [] });

export function validateFeedback(b) {
  // Share events come from public links: sanitise (unknown city → '', items ≤ 40 chars) instead of rejecting.
  if (b && (b.event === 'share' || b.event === 'share_open')) b = clean(b);
  if (!b || !EVENTS.has(b.event)) return { ok: false, error: 'Unknown event.' };
  if (b.city !== undefined && (typeof b.city !== 'string' || !Object.hasOwn(CITIES, b.city))) return { ok: false, error: 'Unknown city.' };
  const base = { event: b.event, city: b.city || '', favourites: Array.isArray(b.favourites) ? b.favourites.slice(0, 5).map(String) : [] };
  if (b.event === 'rating') {
    const r = Number(b.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return { ok: false, error: 'Rating must be 1-5.' };
    return { ok: true, value: { ...base, rating: r, note: String(b.note || '').slice(0, 1000), shown: Array.isArray(b.shown) ? b.shown.slice(0, 10).map(shownString) : [] } };
  }
  if (b.event === 'flag') {
    if (!FLAGS.has(b.flag)) return { ok: false, error: 'Unknown flag.' };
    return { ok: true, value: { ...base, flag: b.flag, pick: String(b.pick || '').slice(0, 200), category: String(b.category || '').slice(0, 20) } };
  }
  // HG-10 share loop: how a result was sent, and a friend opening a ?r= link.
  if (b.event === 'share') return SHARE_METHODS.has(b.method) ? { ok: true, value: { ...base, method: b.method } } : { ok: false, error: 'Unknown share method.' };
  if (b.event === 'share_open') return { ok: true, value: base };
  if (b.event === 'tap') return { ok: true, value: { ...base, action: String(b.action || '').slice(0, 20), pick: String(b.pick || '').slice(0, 200) } };
  if (typeof b.to !== 'string' || !Object.hasOwn(CITIES, b.to)) return { ok: false, error: 'Unknown city.' };
  return { ok: true, value: { ...base, to: b.to } };
}
