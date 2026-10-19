# Qloo param registry

Human-readable view of `registry.seed.json`, which seeds `src/lib/qloo/registry.ts`. Built from the Entity Type Parameter Guide, cross-checked against the Parameter Reference and the Insights API Deep Dive OpenAPI (all dated 2026-07-08). Names and rules only; no response data.

## Status and send policy

| Status | Meaning | Client may send? |
|---|---|---|
| `listed` | Named for that entity type in the Entity Type Parameter Guide | yes |
| `confirmed` | Listed or reference-only, AND a with/without test shows it changes results for that type | yes |
| `reference-only` | Documented in the Parameter Reference or the Deep Dive, but the per-type guide does not list it. May be silently ignored for a type | no, until the spike confirms it |
| POST-only | Needs a JSON body | no |

"Listed" means supported on paper. The spike still tests each param Atelier relies on, because a param can be listed and still do nothing for a type.

## Core params: listed for all 10 insights types

`filter.type` (required), `bias.trends`, `filter.exclude.entities`, `filter.parents.types`, `filter.popularity.min`, `filter.popularity.max`, `filter.exclude.tags`, `operator.exclude.tags`, `filter.external.exists`, `operator.filter.external.exists`, `filter.results.entities`, `filter.results.entities.query`, `filter.tags`, `operator.filter.tags`, `offset`, `take`, `signal.interests.entities`, `signal.interests.tags`, and `signal.demographics.age|audiences|audiences.weight|gender`.

The 10 types: artist, book, brand, destination, movie, person, place, podcast, tv_show, video_game (`urn:entity:<type>`).

Atelier uses: `filter.type`, `signal.interests.entities`, `signal.interests.tags`, `filter.popularity.min|max`, `filter.exclude.entities`, `filter.exclude.tags`, `filter.tags` (+ `operator.filter.tags`), `filter.results.entities`, `bias.trends`, `take`, `offset`. It does not use demographics.

## Type-specific extras (listed)

| Type | Extras |
|---|---|
| artist, brand, podcast, video_game | none beyond core |
| book | `filter.publication_year.min|max` |
| movie | `filter.content_rating`, `filter.release_year.min|max`, `filter.release_country` (+ `operator.filter.release_country`), `filter.rating.min|max` |
| tv_show | movie extras plus `filter.finale_year.min|max`, `filter.latest_known_year.min|max` |
| person | `filter.date_of_birth.min|max`, `filter.date_of_death.min|max`, `filter.gender` |
| destination | `filter.geocode.*`, `filter.location`, `.radius`, `.geohash`, `filter.exclude.location.geohash`. `signal.interests.entities` is REQUIRED |
| place | `bias.quality`, `sort_by`, `filter.address`, `filter.geocode.*`, `filter.hotel_class.*`, `filter.hours`, `filter.location`, `.radius`, `.geohash`, `filter.exclude.location.geohash`, `filter.price_level.*`, `filter.price_range.from|to`, `filter.properties.business_rating.*`, `filter.references_brand`, tripadvisor and resy filters |

Place-only params are not needed by Atelier beyond tags. The three docs name the resy params differently; avoid them.

## Reference-only params (do NOT send until confirmed)

**Documented in the Parameter Reference, absent from the per-type guide:**

| Param | Why Atelier cares |
|---|---|
| `feature.explainability` | adds `query.explainability`: which input entities drove each result and by how much (0 to 1; at or above 0.1 always included), plus an aggregate. If it works, it grounds each path's anchor seed in Qloo's own attribution. Highest-value test |
| `operator.signal.interests.tags` | union = at least one tag, highest-affinity tag scores. Intersection or empty = ALL tags must match. The empty default is intersection, which can silently shrink or empty the frontier when several theme tags are passed |
| `page` | recommended paging (1 to 100, default 1). The per-type guide lists `offset` only |
| `sort_by` | affinity, distance, rating; `quality` for place only |
| `signal.location`, `.query`, `.radius` | location signals; not needed |

**Documented only in the Deep Dive OpenAPI:**

| Param | Why Atelier cares |
|---|---|
| `backfill.cross_domain.take` (1 to 20, default 20), `backfill.content_based.take` (1 to 10, default 10) | Results can be PADDED with backfill: cross-domain results when primary results are insufficient, content-based results when other signals are unavailable. A padded result set looks fine but its entries are weaker, and the response may not mark them. Atelier does cross-domain queries, so this is likely to matter. Lowering both to 1 may reduce padding (test) |
| `bias.content_based` (0 to 1, default 0.5) | strength of content-based metadata in the affinity score. A possible second lever for the dial besides popularity (test) |
| `signal.interests.entities.weight`, `signal.interests.tags.weight` | number >= 0 or `very_low` to `very_high`. GROUP-level: how much the entity signal counts versus the tag signal (and location, demographics). Useful when sending both entities and a theme's tags. Not per entity |
| `filter.exists` | `properties.image` or `properties.description`: only entities that have one. Useful for cards. Never commit images or text from responses |
| `filter.release_date.min|max`, `signal.interests.entities.include`, `filter.entities.query` | not needed |

## Value formats and semantics

