import { timedFetch } from './fetch.js';
import { norm } from './musicbrainz.js';

// Apple iTunes Search API (free, no key): only used for a band's 30-second preview.
export const ITUNES_SEARCH = 'https://itunes.apple.com/search';

export function createItunes({ fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return {
    async previewForArtist(name, country) {
      const url = new URL(ITUNES_SEARCH);
      url.searchParams.set('term', name); url.searchParams.set('media', 'music');
      url.searchParams.set('entity', 'song'); url.searchParams.set('country', country); url.searchParams.set('limit', '10');
      try {
        const res = await timedFetch(fetch, url, {}, { timeoutMs, label: 'iTunes preview' });
        if (!res.ok) return null;
        // Only a track by the verified artist itself; never a cover or a namesake's song.
        const r = ((await res.json()).results || []).find((x) => norm(x.artistName) === norm(name));
        return r?.previewUrl ? { url: r.previewUrl, track: r.trackName } : null;
      } catch { return null; }
    },
  };
}
