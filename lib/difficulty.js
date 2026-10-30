import { showDifficulty } from './tmdb.js';
import { languageName } from './cities.js';

// HG-7 difficulty for a language learner. Signals: TMDB genres, runtime, and Claude's pace and
// dialogue-density read of the overview. Subtitle availability is unknown (no free, account-less
// source), so it adds nothing. Without Claude's signals this is exactly the old genre heuristic.
const EASY = new Set([16, 10751, 10762, 35, 10764]); // Animation, Family, Kids, Comedy, Reality
const HARD = new Set([10768, 36, 80, 9648, 99, 10752]); // War&Politics, History, Crime, Mystery, Documentary, War
const PACE = { slow: -1, steady: 0, fast: 1 };
const DIALOGUE = { light: -1, moderate: 0, heavy: 1 };

export function rateDifficulty({ genreIds = [], runtime, pace, dialogue } = {}) {
  if (!(pace in PACE) || !(dialogue in DIALOGUE)) return showDifficulty(genreIds);
  let score = 0;
  if (genreIds.some((g) => EASY.has(g))) score -= 1;
  if (genreIds.some((g) => HARD.has(g))) score += 1;
  if (runtime >= 140) score += 1; else if (runtime > 0 && runtime <= 95) score -= 1;
  score += PACE[pace] + DIALOGUE[dialogue];
  return score <= -1 ? 'easy' : score >= 2 ? 'hard' : 'medium';
}

// Short subtitle tip. Easy: subtitles in the film's own language from the start (read along).
// Medium/hard: start with subtitles in English, the UI language, then switch.
export function subtitleTip(difficulty, langCode) {
  const lang = languageName(langCode);
  if (difficulty === 'easy') return `Start with subtitles in ${lang}.`;
  if (difficulty === 'medium') return `Start with subtitles in English, then switch to ${lang}.`;
  return `Start with subtitles in English; rewatch favourite scenes in ${lang}.`;
}

// TMDB genre ids -> names (movie + TV lists), so Claude sees words, not ids.
export const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics' };
export const genreNames = (ids = []) => ids.map((g) => GENRES[g]).filter(Boolean);
