import { timedFetch } from './fetch.js';

// Apple iTunes Search API (free, no key): only used for a band's 30-second preview.
export const ITUNES_SEARCH = 'https://itunes.apple.com/search';

export function createItunes({ fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return {
    async previewForArtist(name, country) {
      const url = new URL(ITUNES_SEARCH);
      url.searchParams.set('term', name); url.searchParams.set('media', 'music');
      url.searchParams.set('entity', 'song'); url.searchParams.set('country', country); url.searchParams.set('limit', '1');
      try {
        const res = await timedFetch(fetch, url, {}, { timeoutMs, label: 'iTunes preview' });
        if (!res.ok) return null;
        const r = (await res.json()).results?.[0];
        return r?.previewUrl ? { url: r.previewUrl, track: r.trackName } : null;
      } catch { return null; }
    },
  };
}
