# Homegrown: design brief (HG-2)

*What you'd love if you grew up there.*

> Recreated on 30 Oct 2026 after /workspace/homegrown was wiped. This is a faithful rebuild of the original HG-2 brief, plus the captain's decisions below.

## Captain decisions since the first draft (these override anything below)

1. **v1 scope is music, TV and movies only.** There are no restaurants and no podcasts in v1. Their notes are kept in "Later" sections for reference only.
2. **The native rule is strict.** A pick is shown only if it passes the origin and language check for the chosen city's country and language. Nothing is ever padded with non-native picks. If too few survive, the card says so honestly.
3. **Qloo calls are spaced per browser, with backoff and caching.**
   - Each browser session sends its Qloo calls one at a time, about 7 seconds apart.
   - When Qloo returns a "too many requests" error (429), the session waits and retries, starting at 20 seconds and doubling each time, up to 3 tries.
   - Results are cached per (favourites set, city, category) for 7 days.

---

- **What it is:** you give it five things you love, pick a city, and it shows the music, shows and films a version of you who grew up there would love, all in the local language.
- **Who it's for:** an adult learning Spanish, Korean or French who keeps quitting. It's 11pm, they're on the sofa with a phone, they have Duolingo guilt, and they open Netflix's "Spanish" row and scroll past things they'd never watch in English.
- **The aha:** "Wait, that's *me*, in Mexico City." Meaning a list they actually want to start tonight, made of things they had never heard of.

## 1. The real problem

The pain doesn't come during lessons. It comes at 11pm, when the learner has 40 free minutes and has to pick something in Spanish. The choices are sorted by language and level, not by taste, so they pick something dull, give up after ten minutes, and go back to English. The streak breaks there.

The broader need isn't "find Spanish content". It's **"give me a reason to choose Spanish over English tonight."** Content only wins if it beats what they would watch anyway. Taste is what gets them in; language comes along with it.

## 2. Options considered

| Option | Verdict |
|---|---|
| A. A curated "best Spanish TV" list | Cheap, but it's the same list for everyone and it's the famous stuff. No aha. Cut. |
| B. Just ask an LLM | It names Money Heist and Narcos. It's not grounded in real taste data, and it makes things up. Cut. |
| C. A browser plugin that swaps Netflix rows to the target language | Clever, but fragile, it only covers one platform, and a store review would block it. Cut. |
| D. A weekly "pen-pal twin" email instead of an app | Lovely for retention, but there's no instant reveal. **Kept as phase two** (see section 8). |
| E. A Spotify/Letterboxd import instead of typing favourites | Strong signal, but it adds OAuth friction before the aha. Kept as an optional later path. |
| **F. Five favourites, a city, then a "twin" reveal** (chosen) | The fastest route to the aha, works on any device, and taste data (Qloo) plus origin checks make it real. |

I picked F because it gets to the payoff in about 30 seconds, runs entirely on free tiers, and every pick can be checked against a real source.

## 3. Habituated annoyances, and how they're removed

- **"Foreign language" rows sorted by popularity, not by you.** The whole product is the fix.
- **Dubbed US shows passing as local.** Every pick is strictly checked for origin and language (section 11), and there's a small "made in 🇲🇽" mark on each card.
- **Not knowing whether you can handle it.** Each pick gets an easy/medium/hard dot, so nobody quits ten minutes in.
- **Hunting for where to watch it.** One "where to watch" link from TMDB watch-providers for the user's country.
- **Sign-up walls before value.** No account until after the reveal. Saving is what asks for one.
- **Picking a "level" before you know what you want.** Level is inferred and shown, never asked.

## 4. The aha moment

You see your own favourites turn, one by one, into things someone from Mexico City loves, and you want to press play on at least one tonight.

## 5. Screen-by-screen flow (one action per screen)

