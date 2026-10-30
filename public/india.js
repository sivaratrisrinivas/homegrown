// HG-11: language-first picker for India. Kept apart from app.js so the redesign can rebase easily.
// Pure helpers (indiaGroups, matchState, meanwhileHint, matchStatus) are tested in node; indiaSection
// only builds DOM through the h() it is given.
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// live: Indian languages with a live city (they carry `states`).
// soon: measured but too thin to go live (catalogue.comingSoon).
// unsupported: no TMDB language code or never measured (catalogue.notSupported).
export function indiaGroups(catalogue) {
  const live = (catalogue.languages || []).filter((l) => l.live && l.states?.length)
    .map((l) => ({ id: l.id, name: l.name, local: l.local, states: l.states, statesLabel: l.statesLabel, lang: l }));
  const liveIds = new Set(live.map((l) => l.id));
  const other = (list) => (list || []).filter((l) => !liveIds.has(l.language))
    .map((l) => ({ id: l.language, name: l.name, local: l.local, states: l.states || [], statesLabel: l.statesLabel, meanwhile: l.meanwhile }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { live, soon: other(catalogue.comingSoon), unsupported: other(catalogue.notSupported), noFilmLanguage: catalogue.noFilmLanguage || [], liveIds: [...liveIds], names: Object.fromEntries((catalogue.languages || []).map((l) => [l.id, l.name])) };
}
export const indiaLabel = (l) => (l.statesLabel ? `${l.name}, ${l.statesLabel}` : l.name);

// State search: a query matches a language by state, language or native name. Empty query = all.
export function matchState(groups, query) {
  const q = norm(query);
  if (!q) return { ...groups, stateless: false };
  const hit = (l) => [l.name, l.local, ...(l.states || [])].some((s) => norm(s).includes(q));
  const m = { ...groups, live: groups.live.filter(hit), soon: groups.soon.filter(hit), unsupported: groups.unsupported.filter(hit) };
  // The 'no film language' hint only when no language row matches (e.g. 'pradesh' matches rows, so no hint).
  m.stateless = !(m.live.length + m.soon.length + m.unsupported.length) && groups.noFilmLanguage.some((s) => norm(s).includes(q));
  return m;
}

export const matchStatus = (g) => { const n = g.live.length + g.soon.length + g.unsupported.length; return `${n} ${n === 1 ? 'language matches' : 'languages match'}`; };

// One hint under the list (never per row): the nearest live language where it is obvious, otherwise Hindi.
export function meanwhileHint(g) {
  if (g.stateless) return 'No film language for your state yet, try Hindi meanwhile.';
  if (g.live.length) return null; // a live language is right there: no hint at all
  const waiting = [...g.soon, ...g.unsupported];
  if (!waiting.length) return null;
  if (!g.soon.length) return "We can't match films in this language yet. Try Hindi meanwhile.";
  const live = new Set(g.liveIds || []); // all live languages, not just the ones the search left visible
  const near = waiting.filter((l) => l.meanwhile && l.meanwhile !== 'hi' && live.has(l.meanwhile));
  if (!near.length) return 'Try Hindi meanwhile.';
  const parts = near.map((l) => `${g.names[l.meanwhile] || l.meanwhile} for ${l.name}`);
  return `Try ${parts.join(', ')}${near.length < waiting.length ? ', Hindi for the rest' : ''}, meanwhile.`;
}

export function indiaSection(catalogue, { h, onPick, onSuggest }) {
  const groups = indiaGroups(catalogue);
  if (!groups.live.length && !groups.soon.length && !groups.unsupported.length) return null;
  const list = h('div', { class: 'india-list' });
  const status = h('p', { class: 'muted india-status', role: 'status', 'aria-live': 'polite' });
  const hint = h('p', { class: 'muted india-hint' });
  const native = (l) => h('span', { class: 'india-local', lang: l.id }, l.local);
  const row = (l) => h('div', { class: 'india-lang waiting' }, native(l), h('span', {}, indiaLabel(l)));
  // HG-12: coming-soon languages can be picked for AI film suggestions (TMDB-verified, clearly labelled).
  const soonRow = (l) => (onSuggest ? h('button', { class: 'india-lang waiting', onclick: () => onSuggest(l) }, native(l), h('span', {}, indiaLabel(l)), h('span', { class: 'india-ai' }, 'AI suggestions')) : row(l));
  const heading = (t, n) => (n ? h('h4', { class: 'india-group' }, t) : null);
  const render = (q) => {
    const g = matchState(groups, q);
    list.replaceChildren(...[
      ...g.live.map((l) => h('button', { class: 'india-lang', onclick: () => onPick(l.lang) }, native(l), h('span', {}, indiaLabel(l)))),
      heading('Coming soon', g.soon.length), ...g.soon.map(soonRow),
      heading('Not supported yet', g.unsupported.length), ...g.unsupported.map(row),
    ].filter(Boolean));
    status.textContent = matchStatus(g);
    hint.textContent = meanwhileHint(g) || '';
  };
  const input = h('input', { type: 'search', class: 'india-search', placeholder: 'Find your state', 'aria-label': 'Find your state' });
  input.addEventListener('input', () => render(input.value));
  render('');
  return h('section', { class: 'india' }, h('h3', {}, 'India 🇮🇳'), input, status, list, hint);
}