- `filter.popularity.min|max`: number 0 to 1, a percentile; closer to 1 is more popular.
- `take`: 1 to 50, default 20. `page` (if confirmed) or `offset` to page.
- `bias.trends`: `off`, `very_low`, `low`, `mid`, `medium`, `high`, `very_high`. **Default is `medium`, so trending bias is on unless you set it.** Trending pulls toward the popular, which works against Stretch. Set it explicitly (`off` as the starting point) and test.
- Entity and tag ids are comma-separated on GET. Tag ids come from `/v2/tags` (freeform strings fail). Tag ids look like `urn:tag:<kind>:<namespace>:<value>`; kinds seen in the docs include `genre`, `keyword` and `style`. Whether namespaces are shared across entity types is a spike question.
- `operator.filter.tags` is `union` by default. `filter.exclude.tags` defaults to union (exclude if ANY listed tag is present), which is what Atelier wants: do not send an exclude operator. The docs disagree on its name (see below).
- `filter.results.entities`: supply entity ids to see how they score against the signal. Possible use: scoring candidates that did not come from the query (lineage candidates, LLM-bridged ideas). Test.
- `filter.location.query` with no matching locality returns a 400.

## Response envelopes (one shape per endpoint; the parser must not assume one fits all)

| Call | Envelope |
|---|---|
| `/v2/insights` entity types | `{ success, results: { entities: [...], duration } }` plus query metadata (`query.explainability`, `query.locality.signal`). Per-result affinity is probably `query.affinity` (inferred) |
| `/search` | `{ success, duration, results: [ ... ] }`. `results` is a flat array, not `results.entities`. 404 means no results |
| `/v2/tags` | `{ success, duration, results: { tags: [...] } }` |
| `/v2/insights` with `filter.type=urn:tag` (taste analysis) | `{ success, results: { tags: [ { tag_id, name, types[], subtype, tag_value, query{} } ] }, duration }` (duration at top level) |

Entity item fields are not in any OpenAPI. Unknown: how backfilled results are marked, and where explainability sits inside each entity. The spike records these in words.

## Where the docs disagree (test before relying on either)

- Video games: `urn:entity:video_game` (Developer Guide, per-type guide) vs `urn:entity:videogame` (Deep Dive enum). Not an Atelier domain.
- `filter.type` lists differ: the Deep Dive has locality (partial), heatmap and audience (deprecated) and no destination; the Developer Guide has destination and not locality; the per-type guide also documents `urn:tag`.
- Exclude-tags operator: `operator.exclude.tags` (per-type guide, Parameter Reference) vs `operator.filter.exclude.tags` (Deep Dive). Atelier does not send it.
- `filter.parents.types`: parental entity types in some docs, audience URNs in the Deep Dive. Do not send.
- Place resy params: three naming schemes. Not needed.

## Do not use

- **POST-only features:** per-entity weights (`signal.interests.entities` as `{entity, weight}` objects), per-tag weights, `signal.interests.entities.query`, `filter.exclude.entities.query`, array forms of the location queries. The Developer Guide says `/v2/insights` is GET and a POST body fails. Whether weighted POST works is an open decision (see `docs/DECISIONS.md`).
- **Paths and hosts:** `/recommendations`, `/recs`, `/v2/insights/search`, staging and production hosts (the Deep Dive spec lists the production host; hackathon keys only work on the hackathon host), POST with a JSON body, `urn:entity:music`, `urn:entity:food_and_drink`.

## Taste analysis: tag insights (`filter.type=urn:tag`)

The Taste Analysis page documents `filter.type=urn:tag` with at least one of: `signal.interests.entities`, `signal.interests.tags`, `signal.demographics.audiences`, `signal.location` or `signal.location.query`, `filter.tag.types`, `filter.parents.types`. It suggests combining `filter.tag.types` with `signal.interests.entities` for targeted analysis. Each returned tag has `tag_id`, `name`, `types` (the entity types the tag applies to), `subtype` (the tag namespace) and `tag_value`.

The per-type guide lists only `filter.type`, `diversify.by`, `diversify.take`, `offset` and `take` for tags, so every signal or filter above is **reference-only for `urn:tag`** until the spike confirms it. Unknown: whether tags are ranked or scored for a given signal (the page's sample used no signal entities). The `types` field is useful either way: a tag that applies to both the seed's entity type and a candidate's entity type is a natural cross-domain bridge.

## `/search` (Search Entities OpenAPI, listed)

Params: `query`, `types`, `filter.location` (lat,lon or WKT or entity UUID), `filter.radius` (miles, default 10, max 100), `filter.exists` (`external.<key>`), `filter.tags`, `operator.filter.tags` (union default), `filter.rating`, `filter.popularity` (a minimum only), `filter.address`, `page`, `take` (exclusive max 200), `sort_by` (`match` default, `distance`, `popularity`). Searchable types: artist, book, brand, locality, movie, person, place, podcast, tv_show, videogame, heatmap, audience, plus search-only legacy actor, album, author, director, locality. There is no `destination` and the video game spelling is `videogame`. Atelier's six domains (artist, movie, tv_show, book, place, brand) are all present. 404 "No results" and 429 return `{ code, reason, message }`: a 404 on a seed lookup means the seed is `missing`, not that the call failed.

## `/v2/tags` (Search Tags OpenAPI, listed)

Params: `filter.query` (partial name match), `feature.typo_tolerance`, `feature.semantic_search` (BETA, use with `filter.query`: finds tags by meaning), `filter.tag.types`, `filter.results.tags`, `filter.parents.types`, `filter.popularity.min|max`, `page`, `take` (1 to 50, default 20). Response at `results.tags`. Semantic search could map the words of a user's "why" to real tag ids. Beta, so test before relying on it.

## Other endpoints (named in the API Overview; pages not read yet)

`/entities` (Search Entities by ID; may offer `external.*.ids` lookups such as Wikidata, MusicBrainz and IMDb, unconfirmed), Get Tag Types (`/v2/tags/types`), Get Audiences, Get Audience Types, Analysis Compare, Get Trending Data. There is no `/analysis` route in the official overview.
