import { JOURNEY_FAVS, journeyFor, revealHeader, journeyPicks, encodeShare, decodeShare, QLOO_ORDER, liveCats, pendingCats, runCatsFor, NOT_READY, flapSteps, padTo, userCountryFromLocale, createRunGuard, createSpacer, createMemo, searchKey, DEBOUNCE_MS, settleFavourites, favouriteIds, pickKey, isPicked, lookupOutcome, LOOKUP_FAILED, QLOO_LOOKUP_TIMEOUT_MS, matchingProgress, present, twinClientKey, runCategories, gatedIfCurrent, shouldMemoTwin, scarcePicks, cityForLanguage, liveCitiesForLanguage, languageGroups } from './logic.js';
import { indiaSection } from './india.js';
import { createAltTrigger, verifiedFavourite, missedNote, mergeMissed, resolveMissed } from './altnames-client.js';
import { CATEGORY } from './config.js';
// HG-10 v1 is one journey: hello → language → city → 3 favourites → morph board → reveal → share.
const J = journeyFor(CATEGORY);
// HG-9: run, wait on and note only the catalogue's live categories (within this journey's category).
const runCats = () => runCatsFor(J, S.catalogue);
const serif = (lang) => `serif ${lang === 'ko' ? 'ko' : ''}`;

const app = document.getElementById('app');
const motionMq = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionMq.matches; // read live at each call, so a mid-session OS toggle applies
// Motion tokens come from styles.css (:root), so timings are retuned in one place.
const tokens = getComputedStyle(document.documentElement);
const T = (name) => parseFloat(tokens.getPropertyValue(`--${name}`)) || 0;
const E = (name) => tokens.getPropertyValue(`--ease-${name}`).trim() || 'ease';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fade = (el, ms = T('fade')) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'linear' });
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
const S = { favs: [], pending: [], missed: [], city: null, results: {}, catalogue: null, lang: null };
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const icon = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
const track = (body) => post('/api/feedback', { city: S.city?.id, favourites: favouriteIds(S.favs), ...body }).catch(() => {});

// Loops: at most one per screen, and all of them pause while the tab is hidden.
document.addEventListener('visibilitychange', () => {
  for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations === Infinity) document.hidden ? a.pause() : a.play();
});

// Screens: one <section> at a time. A4 slides the old one out and the new one in (opacity only when
// reduced()); focus moves to the new heading. Every screen replace bumps screenGen and aborts the
// previous screen's alt-names lookup, so a stale lookup can never change S.favs (HG-8).
let goingBack = false;
let screenGen = 0, screenAbort = null;
const show = (...els) => { screenGen++; screenAbort?.(); screenAbort = null; return swap(els); };
const opts = (o) => ({ __opts: true, ...o });
const missNote = (missed) => missedNote(missed, S.favs.length + S.pending.length);
function swap(args) {
  const o = args.length && args.at(-1)?.__opts ? args.pop() : {};
  const sec = h('section', { class: 'screen' }, ...present(args));
  const old = app.querySelector(':scope > .screen');
  const dx = T('travel') * (goingBack ? 1 : -1);
  if (old && o.anim !== false) {
    const top = old.offsetTop; const leave = h('div', { class: 'leaving', 'aria-hidden': 'true', inert: '' }, old);
    leave.style.top = `${top}px`; app.append(leave);
    const anims = [...old.children].map((c) => (reduced() || c.matches('.pin')
      ? c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? T('fade') : T('d-exit'), fill: 'forwards' })
      : c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }], { duration: T('d-exit'), easing: E('in'), fill: 'forwards' })));
    Promise.all(anims.map((a) => a.finished)).catch(() => {}).finally(() => leave.remove());
  } else { old?.remove(); app.querySelectorAll(':scope > .leaving').forEach((l) => l.remove()); }
  app.querySelector(':scope > .screen')?.remove();
  app.prepend(sec); window.scrollTo(0, 0);
  if (old && o.anim !== false) {
    for (const c of sec.children) {
      if (o.still && c.matches(o.still)) continue;
      if (reduced() || c.matches('.pin')) fade(c, reduced() ? T('fade') : T('d-enter'));
      else c.animate([{ opacity: 0, transform: `translateX(${-dx}px)` }, { opacity: 1, transform: 'none' }], { duration: T('d-enter'), easing: E('out'), delay: T('d-enter-delay'), fill: 'backwards' });
    }
  }
  const focusEl = o.focus || sec.querySelector('h1,h2');
  if (focusEl) { if (focusEl.matches('h1,h2,div')) focusEl.setAttribute('tabindex', '-1'); focusEl.focus({ preventScroll: true }); }
  return sec;
}

// History: one entry per step (#lang, #city, #fav, #reveal), so the back button goes back one step.
let restoring = false;
function nav(step, n) {
  const st = { step, n }; const url = `${location.pathname}#${step}`;
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
    runs.start();
    if (st.step === 'friend') friendView();
    else if (st.step === 'hello' || !S.catalogue) hello(true);
    else if (st.step === 'lang' || !S.lang) pickLanguage();
    else if (st.step === 'city' || !S.city) suggestCity();
    else if (st.step === 'fav') { trimTo(st.n ?? 0); favourite(); }
    else if (st.step === 'reveal' && Object.keys(S.results).length) reveal();
    else favourite();
  } finally { restoring = false; goingBack = false; }
});

