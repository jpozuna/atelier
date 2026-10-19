# Qloo API spike report

Run 2026-10-18 against `hackathon.api.qloo.com` with the hackathon key. About 275 logged calls; the monthly counter showed 343 used afterward. Scripts are in `scripts/spike/`. Raw responses, seeds and per-call logs are in `.qloo-private/spike/` (gitignored). This file holds only counts, yes/no findings, field names and param names. It contains no entity names, IDs or tag values.

Seeds: 3 per domain, a mix of well-known and niche, chosen by the agent because the user asked it to. Places were searched around New York. Architecture, cars and theater got 2 probe queries each.

## Summary

- **Recommended domain list:** music, film, TV, books, food and places, fashion. Drop architecture, cars and theater, because Qloo has no type for them (details below).
- **Explainability works on all six types.** Every result carries per-seed attribution, so each path can anchor on the seed Qloo itself says drove the pick.
- **Cross-domain insights return full result sets for all 30 ordered domain pairs.**
- **Frontiers do not go empty.** Even popularity at most 0.2 with every seed and every shown pick excluded still returns 20 per domain.
- **Popularity bunches hard near 1** (default medians 0.95 to 0.99). `filter.popularity.max` is the lever that matters, and it works for every type.
- **Tag vocabularies are shared across film, TV, books and (partly) music.** Places and fashion each have their own vocabulary, so paths into or out of them cannot rest on a shared tag. They rest on affinity, explainability and taste analysis scoped by `filter.parents.types` instead.
- **Qloo has real lineage data for music** (influence properties and influence tags). Film and TV have Wikidata ids on nearly every result. Books, places and fashion are thin or have none.
- **The quota is the main risk: 10,000 calls per month and 5 per second.** The spike used about 3% of the month.
- **POST works** (the docs say it fails). Weighted seeds change results. It has not been adopted; that's your call (see the end).

## Coverage matrix

| Domain | Resolution | Tags | Popularity | Cross-domain | Lineage |
|---|---|---|---|---|---|
| music (`artist`) | yes (3/3 clean) | yes (46 to 56 per seed, 12 tag types) | yes, bunched (median 0.99) | yes | **yes** (influence fields on 20/20 results, Wikidata 19/20) |
| film (`movie`) | yes (2 clean, 1 ambiguous) | yes, rich (159 to 269 per seed) | yes, bunched (0.99) | yes | thin in Qloo (1/20 have an influence field), yes through Wikidata (20/20) |
| TV (`tv_show`) | yes (2 clean, 1 ambiguous) | yes, rich (102 to 300) | yes (0.96) | yes | thin in Qloo (7/20), yes through Wikidata (20/20) |
| books (`book`) | yes, but editions are ambiguous (1 clean, 2 ambiguous) | yes, uneven (10 to 65) | yes, bunched (0.99) | yes | no in Qloo, thin through Wikidata (3/20, seeds 0/3) |
| food and places (`place`) | yes when location-scoped (2 clean, 1 ambiguous) | yes, rich, own vocabulary (136 to 205, 39 tag types) | yes, bunched (0.99) | yes | no |
| fashion (`brand`) | yes (2 clean, 1 ambiguous) | yes, rich, own vocabulary (118 to 149, 35 tag types) | thin: the long tail reports popularity 0 | yes | thin (similar-brand and design-inspiration fields, Wikidata 6/20) |
| architecture | no type. Architects come back as person or author, buildings mostly missing | | | | |
| cars | no type. Queries hit places, books and a car-maker brand | | | | |
| theater | thin. A show can resolve as a venue (place) or a book, and a famous title came back as cities | | | | |

## The four spike questions (from the brief)

**1. Does Qloo give per-entity tags, affinity and popularity in enough detail to compute reach and tag rarity?** Yes.
- Every insights result carries `popularity` (0 to 1), `query.affinity` (0 to 1) and a full `tags` list. Media types have dozens to hundreds of tags each, and places and brands over 100.
- Taste analysis returns tags with their own `popularity` and a signal-specific `query.affinity`, so tag rarity can come straight from Qloo.
- Popularity bunches near 1, so reach should be computed relative to the returned pool, not with absolute thresholds.
- On brands the long tail reports popularity 0, so treat 0 as unknown, not as maximally obscure.

