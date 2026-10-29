// Apple iTunes Search API (free, no key) + the feed's <language> tag for verification.
export const ITUNES_SEARCH = 'https://itunes.apple.com/search';

export function createItunes({ fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return {
    async searchPodcasts(term, country, limit = 15) {
      const url = new URL(ITUNES_SEARCH);
      url.searchParams.set('term', term);
      url.searchParams.set('media', 'podcast');
      url.searchParams.set('country', country);
      url.searchParams.set('limit', String(limit));
      const res = await fetch(url);
      if (!res.ok) { const e = new Error(`iTunes failed: HTTP ${res.status}`); e.status = 502; throw e; }
      return (await res.json()).results || [];
    },
    async feedLanguage(feedUrl) {
      try {
        let res = await fetch(feedUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { range: 'bytes=0-20000' } });
        // Some hosts reject Range; retry once with its own fresh timeout.
        if (!res.ok) res = await fetch(feedUrl, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        return parseFeedLanguage((await res.text()).slice(0, 20000));
      } catch { return null; }
    },
    async previewForArtist(name, country) {
      const url = new URL(ITUNES_SEARCH);
      url.searchParams.set('term', name); url.searchParams.set('media', 'music');
      url.searchParams.set('entity', 'song'); url.searchParams.set('country', country); url.searchParams.set('limit', '1');
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const r = (await res.json()).results?.[0];
        return r?.previewUrl ? { url: r.previewUrl, track: r.trackName } : null;
      } catch { return null; }
    },
  };
}

export function parseFeedLanguage(xml) {
  const m = /<language>\s*(?:<!\[CDATA\[)?\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?)/i.exec(xml || '');
  return m ? m[1].toLowerCase() : null;
}

// Narrative = easy, news/politics = hard, else medium (brief §11).
export function podcastDifficulty(genres = []) {
  const g = genres.join(' ').toLowerCase();
  if (/news|politic|noticias|actualit|뉴스|시사/.test(g)) return 'hard';
  if (/fiction|story|drama|comedy|kids|ficci|histoire|comédie/.test(g)) return 'easy';
  return 'medium';
}