// Accent: set per city (CSS rule, or cities.json accent inline); CSS cross-fades it (--d-2).
function setCity(c) {
  const root = document.documentElement; root.style.removeProperty('--accent');
  if (!c) { delete root.dataset.city; return; }
  delete root.dataset.city; const plain = getComputedStyle(root).getPropertyValue('--accent');
  root.dataset.city = c.id;
  if (getComputedStyle(root).getPropertyValue('--accent') === plain && c.accent) root.style.setProperty('--accent', c.accent);
}
let koFont = false;
function loadKorean() {
  if (koFont) return; koFont = true;
  document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500&display=swap' }));
}

// Fetch the catalogue while the hello screen is up, so Start never waits on the network.
let cataloguePromise = null;
const loadCatalogue = () => (cataloguePromise ||= fetch('/api/cities').then((x) => x.json()).catch(() => null).then((r) => { if (!r?.languages) cataloguePromise = null; return r; }));
function hello(rebuild) {
  loadCatalogue(); setCity(null);
  // A new run starts here: earlier misses from a previous run are cleared.
  const begin = () => { S.missed = []; pickLanguage(); };
  // The hello screen is already in index.html (so it paints before JS); just wire up Start.
  const start = !rebuild && document.getElementById('start');
  if (start) { start.disabled = false; start.onclick = begin; history.replaceState({ step: 'hello' }, '', location.pathname); return; }
  show(h('h1', {}, "What you'd love if you grew up there."), h('p', { class: 'sub' }, 'Pick 3 things you love. Meet the local you.'),
    h('div', { class: 'cta pin' }, h('button', { class: 'primary', onclick: begin }, 'Start')));
}

// Step 1: the language you're learning. Only languages with a live city are offered.
async function pickLanguage() {
  if (!S.catalogue) {
    const r = await loadCatalogue();
    if (!r?.languages) return show(h('h2', {}, 'You’re learning…'), h('p', { class: 'status', role: 'status' }, 'Cities are unavailable right now.'), h('div', {}, h('button', { class: 'quiet', onclick: () => pickLanguage() }, 'Try again')));
    S.catalogue = r;
  }
  nav('lang'); setCity(null);
  // Indian languages (those with states) are listed language-first in their own section (HG-11, india.js).
  const { live: all } = languageGroups(S.catalogue);
  const live = all.filter((l) => !l.states);
  show(h('h2', {}, 'You’re learning…'),
    h('div', { class: 'tiles' }, live.map((l) => h('button', { class: 'tile', onclick: () => { chooseLanguage(l); suggestCity(); } },
      h('span', { class: serif(l.id), lang: l.id }, l.local), h('span', { class: 'cap' }, l.name)))),
    indiaSection(S.catalogue, { h, onPick: (l) => { chooseLanguage(l); suggestCity(); } }));
}
function chooseLanguage(l) { S.lang = l; if (l.id === 'ko') loadKorean(); }