**2. Are tags comparable across domains, so cross-domain paths are possible?** Partly.
- Tag ids are shaped `urn:tag:<kind>:<namespace>:<value>`, and some namespaces are shared (`keyword:media`, `genre:media`, and the `qloo` namespace for theme, style, plot and emotional tone).
- Shared tag ids between two domains' seeds: film and TV 53, music with film, TV or books 4 to 6, places or fashion with anything 0.
- From taste analysis, the share of a domain's top tags that also apply to another type: books to film and TV 0.90+, film to books 0.66, TV to music 0.52, places and fashion to anything at most 0.14.
- **What this means:** shared-tag paths are grounded for film, TV, books and music. Paths that touch places or fashion need a different hop.
  - **Qloo-grounded hop:** cross-domain insights (affinity) plus explainability (which seed drove it), plus taste analysis with `filter.parents.types=<target type>`, which returns the target domain's tags that this taste likes.
  - **LLM-bridged hop:** a theme carried in words between two vocabularies. It must be labeled as a reading.

**3. Is there anything lineage-like from Qloo, and how good is external lineage coverage by domain?**
- **Music: yes, inside Qloo.** Properties such as `influenced_by`, `artists_influenced` and `genres_influenced` are present on 17 to 20 of 20 results, and there are tag types `influenced_by` and `influence`.
- **Film and TV:** an `influenced_other_media` property on 1/20 and 7/20 results, plus Wikidata ids on 19 to 20 of 20.
- **Books:** none in Qloo, and Wikidata on 3/20.
- **Places:** none.
- **Fashion:** `similar_brands`, a `design_inspiration` tag type, and Wikidata on 6/20.
- **Get Entities** accepts lookups by external id, Wikidata included, so links can go both ways.
- **License:** Wikidata is CC0, and Wikipedia text needs attribution (CC BY-SA).
- **What this means:** Qloo's lineage fields are retrieved text, so they may feed the reference layer, labeled as a reading.

**4. How often is the frontier empty?**
- **Never in this run.** Mixed-domain profile (15 seeds from the other five domains), all 18 seeds and all already-shown picks excluded, `filter.popularity.max` of 0.2, 0.3 and 0.5: 20 of 20 results for every domain and every cap, and 0 excluded ids leaked back.
- Same-domain with a cap of 0.3 also returned 20 of 20. The "relax reach first" fallback is still needed for narrow tag filters and niche seeds, but it will be rare.

## Probe results

