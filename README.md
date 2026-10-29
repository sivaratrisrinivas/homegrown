# Homegrown

*What you'd love if you grew up there.* Enter 3-5 favourites, pick Mexico City, Seoul or Paris, and get Qloo taste-matched picks that are verified native: shows (TMDB), a band (MusicBrainz), a podcast (Apple iTunes Search plus the feed's `<language>` tag) and a place to eat (Qloo address plus a chain blocklist).

## Run

```
npm test          # zero dependencies, node >= 20
npm run dev       # http://localhost:3000
```

Deployable as-is on Vercel Hobby: `public/` is static and `api/*.js` are Node functions.

## Env vars (never commit them)

| Var | Needed for |
|---|---|
| `QLOO_API_KEY` | typeahead, TV, music and place discovery |
| `TMDB_API_KEY` | TV origin check and where-to-watch (v3 key or v4 read token) |

When a key is missing, the API returns `503 {"error":"missing_key","key":"..."}` and the UI says so. Podcasts still work without keys. `/api/health` reports only whether each key is present.

## Rules baked in

- Qloo calls are serialised about 7 s apart, with 429 backoff that honours Retry-After. MusicBrainz is limited to 1 req/s with a descriptive User-Agent.
- No padding: if verification drops candidates, the card shows fewer picks and an honest note.
- Why-lines quote a real shared Qloo tag, or fall back to a neutral "taste-matched" line.
- Results are cached in memory per (favourites set, city, category) for 7 days.
