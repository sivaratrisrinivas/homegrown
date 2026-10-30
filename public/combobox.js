// HG-10 r5: one minimal, accessible combobox (ARIA 1.2 combobox + listbox), used for language, city and
// favourites. Plain DOM, no dependencies. The input filters a list; arrows move, Enter picks, Escape closes.
// Options are 48px rows (easy to tap). `load(q)` may be async (favourites search); `filter` is local.

// Pure: does an option match the query? Case- and accent-insensitive, on every given label.
const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const matches = (q, labels) => { const f = fold(q).trim(); return !f || labels.some((l) => fold(l).includes(f)); };

let uid = 0;
export function combobox({ h, label, placeholder, options = [], keys = (o) => [o.label], render = (o) => o.label, onPick, load, open: startOpen = false, inputAttrs = {} }) {
  const id = `cb${++uid}`;
  const input = h('input', { id: `${id}-in`, role: 'combobox', 'aria-label': label, 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${id}-lb`, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder, ...inputAttrs });
  const list = h('ul', { id: `${id}-lb`, role: 'listbox', class: 'cb-list', 'aria-label': label, hidden: '' });
  let items = [], active = -1;
  const setActive = (n) => {
    active = items.length ? (n + items.length) % items.length : -1;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', `${id}-o${active}`); list.children[active].scrollIntoView?.({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const show = (on) => { list.hidden = !on || !items.length; input.setAttribute('aria-expanded', String(!list.hidden)); if (list.hidden) setActive(-1); };
  const pick = (o) => { show(false); onPick(o); };
  const fill = (opts) => {
    items = opts;
    list.replaceChildren(...opts.map((o, k) => h('li', { id: `${id}-o${k}`, role: 'option', class: 'cb-opt', 'aria-selected': 'false',
      onpointerdown: (e) => e.preventDefault(), // keep focus in the input on tap
      onclick: () => pick(o) }, ...[].concat(render(o)))));
    active = -1; show(document.activeElement === input || startOpen);
  };
  const refresh = () => (load ? load(input.value, fill) : fill(options.filter((o) => matches(input.value, keys(o)))));
  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { if (!load) refresh(); else show(true); });
  input.addEventListener('blur', () => setTimeout(() => show(false), 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) show(true); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) show(true); setActive(active - 1); }
    else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(items[active]); }
    else if (e.key === 'Escape') { show(false); }
  });
  if (!load) { items = options; }
  const el = h('div', { class: 'cb' }, input, list);
  if (startOpen && !load) fill(options);
  return { el, input, list, fill, refresh };
}