| # | Probe | Result |
|---|---|---|
| 1 | Seed resolution | 12 clean, 6 ambiguous, 0 missing of 18. Ambiguity comes from same-title works (remakes, editions, other media), so the product needs a candidate chooser. Places need `filter.location`. Search items sometimes lack `popularity` |
| 2 | Entity detail | Rich enough for overlap, rarity, reach and connection. Field list below |
| 3 | Tags | Specific, not genre-only (style, theme, emotional tone, plot, aesthetic, ambience, decor and more). `/v2/tags/types` not probed because its doc page could not be fetched (see Gaps) |
| 4 | Same-domain insights | 20/20 for all six, deterministic across repeat calls, seeds never returned |
| 5 | Cross-domain insights | 30/30 ordered pairs non-empty (20 each). Median affinity 0.83 to 0.95 |
| 6 | Popularity | Default medians: music 0.99, film 0.99, TV 0.96, books 0.99, places 0.99, fashion 0.95. With `filter.popularity.max=0.6`: 0.29 to 0.50. With max 0.3: 0.13 to 0.21. Works for all six |
| 7, 24 | Cross-domain tags | See question 2 |
| 8, 11 | Explainability | Works on all six. Same result ids with and without it. No warnings. Shape below. Same-domain (3 seeds): the top seed holds a median 36% of attribution. Mixed profile (15 seeds): a median 13 seeds contribute to each result, the top one holds about 9%, and 4 to 9 different seeds top the list. Attribution is spread, so the anchor seed is the top scorer, not a dominant one |
| 9 | Lineage | See question 3 |
| 10 | Frontier emptiness | See question 4 |
| 12 | Tag operator | With 3 tags: no operator gives the same ids as `intersection` (so the default is intersection), and `union` differs. All three returned 20, so 3 tags did not empty the frontier |
| 13 | Reference-only params | `page=2` gives the same ids as `offset=20` for all six. `sort_by=rating` is ignored for all six. `signal.location.query` changes results for all six (not needed by Atelier) |
| 14 | `filter.results.entities` | Works: 8 of 8 supplied ids come back with affinity, including ids not in the normal top results. It can score lineage or LLM-bridged candidates against a profile |
| 15 | Taste analysis | Works for all six seed sets. Tags come back **scored** (`query.affinity`) and differ per seed set (overlap between music and other sets: 0.01 to 0.14). The returned tags are mostly NOT the seeds' own tags: they are what this taste likes, and can cross domains. `filter.parents.types` and `filter.tag.types` both change results (the latter returns only that tag type). No signal gives a 400. `urn:heatmap` returned 200 |
| 16 | POST | First call 400 because the per-seed objects need `id` (docs say `entity`). With `{id, weight}`: 200. Equal weights give the same ids as GET. Weighting one seed 10:1 changed results (overlap 0.33) and nudged its attribution share (0.34 to 0.37). One corrective call beyond the one planned. Not adopted |
| 17 | Page size | Insights `take=50` OK, `take=51` is a 400. Search `take=100` OK, `take=199` is a 400 ("must be <= 100", docs say under 200) |
| 18 | Backfill | Results carry no backfill marker (same per-result field set throughout). Same-domain: lowering both backfill caps to 1 changes nothing. Cross-domain: it changes results heavily (overlap 0 to 0.45) but still returns 50, and affinity at the tail stays high. Backfill cannot be detected per result; for cross-domain picks the connection check must come from tags and attribution, not from presence in results |
| 19 | Bias | `bias.trends=off` gives the same ids as the default for all six. `high` changes places (overlap 0.03) and brands (0.74), does nothing for artist, movie or TV, and returns 400 for books ("does not yet support trending"). `bias.content_based`: 0 and 1 change results for artist, movie, TV and place (1 gives an almost disjoint set and lower median popularity, by 0.03 to 0.11), and are ignored for books and brands. 0.5 equals the default |
| 20 | Group weights | First attempt (3 seeds + 3 tags) timed out (504). With 1 tag: `signal.interests.tags.weight` and `signal.interests.entities.weight` both change results (`very_low` on tags: overlap 0.08) |
| 21 | Description and image | `filter.exists=properties.description` changes nothing (all results already have one) and returns **500 for places**. `properties.image` changes artist and brand results only |
| 22 | Semantic tag search | Plain `filter.query` with a sentence: 0 tags. With `feature.semantic_search=true`: 20 tags that fit the words well, in 0.9 to 1.5 s. Many are near-duplicates across namespaces (dedupe by name), and the first concept dominates (later words were lost). `feature.typo_tolerance` recovers misspellings. Scoping with `filter.parents.types` works. Good enough for the "why" screen with a debounce |
| 23 | Search behavior | Item shape below. **A no-match search returns 200 with an empty `results`, not a 404.** `sort_by=popularity` reorders. A 100-item search response is about 3.3 MB |

## Silent-ignore results

**Ignored (same results with and without):**
- `sort_by=rating` for artist, movie, tv_show, book, place and brand
- `bias.trends=off` for all six (same as the default)
- `bias.trends=high` for artist, movie and tv_show
- `bias.content_based` for book and brand
- `filter.exists=properties.description` for all six (and a 500 for place)
- `filter.exists=properties.image` for movie, tv_show, book and place
- `backfill.*.take` for same-domain queries

