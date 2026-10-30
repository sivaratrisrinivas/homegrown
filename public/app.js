import { PROMPTS, MAX_FAVS, canSkip, QLOO_ORDER, MORPH_BUDGET_MS, flapSteps, padTo, rankPicks, userCountryFromLocale, createRunGuard, createSpacer, SKIP, createMemo, searchKey, DEBOUNCE_MS, settleFavourites, favouriteIds, pickKey, isPicked, lookupOutcome, LOOKUP_FAILED, QLOO_LOOKUP_TIMEOUT_MS, matchingProgress, present, twinClientKey, runCategories, gatedIfCurrent, shouldMemoTwin, scarcePicks, cityForLanguage, liveCitiesForLanguage, languageGroups } from './logic.js';
import { isMapReveal, mapFraming } from './maplogic.js';
const serif = (lang) => `serif ${lang === 'ko' ? 'ko' : ''}`;

const app = document.getElementById('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)', EASE_IN = 'cubic-bezier(.4,0,1,1)', EASE_SPRING = 'cubic-bezier(.34,1.4,.64,1)', EASE_FLAP = 'cubic-bezier(.5,0,.5,1)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fade = (el, ms = 150) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'linear' });
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
// S.favs holds only Qloo-matched favourites ({id,name,tags}); chosen-but-unmatched ones live in
// S.pending with their match promise kept separately in pendingMatches.
const pendingMatches = new Map();
const S = { favs: [], pending: [], city: null, results: {}, sound: false, catalogue: null, lang: null };
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const icon = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
const track = (body) => post('/api/feedback', { city: S.city?.id, favourites: favouriteIds(S.favs), ...body }).catch(() => {});

// Loops: at most one per screen; all pause while the tab is hidden, and observed ones pause off-screen.
document.addEventListener('visibilitychange', () => {
  for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations === Infinity) document.hidden ? a.pause() : a.play();
});
const offscreen = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('paused', !e.isIntersecting))) : null;
const observeLoop = (el) => { offscreen?.observe(el); return el; };

