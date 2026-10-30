import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWhy, createWhyWriter, parseBatch, MAX_WHY_USD } from '../lib/whyllm.js';
import { createClaudeBudget } from '../lib/budget.js';
import { rateDifficulty, subtitleTip } from '../lib/difficulty.js';
import { personalise } from '../lib/twin.js';
import { createAnthropic } from '../lib/anthropic.js';
import { fakeFetch, json } from './helpers.js';

const FAVS = [
  { id: 'f1', name: 'Breaking Bad', tags: [{ id: 'urn:tag:keyword:qloo:moral_decay', name: 'moral_decay' }, { id: 'urn:tag:genre:crime', name: 'crime' }] },
  { id: 'f2', name: 'Radiohead', tags: [] },
  { id: 'f3', name: 'Parasite', tags: [{ id: 'urn:tag:theme:class', name: 'class struggle' }] },
];
const OVERVIEW = 'A chemistry teacher in Busan turns to crime to pay for his family, and slowly loses himself.';
const pick = (o = {}) => ({ category: 'movie', qlooId: 'q1', title: '악인', englishTitle: 'The Wicked', difficulty: 'hard',
  tags: [{ id: 'urn:tag:keyword:qloo:moral_decay', name: 'moral_decay' }, { id: 'urn:tag:genre:crime', name: 'crime' }],
  src: { overview: OVERVIEW, genreIds: [80, 18], genreNames: ['Crime', 'Drama'], runtime: 118, language: 'ko' }, ...o });
const GROUND = { favourite: 'Breaking Bad', sources: ['Breaking Bad', '악인', 'The Wicked', 'moral decay', 'crime', OVERVIEW] };

test('grounding: a line built from the data passes', () => {
  assert.equal(validateWhy('Like Breaking Bad, it follows a chemistry teacher who turns to crime and slowly loses himself', GROUND),
    'Like Breaking Bad, it follows a chemistry teacher who turns to crime and slowly loses himself.');
});
test('grounding: invented names, places, numbers and titles are rejected', () => {
  for (const bad of [
    'Like Breaking Bad, it stars Song Kang-ho as a teacher who turns to crime in Busan.',
    'Like Breaking Bad, this chemistry teacher story is set in Seoul and turns to crime.',
    'Like Breaking Bad, it won 3 awards for its teacher who turns to crime and loses himself.',
    'Fans of Breaking Bad and Oldboy will love this chemistry teacher who turns to crime.',
    'Like Breaking Bad, this 범죄 story follows a chemistry teacher who turns to crime.',
  ]) assert.equal(validateWhy(bad, GROUND), null, bad);
});
test('grounding: length, single sentence and favourite name are enforced', () => {
  assert.equal(validateWhy('Like Breaking Bad.', GROUND), null);
  assert.equal(validateWhy('Like Breaking Bad, it is about crime. A teacher slowly loses himself to it all.', GROUND), null);
  assert.equal(validateWhy('A chemistry teacher turns to crime to pay for his family and slowly loses himself.', GROUND), null);
  assert.equal(validateWhy('Like Breaking Bad, ' + 'crime '.repeat(40), GROUND), null);
});

const mockClaude = (reply, calls = { n: 0 }) => ({ calls, async whyBatch(payload) { calls.n++; calls.last = payload; return typeof reply === 'function' ? reply(payload) : reply; } });
const answer = (why, extra = {}) => (payload) => ({ text: JSON.stringify({ picks: payload.picks.map((p) => ({ id: p.id, why, pace: 'slow', dialogue: 'heavy', ...extra })) }), usage: { input_tokens: 500, output_tokens: 100 } });
const GOOD = 'Like Breaking Bad, it follows a chemistry teacher who turns to crime and slowly loses himself.';