**Rejected:** `bias.trends` (any value but `off`) for book is a 400. `take` over 50 on insights. `take` over 100 on search.

## Registry changes

Recorded in `.claude/skills/qloo-api/references/registry.seed.json` (new `spike` section and per-type `confirmed` and `ignored` lists) and `param-registry.md`. `src/lib/qloo/registry.ts` does not exist yet.

**Promoted to `confirmed`:**
- **All six types:** `feature.explainability`, `page`, `signal.location.query` (works, not used)
- **Cross-domain only, all six types:** `backfill.cross_domain.take` and `backfill.content_based.take`
- **artist, movie, tv_show, place:** `bias.content_based`
- **artist, brand:** `filter.exists=properties.image`
- **movie:** `operator.signal.interests.tags`, `signal.interests.tags.weight`, `signal.interests.entities.weight`
- **urn:tag:** `signal.interests.entities`, `filter.parents.types`, `filter.tag.types`
- **/v2/tags:** `feature.semantic_search`, `feature.typo_tolerance`, `filter.parents.types`

The movie-only results are probably type-independent; confirm them for the other types in the client's first test.

**Listed and shown to work:** `filter.popularity.max` (all six), `filter.exclude.entities` (all six, no leaks), `filter.results.entities` (artist, movie, book), `filter.tags` and `filter.exclude.tags` (movie), `bias.trends=high` (place, brand).

**Ignored or rejected:** see the section above.

**New facts:**
- An unsupported `filter.type` gives **400** "not supported for filter.type", not 403.
- Error bodies are `{ errors: [ { message, path | subtype } ] }`, not `{code, reason, message}`, except Search's 400 (`{ error: { reason, message, code, request_id } }`) and gateway 504s, which are HTML.
- `filter.type=urn:tag` needs one of `signal.location`, `signal.interests.entities` or `signal.interests.tags`.

## Item fields (for synthetic fixtures)

**`/search` item:**
- `name`, `entity_id`, `types` (an array, the first being the entity type), `popularity` (sometimes missing), `disambiguation`, `tags` (each `{ name, tag_id, type, value }`)
- `properties`, which includes `external` keyed by source (for example `wikidata`, `musicbrainz`, `imdb`, `goodreads`, `michelin`), plus `akas`, `image` and descriptions

**`/v2/insights` entity item:**
- `name`, `entity_id`, `type` (always `urn:entity`), `subtype` (the entity type urn), `popularity`, `disambiguation`
- `tags`: each `{ id, name, type }`. Note `id` here, `tag_id` in search.
- `external`: keyed by source, each an array of `{ id, ...ratings }`
- `query`: holds `affinity`, sometimes `measurements.audience_growth`, and with explainability `query.explainability["signal.interests.entities"]` as an array of `{ entity_id, score }`. The key is the literal dotted string.
- `properties`: type-specific
  - **Artist:** biography, influenced_by, artists_influenced, genres_influenced, adjectives
  - **Movie and TV:** wikidata_id, plot and style descriptions, influenced_other_media
  - **Book:** publisher, publication_year, isbn
  - **Place:** address, geocode, hours, price, many descriptions
  - **Brand:** similar_brands, competitor_brands, aesthetic_properties
- No backfill marker.

**Insights envelope:** `{ success, results: { entities }, query? }`. With explainability, the top-level `query.explainability["signal.interests.entities"]` has `effect_on_top3_recs`, `effect_on_top5_recs`, `effect_on_top10_recs` and `effect_on_all_recs`, each an array of `{ entity_id, avg_score }`.

**Taste-analysis tag item:** `{ tag_id, name, types[], subtype, tag_value, popularity, query: { affinity } }`.

**`/v2/tags` item (semantic search):** `{ id, name, type, parents, popularity, properties, tags }`. Note `id`, not `tag_id`.

**`/entities` item:** same as the search item. Lookup by `entity_ids` or by `external.<source>.ids`.

## Operational