// Step 2: the best live city for that language is preselected; other live cities are tiles under "or".
function suggestCity(chosen) {
  const best = cityForLanguage(S.catalogue, S.lang.id);
  const back = h('div', { class: 'top' }, h('button', { class: 'quiet', onclick: () => { goingBack = true; try { pickLanguage(); } finally { goingBack = false; } } }, '‹ Language'));
  nav('city');
  if (!best) {
    return show(back, h('h2', {}, S.lang.name), h('p', { class: 'body' }, 'Not ready yet — we only open a city when its picks are truly local.'));
  }
  const c = chosen || (S.city?.language === S.lang.id ? S.city : best);
  setCity(c);
  const others = liveCitiesForLanguage(S.catalogue, S.lang.id).filter((x) => x.id !== c.id);
  show(back,
    h('div', {}, h('p', { class: 'cap' }, c.id === best.id ? `${S.lang.name} · Best match` : S.lang.name),
      h('h2', { class: `city-name ${serif(c.language)}`, lang: c.language, style: 'margin:12px 0 8px' }, c.local),
      h('p', { class: 'flagline' }, c.local !== c.name ? `${c.name} ${c.flag}` : c.flag)),
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

// Step 3: exactly 3 favourites, then straight on to the board (no "that's enough" choice).
// S.missed: favourites HG-5 couldn't match (persistent across rounds); each gets a 'Try other names' action (HG-8).
let landed = false; // a chip just landed: it fades in, and the dot fills
function favourite(note) {
  const missed = S.missed;
  const i = S.favs.length + S.pending.length; // pending picks count toward the slot index
  if (i >= JOURNEY_FAVS) return morph();
  nav('fav', i);
  const p = J.prompts[i];
  const input = h('input', { 'aria-label': p.label, placeholder: p.placeholder, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const field = h('div', { class: 'field' }, input, h('div', { class: 'hair', 'aria-hidden': 'true' }, h('i')));
  const sugs = h('ul', { class: 'sugs' });
  const msg = h('p', { class: 'status', 'aria-live': 'polite' }, note || '');
  const sr = h('span', { class: 'sr', 'aria-live': 'polite' });
  let t, seq = 0, ctl, busyT;
  const busy = (on) => { clearTimeout(busyT); if (on) busyT = setTimeout(() => field.classList.add('busy'), 150); else field.classList.remove('busy'); sr.textContent = on ? 'Searching…' : ''; };
  const alt = createAltTrigger();
  // A verified alt-names match goes straight into S.favs (it's already a Qloo entity).
  const addVerified = (e, kind, from, key) => {
    if (gen !== screenGen) return false; // user left this screen: never touch S.favs
    const v = verifiedFavourite(e, kind, S.favs, S.pending, from);
    if (v.dup) { msg.textContent = `${from || e.name} is already in your favourites.`; return 'dup'; }
    if (!v.fav) return false;
    S.favs.push(v.fav);
    S.missed = resolveMissed(S.missed, { keys: [key] });
    landed = true; favourite(missNote(S.missed)); return true;
  };
  // Secondary trigger: Enter on a query whose suggest came back empty.
  input.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    const q = input.value.trim(); const my = seq;
    if (q.length < 2 || !alt.eligible(q)) return;
    const prev = msg.textContent;
    msg.textContent = 'Looking for other names…';
    const found = await alt.submit(p.kind, q);
    if (my !== seq) return; // superseded: the newer query owns msg
    if (found === null) { msg.textContent = prev; return; } // aborted/failed: restore main's copy
    if (!found.length) { msg.textContent = prev; return; } // no verified match: keep main's copy
    addVerified(found[0], p.kind, q);
  });
  input.addEventListener('input', () => {
    // Bump seq on the keystroke itself (not when the debounce fires), so an in-flight Enter lookup
    // or suggest from an older query can never write msg after the user has typed again.
    const my = ++seq; alt.onInput();
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (my !== seq) return;
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
      alt.noteResults(q, results.length); // zero suggest results (not zero Qloo results) make Enter eligible
      msg.textContent = results.length ? '' : 'Nothing found. Press Enter to try other names, or try something like it.';
      sugs.replaceChildren(...results.slice(0, 3).map((e) => h('li', {}, h('button', { onclick: () => {
        const kind = e.kind || p.kind; const pick = pickKey(kind, e.name, e.year);
        if (isPicked(pick, S.favs, S.pending)) { msg.textContent = `${e.name} is already in your favourites.`; return; }
        const key = `${pick}|${S.pending.length + S.favs.length}`;
        pendingMatches.set(key, resolveFavourite(e, kind));
        S.pending.push({ key, pick, name: e.name, sug: e, kind });
        landed = true; favourite(missNote(S.missed)); // S.missed keeps the 'Try other names' actions
      } }, h('span', {}, e.name), e.year ? h('span', { class: 'yr' }, e.year) : null))));
    }, DEBOUNCE_MS);
  });
  // Primary trigger: favourites HG-5 marked as missed get a 'Try other names' action, same server caps.
  const tryOthers = missed.length ? h('div', { class: 'alts' }, missed.map((m) => {
    const b = h('button', { class: 'quiet', onclick: async () => {
      b.disabled = true; const label = b.textContent; b.textContent = 'Looking for other names…';
      const found = await alt.lookup(m.kind, m.name);
      if (gen !== screenGen) return;
      const added = found?.length ? addVerified(found[0], m.kind, m.name, m.key) : false;
      if (added === true) return; // re-rendered
      if (added === 'dup') { b.textContent = label; b.disabled = false; return; } // msg explains; button usable again
      b.textContent = found === null ? label : `No other names found for ${m.name}`; b.disabled = found !== null;
    } }, `Try other names for ${m.name}`);
    // The user can remove a missed favourite they no longer want.
    const x = h('button', { class: 'quiet', 'aria-label': `Remove ${m.name}`, onclick: () => { S.missed = resolveMissed(S.missed, { keys: [m.key] }); favourite(missNote(S.missed)); } }, '✕');
    return h('span', {}, b, x);
  })) : null;
  const chosen = [...S.favs, ...S.pending];
  const index = h('p', { class: 'cap', 'aria-label': `Favourite ${i + 1} of ${JOURNEY_FAVS}` }, `${i + 1}/${JOURNEY_FAVS}`);
  const shelf = h('div', { class: 'shelf', 'aria-label': 'Your favourites' }, chosen.map((f) => h('span', { class: 'chip' }, f.name)));
  const justLanded = landed; landed = false;
  show(h('div', { class: 'dots-row' }, index), shelf, h('h2', { id: 'prompt' }, p.label), field, msg, sr, tryOthers, sugs,
    opts({ focus: input, still: justLanded ? '.dots-row,.shelf' : null }));
  const gen = screenGen; screenAbort = () => alt.onInput(); // this screen's generation (show() just bumped it)
  if (justLanded && shelf.lastElementChild) { stamp(shelf.lastElementChild); shelf.scrollLeft = shelf.scrollWidth; }
}


// Purposeful delight (all transform/opacity, all timed by CSS tokens, all skipped with reduced() motion).
// A ticket-stamp pop: the new favourite lands on the shelf like a stamp hitting paper.
const stamp = (el) => (reduced() ? fade(el) : el.animate([
  { transform: 'scale(1.7) rotate(-9deg)', opacity: 0 }, { transform: 'scale(.92) rotate(2deg)', opacity: 1, offset: 0.55 },
  { transform: 'scale(1.03) rotate(0)', opacity: 1, offset: 0.8 }, { transform: 'none', opacity: 1 }], { duration: T('d-stamp'), easing: E('out') }));
