# Notes from the official Qloo docs

Sources, all pasted in by the user: the Developer Guide (updated Oct 7, 2026), the Entity Type Parameter Guide, Parameter Reference, Insights API Deep Dive OpenAPI and Search Tags (all Jul 8, 2026), Search Entities (Jul 20, 2026), Taste Analysis (Nov 12, 2025), the API Overview (Mar 30, 2026) and the Parameter Overview (Mar 4, 2026). The full text of the param guide, Deep Dive, Search Entities and Search Tags pages is also kept in the user's project memory. These notes are paraphrased facts, not copies. Where this file disagrees with older third-party material, this file wins. The per-type param lists are in `param-registry.md` and `registry.seed.json`.

Still NOT read: Get Entities, Get Tag Types, Get Audiences, Get Audience Types, Analysis Compare, Get Trending Data, Legacy to Insights Parameter Mapping. The Deep Dive gives the entity-insights envelope but not the fields of an entity item, and `/search` gives no item fields either, so fixtures can only match the envelopes until the spike records an item's fields in words.

## Access

- The key works only against `https://hackathon.api.qloo.com`. Staging and production return 401 with a hackathon key.
- Key goes in the `X-Api-Key` header. Not a query parameter, not a Bearer token.
- `/v2/insights` is GET with params in the query string. The Developer Guide says a POST with a JSON body fails. The Parameter Reference documents POST-only features (weights, `*.query` params); whether any of them work with the hackathon key is untested.
- The base URL alone is not an endpoint; always append a path.
- All documented endpoints are available. `/recommendations` and `/recs` are legacy and unsupported. `/v2/insights/search` does not exist.

## Entity types

- Developer Guide, supported insights `filter.type`: artist, book, brand, destination, movie, person, place, podcast, tv_show, video_game. Anything else is a 403.
- The per-type guide also documents `urn:heatmap` and `urn:tag`, and deprecated actor, author, director (use person). Test before using heatmap or tag.
- Music is `artist` (not `music`). Food and beverage places are `place` or `brand` (not `food_and_drink`).
- `/search` accepts a different, wider list in its `types` param. Its page is unread.

## Params

- Which params are valid depends on `filter.type`. Invalid ones are silently ignored. An empty `results.entities` array with a 200 often means exactly that.
- The three param docs (per-type guide, Parameter Reference, Deep Dive OpenAPI) disagree in places; the conflicts are listed in `param-registry.md`. The Parameter Reference calls `feature.explainability`, `page`, `operator.signal.interests.tags`, `sort_by` and the `signal.location*` params compatible with all types. The per-type guide does not list them (except `sort_by` for place). Treat those as reference-only until tested.
- Tag and audience params need real ids. Freeform strings fail with "at least one valid signal or filter is required". Tag ids come from `/v2/tags`. Audience params need valid audience URNs.
- Per-entity and per-tag weights exist only in POST form, so on GET there is no per-seed weight. The Deep Dive also documents GROUP-level weights on GET (`signal.interests.entities.weight`, `signal.interests.tags.weight`): how much the entity signal counts versus the tag signal. Reference-only until tested.
- `signal.interests.tags` combines with intersection by default (all tags must match); `operator.signal.interests.tags=union` relaxes it.
- Recommended flow: `/search` for entity ids (or `/v2/tags` for tag ids), then pass them as signals or filters to `/v2/insights`.
- `take` is 1 to 50, default 20. `page` (1 to 100) is the recommended way to page.
- `bias.trends` DEFAULTS to `medium`: trending bias is on unless you set it.
- Backfill: `backfill.cross_domain.take` (default 20) and `backfill.content_based.take` (default 10) cap how many cross-domain or content-based results are appended when primary results are insufficient. Results can therefore be padded. The docs do not say how padded results are marked.
- "Taste Analysis" is a use case of the Insights API (retrieving metadata and taste-related tags), not a separate route. "Taste AI" is the old name.

## Taste Analysis, Search Entities, Search Tags

- Taste analysis = `GET /v2/insights?filter.type=urn:tag` plus at least one of `signal.interests.entities`, `signal.interests.tags`, `signal.demographics.audiences`, `signal.location(.query)`, `filter.tag.types`, `filter.parents.types`. Returns `results.tags[]` with `tag_id`, `name`, `types` (entity types the tag applies to), `subtype` (namespace), `tag_value`, `query`. The sample used no signal, so whether tags are scored per signal is unknown. The per-type guide lists far fewer params for tags than this page requires.
- `/search` returns `results` as a flat array (not `results.entities`), 404 for no results, 429 for rate limit (bodies are `{code, reason, message}`). `take` is under 200. `sort_by` can be `popularity`. `filter.popularity` is a minimum only. `destination` is not a searchable type.
- `/v2/tags` has beta `feature.semantic_search` (with `filter.query`) and `feature.typo_tolerance`; `take` is 1 to 50.

## Response envelope (Deep Dive OpenAPI)

`{ success, results: { entities: [...], duration } }` plus query metadata. The 400 and 500 responses have no documented body. Entity item fields are not specified. The OpenAPI's server entry is the production host; hackathon keys work only on the hackathon host.

## Explainability

With `feature.explainability=true` (reference-only, untested), each result gets a `query.explainability` section: which input entities contributed and by how much, normalized 0 to 1, entities at or above 0.1 always included. The top-level `query.explainability` shows average influence across top-N subsets. If it cannot be computed, a warning appears under `query.explainability.warning` and results still return. It covers input entities (`signal.interests.entities`); tag-level attribution is not described.

## Empty results (200, empty `entities`)

Two causes: params invalid for the type (silently ignored), or no data for that entity or location in the hackathon environment. Try a broader query or another entity to tell which.

## Data, caching, limits

- No field filtering. Responses are full and can be verbose (for example `akas`). Trim on your side.
- Private server-side caching is fine, with no time limit. Do not put Qloo response data in a public repo.
- Rate and monthly quota limits are set high for typical projects. If you hit them, post in #api-help on the hackathon Discord; limits can be raised per user.
- Keys stay active through the end of the judging period and are deactivated after the hackathon closes. After that, live Qloo calls from the demo will fail.

## Pages named in the docs

api-overview, insights-api-deep-dive, parameter-overview, parameters (Parameter Reference), available-parameters-by-entity-type (Entity Type Parameter Guide), get-search, get-entities, get-tags-1, get-tag-types-1, get-audiences-1, get-audience-types-1, analysis-compare-1, get-trending, taste-analysis, legacy-insights-parameter-mapping, all on docs.qloo.com. Help: the hackathon Discord, #api-help.
