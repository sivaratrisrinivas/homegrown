import { pickKey, isPicked } from './logic.js';

// HG-8 client side. /api/altnames is called only on an explicit action, never on typeahead keystrokes:
//  - primary: "Try other names" next to a favourite HG-5 couldn't match ("We couldn't match X");
//  - secondary: Enter on a query whose /api/suggest came back empty.
// Calls run outside the shared Qloo gate (the server throttles its own Qloo use), and a newer
// keystroke or lookup aborts the one in flight.
export function createAltTrigger({ fetch = globalThis.fetch } = {}) {
  let emptyQ = null, ctl = null;
  const abort = () => { ctl?.abort(); ctl = null; };
  async function lookup(kind, q) {
    if (!q) return null;
    abort(); const my = ctl = new AbortController();
    try {
      const r = await fetch(`/api/altnames?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`, { signal: my.signal });
      const b = await r.json();
      return my.signal.aborted ? null : (Array.isArray(b.results) ? b.results : []);
    } catch { return null; } finally { if (ctl === my) ctl = null; }
  }
  return {
    abort,
    // Record the latest suggest outcome: only an empty result makes the query eligible for Enter.
    noteResults(q, count) { emptyQ = count === 0 ? q : null; },
    eligible(q) { return !!q && q === emptyQ; },
    // Every keystroke supersedes the query.
    onInput() { abort(); emptyQ = null; },
    // Secondary trigger: Enter on a zero-suggest query. null = not eligible / aborted / failed.
    submit(kind, q) { return q && q === emptyQ ? lookup(kind, q) : Promise.resolve(null); },
    // Primary trigger: a favourite HG-5 marked as missed.
    lookup,
  };
}

// An alt-names match is already a verified Qloo entity: it goes straight into S.favs (never back
// through bestQlooMatch). -> { fav } to push, or { dup: true } when it's already picked/pending.
// Display name is what the user typed (`from`); id and pick come from the Qloo entity.
export function verifiedFavourite(e, kind, favs, pending, from) {
  if (!e || typeof e.id !== 'string' || !e.id) return { invalid: true };
  const pick = pickKey(kind, e.name, e.year);
  if (isPicked(pick, favs, pending) || favs.some((f) => f.id === e.id)) return { dup: true };
  return { fav: { id: e.id, name: String(from || '').trim() || e.name, pick, tags: Array.isArray(e.tags) ? e.tags : [] } };
}

// "We couldn't match X." plus HG-5's "Pick N more." while fewer than 3 favourites are chosen.
export function missedNote(missed, chosen) {
  if (!missed.length) return '';
  const n = 3 - chosen;
  return `We couldn't match ${missed.map((m) => m.name).join(', ')}.${n > 0 ? ` Pick ${n} more.` : ''}`;
}
