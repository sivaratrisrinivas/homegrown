import { PROMPTS, MAX_FAVS, canSkip, QLOO_ORDER, MORPH_BUDGET_MS, flapSteps, padTo, rankPicks, userCountryFromLocale, createRunGuard, createSpacer, SKIP, createMemo, searchKey, DEBOUNCE_MS, settleFavourites, favouriteIds, pickKey, isPicked, lookupOutcome, LOOKUP_FAILED, QLOO_LOOKUP_TIMEOUT_MS, matchingProgress, bestQlooMatch, present, twinClientKey, runCategories, gatedIfCurrent, shouldMemoTwin, postcardCategories, scarcePicks, liveCats, pendingCats, categoryWords, cityForLanguage, liveCitiesForLanguage, languageGroups, otherCities } from './logic.js';
import { indiaSection } from './india.js';
import { createAltTrigger, verifiedFavourite, missedNote, mergeMissed, resolveMissed } from './altnames-client.js';
import { isMapReveal, mapFraming } from './maplogic.js';
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
// S.favs holds only Qloo-matched favourites ({id,name,tags}); chosen-but-unmatched ones live in
// S.pending with their match promise kept separately in pendingMatches.
const pendingMatches = new Map();
const S = { favs: [], pending: [], missed: [], city: null, results: {}, sound: false, catalogue: null, lang: null };
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
// Every screen replace bumps screenGen and aborts the previous screen's alt-names lookup, so a
// stale lookup can never change S.favs after the user has left that screen (HG-8).
let screenGen = 0, screenAbort = null;
const show = (...els) => { screenGen++; screenAbort?.(); screenAbort = null; app.replaceChildren(...present(els)); window.scrollTo(0, 0); };
const missNote = (missed) => missedNote(missed, S.favs.length + S.pending.length);
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
const track = (body) => post('/api/feedback', { city: S.city?.id, favourites: favouriteIds(S.favs), ...body }).catch(() => {});

// Sound: off by default; a quiet synthesised click per flap when enabled.
let actx; const soundBtn = document.getElementById('sound');
soundBtn.onclick = () => { S.sound = !S.sound; soundBtn.textContent = S.sound ? 'Sound on' : 'Sound off'; soundBtn.setAttribute('aria-pressed', S.sound); };
function click() {
  if (!S.sound) return;
  actx ||= new AudioContext();
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = 1800 + Math.random() * 400; g.gain.value = 0.02;
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.012);
}

// Fetch the catalogue while the hello screen is up, so Start never waits on the network.
let cataloguePromise = null;
const loadCatalogue = () => (cataloguePromise ||= fetch('/api/cities').then((x) => x.json()).catch(() => null).then((r) => { if (!r?.languages) cataloguePromise = null; return r; }));
function hello() {
  loadCatalogue();
  document.documentElement.style.setProperty('--accent', '#1B1B1B');
  // The hello screen is already in index.html (so it paints before JS); just wire up Start.
  const start = document.getElementById('start');
  // A new run starts here: earlier misses from a previous run are cleared.
  const begin = () => { S.missed = []; pickLanguage(); };
  if (start) { start.disabled = false; start.onclick = begin; return; }
  show(h('h1', {}, "What you'd love if you grew up there."), h('div', {}, h('button', { onclick: begin }, 'Start')));
}

// Step 1: the language you're learning.
async function pickLanguage() {
  if (!S.catalogue) {
    const r = await loadCatalogue();
    if (!r?.languages) return show(h('p', { class: 'note' }, 'Cities are unavailable right now. Please try again in a minute.'));
    S.catalogue = r;
  }
  // Only languages with a live city are offered; the rest are listed as coming soon.
  // Indian languages (those with states) are listed language-first in their own section (india.js).
  const { live: all, soon: allSoon } = languageGroups(S.catalogue);
  const live = all.filter((l) => !l.states), soon = allSoon.filter((l) => !l.states);
  show(h('h2', {}, 'Which language are you learning?'),
    h('div', { class: 'cities' }, live.map((l) => h('button', { class: 'postcard', onclick: () => { S.lang = l; suggestCity(); } },
      h('span', { class: serif(l.id) }, l.local), h('span', {}, l.name)))),
    indiaSection(S.catalogue, { h, onPick: (l) => { S.lang = l; suggestCity(); } }),
    soon.length ? h('p', { class: 'muted' }, `Coming soon: ${soon.map((l) => l.name).join(', ')}`) : null);
}