// Screens: one <section> at a time. A4 slides the old one out and the new one in (opacity only when reduced);
// focus moves to the new heading. Elements matching `still` (e.g. the shelf while a chip lands) don't slide.
let goingBack = false;
function show(...args) {
  const opts = args.length && args.at(-1)?.__opts ? args.pop() : {};
  const sec = h('section', { class: 'screen' }, ...present(args));
  const old = app.querySelector(':scope > .screen');
  if (old && opts.anim !== false) {
    const top = old.offsetTop; const leave = h('div', { class: 'leaving', 'aria-hidden': 'true', inert: '' }, old);
    leave.style.top = `${top}px`; app.append(leave);
    const dx = goingBack ? 12 : -12;
    const anims = [...old.children].map((c) => (reduced || c.matches('.pin')
      ? c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 150 : 160, fill: 'forwards' })
      : c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }], { duration: 160, easing: EASE_IN, fill: 'forwards' })));
    Promise.all(anims.map((a) => a.finished)).catch(() => {}).finally(() => leave.remove());
  } else { old?.remove(); app.querySelectorAll(':scope > .leaving').forEach((l) => l.remove()); }
  app.querySelector(':scope > .screen')?.remove();
  app.prepend(sec); window.scrollTo(0, 0);
  if (old && opts.anim !== false) {
    for (const c of sec.children) {
      if (opts.still && c.matches(opts.still)) continue;
      if (reduced || c.matches('.pin')) fade(c, reduced ? 150 : 280);
      else c.animate([{ opacity: 0, transform: `translateX(${goingBack ? -12 : 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT, delay: 60, fill: 'backwards' });
    }
  }
  const focusEl = opts.focus || sec.querySelector('h1,h2');
  if (focusEl) { if (focusEl.matches('h1,h2,div')) focusEl.setAttribute('tabindex', '-1'); focusEl.focus({ preventScroll: true }); }
  return sec;
}
const opts = (o) => ({ __opts: true, ...o });

// History: one entry per step (#lang, #city, #fav, #reveal), so the back button goes back one step.
let restoring = false;
function nav(step, n) {
  const st = { step, n }; const url = `${location.pathname}${location.search}#${step}`;
  const cur = history.state;
  if (restoring || (cur && cur.step === step && cur.n === n)) history.replaceState(st, '', url); else history.pushState(st, '', url);
}
function trimTo(n) {
  while (S.favs.length + S.pending.length > n) {
    if (S.pending.length) pendingMatches.delete(S.pending.pop().key); else S.favs.pop();
  }
}
addEventListener('popstate', (e) => {
  const st = e.state || { step: 'hello' };
  restoring = true; goingBack = true;
  try {
    runs.start(); revealEls?.destroy?.(); revealEls = null;
    if (st.step === 'hello' || !S.catalogue) hello(true);
    else if (st.step === 'lang' || !S.lang) pickLanguage();
    else if (st.step === 'city' || !S.city) suggestCity();
    else if (st.step === 'fav') { trimTo(st.n ?? 0); favourite(); }
    else if (st.step === 'reveal' && Object.keys(S.results).length) reveal();
    else favourite();
  } finally { restoring = false; goingBack = false; }
});

// Accent: set per city (CSS rule, or cities.json accent inline). A3 washes it in from the tapped tile.
function setCity(c, ev) {
  const root = document.documentElement; root.style.removeProperty('--accent');
  if (!c) { delete root.dataset.city; return; }
  root.dataset.city = c.id;
  if (getComputedStyle(root).getPropertyValue('--accent').trim().toUpperCase() === '#1A1917' && c.accent) root.style.setProperty('--accent', c.accent);
  if (reduced || !ev) return;
  const x = ev.clientX || innerWidth / 2, y = ev.clientY || innerHeight / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const w = h('div', { class: 'wash', 'aria-hidden': 'true' }); document.body.append(w);
  const at = (s) => `translate(${x}px,${y}px) scale(${s})`;
  w.animate([{ transform: at(0), opacity: 1 }, { transform: at(R / 10), opacity: 1, offset: 0.65 }, { transform: at(R / 10), opacity: 0 }], { duration: 600, easing: EASE_OUT }).finished.catch(() => {}).finally(() => w.remove());
}
let koFont = false;
function loadKorean() {
  if (koFont) return; koFont = true;
  document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500&display=swap' }));
}

// Sound: off by default, toggled on the board. A synthesised 8 ms noise click, at most one per 40 ms.
let actx, lastClick = 0;
function click() {
  if (!S.sound) return;
  const t = performance.now(); if (t - lastClick < 40) return; lastClick = t;
  actx ||= new AudioContext();
  const len = Math.ceil(actx.sampleRate * 0.008), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(), g = actx.createGain(); src.buffer = buf; g.gain.value = 0.03;
  src.connect(g).connect(actx.destination); src.start();
}
const SPEAKER = (on) => `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 8h3l4-3v10l-4-3H3z" fill="currentColor"/>${on ? '<path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10"/>' : '<path d="M13 8l4 4M17 8l-4 4"/>'}</svg>`;
function soundButton() {
  const b = h('button', { class: 'snd', 'aria-pressed': String(S.sound), 'aria-label': 'Flap sound' }, icon(SPEAKER(S.sound)));
  b.onclick = () => { S.sound = !S.sound; b.setAttribute('aria-pressed', String(S.sound)); b.replaceChildren(icon(SPEAKER(S.sound))); };
  return b;
}

// Fetch the catalogue while the hello screen is up, so Start never waits on the network.
let cataloguePromise = null;
const loadCatalogue = () => (cataloguePromise ||= fetch('/api/cities').then((x) => x.json()).catch(() => null).then((r) => { if (!r?.languages) cataloguePromise = null; return r; }));
function hello(rebuild) {
  loadCatalogue(); setCity(null);
  // The hello screen is already in index.html (so it paints before JS); just wire up Start.
  const start = !rebuild && document.getElementById('start');
  if (start) { start.disabled = false; start.onclick = () => pickLanguage(); history.replaceState({ step: 'hello' }, '', location.pathname + location.search); return; }
  show(h('h1', {}, "What you'd love if you grew up there."), h('p', { class: 'sub' }, 'Pick 3 things you love. Meet the local you.'),
    h('div', { class: 'cta pin' }, h('button', { class: 'primary', onclick: () => pickLanguage() }, 'Start')));
}

// Step 1: the language you're learning. Only languages with a live city are offered.
async function pickLanguage() {
  if (!S.catalogue) {
    const r = await loadCatalogue();
    if (!r?.languages) return show(h('h2', {}, 'You’re learning…'), h('p', { class: 'status', role: 'status' }, 'Cities are unavailable right now.'), h('div', {}, h('button', { class: 'quiet', onclick: () => pickLanguage() }, 'Try again')));
    S.catalogue = r;
  }
  nav('lang'); setCity(null);
  const { live } = languageGroups(S.catalogue);
  show(h('h2', {}, 'You’re learning…'),
    h('div', { class: 'tiles' }, live.map((l) => h('button', { class: 'tile', onclick: (e) => { S.lang = l; if (l.id === 'ko') loadKorean(); suggestCity(null, e); } },
      h('span', { class: serif(l.id), lang: l.id }, l.local), h('span', { class: 'cap' }, l.name)))));
}

// Step 2: we suggest the best live city for that language; other live cities are tiles under "or".
function suggestCity(chosen, ev) {
  const best = cityForLanguage(S.catalogue, S.lang.id);
  const back = h('div', { class: 'top' }, h('button', { class: 'quiet', onclick: () => { goingBack = true; try { pickLanguage(); } finally { goingBack = false; } } }, '‹ Language'));
  nav('city');
  if (!best) {
    return show(back, h('h2', {}, S.lang.name), h('p', { class: 'body' }, 'Not ready yet — we only open a city when its picks are truly local.'));
  }
  const c = chosen || (S.city?.language === S.lang.id ? S.city : best);
  setCity(c, ev);
  const others = liveCitiesForLanguage(S.catalogue, S.lang.id).filter((x) => x.id !== c.id);
  show(back,
    h('div', {}, h('p', { class: 'cap' }, c.id === best.id ? `${S.lang.name} · Best match` : S.lang.name),
      h('h2', { class: `city-name ${serif(c.language)}`, lang: c.language, style: 'margin:8px 0' }, c.local),
      h('p', { class: 'cap', style: 'text-transform:none;letter-spacing:0;font-size:15px' }, c.local !== c.name ? `${c.name} ${c.flag}` : c.flag)),
    others.length ? h('p', { class: 'or' }, 'or') : null,
    others.length ? h('div', { class: 'tiles' }, others.map((o) => h('button', { class: 'tile', onclick: (e) => suggestCity(o, e) },
      h('span', { class: serif(o.language), lang: o.language }, o.local), h('span', { class: 'cap' }, o.name)))) : null,
    h('div', { class: 'cta pin' }, h('button', { class: 'primary', onclick: () => { S.city = c; favourite(); } }, `Choose ${c.name}`)));
}

// Typing hits /api/suggest (TMDB / iTunes / Open Library, no Qloo, cached). Only a chosen
// favourite is matched to Qloo, once, in the background through the 7 s gate.
const suggestMemo = createMemo();
function resolveFavourite(sug, kind) {
  const sk = searchKey(kind, sug.name);
  const fromMemo = searchMemo.get(sk);
  const p = fromMemo ? Promise.resolve(fromMemo) : qlooGate(async () => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), QLOO_LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/search?kind=${kind}&q=${encodeURIComponent(sug.name)}`, { signal: ctl.signal });
      const r = { ok: res.ok, body: await res.json().catch(() => ({})) };
      if (r.ok) searchMemo.set(sk, r); // failures are never memoised
      return r;
    } finally { clearTimeout(t); }
  });
  // Failure (HTTP error, throw, timeout) -> LOOKUP_FAILED; Qloo answered but no name match -> null.
  return p.then((r) => lookupOutcome(r, sug)).catch(() => LOOKUP_FAILED);
}

const EXAMPLES = ['e.g. Breaking Bad', 'e.g. Radiohead', 'e.g. Amélie', 'e.g. Normal People', 'Anything at all'];
let flyFrom = null; // rect of the suggestion just chosen (A6)
function favourite(note) {
  const i = S.favs.length + S.pending.length;
  if (i >= MAX_FAVS) return morph();
  nav('fav', i);
  const p = PROMPTS[i];
  const input = h('input', { 'aria-label': p.label, placeholder: EXAMPLES[i], autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const field = h('div', { class: 'field' }, input, h('div', { class: 'hair', 'aria-hidden': 'true' }, h('i')));
  const sugs = h('ul', { class: 'sugs' });
  const msg = h('p', { class: 'status', 'aria-live': 'polite' }, note || '');
  const sr = h('span', { class: 'sr', 'aria-live': 'polite' });
  let t, seq = 0, ctl, busyT;
  const busy = (on) => { clearTimeout(busyT); if (on) busyT = setTimeout(() => field.classList.add('busy'), 150); else field.classList.remove('busy'); sr.textContent = on ? 'Searching…' : ''; };
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim(); const my = ++seq;
      if (q.length < 2) { sugs.replaceChildren(); msg.textContent = note || ''; busy(false); return; }
      const sk = searchKey(p.kind, q);
      let r = suggestMemo.get(sk);
      if (!r) {
        busy(true);
        ctl?.abort(); ctl = new AbortController();
        try {
          const res = await fetch(`/api/suggest?kind=${p.kind}&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
          r = { ok: res.ok, body: await res.json().catch(() => ({})) };
        } catch { if (my === seq) { busy(false); msg.textContent = 'Search is unavailable right now.'; } return; }
        if (r.ok && !r.body.partial) suggestMemo.set(sk, r);
      }
      if (my !== seq) return;
      busy(false);
      if (!r.ok) { msg.textContent = r.body.message || 'Search is unavailable right now.'; return; }
      const results = r.body.results || [];
      msg.textContent = results.length ? '' : 'Nothing found. Try something like it.';
      sugs.replaceChildren(...results.slice(0, 3).map((e) => h('li', {}, h('button', { onclick: (ev) => {
        const kind = e.kind || p.kind; const pick = pickKey(kind, e.name, e.year);
        if (isPicked(pick, S.favs, S.pending)) { msg.textContent = `${e.name} is already in your favourites.`; return; }
        const key = `${pick}|${S.pending.length + S.favs.length}`;
        pendingMatches.set(key, resolveFavourite(e, kind));
        S.pending.push({ key, pick, name: e.name, sug: e, kind });
        flyFrom = ev.currentTarget.getBoundingClientRect();
        favourite();
      } }, h('span', {}, e.name), e.year ? h('span', { class: 'yr' }, e.year) : null))));
    }, DEBOUNCE_MS);
  });
  const chosen = [...S.favs, ...S.pending];
  const dots = h('div', { class: 'dots', role: 'img', 'aria-label': `${i} of ${MAX_FAVS} favourites` }, PROMPTS.map((_, k) => h('i', { class: k < i ? 'on' : '' })));
  const shelf = h('div', { class: 'shelf', 'aria-label': 'Your favourites' }, chosen.map((f) => h('span', { class: 'chip' }, f.name)));
  const from = flyFrom; flyFrom = null;
  show(h('div', { class: 'dots-row' }, dots, canSkip(i) ? h('button', { class: 'quiet', onclick: () => morph() }, 'That’s enough →') : null), shelf,
    h('h2', { id: 'prompt' }, p.label), field, msg, sr, sugs, opts({ focus: input, still: from ? '.dots-row,.shelf' : null }));
  if (from && !reduced) {
    const chip = shelf.lastElementChild; const to = chip.getBoundingClientRect();
    chip.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px) rotate(-3deg)` }, { transform: 'none' }], { duration: 420, easing: EASE_SPRING });
    dots.children[i - 1]?.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { duration: 420, easing: EASE_SPRING });
    shelf.scrollLeft = shelf.scrollWidth;
  }
}

// Split-flap row: cells settle left→right (28 ms stagger), ≤ 6 intermediate characters at 55 ms each.
function flapRow(text, width, withTick = true) {
  const row = h('div', { class: 'row', role: 'img', 'aria-label': text });
  const fit = (s) => { const c = padTo(s, width); if ([...String(s)].length > width) c[width - 1] = '…'; return c; };
  row.cells = fit(text.toUpperCase()).map((ch) => h('span', { class: 'flap', 'aria-hidden': 'true' }, ch));
  row.append(...row.cells);
  if (withTick) { row.tick = h('span', { class: 'flap tick', 'aria-hidden': 'true' }, '…'); row.append(row.tick); }
  row.flipTo = async (to) => {
    row.setAttribute('aria-label', to);
    const target = fit(to);
    if (reduced) { row.cells.forEach((c, k) => (c.textContent = target[k])); await fade(row).finished.catch(() => {}); return; }
    await Promise.all(row.cells.map(async (cell, k) => {
      await wait(k * 28);
      for (const ch of flapSteps(cell.textContent, target[k], 7)) {
        cell.animate([{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(-90deg)', opacity: 1 }], { duration: 55, easing: EASE_FLAP, pseudoElement: '::before' });
        cell.textContent = ch; click();
        await wait(55);
      }
    }));
  };
  return row;
}
async function flipHeader(hdr, text, ko) {
  if (reduced) { hdr.textContent = text; hdr.classList.toggle('ko', ko); return; }
  await hdr.animate([{ transform: 'perspective(400px) rotateX(0)' }, { transform: 'perspective(400px) rotateX(90deg)' }], { duration: 250, easing: EASE_FLAP }).finished.catch(() => {});
  hdr.textContent = text; hdr.classList.toggle('ko', ko);
  await hdr.animate([{ transform: 'perspective(400px) rotateX(-90deg)' }, { transform: 'perspective(400px) rotateX(0)' }], { duration: 250, easing: EASE_FLAP }).finished.catch(() => {});
}

// The board appears at once with the favourites; matching happens on it (✓ per row), then picks flip in.
const runs = createRunGuard();
const rowKey = (f) => f.pick || f.id;
async function morph() {
  if (!S.pending.length && S.favs.length < 3) return favourite('Pick at least 3 favourites.');
  const current = runs.start(); revealEls?.destroy?.(); revealEls = null;
  const c = S.city; setCity(c); nav('reveal');
  const onBoard = [...S.favs, ...S.pending];
  const width = Math.min(22, Math.max(12, ...onBoard.map((f) => [...f.name].length)));
  const rows = new Map(onBoard.map((f) => [rowKey(f), flapRow(f.name, width)]));
  for (const f of S.favs) rows.get(rowKey(f)).tick.textContent = '✓';
  const hdr = h('h2', { class: 'hdr' }, 'Matching…');
  const pend = [...S.pending]; const total = pend.length; let done = 0;
  const progress = h('p', { class: 'foot', role: 'status', 'aria-live': 'polite' }, matchingProgress(done, total));
  if (!total) progress.textContent = `Asking people in ${c.name}…`;
  const board = h('div', { class: 'board' }, hdr, soundButton(), [...rows.values()], progress);
  const sec = show(board);
  // A7: one blinking cursor, on the first row still being matched.
  const cursor = () => { let first = true; for (const f of pend) { const r = rows.get(rowKey(f)); if (r.settled) continue; r.tick.classList.toggle('cursor', first && !reduced); first = false; } };
  cursor();
  const matches = new Map(await Promise.all(pend.map(async (f) => {
    const m = await pendingMatches.get(f.key);
    progress.textContent = matchingProgress(++done, total);
    const r = rows.get(rowKey(f)); r.settled = true; r.tick.classList.remove('cursor');
    r.tick.textContent = m && !m.failed && m.id ? '✓' : '×'; cursor();
    return [f.key, m];
  })));
  if (!current()) return;
  const { favs, missed, failed } = settleFavourites(S.favs, S.pending, matches);
  S.pending.forEach((f) => pendingMatches.delete(f.key));
  S.favs = favs; S.pending = failed;
  for (const name of missed) for (const [, r] of rows) if (r.getAttribute('aria-label') === name) r.classList.add('dim');
  if (failed.length) {
    // Couldn't reach Qloo: keep these picks and offer a retry; nothing is dropped or called a no-match.
    for (const f of failed) rows.get(rowKey(f))?.classList.add('dim');
    const retry = () => { for (const f of S.pending) pendingMatches.set(f.key, resolveFavourite(f.sug, f.kind)); morph(); };
    progress.textContent = '';
    sec.append(h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, `Couldn't reach our matcher for ${failed.map((f) => f.name).join(', ')}, try again.`),
      h('div', {}, h('button', { class: 'primary', onclick: retry }, 'Try again')));
    return;
  }
  if (S.favs.length < 3) { favourite(`We couldn't match ${missed.join(', ')}. Pick ${3 - S.favs.length} more.`); return; }
  hdr.textContent = 'Your favourites';
  progress.textContent = `Asking people in ${c.name}…`;
  const flipRows = S.favs.map((f) => rows.get(rowKey(f))).filter(Boolean);

  S.results = {};
  const base = { favourites: S.favs.map(({ id, name, tags }) => ({ id, name, tags })), city: c.id, userCountry: userCountryFromLocale(navigator.language) };
  let flipped = 0, flips = Promise.resolve();
  const land = (cat, r) => {
    if (!current()) return; // a newer city run started: drop stale responses
    S.results[cat] = r.ok ? r.body : { picks: [], note: r.body.message || 'This part is unavailable right now.', error: true };
    for (const p of S.results[cat].picks) if (flipped < flipRows.length) { const row = flipRows[flipped++]; flips = flips.then(() => current() && row.flipTo(p.title)).then(() => wait(reduced ? 0 : 200)); }
    if (revealEls) updateReveal();
  };
  // Every category is Qloo-backed, so they go one at a time through the 7 s browser gate.
  // One failed category must not stop the ones after it.
  const qlooP = runCategories(QLOO_ORDER, (cat) => qlooPost({ ...base, category: cat }, current), land);
  await Promise.race([qlooP, wait(MORPH_BUDGET_MS)]);
  await Promise.race([flips, wait(8000)]);
  if (!current()) return;
  await flipHeader(hdr, c.header, c.language === 'ko');
  board.classList.add('city');
  await wait(reduced ? 0 : 300);
  if (!current()) return;
  reveal(board);
}

