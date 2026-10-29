import { PROMPTS, MAX_FAVS, canSkip, QLOO_ORDER, MORPH_BUDGET_MS, flapSteps, padTo, rankPicks, userCountryFromLocale, createRunGuard, createSpacer, SKIP, createMemo, searchKey, twinClientKey, runCategories, gatedIfCurrent } from './logic.js';

const CITIES = [
  { id: 'mexico_city', local: 'Ciudad de México', name: 'Mexico City', accent: '#E4007C', header: 'Tu yo chilango', flag: '🇲🇽' },
  { id: 'seoul', local: '서울', name: 'Seoul', accent: '#2E8B57', header: '서울의 너', flag: '🇰🇷' },
  { id: 'paris', local: 'Paris', name: 'Paris', accent: '#1D4E89', header: 'Toi, version parisienne', flag: '🇫🇷' },
];
const app = document.getElementById('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const qlooGate = createSpacer();
const searchMemo = createMemo(), twinMemo = createMemo();
// Qloo-backed calls go through the 7 s gate; cached answers skip it entirely.
async function qlooPost(body, isCurrent = () => true) {
  const k = twinClientKey(body.favourites, body.city, body.category, body.userCountry);
  const hit = twinMemo.get(k); if (hit) return hit;
  const r = await gatedIfCurrent(qlooGate, isCurrent, () => post('/api/twin', body));
  if (r.ok) twinMemo.set(k, r);
  return r;
}
const S = { favs: [], city: null, results: {}, sound: false };
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const show = (...els) => { app.replaceChildren(...els); window.scrollTo(0, 0); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
const track = (body) => post('/api/feedback', { city: S.city?.id, favourites: S.favs.map((f) => f.id), ...body }).catch(() => {});

// Sound: off by default; a quiet synthesised click per flap when enabled.
let actx; const soundBtn = document.getElementById('sound');
soundBtn.onclick = () => { S.sound = !S.sound; soundBtn.textContent = S.sound ? '🔈' : '🔇'; soundBtn.setAttribute('aria-pressed', S.sound); };
function click() {
  if (!S.sound) return;
  actx ||= new AudioContext();
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = 1800 + Math.random() * 400; g.gain.value = 0.02;
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.012);
}

function hello() {
  document.documentElement.style.setProperty('--accent', '#1B1B1B');
  show(h('h1', {}, "What you'd love if you grew up there."), h('div', {}, h('button', { onclick: () => favourite() }, 'Start')));
}

function favourite() {
  const i = S.favs.length;
  if (i >= MAX_FAVS) return pickCity();
  const p = PROMPTS[i];
  const input = h('input', { 'aria-label': p.label, placeholder: 'Start typing…', autocomplete: 'off' });
  const sugs = h('ul', { class: 'sugs' }); const msg = h('p', { class: 'muted' });
  let t, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim(); const my = ++seq;
      if (q.length < 2) return sugs.replaceChildren();
      msg.textContent = 'Searching…';
      const sk = searchKey(p.kind, q);
      let r = searchMemo.get(sk);
      if (!r) {
        r = await qlooGate(async () => {
          if (my !== seq) return SKIP; // superseded while waiting for the gate: don't spend a Qloo call
          const res = await fetch(`/api/search?kind=${p.kind}&q=${encodeURIComponent(q)}`);
          return { ok: res.ok, body: await res.json().catch(() => ({})) };
        });
        if (r === SKIP) return;
        if (r?.ok) searchMemo.set(sk, r);
      }
      if (!r || my !== seq) return;
      const body = r.body;
      if (!r.ok) { msg.textContent = body.message || 'Search is unavailable right now.'; return; }
      msg.textContent = body.results.length ? '' : 'Nothing found. Try something like it.';
      sugs.replaceChildren(...body.results.slice(0, 3).map((e) => h('li', {}, h('button', { onclick: () => { S.favs.push(e); favourite(); } }, e.name, e.year ? ` (${e.year})` : ''))));
    }, 600);
  });
  const shelf = h('div', { class: 'shelf', 'aria-label': 'Your favourites' }, S.favs.map((f) => h('span', { class: 'chip' }, f.name)));
  show(h('p', { class: 'muted' }, `Favourite ${i + 1} of ${MAX_FAVS}`), h('h2', {}, p.label), input, msg, sugs,
    canSkip(i) ? h('div', {}, h('button', { class: 'ghost', onclick: pickCity }, 'Skip, that’s enough')) : null, shelf);
  input.focus();
}