// Step 2: we suggest the best live city for that language.
function suggestCity() {
  const live = cityForLanguage(S.catalogue, S.lang.id);
  if (!live) {
    return show(h('h2', {}, `${S.lang.name} isn't live yet.`),
      h('p', { class: 'muted' }, `A city opens only when at least ${Math.round(S.catalogue.threshold * 100)}% of its picks in ${categoryWords(liveCats(S.catalogue))} are verified local. Its city hasn't reached that yet.`),
      h('button', { class: 'ghost', onclick: pickLanguage }, 'Pick another language'));
  }
  // Default is the measured best city; switching to another live city is one tap.
  const pick = (c) => {
    const others = liveCitiesForLanguage(S.catalogue, S.lang.id).filter((x) => x.id !== c.id);
    show(h('p', { class: 'muted' }, c.id === live.id ? `For ${S.lang.name}, we suggest` : `${S.lang.name} in`),
      h('h2', { class: serif(c.language), dir: 'auto' }, `${c.local} ${c.flag}`),
      c.lead ? h('p', { class: 'lead' }, c.lead.text) : null,
      h('button', { onclick: () => { S.city = c; favourite(); } }, `Go to ${c.name}`),
      others.length ? h('div', {}, others.map((o) => h('button', { class: 'ghost', onclick: () => pick(o) }, `Switch to ${o.name}`))) : null,
      h('button', { class: 'ghost', onclick: pickLanguage }, 'Change language'));
  };
  pick(live);
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

// S.missed: favourites HG-5 couldn't match (persistent across rounds); each gets a 'Try other names' action (HG-8).
function favourite(note) {
  const missed = S.missed;
  const i = S.favs.length + S.pending.length; // pending picks count toward the slot index
  if (i >= MAX_FAVS) return morph();
  const p = PROMPTS[i];
  const input = h('input', { 'aria-label': p.label, placeholder: 'Start typing…', autocomplete: 'off' });
  const sugs = h('ul', { class: 'sugs' }); const msg = h('p', { class: 'muted', 'aria-live': 'polite' }, note || '');
  let t, seq = 0, ctl;
  const alt = createAltTrigger();
  // A verified alt-names match goes straight into S.favs (it's already a Qloo entity).
  const addVerified = (e, kind, from, key) => {
    if (gen !== screenGen) return false; // user left this screen: never touch S.favs
    const v = verifiedFavourite(e, kind, S.favs, S.pending, from);
    if (v.dup) { msg.textContent = `${from || e.name} is already in your favourites.`; return 'dup'; }
    if (!v.fav) return false;
    S.favs.push(v.fav);
    S.missed = resolveMissed(S.missed, { keys: [key] });
    favourite(missNote(S.missed)); return true;
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
      if (q.length < 2) { sugs.replaceChildren(); msg.textContent = ''; return; }
      const sk = searchKey(p.kind, q);
      let r = suggestMemo.get(sk);
      if (!r) {
        msg.textContent = 'Searching…';
        ctl?.abort(); ctl = new AbortController();
        try {
          const res = await fetch(`/api/suggest?kind=${p.kind}&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
          r = { ok: res.ok, body: await res.json().catch(() => ({})) };
        } catch { if (my === seq) msg.textContent = 'Search is unavailable right now.'; return; }
        if (r.ok && !r.body.partial) suggestMemo.set(sk, r);
      }
      if (my !== seq) return;
      if (!r.ok) { msg.textContent = r.body.message || 'Search is unavailable right now.'; return; }
      const results = r.body.results || [];
      alt.noteResults(q, results.length); // zero suggest results (not zero Qloo results) make Enter eligible
      msg.textContent = results.length ? '' : 'Nothing found. Press Enter to try other names, or try something like it.';
      sugs.replaceChildren(...results.slice(0, 5).map((e) => h('li', {}, h('button', { onclick: () => {
        const kind = e.kind || p.kind; const pick = pickKey(kind, e.name, e.year);
        if (isPicked(pick, S.favs, S.pending)) { msg.textContent = `${e.name} is already in your favourites.`; return; }
        const key = `${pick}|${S.pending.length + S.favs.length}`;
        pendingMatches.set(key, resolveFavourite(e, kind));
        S.pending.push({ key, pick, name: e.name, sug: e, kind });
        favourite(missNote(S.missed)); // S.missed keeps the 'Try other names' actions
      } }, e.name, e.year ? ` (${e.year})` : ''))));
    }, DEBOUNCE_MS);
  });
  // Primary trigger: favourites HG-5 marked as missed get a 'Try other names' action, same server caps.
  const tryOthers = missed.length ? h('div', {}, missed.map((m) => {
    const b = h('button', { class: 'ghost', onclick: async () => {
      b.disabled = true; const label = b.textContent; b.textContent = 'Looking for other names…';
      const found = await alt.lookup(m.kind, m.name);
      if (gen !== screenGen) return;
      const added = found?.length ? addVerified(found[0], m.kind, m.name, m.key) : false;
      if (added === true) return; // re-rendered
      if (added === 'dup') { b.textContent = label; b.disabled = false; return; } // msg explains; button usable again
      b.textContent = found === null ? label : `No other names found for ${m.name}`; b.disabled = found !== null;
    } }, `Try other names for ${m.name}`);
    // The user can remove a missed favourite they no longer want.
    const x = h('button', { class: 'ghost', 'aria-label': `Remove ${m.name}`, onclick: () => { S.missed = resolveMissed(S.missed, { keys: [m.key] }); favourite(missNote(S.missed)); } }, '✕');
    return h('span', {}, b, x);
  })) : null;
  const shelf = h('div', { class: 'shelf', 'aria-label': 'Your favourites' }, [...S.favs, ...S.pending].map((f) => h('span', { class: 'chip' }, f.name)));
  show(h('p', { class: 'muted' }, `Favourite ${i + 1} of ${MAX_FAVS}`), h('h2', {}, p.label), input, msg, tryOthers, sugs,
    canSkip(i) ? h('div', {}, h('button', { class: 'ghost', onclick: () => morph() }, 'Skip, that’s enough')) : null, shelf);
  const gen = screenGen; screenAbort = () => alt.onInput(); // this screen's generation (show() just bumped it)
  input.focus();
}

// Wait for the background Qloo matches; favourites Qloo doesn't know are dropped with a note.
async function matchFavourites() {
  if (!S.pending.length) return S.favs.length >= 3 || (favourite(S.missed.length ? missNote(S.missed) : 'Pick at least 3 favourites.'), false);
  const total = S.pending.length; let done = 0;
  const progress = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, matchingProgress(done, total));
  show(h('p', { class: 'muted' }, 'Matching your favourites…'), progress);
  const matches = new Map(await Promise.all(S.pending.map(async (f) => {
    const m = await pendingMatches.get(f.key);
    progress.textContent = matchingProgress(++done, total);
    return [f.key, m];
  })));
  const { favs, missed, missedKeys, failed } = settleFavourites(S.favs, S.pending, matches);
  // Matched by pending key (not name), so two picks with the same name can't be confused.
  const missedPicks = S.pending.filter((f) => missedKeys.includes(f.key)).map((f) => ({ key: f.key, pick: f.pick, name: f.name, kind: f.kind }));
  // Merge into the persistent list; a later successful match of the same pick resolves an earlier miss.
  S.missed = resolveMissed(mergeMissed(S.missed, missedPicks), { picks: favs.map((f) => f.pick) });
  S.pending.forEach((f) => pendingMatches.delete(f.key));
  S.favs = favs; S.pending = failed;
  if (failed.length) {
    // Couldn't reach Qloo: keep these picks and offer a retry; nothing is dropped or called a no-match.
    const retry = () => { for (const f of S.pending) pendingMatches.set(f.key, resolveFavourite(f.sug, f.kind)); morph(); };
    show(h('p', { role: 'status', 'aria-live': 'polite' }, `Couldn't reach our matcher for ${failed.map((f) => f.name).join(', ')}, try again.`),
      h('button', { onclick: retry }, 'Try again'));
    return false;
  }
  if (S.favs.length < 3) { favourite(missNote(S.missed) || `Pick ${3 - S.favs.length} more.`); return false; }
  return true;
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
  if (!(await matchFavourites())) return;
  const current = runs.start(); revealEls?.destroy?.(); revealEls = null;
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
  const qlooP = runCategories(liveCats(S.catalogue), (cat) => qlooPost({ ...base, category: cat }, current), land);
  await Promise.race([qlooP, new Promise((r) => setTimeout(r, MORPH_BUDGET_MS))]);
  if (!current()) return;
  hdr.textContent = c.header; hdr.dir = 'auto'; hdr.classList.toggle('ko', c.language === 'ko');
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
  const cats = liveCats(S.catalogue);
  const pending = pendingCats(cats, S.results);
  const scarce = scarcePicks(S.results);
  const cityInfo = S.catalogue?.cities.find((x) => x.id === S.city.id);
  const lead = cityInfo?.lead;
  return [
    lead ? h('p', { class: 'lead' }, lead.text) : null,
    cityInfo?.thinNote ? h('p', { class: 'muted thin-note' }, cityInfo.thinNote) : null,
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
function updateReveal() { if (revealEls.update) return revealEls.update(); revealEls.picks.replaceChildren(...picksView()); }
function shownPicks() { const { hero, rest } = rankPicks(S.results); return [hero, ...rest].filter(Boolean); }

// HG-6 prototype: ?reveal=map swaps the picks list for a walkable map. Without the flag nothing changes.
async function mapPicks() {
  const { createMapReveal } = await import('./map.js');
  const m = createMapReveal({ h, city: S.city, getResults: () => S.results, picks: () => [...shownPicks(), ...scarcePicks(S.results)], pickCard, reduced, ping: click });
  return m;
}
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
  // Only other live cities are offered, and never an explicit-only language (English) the learner didn't pick.
  const others = S.catalogue ? otherCities(S.catalogue, S.city.id, S.lang?.id) : [];
  show(h('p', { class: 'kind', dir: 'auto' }, S.city.header), picks, rating,
    h('section', { class: 'card postcard-summary' }, h('h3', { class: 'serif' }, `Keep your ${S.city.name} self`),
      h('button', { onclick: (e) => { e.target.replaceWith(h('p', { class: 'muted' }, 'Saving with an email link is coming soon.')); } }, `Save my ${S.city.name} self`),
      h('div', {}, others.map((c) => h('button', { class: 'ghost', onclick: () => { track({ event: 'try_city', to: c.id }); S.city = c; morph(); } }, `Try ${c.name}`)))));
  if (isMapReveal(location.search)) {
    updateReveal(); // the normal reveal shows first, so the area is never blank
    const mine = revealEls;
    mapPicks().then((m) => {
      if (revealEls !== mine) return m.destroy();
      // The map holds the picks; the postcard line, lead, notes and "still flipping in" stay beneath it.
      const framing = h('div', { class: 'map-framing' });
      const refresh = () => {
        try { m.update(); framing.replaceChildren(...mapFraming(picksView())); }
        catch { try { m.destroy(); } catch {} delete mine.update; delete mine.destroy; picks.replaceChildren(...picksView()); }
      };
      picks.replaceChildren(h('h2', {}, 'Territory you walk'), m.el, framing);
      mine.update = refresh; mine.destroy = m.destroy; refresh();
    })
        .catch(() => { if (revealEls === mine) { delete mine.update; delete mine.destroy; picks.replaceChildren(...picksView()); } });
    return;
  }
  updateReveal();
}

hello();