let revealEls = null;
const KIND = { tv: 'Show', movie: 'Film', music: 'Band' };
const CAT = { tv: 'Shows', movie: 'Films', music: 'Music' };
const LEVEL = { easy: 1, medium: 2, hard: 3 };
let uid = 0;
const sized = (url, w) => String(url).replace(/(image\.tmdb\.org\/t\/p\/)[^/]+\//, `$1${w}/`);
function kindLine(p) {
  const n = LEVEL[p.difficulty];
  return h('p', { class: 'cap' }, KIND[p.category] || 'Pick', n ? [' · ', h('span', { class: 'diff', role: 'img', 'aria-label': `${p.difficulty[0].toUpperCase()}${p.difficulty.slice(1)} difficulty` }, '●'.repeat(n) + '○'.repeat(3 - n))] : null);
}
// Poster: an accent-soft tile with the title's first letter until the image has loaded (A11). Never grey.
function art(p, cls, hero) {
  const box = h('div', { class: cls, 'aria-hidden': 'true' }, h('b', {}, [...String(p.title || '?')][0]));
  if (p.image) {
    const img = h('img', { alt: '', decoding: 'async', loading: hero ? 'eager' : 'lazy', fetchpriority: hero ? 'high' : null, src: sized(p.image, hero ? 'w342' : 'w92') });
    img.addEventListener('load', () => { img.classList.add('in'); if (reduced) fade(img); else img.animate([{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE_OUT }); }, { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    box.append(img);
  }
  return box;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function whyLine(p) {
  const text = p.why?.text || ''; const names = (p.why?.favourite ? [p.why.favourite] : S.favs.map((f) => f.name)).filter(Boolean);
  if (!names.length) return h('p', { class: 'why' }, text);
  return h('p', { class: 'why' }, text.split(new RegExp(`(${names.map(esc).join('|')})`)).map((part) => (names.includes(part) ? h('em', {}, part) : part)));
}
function player(p) {
  const audio = h('audio', { preload: 'none', src: p.preview.url, onplay: () => track({ event: 'tap', action: 'listen', pick: p.title }) });
  const ring = icon('<svg class="prog" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="21" stroke-dasharray="132" stroke-dashoffset="132"/></svg>');
  const glyph = (on) => icon(on ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>' : '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5l9 5.5-9 5.5z" fill="currentColor"/></svg>');
  const circle = h('span', { class: 'ring' }, ring, glyph(false));
  const btn = h('button', { class: 'play', 'aria-pressed': 'false', 'aria-label': `Listen to ${p.title}` }, circle, h('span', {}, 'Listen'));
  btn.onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  const sync = () => { const on = !audio.paused; btn.setAttribute('aria-pressed', String(on)); circle.replaceChild(glyph(on), circle.lastChild); };
  audio.addEventListener('play', sync); audio.addEventListener('pause', sync); audio.addEventListener('ended', sync);
  audio.addEventListener('timeupdate', () => { if (audio.duration) ring.firstChild.setAttribute('stroke-dashoffset', String(132 * (1 - audio.currentTime / audio.duration))); });
  return h('div', {}, btn, audio);
}
function action(p) {
  if (p.watch?.url) {
    return h('a', { class: 'outline', href: p.watch.url, target: '_blank', rel: 'noopener', title: p.watch.provider ? `${p.watch.provider}${p.watch.label ? ` (${p.watch.label})` : ''}` : null, onclick: () => track({ event: 'tap', action: 'watch', pick: p.title }) },
      p.watch.provider ? `Watch on ${p.watch.provider}` : 'Find it');
  }
  return p.preview?.url ? player(p) : null;
}
// One "⋯" per card keeps the two-error feedback (not local / not my taste) without ten buttons.
function flagMenu(p, card) {
  const btn = h('button', { class: 'more', 'aria-label': `Feedback on ${p.title}`, 'aria-expanded': 'false', 'aria-haspopup': 'true' }, '⋯');
  let menu = null;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(true); } };
  const onOut = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(false); };
  function close(refocus) {
    if (!menu) return; const m = menu; menu = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOut, true);
    m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 }).finished.catch(() => {}).finally(() => m.remove());
    if (refocus) btn.focus();
  }
  const item = (f, label) => h('button', { onclick: () => {
    track({ event: 'flag', flag: f, pick: p.title, category: p.category });
    close(false); card.classList.add('noted');
    const noted = h('span', { class: 'more cap', role: 'status', style: 'display:grid;place-items:center;width:auto;padding:0 8px' }, 'Noted');
    btn.replaceWith(noted); if (!reduced) fade(noted, 220);
  } }, label);
  btn.onclick = () => {
    if (menu) return close(true);
    menu = h('div', { class: 'menu' }, item('not_local', 'Not really local'), item('not_my_taste', 'Not my taste'));
    btn.after(menu); btn.setAttribute('aria-expanded', 'true'); fade(menu, reduced ? 150 : 120); menu.firstChild.focus();
    document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onOut, true);
  };
  return btn;
}
const enTitle = (p) => (p.englishTitle && p.englishTitle !== p.title ? p.englishTitle : null);
// Hero ticket: the one design for a pick, in the list and in the map's pull sheet.
function pickCard(p, hero = true) {
  const kind = KIND[p.category] || 'Pick';
  const card = h('article', { class: 'ticket', 'aria-label': `${kind}: ${p.title}, from ${S.city.name}` });
  card.append(flagMenu(p, card), kindLine(p), art(p, 'poster', hero),
    h('div', {}, h('h2', { class: S.city.language === 'ko' ? 'ko' : '', lang: S.city.language }, p.title), enTitle(p) ? h('p', { class: 'en' }, enTitle(p)) : null),
    whyLine(p), action(p), hero && p.tip ? h('p', { class: 'tip' }, p.tip) : null);
  return h('div', { class: 'ticket-wrap' }, card);
}
// "Also yours": slim rows that expand in place (A12).
function pickRow(p) {
  const key = `${p.category}|${p.title}`; const kind = KIND[p.category] || 'Pick';
  const row = h('article', { class: 'prow', 'aria-label': `${kind}: ${p.title}, from ${S.city.name}` });
  const id = `pb-${++uid}`;
  const head = h('button', { class: 'head', 'aria-expanded': 'false', 'aria-controls': id },
    art(p, 'thumb', false), h('span', { class: 't' }, h('span', { class: serif(S.city.language), lang: S.city.language }, p.title), enTitle(p) ? h('span', { class: 'en' }, enTitle(p)) : null, kindLine(p)));
  const body = h('div', { class: 'body', id, inert: '' }, h('div', {}, whyLine(p), action(p)));
  const set = (open) => { row.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); open ? body.removeAttribute('inert') : body.setAttribute('inert', ''); open ? revealEls?.open.add(key) : revealEls?.open.delete(key); };
  head.onclick = () => set(!row.classList.contains('open'));
  row.append(head, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'), body, flagMenu(p, row));
  if (revealEls?.open.has(key)) set(true);
  return row;
}
// A10: each pick card stamps in once, the first time it mounts (late arrivals too).
function stampIn(el, p, n, delay = 0) {
  const seen = revealEls?.seen; const key = `${p.category}|${p.title}`;
  if (!seen || seen.has(key)) return el; seen.add(key);
  if (reduced) fade(el);
  else el.animate([{ opacity: 0, transform: 'translateY(16px) rotate(-1.5deg)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE_SPRING, delay: delay + n * 60, fill: 'backwards' });
  return el;
}

function picksView() {
  const { hero, rest } = rankPicks(S.results);
  const pending = QLOO_ORDER.filter((k) => !S.results[k]);
  const scarce = scarcePicks(S.results);
  const notes = QLOO_ORDER.filter((k) => S.results[k]?.note).map((k) => (S.results[k].error ? `${CAT[k]} didn't come through this time.` : S.results[k].note));
  const first = revealEls?.first ? 150 : 0;
  const watched = [...(hero ? [hero] : []), ...rest, ...scarce].find((p) => p.watch?.attribution);
  return [
    hero ? stampIn(pickCard(hero, true), hero, 0, first)
      : pending.length ? null : h('p', { class: 'body' }, 'We couldn’t find picks local enough for your taste here. Try another city.'),
    rest.length ? h('div', { class: 'list' }, h('p', { class: 'cap' }, 'Also yours'), rest.map((p, n) => stampIn(pickRow(p), p, n + 1, first))) : null,
    pending.map((k, n) => { const s = h('div', { class: `skel${n === 0 && !reduced && !revealEls?.map ? ' shim' : ''}` }, `${CAT[k]} — landing…`); return n === 0 ? observeLoop(s) : s; }),
    notes.map((n) => h('p', { class: 'note-row' }, n)),
    scarce.length ? scarceSection(scarce) : null,
    watched ? h('p', { class: 'foot-line' }, `Where-to-watch data: ${watched.watch.attribution}.`) : null,
  ].flat().filter(Boolean);
}
function scarceSection(scarce) {
  const list = h('div', { class: 'list', hidden: revealEls?.scarceOpen ? null : '' }, scarce.map((p) => pickRow(p)));
  const btn = h('button', { class: 'quiet', 'aria-expanded': String(!!revealEls?.scarceOpen) }, `${scarce.length} more, rarer find${scarce.length === 1 ? '' : 's'}`);
  btn.onclick = () => { const open = list.hidden; list.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (revealEls) revealEls.scarceOpen = open; };
  return h('section', {}, btn, list);
}
// Only the picks region re-renders as categories land; the rating/note form keeps its state.
function updateReveal() { if (revealEls.update) return revealEls.update(); revealEls.picks.replaceChildren(...picksView()); }
function shownPicks() { const { hero, rest } = rankPicks(S.results); return [hero, ...rest].filter(Boolean); }

// ?reveal=map swaps the picks list for a walkable map. Without the flag nothing changes.
async function mapPicks() {
  const { createMapReveal } = await import('./map.js');
  const m = createMapReveal({ h, city: S.city, getResults: () => S.results, picks: () => [...shownPicks(), ...scarcePicks(S.results)], pickCard, reduced, ping: click });
  return m;
}
function setView(map) {
  const q = new URLSearchParams(location.search); if (map) q.set('reveal', 'map'); else q.delete('reveal');
  const s = q.toString(); history.replaceState(history.state, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`);
  revealEls?.destroy?.(); reveal();
}
function rateStrip() {
  const thanks = h('span', { class: 'thanks', role: 'status' });
  const rating = h('section', { class: 'rate' });
  const send = (note) => track({ event: 'rating', rating: Number(rating.dataset.r), note, shown: shownPicks().map((p) => `${p.category}:${p.title}:${p.verification?.source || ''}`.slice(0, 200)) });
  const noteBtn = h('button', { class: 'quiet', onclick: () => {
    const input = h('input', { id: 'note', 'aria-label': 'Your note', placeholder: 'What felt off?' });
    const form = h('form', { class: 'noteform', onsubmit: (e) => { e.preventDefault(); send(input.value); form.replaceWith(h('p', { class: 'thanks', role: 'status' }, 'Thank you')); } }, input, h('button', { class: 'outline', type: 'submit' }, 'Send'));
    noteBtn.replaceWith(form); input.focus();
  } }, 'Add a note');
  rating.append(h('p', {}, 'Feels like you?'),
    h('div', { class: 'stamps', role: 'group', 'aria-label': 'Rate from 1 to 5' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'stamp', 'aria-pressed': 'false', 'aria-label': `${n} of 5`, onclick: (e) => {
      rating.querySelectorAll('.stamp').forEach((x) => x.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); rating.dataset.r = n;
      if (!reduced) e.currentTarget.firstChild.animate([{ transform: 'scale(1)' }, { transform: 'scale(.9)', offset: 0.3 }, { transform: 'scale(1.06) rotate(-6deg)', offset: 0.7 }, { transform: 'rotate(-6deg)' }], { duration: 320, easing: EASE_SPRING });
      send('');
      if (!thanks.textContent) { thanks.textContent = 'Thanks'; fade(thanks, reduced ? 150 : 220); rating.append(noteBtn); }
    } }, h('span', {}, n)))), thanks);
  return rating;
}
function reveal(fromBoard) {
  nav('reveal');
  const first = fromBoard?.getBoundingClientRect();
  const picks = h('div', { class: 'screen', style: 'gap:16px' });
  revealEls = { picks, seen: new Set(), open: new Set(), first: !!fromBoard };
  const ko = S.city.language === 'ko';
  const board = h('div', { class: 'board compact city' }, h('h2', { class: `hdr ${ko ? 'ko' : ''}`, lang: S.city.language }, S.city.header), flapRow(S.city.name.toUpperCase(), [...S.city.name].length, false));
  const mapOn = isMapReveal(location.search);
  const toggle = h('div', { style: 'margin:-16px 0 -8px -8px' }, h('button', { class: 'quiet', onclick: () => setView(!mapOn) }, mapOn ? 'List view' : 'See it as a map'));
  // Only other live cities are offered.
  const others = (S.catalogue?.cities || []).filter((c) => c.live && c.id !== S.city.id);
  const next = others.length ? h('div', { class: 'tiles next' }, others.map((c) => h('button', { class: 'tile', onclick: (e) => { track({ event: 'try_city', to: c.id }); S.city = c; setCity(c, e); morph(); } },
    h('span', { class: 'serif' }, `Grow up in ${c.name} instead →`)))) : null;
  show(board, toggle, picks, rateStrip(), next, opts({ anim: !fromBoard, focus: board.firstChild }));
  if (fromBoard && !reduced) {
    const last = board.getBoundingClientRect(); const s = first.width / last.width;
    board.animate([{ transform: `translate(${first.left - last.left}px,${first.top - last.top}px) scale(${s})` }, { transform: 'none' }], { duration: 600, easing: EASE_OUT });
  } else if (fromBoard) fade(app.querySelector('.screen'));
  if (isMapReveal(location.search)) {
    updateReveal(); // the normal reveal shows first, so the area is never blank
    const mine = revealEls;
    mapPicks().then((m) => {
      if (revealEls !== mine) return m.destroy();
      mine.map = true;
      // The map holds the picks; skeletons, notes and the footer line stay beneath it.
      const framing = h('div', { class: 'map-framing screen', style: 'gap:8px' });
      const refresh = () => {
        try { m.update(); framing.replaceChildren(...mapFraming(picksView())); }
        catch { try { m.destroy(); } catch {} delete mine.update; delete mine.destroy; picks.replaceChildren(...picksView()); }
      };
      picks.replaceChildren(m.el, framing);
      mine.update = refresh; mine.destroy = m.destroy; refresh();
    })
        .catch(() => { if (revealEls === mine) { delete mine.update; delete mine.destroy; picks.replaceChildren(...picksView()); } });
    return;
  }
  updateReveal();
}

hello();
