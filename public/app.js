import { PROMPTS, MAX_FAVS, canSkip, QLOO_ORDER, MORPH_BUDGET_MS, flapSteps, padTo, rankPicks, userCountryFromLocale, createRunGuard, createSpacer, SKIP, createMemo, searchKey, twinClientKey, runCategories, gatedIfCurrent, shouldMemoTwin, postcardCategories, scarcePicks, cityForLanguage, liveCitiesForLanguage, languageGroups } from './logic.js';
import { createAltTrigger } from './altnames-client.js';
const serif = (lang) => `serif ${lang === 'ko' ? 'ko' : ''}`;

const app = document.getElementById('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const qlooGate = createSpacer();
const searchMemo = createMemo(), twinMemo = createMemo();
// Qloo-backed calls go through the 7 s gate; cached answers skip it entirely.
async function qlooPost(body, isCurrent = () => true) {
  const k = twinClientKey(body.favourites, body.city, body.category, body.userCountry);
  const hit = twinMemo.get(k); if (hit) return hit;
  const r = await gatedIfCurrent(qlooGate, isCurrent, () => post('/api/twin', body));
  if (shouldMemoTwin(r)) twinMemo.set(k, r);
  return r;
}
const S = { favs: [], city: null, results: {}, sound: false, catalogue: null, lang: null };
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
  show(h('h1', {}, "What you'd love if you grew up there."), h('div', {}, h('button', { onclick: () => pickLanguage() }, 'Start')));
}

// Step 1: the language you're learning.
async function pickLanguage() {
  if (!S.catalogue) {
    const r = await fetch('/api/cities').then((x) => x.json()).catch(() => null);
    if (!r?.languages) return show(h('p', { class: 'note' }, 'Cities are unavailable right now. Please try again in a minute.'));
    S.catalogue = r;
  }
  // Only languages with a live city are offered; the rest are listed as coming soon.
  const { live, soon } = languageGroups(S.catalogue);
  show(h('h2', {}, 'Which language are you learning?'),
    h('div', { class: 'cities' }, live.map((l) => h('button', { class: 'postcard', onclick: () => { S.lang = l; suggestCity(); } },
      h('span', { class: serif(l.id) }, l.local), h('span', {}, l.name)))),
    soon.length ? h('p', { class: 'muted' }, `Coming soon: ${soon.map((l) => l.name).join(', ')}`) : null);
}

// Step 2: we suggest the best live city for that language.
function suggestCity() {
  const live = cityForLanguage(S.catalogue, S.lang.id);
  if (!live) {
    return show(h('h2', {}, `${S.lang.name} isn't live yet.`),
      h('p', { class: 'muted' }, `A city opens only when at least ${Math.round(S.catalogue.threshold * 100)}% of its picks in music, TV and movies are verified local. Its city hasn't reached that yet.`),
      h('button', { class: 'ghost', onclick: pickLanguage }, 'Pick another language'));
  }
  // Default is the measured best city; switching to another live city is one tap.
  const pick = (c) => {
    const others = liveCitiesForLanguage(S.catalogue, S.lang.id).filter((x) => x.id !== c.id);
    show(h('p', { class: 'muted' }, c.id === live.id ? `For ${S.lang.name}, we suggest` : `${S.lang.name} in`),
      h('h2', { class: serif(c.language) }, `${c.local} ${c.flag}`),
      c.lead ? h('p', { class: 'lead' }, c.lead.text) : null,
      h('button', { onclick: () => { S.city = c; favourite(); } }, `Go to ${c.name}`),
      others.length ? h('div', {}, others.map((o) => h('button', { class: 'ghost', onclick: () => pick(o) }, `Switch to ${o.name}`))) : null,
      h('button', { class: 'ghost', onclick: pickLanguage }, 'Change language'));
  };
  pick(live);
}