// The city's letters settle into their slots on reveal, one by one.
function settle(cells, after = 0) {
  if (reduced()) return;
  cells.forEach((cell, i) => cell.animate([{ transform: 'translateY(-18px) rotateX(75deg)', opacity: 0 }, { transform: 'translateY(2px)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
    { duration: T('d-settle'), delay: after + i * T('d-settle-stagger'), easing: E('reveal'), fill: 'backwards' }));
}
// A few sparks burst from the share button: the result is on its way.
let sparking = false; // rapid taps: one burst at a time
function sparkle(btn) {
  if (reduced() || sparking) return;
  sparking = true; setTimeout(() => { sparking = false; }, T('d-sparkle'));
  const host = btn.parentElement, b = btn.getBoundingClientRect(), o = host.getBoundingClientRect();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4, d = 38 + Math.random() * 34;
    const sp = h('i', { class: 'spark', 'aria-hidden': 'true', style: `--x:${b.left - o.left + b.width / 2}px;--y:${b.top - o.top + b.height / 2}px` });
    host.append(sp);
    sp.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1) rotate(${i * 40}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.2}px), calc(-50% + ${Math.sin(a) * d * 1.2 + 10}px)) scale(.2)`, opacity: 0 }], { duration: T('d-sparkle'), easing: E('out') }).onfinish = () => sp.remove();
  }
}
// Film frames flickering by while the matcher works.
const frames = () => h('div', { class: 'frames', 'aria-hidden': 'true' }, h('span', {}, Array.from({ length: 24 }, () => h('i'))));

// Wait for the background Qloo matches, on the board: each row's end cell flips to ✓ (or ×).
// Favourites Qloo doesn't know go back to the favourites screen with 'Try other names'.
async function matchFavourites(board, rows) {
  if (!S.pending.length) return S.favs.length >= 3 || (favourite(S.missed.length ? missNote(S.missed) : 'Pick at least 3 favourites.'), false);
  const pend = [...S.pending]; const total = pend.length; let done = 0;
  const progress = h('p', { class: 'foot', role: 'status', 'aria-live': 'polite' }, matchingProgress(done, total));
  board.append(progress);
  // A7: one blinking cursor, on the first row still being matched.
  const cursor = () => { let first = true; for (const f of pend) { const r = rows.get(rowKey(f)); if (r.settled) continue; r.tick.classList.toggle('cursor', first && !reduced()); first = false; } };
  cursor();
  const matches = new Map(await Promise.all(pend.map(async (f) => {
    const m = await pendingMatches.get(f.key);
    progress.textContent = matchingProgress(++done, total);
    const r = rows.get(rowKey(f)); r.settled = true; r.tick.classList.remove('cursor');
    r.tick.textContent = m && !m.failed && m.id ? '✓' : '×'; cursor();
    return [f.key, m];
  })));
  progress.remove();
  const { favs, missedKeys, failed } = settleFavourites(S.favs, S.pending, matches);
  // Matched by pending key (not name), so two picks with the same name can't be confused.
  const missedPicks = S.pending.filter((f) => missedKeys.includes(f.key)).map((f) => ({ key: f.key, pick: f.pick, name: f.name, kind: f.kind }));
  // Merge into the persistent list; a later successful match of the same pick resolves an earlier miss.
  S.missed = resolveMissed(mergeMissed(S.missed, missedPicks), { picks: favs.map((f) => f.pick) });
  S.pending.forEach((f) => pendingMatches.delete(f.key));
  S.favs = favs; S.pending = failed;
  if (failed.length) {
    // Couldn't reach Qloo: keep these picks and offer a retry; nothing is dropped or called a no-match.
    for (const f of failed) rows.get(rowKey(f))?.classList.add('dim');
    const retry = () => { for (const f of S.pending) pendingMatches.set(f.key, resolveFavourite(f.sug, f.kind)); morph(); };
    board.after(h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, `Couldn't reach our matcher for ${failed.map((f) => f.name).join(', ')}, try again.`),
      h('div', {}, h('button', { class: 'primary', onclick: retry }, 'Try again')));
    return false;
  }
  if (S.favs.length < 3) { favourite(missNote(S.missed) || `Pick ${3 - S.favs.length} more.`); return false; }
  return true;
}

