import { showDifficulty } from './tmdb.js';
import { languageName } from './cities.js';

// HG-7 difficulty for a language learner (an estimate, labelled so in the UI). Base signals:
// TMDB genres and runtime. Claude's pace and dialogue-density read of the overview moves the score
// by at most ±1 on top. Subtitle availability is unknown (no free, account-less source).
// Without Claude's signals this is exactly the old genre heuristic.
const EASY = new Set([16, 10762, 35, 10764]); // same sets as showDifficulty: Animation, Kids, Comedy, Reality
const HARD = new Set([10768, 36, 80, 9648, 99]); // War&Politics, History, Crime, Mystery, Documentary
const PACE = { slow: -1, steady: 0, fast: 1 };
const DIALOGUE = { light: -1, moderate: 0, heavy: 1 };

// Genre: EASY wins over HARD (as in showDifficulty). Runtime always counts. Claude's pace and
// dialogue add at most ±1 on top. With no runtime and no Claude this equals showDifficulty.
export function rateDifficulty({ genreIds = [], runtime, pace, dialogue } = {}) {
  let score = genreIds.some((g) => EASY.has(g)) ? -1 : genreIds.some((g) => HARD.has(g)) ? 1 : 0;
  if (runtime >= 140) score += 1; else if (runtime > 0 && runtime <= 95) score -= 1;
  if (pace in PACE && dialogue in DIALOGUE) score += Math.max(-1, Math.min(1, PACE[pace] + DIALOGUE[dialogue]));
  return score <= -1 ? 'easy' : score >= 1 ? 'hard' : 'medium';
}

// Used only when the city has no subtitleTip of its own.
export function subtitleTip(difficulty, langCode) {
  const lang = languageName(langCode);
  return difficulty === 'easy' ? `If you can, start with subtitles in ${lang}.` : `If you can, start with subtitles in English, then switch to ${lang}.`;
}

// TMDB genre ids -> names (movie + TV lists), so Claude sees words, not ids.
export const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics' };
export const genreNames = (ids = []) => ids.map((g) => GENRES[g]).filter(Boolean);