function favourite() {
  const i = S.favs.length;
  if (i >= MAX_FAVS) return morph();
  const p = PROMPTS[i];
  const input = h('input', { 'aria-label': p.label, placeholder: 'Start typing…', autocomplete: 'off' });
  const sugs = h('ul', { class: 'sugs' }); const msg = h('p', { class: 'muted' });
  let t, seq = 0;
  const alt = createAltTrigger();
  const pick = (e) => h('li', {}, h('button', { onclick: () => { S.favs.push(e); favourite(); } }, e.name, e.year ? ` (${e.year})` : ''));
  // Enter on a query with no results: ask the server for Qloo-verified alternate names (HG-8).
  input.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    const q = input.value.trim(); const my = seq;
    if (q.length < 2) return;
    msg.textContent = 'Looking for other names…';
    const found = await alt.submit(p.kind, q);
    if (found === null || my !== seq) return; // aborted/superseded: leave the message to the newer query
    msg.textContent = found.length ? 'Found it under another name:' : 'Nothing found. Try something like it.';
    sugs.replaceChildren(...found.slice(0, 3).map(pick));
  });
  input.addEventListener('input', () => {
    alt.onInput();
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
      alt.noteResults(q, body.results.length);
      msg.textContent = body.results.length ? '' : 'Nothing found. Press Enter to try other names.';
      sugs.replaceChildren(...body.results.slice(0, 3).map(pick));
    }, 600);
  });
  const shelf = h('div', { class: 'shelf', 'aria-label': 'Your favourites' }, S.favs.map((f) => h('span', { class: 'chip' }, f.name)));
  show(h('p', { class: 'muted' }, `Favourite ${i + 1} of ${MAX_FAVS}`), h('h2', {}, p.label), input, msg, sugs,
    canSkip(i) ? h('div', {}, h('button', { class: 'ghost', onclick: () => morph() }, 'Skip, that’s enough')) : null, shelf);
  input.focus();
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
  hdr.textContent = c.header; hdr.classList.toggle('ko', c.language === 'ko');
  await new Promise((r) => setTimeout(r, reduced ? 200 : 1200));
  if (!current()) return;
  reveal();
}

let revealEls = null;

function pickCard(p, hero = false) {
  const kind = { tv: 'Show', movie: 'Film', music: 'Band' }[p.category];
  const link = p.watch?.url ? h('a', { class: 'btn', href: p.watch.url, target: '_blank', rel: 'noopener', onclick: () => track({ event: 'tap', action: 'watch', pick: p.title }) }, `Where to watch${p.watch.provider ? ` · ${p.watch.provider}` : ''}${p.watch.label ? ` (${p.watch.label})` : ''}`)
    : p.preview ? h('audio', { controls: '', preload: 'none', src: p.preview.url, onplay: () => track({ event: 'tap', action: 'listen', pick: p.title }) }) : null;
  const flag = (f) => h('button', { onclick: (e) => { track({ event: 'flag', flag: f, pick: p.title, category: p.category }); e.target.textContent = 'Thanks'; e.target.disabled = true; } }, f === 'not_local' ? '👎 Not local' : '👎 Not my taste');
  return h('article', { class: `card ${hero ? 'hero' : ''}` },
    h('span', { class: 'kind' }, kind),
    p.image && hero ? h('img', { class: 'thumb', src: p.image, alt: '' }) : null,
    h(hero ? 'h2' : 'h3', { class: S.city.language === 'ko' ? 'ko' : '' }, p.title),
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
  const scarce = scarcePicks(S.results);
  const lead = S.catalogue?.cities.find((x) => x.id === S.city.id)?.lead;
  return [
    lead ? h('p', { class: 'lead' }, lead.text) : null,
    pending.length ? null : h('p', { class: 'muted' }, postcardCategories(S.results).length
      ? `On your postcard: ${postcardCategories(S.results).map((c) => ({ tv: 'shows', movie: 'films', music: 'bands' })[c]).join(', ')}`
      : 'Local picks are scarce for your taste here, so your postcard is empty this time.'),
    hero ? pickCard(hero, true) : h('div', { class: 'card' }, h('p', {}, pending.length ? 'Still landing…' : 'Nothing passed our origin checks this time.')),
    h('div', { class: 'grid' }, rest.map((p) => pickCard(p))),
    pending.length ? h('p', { class: 'muted' }, `Still flipping in: ${pending.join(', ')}…`) : null,
    notes.map((n) => h('p', { class: 'note' }, n)),
    scarce.length ? h('section', {}, h('h3', { class: 'serif' }, 'Also local, but scarce here'), h('div', { class: 'grid' }, scarce.map((p) => pickCard(p)))) : null,
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
  // Only other live cities are offered.
  const others = (S.catalogue?.cities || []).filter((c) => c.live && c.id !== S.city.id);
  show(h('p', { class: 'kind' }, S.city.header), picks, rating,
    h('section', { class: 'card postcard-summary' }, h('h3', { class: 'serif' }, `Keep your ${S.city.name} self`),
      h('button', { onclick: (e) => { e.target.replaceWith(h('p', { class: 'muted' }, 'Saving with an email link is coming soon.')); } }, `Save my ${S.city.name} self`),
      h('div', {}, others.map((c) => h('button', { class: 'ghost', onclick: () => { track({ event: 'try_city', to: c.id }); S.city = c; morph(); } }, `Try ${c.name}`)))));
  updateReveal();
}

hello();
