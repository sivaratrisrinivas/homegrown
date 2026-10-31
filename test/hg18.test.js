import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWhy, feedbackFor, allowedWords, buildContent } from '../lib/whyllm.js';
import { WHY_SYSTEM } from '../lib/anthropic.js';

const ground = { favourite: 'Breaking Bad', titles: ['Powder'], sources: ['Crime', 'Drama', 'Two teenagers chase a cartel shipment of cocaine across the city.'] };

test('HG-18: checkWhy names the number word and the ungrounded words; the rules are unchanged', () => {
  assert.deepEqual(checkWhy('Fans of Breaking Bad will like this crime drama about two teenagers and a cartel shipment.', ground), { line: null, reason: 'number_word', word: 'two' });
  const r = checkWhy('Fans of Breaking Bad will like this crime drama about teenagers and a drug cartel shipment.', ground);
  assert.equal(r.reason, 'ungrounded:1'); assert.equal(r.word, 'drug');
  assert.ok(checkWhy('Fans of Breaking Bad will like this crime drama about teenagers and a cartel shipment of cocaine.', ground).line);
});

test('HG-18: retry feedback names the rule and the word, letters only', () => {
  assert.match(feedbackFor('number_word', 'two'), /number word "two".*"teenagers", not "two teenagers"/);
  assert.match(feedbackFor('ungrounded:2', 'drug, <x>'), /"drug, x", which is not in the words list/);
  assert.equal(feedbackFor('missing'), '');
  const c = buildContent([{ input: { id: 'p0', favourite: 'F', words: ['a'], tags: [], title: 'T', genres: [], overview: 'o', feedback: feedbackFor('number_word', 'two') } }]);
  assert.match(c, /<feedback>Your previous line[^<>]*<\/feedback>/);
});

test('HG-18: word list drops number-only words like year and old; prompt forbids number words', () => {
  const w = allowedWords(['A seventeen year old discovers the punk scene.']);
  assert.ok(!w.includes('year') && !w.includes('old') && !w.includes('seventeen'));
  assert.ok(w.includes('punk'));
  assert.match(WHY_SYSTEM, /"teenagers", not "two teenagers"/);
  assert.match(WHY_SYSTEM, /<feedback>/);
});