test('batch: all picks of a reveal go in one call, then the cache serves pick+favourite', async () => {
  const claude = mockClaude(answer(GOOD));
  const w = createWhyWriter({ claude, budget: createClaudeBudget() });
  const picks = [pick(), pick({ qlooId: 'q2' }), pick({ qlooId: 'q3' })];
  const a = await w(picks, FAVS, { ip: 'x' });
  assert.equal(claude.calls.n, 1); assert.equal(claude.calls.last.picks.length, 3);
  assert.equal(claude.calls.last.picks[0].favourite, 'Breaking Bad');
  assert.deepEqual(claude.calls.last.picks[0].shared_tags, ['moral decay', 'crime']);
  assert.equal(a[0].why, GOOD);
  const b = await w(picks, FAVS, { ip: 'y' });
  assert.equal(claude.calls.n, 1); assert.deepEqual(b, a);
  // A different favourite name (same id) is a different cache entry.
  await w([pick()], FAVS.map((f) => (f.id === 'f1' ? { ...f, name: 'BB' } : f)), { ip: 'x' });
  assert.equal(claude.calls.n, 2);
});
test('fallback: Claude error, invented line, timeout and spent budget keep the heuristic', async () => {
  const fail = createWhyWriter({ claude: { async whyBatch() { throw Object.assign(new Error('x'), { status: 502 }); } }, budget: createClaudeBudget() });
  const r1 = await fail([pick()], FAVS, { ip: 'x' });
  assert.deepEqual(r1, [null]);
  const out = personalise({ picks: [pick()] }, FAVS, r1).picks[0];
  assert.equal(out.why.source, undefined); assert.match(out.why.text, /Breaking Bad/);
  assert.equal(out.difficulty, 'hard'); assert.equal(out.difficultySource, 'heuristic');
  assert.equal(out.src, undefined); assert.equal(out.tags, undefined);

  const liar = createWhyWriter({ claude: mockClaude(answer('Like Breaking Bad, it stars Song Kang-ho as a teacher who turns to crime.')), budget: createClaudeBudget() });
  const r2 = await liar([pick()], FAVS, { ip: 'x' });
  assert.equal(r2[0].why, null);
  assert.notEqual(personalise({ picks: [pick()] }, FAVS, r2).picks[0].why.source, 'claude');

  const slow = mockClaude(() => new Promise((r) => setTimeout(() => r(answer(GOOD)({ picks: [{ id: 'p0' }] })), 200)));
  const w = createWhyWriter({ claude: slow, budget: createClaudeBudget(), waitMs: 20 });
  assert.deepEqual(await w([pick()], FAVS, { ip: 'x' }), [null]);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal((await w([pick()], FAVS, { ip: 'x' }))[0].why, GOOD); // late answer filled the cache
  assert.equal(slow.calls.n, 1);

  const claude = mockClaude(answer(GOOD));
  const broke = createWhyWriter({ claude, budget: createClaudeBudget({ usdPerDay: MAX_WHY_USD / 2 }) });
  assert.deepEqual(await broke([pick()], FAVS, { ip: 'x' }), [null]); assert.equal(claude.calls.n, 0);
});
test('budget is shared and per-IP capped; no shared tags or overview means no call', async () => {
  const budget = createClaudeBudget({ usdPerDay: MAX_WHY_USD * 2.5 });
  const claude = mockClaude(() => ({ text: '{}', usage: {} })); // no usage -> keeps full reservation
  const w = createWhyWriter({ claude, budget, caps: { perIpPerDay: 1, maxIps: 10, maxPicks: 6 } });
  await w([pick({ qlooId: 'a' })], FAVS, { ip: 'x' });
  await w([pick({ qlooId: 'b' })], FAVS, { ip: 'x' }); assert.equal(claude.calls.n, 1); // per-IP cap
  await w([pick({ qlooId: 'c' })], FAVS, { ip: 'y' });
  await w([pick({ qlooId: 'd' })], FAVS, { ip: 'z' }); assert.equal(claude.calls.n, 2); // $ cap
  assert.equal(budget.reserve(0.0001), true);
  const none = createWhyWriter({ claude, budget: createClaudeBudget() });
  assert.deepEqual(await none([pick({ tags: [] }), pick({ src: { ...pick().src, overview: '' } })], FAVS), [null, null]);
  assert.equal(claude.calls.n, 2);
});
test('difficulty mapping', () => {
  assert.equal(rateDifficulty({ genreIds: [80] }), 'hard'); // no Claude signals -> old heuristic
  assert.equal(rateDifficulty({ genreIds: [35] }), 'easy');
  assert.equal(rateDifficulty({ genreIds: [18] }), 'medium');
  assert.equal(rateDifficulty({ genreIds: [16], runtime: 90, pace: 'slow', dialogue: 'light' }), 'easy');
  assert.equal(rateDifficulty({ genreIds: [35], runtime: 110, pace: 'fast', dialogue: 'heavy' }), 'medium');
  assert.equal(rateDifficulty({ genreIds: [80], runtime: 155, pace: 'steady', dialogue: 'moderate' }), 'hard');
  assert.equal(rateDifficulty({ genreIds: [18], runtime: 120, pace: 'fast', dialogue: 'heavy' }), 'hard');
  assert.equal(rateDifficulty({ genreIds: [80], runtime: 90, pace: 'slow', dialogue: 'light' }), 'easy');
  assert.equal(rateDifficulty({ genreIds: [18], runtime: 120, pace: 'bogus', dialogue: 'heavy' }), 'medium');
  assert.equal(subtitleTip('easy', 'ko'), 'Start with subtitles in Korean.');
  assert.match(subtitleTip('hard', 'ta'), /^Start with subtitles in English.*Tamil/);
  const p = personalise({ picks: [pick()] }, FAVS, [{ why: GOOD, favourite: 'Breaking Bad', pace: 'steady', dialogue: 'light' }]).picks[0];
  assert.equal(p.difficulty, 'medium'); assert.equal(p.difficultySource, 'claude+tmdb');
  assert.equal(p.why.text, GOOD); assert.equal(p.why.source, 'claude'); assert.equal(p.tip, 'Start with subtitles in English, then switch to Korean.');
});
test('parseBatch tolerates fences and junk; whyBatch never leaks the key in errors', async () => {
  assert.equal(parseBatch('```json\n{"picks":[{"id":"p0"}]}\n```').length, 1);
  assert.deepEqual(parseBatch('nope'), []);
  const c = createAnthropic({ fetch: fakeFetch([['anthropic.com', () => json({}, 500)]]), env: { ANTHROPIC_API_KEY: 'sk-secret' } });
  await assert.rejects(c.whyBatch({ picks: [] }), (e) => !String(e.message).includes('sk-secret') && e.upstreamStatus === 500);
});