// Split-flap row: cells settle left→right (--d-flap-stagger), ≤ 6 intermediate characters at --d-flap each.
function flapRow(text, width, withTick = true) {
  const row = h('div', { class: 'row', role: 'img', 'aria-label': text });
  const fit = (s) => { const c = padTo(s, width); if ([...String(s)].length > width) c[width - 1] = '…'; return c; };
  row.cells = fit(text.toUpperCase()).map((ch) => h('span', { class: 'flap', 'aria-hidden': 'true' }, ch));
  row.append(...row.cells);
  if (withTick) { row.tick = h('span', { class: 'flap tick', 'aria-hidden': 'true' }, '…'); row.append(row.tick); }
  row.flipTo = async (to) => {
    row.setAttribute('aria-label', to);
    const target = fit(to);
    if (reduced()) { row.cells.forEach((c, k) => (c.textContent = target[k])); await fade(row).finished.catch(() => {}); return; }
    const step = T('d-flap'), stagger = T('d-flap-stagger');
    await Promise.all(row.cells.map(async (cell, k) => {
      await wait(k * stagger);
      for (const ch of flapSteps(cell.textContent, target[k], 7)) {
        cell.animate([{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(-90deg)', opacity: 1 }], { duration: step, easing: E('flap'), pseudoElement: '::before' });
        cell.textContent = ch;
        await wait(step);
      }
    }));
  };
  return row;
}
async function flipHeader(hdr, text, ko) {
  if (reduced()) { hdr.textContent = text; hdr.classList.toggle('ko', ko); return; }
  const half = T('d-header'), p = 'perspective(400px) rotateX';
  await hdr.animate([{ transform: `${p}(0)` }, { transform: `${p}(90deg)` }], { duration: half, easing: E('flap') }).finished.catch(() => {});
  hdr.textContent = text; hdr.classList.toggle('ko', ko);
  await hdr.animate([{ transform: `${p}(-90deg)` }, { transform: `${p}(0)` }], { duration: half, easing: E('flap') }).finished.catch(() => {});
}

// Step 4: the board appears at once with the favourites; matching happens on it, then picks flip in.
const runs = createRunGuard();
const rowKey = (f) => f.pick || f.id;
async function morph() {
  if (!S.pending.length && S.favs.length < 3) return favourite('Pick at least 3 favourites.');
  const current = runs.start();
  const c = S.city; setCity(c); nav('reveal');
  const onBoard = [...S.favs, ...S.pending];
  const width = Math.min(22, Math.max(12, ...onBoard.map((f) => [...f.name].length)));
  const rows = new Map(onBoard.map((f) => [rowKey(f), flapRow(f.name, width)]));
  for (const f of S.favs) rows.get(rowKey(f)).tick.textContent = '✓';
  const hdr = h('h2', { class: 'hdr' }, 'Matching…');
  const strip = frames();
  const board = h('div', { class: 'board' }, hdr, strip, [...rows.values()]);
  show(board);
  if (!(await matchFavourites(board, rows)) || !current()) return;
  hdr.textContent = 'Your favourites';
  const foot = h('p', { class: 'foot', role: 'status', 'aria-live': 'polite' }, `Asking people in ${c.name}…`);
  board.append(foot);
  const flipRows = S.favs.map((f) => rows.get(rowKey(f))).filter(Boolean);

  S.results = {};
  const base = { favourites: S.favs.map(({ id, name, tags }) => ({ id, name, tags })), city: c.id, userCountry: userCountryFromLocale(navigator.language) };
  let flipped = 0, flips = Promise.resolve();
  const land = (cat, r) => {
    if (!current()) return; // a newer city run started: drop stale responses
    S.results[cat] = r.ok ? r.body : { picks: [], note: r.body.message || 'This part is unavailable right now.', error: true };
    for (const p of S.results[cat].picks) if (flipped < flipRows.length) { const row = flipRows[flipped++]; flips = flips.then(() => current() && row.flipTo(p.title)).then(() => wait(T('d-row-gap'))); }
    if (revealEls) updateReveal();
  };
  // Every category is Qloo-backed, so they go one at a time through the 7 s browser gate.
  // One failed category must not stop the ones after it.
  const qlooP = runCategories(runCats(), (cat) => qlooPost({ ...base, category: cat }, current), land);
  await Promise.race([qlooP, wait(T('d-flip-cap'))]);
  await Promise.race([flips, wait(T('d-flip-cap'))]);
  if (!current()) return;
  foot.remove();
  await flipHeader(hdr, revealHeader(J, c), !J.single && c.language === 'ko');
  board.classList.add('city');
  await wait(T('d-hold'));
  if (!current()) return;
  reveal(board);
}

// Step 5: the reveal (the aha) — header, one hero ticket, then Share, then rows 01–04.
let revealEls = null;
const KIND = { tv: 'Show', movie: 'Film', music: 'Band' };
const CAT = { tv: 'Shows', movie: 'Films', music: 'Music' };
const sized = (url, w) => String(url).replace(/(image\.tmdb\.org\/t\/p\/)[^/]+\//, `$1${w}/`);
// Poster: an accent-soft tile with the title's first letter until the image has loaded (A11). Never grey.
function art(p) {
  const box = h('div', { class: 'poster', 'aria-hidden': 'true' }, h('b', {}, [...String(p.title || '?')][0]));
  if (p.image) {
    const img = h('img', { alt: '', decoding: 'async', loading: 'eager', fetchpriority: 'high', src: sized(p.image, 'w342') });
    img.addEventListener('load', () => { img.classList.add('in'); if (reduced()) fade(img); else img.animate([{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'none' }], { duration: T('d-develop'), easing: E('reveal') }); }, { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    box.append(img);
  }
  return box;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function whyLine(p) {
  const text = p.why?.text || ''; const names = (p.why?.favourite ? [p.why.favourite] : S.favs.map((f) => f.name)).filter(Boolean);
  if (!text) return null;
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
// Watch/listen: hero only (the next action after the aha).
function action(p) {
  if (p.watch?.url) {
    return h('a', { class: 'outline', href: p.watch.url, target: '_blank', rel: 'noopener', title: p.watch.provider ? `${p.watch.provider}${p.watch.label ? ` (${p.watch.label})` : ''}` : null, onclick: () => track({ event: 'tap', action: 'watch', pick: p.title }) },
      p.watch.provider ? `Watch on ${p.watch.provider}` : 'Find it');
  }
  return p.preview?.url ? player(p) : null;
}
const enTitle = (p) => (p.englishTitle && p.englishTitle !== p.title ? p.englishTitle : null);
// Hero ticket: kind (mixed only) · title · English · poster · why · action · tip. Title sits above the
// poster so the main action stays in the first phone viewport.
function pickCard(p, city, readOnly) {
  const kind = KIND[p.category] || 'Pick';
  return h('article', { class: 'ticket', 'aria-label': `${kind}: ${p.title}, from ${city.name}` },
    !J.single && !readOnly ? h('p', { class: 'cap' }, kind) : null,
    h('div', {}, h('h2', { class: city.language === 'ko' ? 'ko' : '', lang: city.language }, p.title), enTitle(p) ? h('p', { class: 'en' }, enTitle(p)) : null),
    readOnly ? null : action(p), art(p), readOnly ? null : whyLine(p), !readOnly && p.tip ? h('p', { class: 'tip' }, p.tip) : null);
}
// Rows 01–04: type only, one name (local title) plus the English line when it differs.
const pickRow = (p, n, city) => h('article', { class: 'prow', 'aria-label': `${KIND[p.category] || 'Pick'}: ${p.title}, from ${city.name}` },
  h('span', { class: 'n', 'aria-hidden': 'true' }, String(n).padStart(2, '0')),
  h('div', {}, h('span', { class: serif(city.language), lang: city.language }, p.title), enTitle(p) ? h('span', { class: 'en' }, enTitle(p)) : null));
// Rows rise in (opacity + --row-rise, --d-row-stagger apart), once each, late arrivals too.
function riseIn(el, key, n) {
  const seen = revealEls?.seen; if (!seen || seen.has(key)) return el; seen.add(key);
  if (reduced()) fade(el);
  else el.animate([{ opacity: 0, transform: `translateY(${T('row-rise')}px)` }, { opacity: 1, transform: 'none' }], { duration: T('d-rows'), easing: E('reveal'), delay: (revealEls.first ? T('d-shrink') / 2 : 0) + n * T('d-row-stagger'), fill: 'backwards' });
  return el;
}

function picksView() {
  const { hero, rows } = journeyPicks(S.results, J);
  const cats = runCats();
  const pending = pendingCats(cats, S.results);
  const thin = S.catalogue?.cities?.find((x) => x.id === S.city.id)?.thinNote; // HG-9 thin-pool note; the lead line stays cut (§C)
  const notes = cats.filter((k) => S.results[k]?.note).map((k) => (S.results[k].error ? `${CAT[k]} didn't come through this time.` : S.results[k].note));
  const watched = [hero, ...rows, ...scarcePicks(S.results)].filter(Boolean).find((p) => p.watch?.attribution);
  return {
    hero: !cats.length ? h('p', { class: 'body not-ready' }, NOT_READY) : hero ? riseIn(pickCard(hero, S.city), `h|${hero.title}`, 0) : pending.length ? null : h('p', { class: 'body' }, 'We couldn’t find picks local enough for your taste here. Try another city.'),
    rest: [
      rows.length ? h('div', { class: 'list' }, rows.map((p, n) => riseIn(pickRow(p, n + 1, S.city), `${p.category}|${p.title}`, n + 1))) : null,
      pending.map((k) => h('div', { class: 'skel' }, `${CAT[k]} — landing…`)),
      notes.map((n) => h('p', { class: 'note-row' }, n)),
      thin ? h('p', { class: 'note-row thin-note' }, thin) : null,
    ].flat().filter(Boolean),
    foot: watched ? h('p', { class: 'foot-line' }, `Where-to-watch data: ${watched.watch.attribution}.`) : null,
    hasHero: !!hero,
  };
}
// Only the picks regions re-render as categories land; the share block and rating keep their state.
function updateReveal() {
  const v = picksView(); const R = revealEls;
  R.hero.replaceChildren(...present([v.hero])); R.rest.replaceChildren(...v.rest); R.foot.replaceChildren(...present([v.foot]));
  if (v.hasHero && !R.shareShown) { R.shareShown = true; R.showShare(); }
}
function shownPicks() { const { hero, rows } = journeyPicks(S.results, J); return [hero, ...rows].filter(Boolean); }

// "Feels like you? Yes / Not really": 2 taps max, the existing rating event (5 = yes, 1 = not really).
function feelsLike() {
  const strip = h('section', { class: 'rate' }, h('p', {}, 'Feels like you?'));
  const say = (yes) => (e) => {
    strip.querySelectorAll('.quiet').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true');
    track({ event: 'rating', rating: yes ? 5 : 1, note: yes ? 'feels_like_me' : 'not_really', shown: shownPicks().map((p) => `${p.category}:${p.title}:${p.verification?.source || ''}`.slice(0, 200)) });
    if (!strip.querySelector('.thanks')) strip.append(h('span', { class: 'cap thanks', role: 'status' }, 'Thanks'));
  };
  strip.append(h('button', { class: 'quiet', 'aria-pressed': 'false', onclick: say(true) }, 'Yes'), h('button', { class: 'quiet', 'aria-pressed': 'false', onclick: say(false) }, 'Not really'));
  return strip;
}

// §S Share: a type-only postcard drawn on a canvas + a ?r= link that carries the result (no storage).
const shareCode = () => { const { hero, rows } = journeyPicks(S.results, J); return encodeShare({ lang: S.lang?.id || S.city.language, city: S.city.id, category: J.category, favs: S.favs.map((f) => f.name), hero, rows }); };
const shareUrl = (code) => `${location.origin}/?r=${code}`;
async function postcard({ city, favs, picks, url }) {
  const W = 1080, H = 1350, M = 96, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); const css = (n) => tokens.getPropertyValue(n).trim();
  const ko = city.language === 'ko'; const disp = ko ? '"Noto Serif KR", Fraunces, serif' : 'Fraunces, serif';
  await Promise.all([`400 120px Fraunces`, `400 36px Inter`, `500 36px Inter`, ko ? `500 60px "Noto Serif KR"` : null].filter(Boolean).map((f) => document.fonts.load(f).catch(() => {})));
  g.fillStyle = css('--paper'); g.fillRect(0, 0, W, H);
  // The postcard is the one place the perforated notch earns its keep (§C).
  g.globalCompositeOperation = 'destination-out'; for (const x of [0, W]) { g.beginPath(); g.arc(x, H * 2 / 3, 28, 0, Math.PI * 2); g.fill(); } g.globalCompositeOperation = 'source-over';
  const fit = (text, font, size, max) => { let s = size; do { g.font = font(s); } while (g.measureText(text).width > max && (s -= 4) > 24); return s; };
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || css('--ink');
  g.textBaseline = 'alphabetic'; g.fillStyle = css('--ink-2'); g.font = `400 30px ui-monospace, Menlo, monospace`; g.fillText('HOMEGROWN', M, M + 20);
  g.fillStyle = css('--ink'); const cs = fit(city.local, (s) => `400 ${s}px ${disp}`, 132, W - 2 * M); g.fillText(city.local, M, M + 80 + cs);
  let y = M + 80 + cs + 40; g.fillStyle = accent; g.fillRect(M, y, 160, 6); y += 90;
  g.fillStyle = css('--ink-2'); g.font = '400 40px Inter, sans-serif'; g.fillText(J.single ? `If I’d grown up here, my ${J.plural} would be:` : 'If I’d grown up here, I’d love:', M, y); y += 40;
  for (const p of picks.slice(0, 3)) {
    y += 96; g.fillStyle = css('--ink'); fit(p.title, (s) => `400 ${s}px ${disp}`, 72, W - 2 * M); g.fillText(p.title, M, y);
    const en = enTitle(p); if (en) { y += 52; g.fillStyle = css('--ink-3'); g.font = '400 36px Inter, sans-serif'; g.fillText(en, M, y); }
  }
  if (favs.length) { const line = `because I love ${favs.join(', ')}`; g.fillStyle = css('--ink-2'); fit(line, (s) => `400 ${s}px Inter, sans-serif`, 34, W - 2 * M); g.fillText(line, M, H - M - 70); }
  g.fillStyle = css('--ink-3'); g.font = '400 28px ui-monospace, Menlo, monospace'; g.fillText(url.replace(/^https?:\/\//, '').replace(/\?r=.*/, ''), M, H - M);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
function shareBlock() {
  const c = S.city; const wrap = h('section', { class: 'share wait', 'aria-label': 'Share' });
  const status = h('p', { class: 'cap', role: 'status', 'aria-live': 'polite' });
  const card = () => { const { hero, rows } = journeyPicks(S.results, J); return postcard({ city: c, favs: S.favs.map((f) => f.name), picks: [hero, ...rows].filter(Boolean), url: shareUrl(shareCode()) }); };
  const text = J.single ? `My ${J.noun} self grew up in ${c.name} (apparently). Who’s yours?` : `I grew up in ${c.name} (apparently). Who are you there?`;
  const copy = async () => {
    const url = shareUrl(shareCode());
    try { await navigator.clipboard.writeText(url); status.textContent = 'Link copied'; } catch { status.textContent = url; }
    track({ event: 'share', method: 'copy' });
  };
  const save = async () => {
    const blob = await card(); const a = h('a', { href: URL.createObjectURL(blob), download: `homegrown-${c.id}.png` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status.textContent = 'Image saved'; track({ event: 'share', method: 'image' });
  };
  const canShare = typeof navigator.share === 'function';
  const fallback = h('div', { class: 'row-btns' }, h('button', { class: 'quiet', onclick: copy }, 'Copy link'), h('button', { class: 'quiet', onclick: save }, 'Save image'));
  // iOS only lets navigator.share run inside the tap's user activation, so the postcard is drawn
  // ahead of time (when the block appears) and send() calls share with no await before it.
  let cached = null;
  wrap.prepare = () => { const code = shareCode(); if (cached?.code === code) return; card().then((blob) => { if (!blob) return; cached = { code, file: new File([blob], `homegrown-${c.id}.png`, { type: 'image/png' }) }; preview(blob); }).catch(() => {}); };
  // The postcard flips in beside the button once it's drawn: you see what you're sending.
  const shot = h('img', { class: 'postcard', alt: `Postcard: your ${c.name} self` });
  const preview = (blob) => {
    const first = !shot.src; if (shot.src) URL.revokeObjectURL(shot.src); shot.src = URL.createObjectURL(blob);
    if (!first) return; wrap.insertBefore(shot, wrap.querySelector('.cta').nextSibling);
    if (reduced()) return;
    shot.animate([{ transform: 'perspective(800px) translateX(40px) rotateY(-80deg) rotate(4deg)', opacity: 0 }, { transform: 'perspective(800px) translateX(-4px) rotateY(8deg) rotate(-3deg)', opacity: 1, offset: 0.7 },
      { transform: 'perspective(800px) rotate(-2deg)', opacity: 1 }], { duration: T('d-postcard'), easing: E('reveal') });
  };
  const send = (e) => {
    if (e?.currentTarget) sparkle(e.currentTarget);
    if (!canShare) return copy();
    const code = shareCode(), url = shareUrl(code);
    const file = cached?.code === code ? cached.file : null;
    const useFiles = !!file && !!navigator.canShare?.({ files: [file] });
    const sent = useFiles ? navigator.share({ files: [file], text: `${text} ${url}`, url }) : navigator.share({ url, text });
    if (!file) wrap.prepare(); // picks changed since the last draw: ready for next time
    return Promise.resolve(sent).then(() => track({ event: 'share', method: useFiles ? 'files' : 'link' }))
      .catch((e) => { if (e?.name !== 'AbortError' && !fallback.isConnected) wrap.append(fallback); });
  };
  wrap.append(h('div', { class: 'cta' }, h('button', { class: 'primary', onclick: send }, `Send my ${c.name} self`)), canShare ? null : fallback, status);
  const others = liveCitiesForLanguage(S.catalogue || { cities: [], languages: [] }, c.language).filter((o) => o.id !== c.id);
  if (others.length) wrap.append(h('div', {}, others.map((o) => h('button', { class: 'quiet', onclick: () => { track({ event: 'try_city', to: o.id }); S.city = o; setCity(o); morph(); } }, `Grow up in ${o.name} instead →`))));
  return wrap;
}

function reveal(fromBoard) {
  nav('reveal');
  const first = fromBoard?.getBoundingClientRect();
  const R = revealEls = { hero: h('div'), rest: h('div', { class: 'screen', style: 'gap:0' }), foot: h('div'), seen: new Set(), first: !!fromBoard, shareShown: false };
  const ko = !J.single && S.city.language === 'ko';
  const board = h('div', { class: 'board compact city' }, h('h2', { class: `hdr ${ko ? 'ko' : ''}`, lang: J.single ? 'en' : S.city.language }, revealHeader(J, S.city)), flapRow(S.city.name.toUpperCase(), [...S.city.name].length, false));
  const share = shareBlock();
  R.showShare = () => {
    // A21: the share block rises 1.2 s after the header settles (immediately with reduced() motion).
    const delay = fromBoard ? T('d-share-delay') : 0;
    setTimeout(() => { if (revealEls !== R) return; share.classList.remove('wait'); share.prepare?.(); if (reduced()) return;
      share.animate([{ opacity: 0, transform: `translateY(${T('travel')}px)` }, { opacity: 1, transform: 'none' }], { duration: T('d-share'), easing: E('reveal') }); }, delay);
  };
  show(board, R.hero, share, R.rest, feelsLike(), R.foot, opts({ anim: !fromBoard, focus: board.firstChild }));
  if (fromBoard && !reduced()) {
    const last = board.getBoundingClientRect(); const s = first.width / last.width;
    board.animate([{ transform: `translate(${first.left - last.left}px,${first.top - last.top}px) scale(${s})` }, { transform: 'none' }], { duration: T('d-shrink'), easing: E('reveal') });
  } else if (fromBoard) fade(app.querySelector('.screen'));
  settle([...board.querySelectorAll('.flap')], fromBoard ? T('d-shrink') * 0.6 : T('d-enter'));
  updateReveal();
}

// A friend's ?r= link: their reveal, read-only, from the link alone. One primary: "Find yours".
async function friendView() {
  const code = new URLSearchParams(location.search).get('r');
  const cat = S.catalogue || (S.catalogue = await loadCatalogue());
  const data = cat?.cities && decodeShare(code, cat.cities);
  if (!data) { history.replaceState({ step: 'hello' }, '', location.pathname); return hello(true); }
  history.replaceState({ step: 'friend' }, '', `${location.pathname}${location.search}`);
  const c = data.city; setCity(c); if (c.language === 'ko') loadKorean();
  track({ event: 'share_open', city: c.id, favourites: [] });
  const fj = journeyFor(data.category); const header = fj.single ? `${fj.noun} self` : 'self';
  const board = h('div', { class: 'board compact city' }, h('h2', { class: 'hdr', lang: 'en' }, `A friend’s ${c.name} ${header}`), flapRow(c.name.toUpperCase(), [...c.name].length, false));
  const lang = (cat.languages || []).find((l) => l.id === (data.lang || c.language)) || (cat.languages || []).find((l) => l.id === c.language);
  const find = () => { history.replaceState({ step: 'hello' }, '', location.pathname); S.missed = []; S.favs = []; S.pending = []; if (lang) { chooseLanguage(lang); S.city = c; suggestCity(c); } else pickLanguage(); };
  show(board, h('p', { class: 'cap shared-by' }, 'Shared by a friend · open yours for live picks'), h('p', { class: 'friend-cap' }, data.favs.length ? `Because they love ${fj.single ? `the ${fj.plural} ` : ''}${data.favs.join(', ')}` : null),
    pickCard({ ...data.hero, why: null }, c, true),
    h('div', { class: 'cta' }, h('button', { class: 'primary', onclick: find }, 'Find yours')),
    data.rows.length ? h('div', { class: 'list' }, data.rows.map((p, n) => pickRow(p, n + 1, c))) : null, opts({ anim: false, focus: board.firstChild }));
  settle([...board.querySelectorAll('.flap')], T('d-enter'));
}

if (new URLSearchParams(location.search).has('r')) { loadCatalogue(); document.getElementById('start')?.closest('.screen')?.remove(); friendView(); } else hello();
