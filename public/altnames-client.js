// HG-8 client trigger: /api/altnames runs only when the user explicitly submits (Enter) a query that
// came back with no Qloo results, never on typeahead keystrokes. It runs outside the shared Qloo gate
// so it never blocks search, and any newer keystroke/submit aborts it.
export function createAltTrigger({ fetch = globalThis.fetch } = {}) {
  let emptyQ = null, ctl = null;
  const abort = () => { ctl?.abort(); ctl = null; };
  return {
    // Record the latest typeahead outcome: only an empty result makes the query eligible.
    noteResults(q, count) { emptyQ = count === 0 ? q : null; },
    // True only when q is the latest query that came back with no results (the UI sets its message on this).
    eligible(q) { return !!q && q === emptyQ; },
    // Called on every keystroke: the query is superseded.
    onInput() { abort(); emptyQ = null; },
    // Explicit submit. Resolves to an array of Qloo-verified entities, or null when not eligible/aborted.
    async submit(kind, q) {
      if (!q || q !== emptyQ) return null;
      abort(); const my = ctl = new AbortController();
      try {
        const r = await fetch(`/api/altnames?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`, { signal: my.signal });
        const b = await r.json();
        return my.signal.aborted ? null : (Array.isArray(b.results) ? b.results : []);
      } catch { return null; } finally { if (ctl === my) ctl = null; }
    },
  };
}