1. **Hello.** You see one line, "What you'd love if you grew up there.", and one button: *Start*. *Why it exists:* it sets the promise in seven words. No carousel.
2. **Favourite 1 of 5.** You see a single input, "A show you'd rewatch", with typeahead (Qloo search). You pick one and the card drops into a little shelf at the bottom. *Why:* one thing at a time feels like a chat, not a form. The prompts rotate through show, band, film, book, wildcard. Books and wildcards are inputs only.
3. **Favourites 2 to 5.** Same screen, next prompt. After 3 you can *Skip*. *Why:* 3 signals is enough to work, 5 is better, and nobody gets stuck.
4. **Pick a city.** You see three big postcards (Ciudad de México, 서울, Paris), each with its local name and a faint street sound on hover or tap. You tap one. *Why:* a city feels more human than a language, and the local name sets the tone.
5. **The morph (the twist and the wait).** Each of your five favourites flips over, split-flap style, into its local twin (Breaking Bad → Diablero). This screen hides the API wait, which can be longer now that calls are spaced per browser. *Why:* the loading time becomes the moment of transformation, and it's the shareable bit.
6. **The reveal.** One hero card shows the strongest pick, with the title in the local language, one line on *why you* ("Because you liked Breaking Bad's slow moral rot"), a difficulty dot, the "made in" mark, and a *Where to watch* or *Listen* link. Below it, smaller cards: 2nd show, a film, a band (with a 30-second preview). *Why:* one strong answer first, the rest as support.
7. **How did we do?** Five stamps (1 to 5) and an optional note: "Anything off?" *Why:* this is the feedback loop, and it only appears after you've scrolled the reveal.
8. **Keep your twin.** One action: *Save my Mexico City self* (email magic link). There's also a quiet *Try Seoul* link that replays the morph. *Why:* the account comes after the value, and the city flip is the second aha.

## 6. Visual direction

