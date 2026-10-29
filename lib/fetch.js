// Fetch with a timeout. Errors are rebuilt from a label + status only: never the URL or the raw
// error, because URLs can carry credentials (e.g. TMDB api_key).
export async function timedFetch(fetchImpl, url, init, { timeoutMs, label }) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    const err = new Error(`${label} ${timeout ? 'timed out' : 'network error'}`);
    err.status = timeout ? 504 : 502;
    throw err;
  }
}
