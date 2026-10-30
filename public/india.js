// HG-11: language-first picker for India. Kept apart from app.js so the redesign can rebase easily.
// Pure helpers (indiaGroups, matchState) are tested in node; indiaSection only builds DOM via the given h().
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Live Indian languages carry `states`; measured-but-not-live ones come from catalogue.comingSoon.
export function indiaGroups(catalogue) {
  const live = (catalogue.languages || []).filter((l) => l.live && l.states?.length)
    .map((l) => ({ id: l.id, name: l.name, local: l.local, states: l.states, statesLabel: l.statesLabel, live: true, lang: l }));
  const liveIds = new Set(live.map((l) => l.id));
  const soon = (catalogue.comingSoon || []).filter((l) => !liveIds.has(l.language))
    .map((l) => ({ id: l.language, name: l.name, local: l.local, states: l.states || [], statesLabel: l.statesLabel, live: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { live, soon };
}
export const indiaLabel = (l) => (l.statesLabel ? `${l.name}, ${l.statesLabel}` : l.name);

// State search: a query matches a language by state name, language name or local name. Empty query = all.
export function matchState(groups, query) {
  const q = norm(query);
  if (!q) return groups;
  const hit = (l) => [l.name, l.local, ...(l.states || [])].some((s) => norm(s).includes(q));
  return { live: groups.live.filter(hit), soon: groups.soon.filter(hit) };
}

export function indiaSection(catalogue, { h, onPick }) {
  const groups = indiaGroups(catalogue);
  if (!groups.live.length && !groups.soon.length) return null;
  const list = h('div', { class: 'india-list' });
  const render = (q) => {
    const g = matchState(groups, q);
    list.replaceChildren(
      ...g.live.map((l) => h('button', { class: 'india-lang', onclick: () => onPick(l.lang) },
        h('span', { class: 'india-local' }, l.local), h('span', {}, indiaLabel(l)))),
      ...g.soon.map((l) => h('div', { class: 'india-lang soon', 'aria-disabled': 'true' },
        h('span', { class: 'india-local' }, l.local), h('span', {}, indiaLabel(l)), h('span', { class: 'muted' }, 'Coming soon, try Hindi meanwhile'))),
      ...(g.live.length || g.soon.length ? [] : [h('p', { class: 'muted' }, 'No match. Try Hindi meanwhile.')]));
  };
  const input = h('input', { type: 'search', class: 'india-search', placeholder: 'Find your state', 'aria-label': 'Find your state' });
  input.addEventListener('input', () => render(input.value));
  render('');
  return h('section', { class: 'india' }, h('h3', {}, 'India 🇮🇳'), input, list);
}
