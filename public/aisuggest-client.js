// HG-12: reveal for a 'coming soon' Indian language. Claude suggests films, the server keeps only the
// TMDB-verified ones. Labelled as AI, not taste-matched; none of the taste-twin wording. Kept apart from app.js (PR #5).
export const AI_LABEL = 'Suggested by AI, not taste-matched';
export const thinMessage = (name) => `Not enough films yet for ${name}. Try Hindi meanwhile.`;

// Pure: server body -> what to show.
export function aiView(body, lang) {
  if (body?.status === 'ok' && Array.isArray(body.films) && body.films.length >= 3) return { kind: 'films', label: AI_LABEL, films: body.films };
  if (body?.status === 'capped') return { kind: 'note', text: `AI suggestions are resting for today. Try Hindi meanwhile.` };
  if (body?.status === 'thin' || body?.status === 'ok') return { kind: 'note', text: thinMessage(lang.name) };
  return { kind: 'note', text: `AI suggestions are unavailable right now. Try Hindi meanwhile.` };
}

export async function aiReveal({ h, show, lang, favourites, onBack, fetch = globalThis.fetch }) {
  show(h('p', { class: 'muted', role: 'status' }, `Finding ${lang.name} films…`));
  let body = null;
  try {
    const r = await fetch('/api/aisuggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: lang.id, favourites }) });
    body = await r.json();
  } catch { body = null; }
  const v = aiView(body, lang);
  const back = h('button', { class: 'ghost', onclick: onBack }, 'Pick another language');
  if (v.kind === 'note') return show(h('h2', {}, lang.name), h('p', { class: 'muted' }, v.text), back);
  show(h('h2', {}, `${lang.name} films`),
    h('p', { class: 'ai-label' }, v.label),
    h('div', { class: 'ai-films' }, v.films.map((f) => h('div', { class: 'card ai-film' },
      f.image ? h('img', { src: f.image, alt: '', loading: 'lazy' }) : null,
      h('h3', { lang: lang.id }, f.title), f.englishTitle && f.englishTitle !== f.title ? h('p', { class: 'muted' }, f.englishTitle) : null,
      h('p', { class: 'muted' }, [f.year, 'made in 🇮🇳'].filter(Boolean).join(' · '))))),
    h('p', { class: 'muted' }, 'Each title is checked in TMDB: original language and made in India.'),
    back);
}
