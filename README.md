# Homegrown

*What you'd love if you grew up there.* Enter 3-5 favourites, pick Mexico City, Seoul or Paris, and get Qloo taste-matched picks that are verified native: shows and a film (TMDB: exact title, original language and country) and a band (MusicBrainz, with an iTunes 30-second preview). Version 1 covers music, TV and movies only; anything not verifiably made in the city is dropped, never padded.

## Run

```
npm test          # zero dependencies, node >= 20
npm run dev       # http://localhost:3000
```

Deployable as-is on Vercel Hobby: `public/` is static and `api/*.js` are Node functions.

## Env vars (never commit them)

| Var | Needed for |
|---|---|
| `QLOO_API_KEY` | typeahead and all three categories |
| `TMDB_API_KEY` | show and film origin checks and where-to-watch (v3 key or v4 read token) |

When a key is missing, the API returns `503 {"error":"missing_key","key":"..."}` and the UI says so. `/api/health` reports only whether each key is present.

## Rules baked in

- Qloo calls are serialised about 7 s apart, with 429 backoff that honours Retry-After. MusicBrainz is limited to 1 req/s with a descriptive User-Agent.
- No padding: if verification drops candidates, the card shows fewer picks and an honest note.
- Why-lines quote a real shared Qloo tag, or fall back to a neutral "taste-matched" line.
- Each request logs its native rate per category (candidates checked, accepted, %), with no secrets or user text.
- Results are cached in memory per (favourites set, city, category) for 7 days.

## Captain rules (v1)

- **Picks:** 5 strict-local picks per category from a Qloo top 15. Fewer than 3 is "scarce": the category is shown with a plain note but left off the postcard.
- **City gate:** a city is live only with ≥ 60% local picks in TV, movies and music. See `config/gate.json`, refreshed by `npm run measure`, which needs `QLOO_API_KEY` and `TMDB_API_KEY` and takes ~3 min because Qloo calls are ~7 s apart.
- **Flow:** language first (only languages with a live city; the others are "coming soon"), then the measured best city, with a one-tap switch to other live cities.
- **Config:** cities and languages live in `config/cities.json`. To add a city, add an entry and run `npm run measure`. Candidates: Mexico City, Madrid, Buenos Aires, Seoul, Paris, Chennai.
- **Reveal:** one "culture leads in" line, computed from the measured native counts.

## Deployment

`vercel.json` sets `maxDuration: 60` for `api/twin.js`. Vercel Hobby with Fluid compute (the default) allows up to 300 s, so 60 s fits; the request deadlines (45 s / 50 s) keep each call inside it.

## Deviations from the design brief

- **Qloo 429 backoff.** The brief ([docs/design-brief.md](docs/design-brief.md)) says 20 s, then 40 s, then 80 s, max 3 tries. We keep calls about 7 s apart, honour `Retry-After`, and otherwise back off 14 s, 28 s, then 30 s (capped by `QLOO_MAX_BACKOFF_MS`). Retries also stop at a request deadline fixed when the request arrives (50 s for Qloo, 45 s for verification). An 80 s wait cannot fit inside a 60 s serverless function, so the request returns 429/504 instead of hanging.

## Claude alternate-name fallback (HG-8)

When `/api/search` returned nothing for a typed favourite and the user presses Enter, the client calls `GET /api/altnames?q=&kind=`.
The server asks `claude-haiku-5-5` (max_tokens 100, thinking off) for up to 3 alternate/official names as JSON,
re-resolves at most 2 with Qloo search (7 s throttle) and returns only an entity whose Qloo name equals one of them.
Claude never sources picks. Needs `ANTHROPIC_API_KEY`; without it, or on any error, the endpoint returns `{ results: [] }`.

Caps (`lib/altnames.js`): 10 Claude calls per IP per UTC day (IP from `x-vercel-forwarded-for`/`x-real-ip`);
at most 40 Qloo searches per UTC day for this feature; worst-case cost reserved before each call;
identical in-flight requests share one call; a global spend estimate from usage tokens
(priced at Haiku 5.5's higher long-prompt rates, $0.50/$2.50 per MTok) stopped at $0.25 per UTC day; a call starts only
if its worst case fits. Results, including "no match", are cached 7 days.
Limitation: this state is in-memory per serverless instance. It resets on cold starts and isn't shared across
instances, so the real daily spend can exceed one instance's cap. That's why the cap is half the $0.50 budget.