- **Colour:** warm paper off-white (#F6F3EE), ink near-black (#1B1B1B), plus **one accent per city**: Mexico City in mexican pink (#E4007C), Seoul in dancheong green (#2E8B57), Paris in Métro tile blue (#1D4E89). That's all.
- **Type:** *Fraunces* (Google Fonts, free) for titles, with some character in the local-language names. *Inter* for UI text. Korean uses *Noto Serif KR* (Google Fonts). Big sizes, few weights.
- **Spacing:** an 8pt grid, wide margins, one idea per viewport. The cards look like real paper: a slight shadow, rounded 14px corners, a faint grain texture.
- **Offbeat twist: the split-flap morph.** Your favourites physically flip, like an old airport departures board, into their local twins. The last flip changes the board's header from "Your favourites" to "Tu yo chilango" / "서울의 너" / "Toi, version parisienne". It's calm everywhere else, with one moment of beautiful mechanical theatre.

## 7. Motion plan

| Asset | Screen | Source (free) | Purpose |
|---|---|---|---|
| Split-flap character animation | 5 (morph) | Built in CSS/JS. Candidate MIT library **"Flapper"** (github.com/jayKayEss/Flapper; *named from memory, not checked yet*) or a 40-line custom component | The transformation is the core feeling, and it hides latency |
| Flap clatter sound (short, quiet, muted by default) | 5 | **freesound.org**, search "split flap display" (CC0 only) | Makes the board feel physical. Mute toggle in the corner |
| City street ambience loop, 3s | 4 | freesound.org CC0 (Mexico City street, Seoul subway chime, Paris café) | Gives each city a texture before you even tap |
| Hand-drawn postcard/stamp Lottie | 4, 7 | **LottieFiles.com** free library, search "postage stamp" / "postcard" (free licence) | The stamps are the rating control, so they reinforce the "postcard" world |
| Card drop + shelf settle | 2–3 | **Motion** (motion.dev, free, MIT) spring physics | The favourite feels placed, not typed |
| Paper grain texture | All | Generated in-house with SVG feTurbulence (no asset licence) | Tactile warmth, zero bytes downloaded |
| Icons (play, headphones, film) | 6 | **Phosphor Icons** (MIT) | Consistent, light line weight |

Rule: any motion that doesn't explain or make you feel something is cut. Everything respects `prefers-reduced-motion`, which falls back to a crossfade.

## 8. Feedback loop

- **Captured per reveal:** the 1–5 stamp, an optional note, the city, the five favourite entity IDs, every pick shown (with its source, its origin-check result and its position), what was tapped (watch/listen), and whether the user tried another city.
- **Per pick:** a quiet 👎 "Not local" or "Not my taste" on long-press. These are two different errors, a data error and a taste error, so they're stored separately.
- **How it improves the product:**
  - "Not local" flags feed a blocklist and tighten the strict filters for that category and city.
  - Low stamps with notes get read weekly, and the patterns become prompt or filter changes.
  - Taps per category show which category earns its place.
  - Phase two: the saved twin sends a short "your twin's week" email with one new pick.

## 9. What was cut, and the constraints

**Cut:** restaurants and podcasts (captain's v1 decision; see "Later" in section 11); accounts before the reveal; choosing a language level; more than 3 cities at launch; books as an *output* (they're kept as an input only); social feed; streaks/gamification (that's the guilt we're escaping); a map view.

**Constraints:**
- **Free tiers only:** Qloo hackathon key, TMDB, MusicBrainz, Vercel Hobby, Supabase free.
- **Qloo rate limit:** Qloo throttles about 5 calls in 20 seconds. Calls are spaced per browser, about 7 seconds apart, with 429 backoff (20s, then 40s, then 80s, max 3 tries).
- **Caching:** results are cached per (favourites set, city, category) for 7 days. The server is shared across all browsers, so popular combinations make no new calls.
- **MusicBrainz:** 1 request per second, with a User-Agent.
- **Language coverage:** 3 cities first. More cities are added only when each category's strict pass rate is at least 80% in that city.

## 10. Risks, and how the design handles them

- **Typeahead can't find a favourite.** Show the closest 3 plus "something like it", and allow skipping after 3 favourites.
- **The morph feels slow (more likely now, with spaced calls).**
  - The board animates no matter what.
  - The reveal shows the hero pick as soon as the first category lands, and the rest flip in as they arrive.
  - Cached results are instant.
  - Order the calls TV, then movie, then music, so the strongest category comes first.
- **A pick isn't really local.** The strict native rule means it is dropped. If fewer than 2 native picks survive in a category, the card says so honestly ("Few Korean films match you, here's what does") instead of showing a fake.
- **Picks are too hard for the user's level.** The difficulty dot plus a one-line "start with subtitles in Spanish" tip.
- **Taste beats locality.** HG-1 showed this: anime fans got Japanese shows in Mexico City. The country filter is always applied, so taste ranks within local content, never instead of it.
- **Users bounce at sign-up.** Sign-up comes only after the reveal, and the reveal is shareable without an account.

## 11. Data plan (v1: music, TV, movies)

**Strict native rule:** a pick passes only if every check below passes. A pick that fails any check is removed and never shown. There is no padding.
- **TV/movies:** TMDB `original_language` equals the city's language (es / ko / fr), **and** TMDB `origin_country` includes the city's country (MX / KR / FR); for films with an empty `origin_country`, `production_countries` is used instead (HG-14).
- **Music:** MusicBrainz artist `country` (or area) equals the city's country. Instrumental-only or mostly-English artists are dropped when the lyrics language can be checked.

| Category | Discover (taste) | Locality filter | Verify (free) | HG-1 raw → expected after strict filtering |
|---|---|---|---|---|
| TV (2 picks) | Qloo insights `urn:entity:tv_show`, favourites as signals, `signal.location.query=<city>` | `filter.release_country=<country>` | **TMDB** (free API key): match by title + year, then apply the strict rule | 0% raw (MX/Paris) → ~65–70% language-native from Qloo's country filter alone; **100% of what's shown after TMDB** (about 6–7 of a top 10 survive, so 2 picks are safe) |
| Movies (1 pick) | Qloo `urn:entity:movie` + city signal | `filter.release_country=<country>` | TMDB, strict rule, same as TV | Not measured in HG-1. Assumed similar to TV. **Test this first** |
| Music (1 band) | Qloo `urn:entity:artist` + city signal | `filter.tags` genre: `latin` (MX), `k_pop` (Seoul), `french` (Paris) | **MusicBrainz** country check, strict; Deezer free 30s preview for listening | 60–100% by origin from tags (MX ~60%, Seoul 100%, Paris ~80%) → **100% of what's shown after MusicBrainz** (about 6–10 of a top 10 survive) |
| Why-line + difficulty | LLM using the Qloo tags the favourite and the pick share | n/a | Difficulty: TV/film by genre + TMDB (kids/animation = easy, period/legal = hard); music by lyric density (default medium) | n/a |

**Overall:** every pick shown is native, by construction. The open risk is volume, not accuracy: niche tastes in a small market may leave fewer than 2 picks, which the design handles honestly. To get more candidates, ask Qloo for a top 20 (one call) before filtering.

**Free-tier rule:** no paid APIs, ever. Spotify's API is avoided (strict terms for preview use). If a source starts charging, the category degrades gracefully rather than switching to a paid source without approval.

### Later (not in v1)
- **Podcasts:** Apple iTunes Search (`media=podcast&country=mx/kr/fr`) plus Apple Top Podcasts RSS, checked by the feed's `<language>`. Expected ~95% native but weaker on taste.
- **Restaurants:** Qloo `urn:entity:place` + `filter.location.query=<city>`, which was ~95–100% local in HG-1, with chains and tourist clusters dropped.

## 12. Open product questions (with my default answers)

1. **Which three cities at launch?** *Default:* Mexico City, Seoul, Paris (HG-1 tested them). Next: Tokyo, then São Paulo.
2. **Do we need an account at all?** *Default:* not for the reveal. A magic link only to save a twin or get the weekly email.
3. **Should the output include books?** *Default:* no. Books are an input only.
4. **Where-to-watch for which country?** *Default:* the user's country from the browser locale, via TMDB watch providers (JustWatch data, free with attribution).
5. **How is "difficulty" defined?** *Default:* a simple 3-step heuristic per category (section 11). Not CEFR. Shown as a dot, never asked.
6. **What if fewer than 2 native picks survive?** *Default:* show what survives plus an honest line. Never pad (strict rule).
7. **Is the UI in English or the target language?** *Default:* English UI, with titles, the board header and city names in the target language. Phase two adds a "more Spanish" toggle.
8. **Is sound on by default?** *Default:* off, with a visible tap-to-enable on the city screen.
9. **Can a reveal be shared?** *Default:* yes. A public read-only link with an OG image of the split-flap board.
10. **Which LLM writes the why-lines?** *Default:* whatever free or cheapest tier is available through the existing gateway. The why-line must quote a real shared Qloo tag (no made-up reasons).
11. **Do co-productions count as native (e.g. Lupin, France and US)?** *Decided (HG-14):* yes, if TMDB `original_language` matches and `origin_country` includes the city's country (`production_countries` only when `origin_country` is empty). A film whose origin is only the US stays out even with a local co-producer.

## Captain decisions (2026-10-30)

These override anything above that conflicts with them.

1. **Thin categories.** Aim for 5 strict-local picks per category, screened from a Qloo top 15. If a city has fewer than 3 for a category, show what was found, say plainly that local picks are scarce there, and leave that category off the city's postcard. The strict native rule is unchanged: never pad.
2. **Data-gated cities.** A city goes live only if it reaches at least 60% local picks in all three categories (music, TV, movies) in the measuring run. The threshold and the measured counts live in `config/gate.json`. `npm run measure` writes that file: it checks every Qloo candidate (top 15) per city and category through the app's real code path, with no early stop. The server refuses non-live cities (403), and the UI never offers them.
3. **Flow.** Step 1: the learner picks a language (Spanish, Korean, French). Step 2: we suggest the best live city for it (the live city with the highest weakest-category %). If no city for that language is live, we say so plainly. Favourites come after that.
4. **Culture leads in.** Each reveal gets one line, e.g. "Seoul: dramas lead". It is computed only from Qloo's own native counts per category in the measuring run, never hand-written. Ties share the lead ("dramas and films lead").
5. **Language list.** v1 shows only languages with at least one city passing the 60% bar in all three categories. The rest show as "coming soon".
6. **Several cities per language.** The default is the measured best city (highest weakest-category %), and switching to another live city for that language is one tap. Spanish candidates: Mexico City, Madrid, Buenos Aires. French: Paris. Korean: Seoul.
7. **Chennai / Tamil.** Candidate city: country India (IN), language `ta`, TMDB `original_language` `ta`, MusicBrainz country IN, Qloo release country "India". It goes live only if it passes the same 60% bar.

Cities and languages are data in `config/cities.json`. Adding a city means adding a config entry and running `npm run measure`, which measures every configured city × TV, movies and music.
