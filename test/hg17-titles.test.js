// HG-17: Indic scripts render at a normal weight from a named per-script font, not a random system fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/styles.css', 'utf8');
const html = readFileSync('public/index.html', 'utf8');
const SCRIPTS = ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Devanagari', 'Gurmukhi', 'Gujarati', 'Oriya'];

test('HG-17: serif and sans stacks name a Noto font per Indic script before the generic fallback', () => {
  const serifVar = css.match(/--serif:([^;]+);/)[1], sansVar = css.match(/--sans:([^;]+);/)[1];
  assert.match(serifVar, /var\(--indic-serif\),serif$/); assert.match(sansVar, /var\(--indic-sans\)/);
  for (const s of SCRIPTS) {
    assert.match(css, new RegExp(`--indic-serif:[^;]*"Noto Serif ${s}"`), `serif ${s}`);
    assert.match(css, new RegExp(`--indic-sans:[^;]*"Noto Sans ${s}"`), `sans ${s}`);
    // Loaded at weight 400 only (no heavy weights).
    assert.match(html, new RegExp(`family=Noto\\+Serif\\+${s}:wght@400(&|")`), `loads serif ${s} 400`);
    assert.match(html, new RegExp(`family=Noto\\+Sans\\+${s}:wght@400(&|")`), `loads sans ${s} 400`);
  }
  assert.match(css, /h1,h2,\.serif\{font-family:Fraunces,"Fraunces Fallback",var\(--indic-serif\),serif;font-weight:400/);
  assert.doesNotMatch(html, /Noto\+(Serif|Sans)\+[A-Za-z]+:wght@[^"&]*(500|600|700|800|900)/);
});

test('HG-17: native-script headings (any Indic lang) stay at weight 400, even h3', () => {
  const rule = css.match(/:is\(((?::lang\(\w+\),?)+)\):is\(h1,h2,h3,\.serif\)\{font-weight:400\}/);
  assert.ok(rule, 'Indic weight rule present');
  for (const l of ['ta', 'te', 'kn', 'ml', 'bn', 'hi', 'mr', 'pa', 'gu', 'or']) assert.match(rule[1], new RegExp(`:lang\\(${l}\\)`), l);
  // The AI card heading carries the language so the rule applies.

});

import { soundsAlike } from '../lib/titlematch.js';
test('HG-17: native/English sound check across Indic scripts (real TMDB pairs)', () => {
  const same = [['ಕಿರಿಕ್ ಪಾರ್ಟಿ', 'Kirik Party'], ['ಕಾಂತಾರ', 'Kantara'], ['ಯು ಟರ್ನ್', 'U Turn'], ['விக்ரம் வேதா', 'Vikram Vedha'], ['दंगल', 'Dangal'],
    ['അങ്കമാലി ഡയറീസ്', 'Angamaly Diaries'], ['পথের পাঁচালী', 'Pather Panchali'], ['అల వైకుంఠపురములో', 'Ala Vaikunthapurramuloo'], ['ਕੈਰੀ ਆਨ ਜੱਟਾ', 'Carry On Jatta'],
    // HG-17 review: Malayalam chillus, Devanagari nukta (precomposed and combining), Bengali khanda ta, Tamil aytham.
    ['ഉസ്താദ് ഹോട്ടൽ', 'Ustad Hotel'], ['ബാംഗ്ലൂർ ഡെയ്സ്', 'Bangalore Days'], ['\u095Bिंदगी ना मिलेगी दोबारा', 'Zindagi Na Milegi Dobara'],
    ['ज\u093Cिंदगी ना मिलेगी दोबारा', 'Zindagi Na Milegi Dobara'], ['উৎসব', 'Utsab'], ['ஃபைட் கிளப்', 'Fight Club']];
  for (const [n, e] of same) assert.equal(soundsAlike(n, e), true, `${n} ~ ${e}`);
  // TMDB 397490: original_title 'ಮಗಳು ಜಾನಕಿ' is a different work from 'U Turn'. Translated titles aren't confirmed by sound.
  for (const [n, e] of [['ಮಗಳು ಜಾನಕಿ', 'U Turn'], ['तारे ज़मीन पर', 'Like Stars on Earth'], ['', 'X'], ['ಕ', 'K']]) assert.equal(soundsAlike(n, e), false, `${n} !~ ${e}`);
});

import { indicSkeleton } from '../lib/titlematch.js';
test('HG-17 review: block-specific letters map to their consonant', () => {
  assert.equal(indicSkeleton('\u0D7A\u0D7B\u0D7C\u0D7D\u0D7E\u0D7F'), 'NNRLLK');
  assert.equal(indicSkeleton('\u0958\u0959\u095A\u095B\u095C\u095D\u095E'), 'KKKSTTP');
  assert.equal(indicSkeleton('\u09CE'), 'T');
  assert.equal(indicSkeleton('\u0B83'), 'H');
  assert.equal(indicSkeleton('\u0B83\u0BAA'), 'P', 'ஃப is f');
  assert.equal(indicSkeleton('\u0C58'), '', 'Telugu archaic letters are not nukta forms');
});

import { aiReveal } from '../public/aisuggest-client.js';
test('HG-17 review: card heading lang is the language only for Indic-script titles, else en', async () => {
  const h3s = [];
  const h = (tag, attrs = {}, ...kids) => { if (tag === 'h3') h3s.push([attrs.lang, kids.flat().join('')]); return { tag }; };
  const body = { status: 'ok', label: 'x', films: [{ title: 'U Turn', year: 2016 }, { title: 'ಕಿರಿಕ್ ಪಾರ್ಟಿ', englishTitle: 'Kirik Party', year: 2016 }, { title: 'ಕಾಂತಾರ', year: 2022 }] };
  await aiReveal({ h, show: () => {}, lang: { id: 'kn', name: 'Kannada' }, favourites: [], onBack: () => {}, fetch: async () => ({ json: async () => body }) });
  assert.deepEqual(h3s, [['en', 'U Turn'], ['kn', 'ಕಿರಿಕ್ ಪಾರ್ಟಿ'], ['kn', 'ಕಾಂತಾರ']]);
});