function pickCity() {
  show(h('h2', {}, 'Pick a city.'), h('p', { class: 'muted' }, 'Where did the other you grow up?'),
    h('div', { class: 'cities' }, CITIES.map((c) => h('button', { class: 'postcard', style: `--c:${c.accent}`, onclick: () => { S.city = c; morph(); } },
      h('span', { class: `serif ${c.id === 'seoul' ? 'ko' : ''}` }, c.local), h('span', {}, c.flag)))));
}

function flapRow(text, width) {
  const row = h('div', { class: 'row', 'aria-label': text });
  row.cells = padTo(text.toUpperCase(), width).map((ch) => { const s = h('span', { class: 'flap' }, ch); row.append(s); return s; });
  row.flipTo = async (to) => {
    row.setAttribute('aria-label', to);
    const target = padTo(to, width);
    if (reduced) { row.cells.forEach((c, k) => (c.textContent = target[k])); return; }
    await Promise.all(row.cells.map(async (cell, k) => {
      for (const ch of flapSteps(cell.textContent, target[k])) {
        cell.classList.remove('flip'); void cell.offsetWidth; cell.classList.add('flip');
        cell.textContent = ch; click();
        await new Promise((r) => setTimeout(r, 60 + k * 2));
      }
    }));
  };
  return row;
}

const runs = createRunGuard();
async function morph() {
  const current = runs.start(); revealEls = null;
  const c = S.city; document.documentElement.style.setProperty('--accent', c.accent);
  S.results = {};
  const width = Math.min(22, Math.max(12, ...S.favs.map((f) => f.name.length)));
  const hdr = h('div', { class: 'hdr' }, 'Your favourites');
  const rows = S.favs.map((f) => flapRow(f.name, width));
  const status = h('p', { class: 'muted' }, `Asking people in ${c.name}…`);
  show(h('div', { class: 'board' }, hdr, rows), status);

  const base = { favourites: S.favs.map(({ id, name, tags }) => ({ id, name, tags })), city: c.id, userCountry: userCountryFromLocale(navigator.language) };
  let flipped = 0;
  const land = (cat, r) => {
    if (!current()) return; // a newer city run started: drop stale responses
    S.results[cat] = r.ok ? r.body : { picks: [], note: r.body.message || 'This part is unavailable right now.', error: true };
    for (const p of S.results[cat].picks) if (flipped < rows.length) rows[flipped++].flipTo(p.title);
    if (revealEls) updateReveal();
  };
  // Every category is Qloo-backed, so they go one at a time through the 7 s browser gate.
  // One failed category must not stop the ones after it.
  const qlooP = runCategories(QLOO_ORDER, (cat) => qlooPost({ ...base, category: cat }, current), land);
  await Promise.race([qlooP, new Promise((r) => setTimeout(r, MORPH_BUDGET_MS))]);
  if (!current()) return;
  hdr.textContent = c.header; hdr.classList.toggle('ko', c.id === 'seoul');
  await new Promise((r) => setTimeout(r, reduced ? 200 : 1200));
  if (!current()) return;
  reveal();
}

let revealEls = null;

