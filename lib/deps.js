import { createQloo } from './qloo.js';
import { createTmdb } from './tmdb.js';
import { createMusicBrainz } from './musicbrainz.js';
import { createItunes } from './itunes.js';
import { createCache } from './cache.js';
import { createTwinService } from './twin.js';

let deps;
export function getDeps() {
  if (!deps) {
    const qloo = createQloo();
    const log = (o) => console.log(JSON.stringify(o));
    deps = { qloo, twin: createTwinService({ qloo, tmdb: createTmdb(), mb: createMusicBrainz(), itunes: createItunes(), cache: createCache(), log }), log };
  }
  return deps;
}
export function setDeps(d) { deps = d; }

// Errors never include secrets: messages are built from status codes and key *names* only.
export function sendError(res, err) {
  const status = err.status || 500;
  const body = err.code === 'missing_key'
    ? { error: 'missing_key', key: err.keyName, message: `This feature needs ${err.keyName}, which isn't configured yet.` }
    : { error: status === 429 ? 'rate_limited' : status < 500 ? 'bad_request' : 'upstream_error', message: status < 500 || status === 429 ? err.message : 'Something went wrong upstream.' };
  // Upstream failures: log only the upstream status (no URL, no message, which could carry a key).
  if (status >= 500) console.error(JSON.stringify({ event: 'upstream_error', status, upstream: err.upstreamStatus ?? null, source: err.source ?? null }));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
export function sendJson(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