- **Quota (response headers):** `x-second-ratelimit-limit: 5` and `x-month-ratelimit-limit: 10000`. The month resets about 29 days after first use. The spike used about 340 calls. No 429s were hit (the client retries 429s).
- **Latency:**
  - Search: 70 to 310 ms
  - Insights: 160 ms to 3.9 s. Artist and anything combining entities and tags are slowest.
  - Taste analysis: 0.5 to 2 s
  - Semantic tags: 0.9 to 1.8 s
  - Five parallel insights calls: 3.2 s wall time, bounded by the slowest
- **Failures seen:** 504 on a 3-seed + 3-tag call (three times). 500 for `filter.exists=properties.description` on places.
- **Response size:** 8 to 32 KB per insights entity (books smallest, film and places largest), and about 33 KB per search item at `take=100`. The private cache must strip `akas`, websites, keywords and long descriptions before storing.
- **No key:** 401.

## Risks

1. **Quota.** 10,000 calls a month has to cover development, evals, the demo and judges' sessions through Nov 16.
   - One full profile run is likely 20 to 40 calls (resolution, taste analysis, 5 or 6 domains × 3 degrees, re-queries).
   - Cache aggressively, record live runs for replay, and ask for a raise in #api-help on the hackathon Discord now.
2. **Rate limit of 5 per second.** One profile run fans out across domains and degrees. The client needs a queue (at most 4 in flight) and backoff on 429.
3. **Latency.** A cold run with 18 calls at 1 to 4 s each needs streaming progress in the reasoning panel, and 504s need one retry with a simpler query (fewer tags).
4. **Bunched popularity.** Absolute thresholds are weak. Rank within the pool and use `filter.popularity.max` per degree.
5. **Brand popularity of 0** in the long tail. Treat it as unknown.
6. **Cross-domain backfill is invisible.** A cross-domain result is not evidence of connection by itself. The connection floor must use shared tags, taste-analysis tags or attribution.
7. **Books** have uneven tags, ambiguous editions, no lineage and no trending (a 400). Don't send `bias.trends` for books.
8. **Key lifetime.** Live calls stop after the hackathon closes. The demo must degrade gracefully, for example with a replay mode backed by the private cache.
9. **Doc drift.** The 403 vs 400 behavior, error body shapes, the search take limit, search's 404 vs empty 200, and the POST field name all differ from the docs.

## What this means for the open decisions

- **Domain list:** recommend music, film, TV, books, food and places, fashion. Architecture, cars and theater have no Qloo type; keep them out (the brief's default). If one is wanted later, it would be LLM-bridged and labeled.
- **Axes clustering:** taste analysis gives scored tags with a tag type (`subtype`, such as theme, style, emotional_tone, aesthetic_property, ambience). Axes can be clusters of tag types and tags from taste analysis per domain, weighted by `query.affinity`, which keeps every axis grounded in Qloo tags.
- **Input process:** seeds plus reasons is supported. Semantic tag search maps a "why" sentence to fitting tags in about 1 s. Seed search needs a chooser for ambiguous titles.
- **Semantic tag search:** recommend yes, with name-level dedupe and one short phrase at a time.
- **GET only vs POST:** decided 2026-10-19: POST for `/v2/insights`, GET elsewhere (see `docs/DECISIONS.md`). Body-borne filters still need the 6-call check in `scripts/spike/04-post-check.mjs`.
- **Qloo vs plain LLM side-by-side:** feasible. Explainability and taste analysis give Qloo-side evidence that a plain LLM lacks.
- **Reference-layer sources:** Qloo's own music influence fields, plus Wikidata (CC0) for film, TV and some fashion. Books and places would have no lineage, so omit lineage there per hard rule 6.

## Gaps

- Not read or probed: Get Tag Types, Get Audiences, Get Audience Types, Analysis Compare (the doc pages returned 404 or 429 when fetched). Paste them into `.qloo-private/param-guide.md` if they turn out to be needed.
- Group weights, the tag operator, `filter.tags` and `filter.exclude.tags` were only tested on movie.
- Explainability was tested with seeds only, not with tags as signals.
