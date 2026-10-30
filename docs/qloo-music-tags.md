# Qloo music genre tags per city (evidence)

Looked up on 2026-10-30 with Qloo's tags search, `GET /v2/tags?filter.query=<term>`, on the hackathon API. These are the tag ids Qloo returned, copied rather than guessed. Each city's `musicTag` in `config/cities.json` is one of them, used as `filter.tags=urn:tag:genre:music:<tag>` in the music insights call.

| City | Query | Tags Qloo returned (music genres) | Chosen |
|---|---|---|---|
| Mexico City | `mexican` | `urn:tag:genre:music:mexican`, `…:mexican_folk` (also `regional mexican` → `…:regional_mexican`) | `mexican` |
| Madrid | `spanish` | `urn:tag:genre:music:spanish`, `…:spanish_rock`, `…:spanish_hip_hop`, `…:spanish_pop` | `spanish` |
| Buenos Aires | `argentine` | `urn:tag:genre:music:argentine`, `…:argentine_tango` (also `argentina`, `argentinian`, `argentina_indie`) | `argentine` |
| Seoul | `k-pop` | `urn:tag:genre:music:k_pop`, `…:kpop`, `…:k_pop_star` | `k_pop` |
| Paris | `french` | `urn:tag:genre:music:french` (also `chanson` → `…:chanson_francaise`) | `french` |
| Chennai | `tamil` | `urn:tag:genre:music:tamil` (also `kollywood` → `urn:tag:genre:music:kollywood`, `filmi`, `indian`) | `tamil` |

The earlier config used the broad `latin` tag for all three Spanish cities and no tag for Chennai. Qloo then surfaced non-local acts there (Madrid 0/15, Chennai 0/15 native).

## HG-9: language-aware discovery and native check

Looked up on 2026-10-31 with `GET /v2/tags?filter.query=<term>`. Qloo entities carry **no language property** (only `release_country`, and `akas` with translated titles), so the language filter for TV and movies comes from TMDB.

**Discovery.** Each category fetches a Qloo pool of 50 (`POOL`). It is filtered by language, then the first 15 language-matched candidates (`CANDIDATES`) are measured.

**TV / movie.**
- Qloo bias: `signal.interests.tags=<screenTag>`. This is a soft signal next to the taste entities, not a hard filter (a hard `filter.tags` returned only 2 Tamil TV shows).
- Tags used: Chennai `urn:tag:keyword:qloo:tamil_cinema`, Mumbai `urn:tag:keyword:qloo:bollywood`, Seoul `urn:tag:keyword:qloo:korean_cinema`, Paris `urn:tag:keyword:qloo:french_cinema`, Hyderabad `urn:tag:keyword:qloo:telugu_cinema`, Kolkata `urn:tag:keyword:qloo:bengali_cinema` (Hyderabad and Kolkata are live on movies; `filter.tags` with `bengali_cinema` returns 0 movies, so it stays a soft signal). Qloo has no Mexican, Spanish or Argentine cinema tag, so those cities have none. `filter.release_country` and `signal.location.query` are kept as before.
- Language filter: TMDB exact-title match, then `original_language` must equal the city's language. A mismatch is `off_language`: it is the only prefilter, so it never enters the measured 15 and does not count in the native %. A title with no exact match is `no_tmdb_match`: it stays in the measured 15 and counts as a failure.
- Native check on the 15: the origin country must match (`origin_country` for TV; `origin_country` or `production_countries` for movies).

**Music.**
- Qloo hard filter: `filter.tags=urn:tag:genre:music:<musicTag>` (unchanged).
- Language/scene signal: the candidate's **own Qloo genre tags**. Only `urn:tag:genre:*` ids count, matched on the last segment, either equal to the stem or starting with `<stem>_`.
- The tag must match one of the city's `musicLanguageTags` and none of its `musicConflictTags`. Conflict tags are the other languages of the same country: hindi/bollywood, tamil/kollywood, telugu/tollywood, bengali/bangla, malayalam, kannada, punjabi, bangladesh(i), pakistani.
- Candidates without the signal are `off_language` and never reach MusicBrainz. MusicBrainz still runs the origin check on the 15 (exact name, score ≥ 90, unambiguous country, IN/area match). **MusicBrainz is not used as a language signal.** Its search results carry no language field.
- Stems: Mexico City `mexican, regional_mexican`; Madrid `spanish`; Buenos Aires `argentine, argentina, argentinian`; Seoul `k_pop, kpop, korean`; Paris `french, chanson_francaise`; Chennai `tamil, kollywood`; Mumbai `hindi, bollywood`. Measured only: Hyderabad `telugu, tollywood` (no `telugu` music tag exists, so the hard filter is `tollywood`); Kolkata (live) `bengali, bangla`. In v1 music is not live, so these stems are kept for later.

**Gate.** Every *live* category (`liveCategories`, v1 = movies) needs ≥ 60%. It now also needs at least `minSeen` (5) measured candidates, because the language filter can leave pools of 1 or 2.