function pickCard(p, hero = false) {
  const kind = { tv: 'Show', movie: 'Film', music: 'Band' }[p.category];
  const link = p.watch?.url ? h('a', { class: 'btn', href: p.watch.url, target: '_blank', rel: 'noopener', onclick: () => track({ event: 'tap', action: 'watch', pick: p.title }) }, p.watch.provider ? `Where to watch · ${p.watch.provider}` : 'Where to watch')
    : p.preview ? h('audio', { controls: '', preload: 'none', src: p.preview.url, onplay: () => track({ event: 'tap', action: 'listen', pick: p.title }) }) : null;
  const flag = (f) => h('button', { onclick: (e) => { track({ event: 'flag', flag: f, pick: p.title, category: p.category }); e.target.textContent = 'Thanks'; e.target.disabled = true; } }, f === 'not_local' ? '👎 Not local' : '👎 Not my taste');
  return h('article', { class: `card ${hero ? 'hero' : ''}` },
    h('span', { class: 'kind' }, kind),
    p.image && hero ? h('img', { class: 'thumb', src: p.image, alt: '' }) : null,
    h(hero ? 'h2' : 'h3', { class: S.city.id === 'seoul' ? 'ko' : '' }, p.title),
    p.englishTitle && p.englishTitle !== p.title ? h('p', { class: 'muted' }, p.englishTitle) : null,
    h('p', {}, p.why?.text),
    h('div', { class: 'meta' }, p.difficulty ? h('span', {}, h('span', { class: `dot ${p.difficulty}` }), p.difficulty) : null,
      h('span', {}, `made in ${S.city.flag}`)),
    hero && p.tip ? h('p', { class: 'muted' }, p.tip) : null,
    link, p.watch ? h('p', { class: 'muted', style: 'font-size:12px' }, `Availability: ${p.watch.attribution}`) : null,
    h('div', { class: 'pick-actions' }, flag('not_local'), flag('not_my_taste')));
}

function picksView() {
  const { hero, rest } = rankPicks(S.results);
  const notes = Object.values(S.results).map((r) => r.note).filter(Boolean);
  const pending = QLOO_ORDER.filter((k) => !S.results[k]);
  return [
    hero ? pickCard(hero, true) : h('div', { class: 'card' }, h('p', {}, pending.length ? 'Still landing…' : 'Nothing passed our origin checks this time.')),
    h('div', { class: 'grid' }, rest.map((p) => pickCard(p))),
    pending.length ? h('p', { class: 'muted' }, `Still flipping in: ${pending.join(', ')}…`) : null,
    notes.map((n) => h('p', { class: 'note' }, n)),
  ].flat().filter(Boolean);
}
// Only the picks region re-renders as categories land; the rating/note form keeps its state.
function updateReveal() { revealEls.picks.replaceChildren(...picksView()); }
function shownPicks() { const { hero, rest } = rankPicks(S.results); return [hero, ...rest].filter(Boolean); }

function reveal() {
  const picks = h('div', { style: 'display:flex;flex-direction:column;gap:16px' });
  revealEls = { picks };
  const rating = h('section', { class: 'card' }, h('h3', { class: 'serif' }, 'How did we do?'),
    h('div', { class: 'stamps', role: 'radiogroup' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'stamp', 'aria-pressed': 'false', onclick: (e) => {
      rating.querySelectorAll('.stamp').forEach((x) => x.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); rating.dataset.r = n;
    } }, n))),
    h('input', { placeholder: 'Anything off? (optional)', id: 'note' }),
    h('button', { onclick: (e) => {
      if (!rating.dataset.r) return;
      track({ event: 'rating', rating: Number(rating.dataset.r), note: rating.querySelector('#note').value, shown: shownPicks().map((p) => `${p.category}:${p.title}:${p.verification?.source || ''}`.slice(0, 200)) });
      e.target.textContent = 'Thank you'; e.target.disabled = true;
    } }, 'Send'));
  const others = CITIES.filter((c) => c.id !== S.city.id);
  show(h('p', { class: 'kind' }, S.city.header), picks, rating,
    h('section', { class: 'card' }, h('h3', { class: 'serif' }, `Keep your ${S.city.name} self`),
      h('button', { onclick: (e) => { e.target.replaceWith(h('p', { class: 'muted' }, 'Saving with an email link is coming soon.')); } }, `Save my ${S.city.name} self`),
      h('div', {}, others.map((c) => h('button', { class: 'ghost', onclick: () => { track({ event: 'try_city', to: c.id }); S.city = c; morph(); } }, `Try ${c.name}`)))));
  updateReveal();
}

hello();
