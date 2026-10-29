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
