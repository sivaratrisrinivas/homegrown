// HG-12: reveal for a 'coming soon' Indian language. Claude suggests films, the server keeps only the
// TMDB-verified ones and sends the label and copy (nothing duplicated here). Kept apart from app.js (PR #5).
const FALLBACK = 'AI suggestions are unavailable right now. Try again soon.';

// Pure: server body -> what to show. Films only with the server's label; anything else is a note.
export function aiView(body) {
  if (body?.status === 'ok' && body.label && Array.isArray(body.films) && body.films.length) return { kind: 'films', label: body.label, note: body.note, films: body.films };
  return { kind: 'note', text: body?.message || FALLBACK };
}
// Heading: TMDB's title (native, then English), plus Claude's spelling when it differs.
export const filmHeading = (f) => ({ title: f.title, sub: [f.englishTitle, f.suggestedTitle && `suggested as “${f.suggestedTitle}”`].filter(Boolean).join(' · ') });

export async function aiReveal({ h, show, lang, favourites, onBack, fetch = globalThis.fetch }) {
  show(h('p', { class: 'muted', role: 'status' }, `Finding ${lang.name} films…`));
  let body = null;
  try {
    const r = await fetch('/api/aisuggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: lang.id, favourites }) });
    body = await r.json();
  } catch { body = null; }
  const v = aiView(body);
  const back = h('button', { class: 'ghost', onclick: onBack }, 'Pick another language');
  if (v.kind === 'note') return show(h('h2', {}, lang.name), h('p', { class: 'muted' }, v.text), back);
  show(h('h2', {}, `${lang.name} films`),
    h('p', { class: 'ai-label' }, v.label),
    h('div', { class: 'ai-films' }, v.films.map((f) => { const hd = filmHeading(f); return h('div', { class: 'card ai-film' },
      f.image ? h('img', { src: f.image, alt: '', loading: 'lazy' }) : null,
      h('h3', { lang: lang.id }, hd.title), hd.sub ? h('p', { class: 'muted' }, hd.sub) : null,
      h('p', { class: 'muted' }, [f.year, 'made in 🇮🇳'].filter(Boolean).join(' · '))); })),
    v.note ? h('p', { class: 'muted' }, v.note) : null,
    back);
}
