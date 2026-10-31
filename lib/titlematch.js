// HG-17: does a native-script title sound like its English (romanised) title? Used to confirm that a
// TMDB record's original_title and title are really the same film before showing them as a pair.
// Indic Unicode blocks share one layout (ISCII order), so one offset table covers Devanagari, Bengali,
// Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada and Malayalam. Both sides become a consonant
// skeleton (vowels dropped; voiced/unvoiced and aspirated forms merged, since Tamil script doesn't mark them).
const INDIC = [0x0900, 0x0d7f];
const OFF = {
  0x02: 'N', 0x15: 'K', 0x16: 'K', 0x17: 'K', 0x18: 'K', 0x19: 'N', 0x1a: 'C', 0x1b: 'C', 0x1c: 'C', 0x1d: 'C', 0x1e: 'N',
  0x1f: 'T', 0x20: 'T', 0x21: 'T', 0x22: 'T', 0x23: 'N', 0x24: 'T', 0x25: 'T', 0x26: 'T', 0x27: 'T', 0x28: 'N', 0x29: 'N',
  0x2a: 'P', 0x2b: 'P', 0x2c: 'P', 0x2d: 'P', 0x2e: 'M', 0x30: 'R', 0x31: 'R', 0x32: 'L', 0x33: 'L', 0x34: 'L',
  0x35: 'V', 0x36: 'S', 0x37: 'S', 0x38: 'S', 0x39: 'H',
};
export function indicSkeleton(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    if (cp < INDIC[0] || cp > INDIC[1]) continue;
    const k = OFF[(cp - 0x0900) % 0x80];
    if (k) out += k;
  }
  return out;
}
export function latinSkeleton(s) {
  const t = String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const a = t[i], b = t[i + 1];
    const di = { ch: 'C', sh: 'S', th: 'T', ph: 'P', kh: 'K', gh: 'K', bh: 'P', dh: 'T', jh: 'C', zh: 'L' }[a + b];
    if (di) { out += di; i++; continue; }
    if (a === 'c') { out += b === 'e' || b === 'i' || b === 'y' ? 'S' : 'K'; continue; }
    const m = { k: 'K', q: 'K', g: 'K', j: 'C', t: 'T', d: 'T', n: 'N', m: 'M', p: 'P', b: 'P', f: 'P', r: 'R', l: 'L', v: 'V', w: 'V', s: 'S', z: 'S', x: 'S', h: 'H' }[a];
    if (m) out += m;
  }
  return out;
}
const lev = (a, b) => {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
// True when the native title reads as the English one (a transliteration). Translated titles
// ('Like Stars on Earth') are not confirmed by this; they need TMDB's own alternative titles.
export function soundsAlike(native, english, min = 0.7) {
  const a = indicSkeleton(native), b = latinSkeleton(english);
  if (a.length < 2 || b.length < 2) return false;
  return 1 - lev(a, b) / Math.max(a.length, b.length) >= min;
}
