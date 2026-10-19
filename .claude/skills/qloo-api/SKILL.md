---
name: qloo-api
description: "How to call Qloo's API correctly in Atelier, which params are valid for which entity type, and how to handle Qloo data without breaking hackathon rules. Use whenever writing, changing, reviewing or debugging code that calls Qloo (search, entities, tags, taste analysis, insights), choosing params for a domain, building a Qloo client or fixtures, caching responses, diagnosing a 401, 403 or empty result, or touching anything about taste graph, tags, affinity, popularity, explainability, seeds or recommendations, even if the user does not say \"Qloo\"."
---

# Qloo API in Atelier

Qloo silently ignores params that are invalid for an entity type. The call returns 200, the results look plausible or come back empty, and the product is quietly wrong. Most of this skill exists to prevent that, and to keep Qloo data out of the public repo.

Sources: the official Developer Guide, Entity Type Parameter Guide, Parameter Reference and API Overview (notes in `references/official-guide-notes.md`). Per-type param lists are in `references/param-registry.md` and `references/registry.seed.json`. Pages we have not read are listed in the notes.

## Fixed facts

- Host: `https://hackathon.api.qloo.com`. The hackathon key works only there. Staging or production URLs return 401.
- `GET` only, params in the query string. Key in the `X-Api-Key` header, never in the query string and never as a Bearer token.
- Always append a path. Never use `/recommendations` or `/recs` (legacy, unsupported). There is no `/v2/insights/search`.
- Server-side only. The key never reaches the client bundle or any `NEXT_PUBLIC_*` variable.
- No Qloo response data in tracked files (entity names, IDs, tag IDs, raw JSON, screenshots of picks). Synthetic fixtures only.
- Private server-side caching is allowed with no time limit. A public repo is never a cache.
- Responses cannot be trimmed by the API. Strip bulky fields (like `akas`) before logging or storing traces.
- Keys stay active through the end of judging (Nov 16) and are deactivated after the hackathon closes, so live Qloo calls in the demo stop after that. Limits are high and can be raised by asking in #api-help on the hackathon Discord.

## Errors and what they mean

| What you see | Usual cause |
|---|---|
| 401 | wrong base URL, or key not in `X-Api-Key` |
| 401 "No API key found" | key sent as query param or Bearer token |
| 403 "no permission to access urn:entity:..." | unsupported `filter.type` |
| 404 or "No path matching" | wrong method (POST), or no path after the host |
| 404 "No results" from `/search` | not a failure: no entity matched. Treat the seed as `missing` |
| 429 | rate limit (`{code, reason, message}`). Back off and retry later; do not hammer, and cache results |
| 400 | `filter.location.query` matched no locality (and similar bad lookups) |
| "at least one valid signal or filter is required" | freeform strings passed as tags or audiences; use ids from `/v2/tags` |
| 200 with empty `results.entities` | params invalid for this type (silently ignored), or no data for that entity or place in the hackathon environment |

The client must treat "200 and empty" as a result to diagnose (param-validity check first), never as success.

## Endpoints Atelier uses

| Endpoint | Atelier use |
|---|---|
| Search Entities (`/search`) | resolve a typed seed to an entity. `results` is a flat array. Searchable types differ from insights (no `destination`; video games are `videogame`). `sort_by` can be `popularity`; `take` under 200. 404 means no results |
| Search Entities by ID (`/entities`) | fetch entities by id. Check what detail comes back (spike) |
| Search Tags (`/v2/tags`) | resolve a theme to tag ids; `filter.query`, `filter.tag.types`. Beta `feature.semantic_search` could map the words of a user's "why" to tag ids (test). Results at `results.tags` |
| Get Tag Types (`/v2/tags/types`) | which tag types exist per entity type |
| `GET /v2/insights` | recommendations per domain. The workhorse |
| Taste analysis | `GET /v2/insights?filter.type=urn:tag` with the seeds' entity ids as `signal.interests.entities` (optionally `filter.tag.types`, `filter.parents.types`). Returns `results.tags[]` with `tag_id`, `name`, `types`, `subtype`, `tag_value`. The signal params are documented on the Taste Analysis page but not in the per-type guide for tags, so they are reference-only for `urn:tag` until the spike confirms them. Unknown whether tags come back scored for a signal |

## Entity types and domains

Insights `filter.type` (Developer Guide): `urn:entity:artist`, `book`, `brand`, `destination`, `movie`, `person`, `place`, `podcast`, `tv_show`, `video_game`. Anything else is a 403. The per-type guide also documents `urn:heatmap` and `urn:tag`, and the Deep Dive enum differs (it has locality, and spells video games `videogame`). The docs disagree, so test before using any type outside the six Atelier domains.

music -> `artist` (never `music`); film -> `movie`; TV -> `tv_show`; books -> `book`; food and places -> `place` or `brand` (never `food_and_drink`), with cuisine and category coming from tags; fashion -> `brand`. Architecture, cars and theater have no obvious type. Coverage is for the spike to settle. If none, the UI labels them LLM-bridged.

## The registry

`references/registry.seed.json` is the machine-readable list of params that are `listed` for each type in the Entity Type Parameter Guide. `src/lib/qloo/registry.ts` is built from it, and the client refuses to send any param that is not `listed` or `confirmed` for the call's entity type. `references/param-registry.md` explains the statuses.

Rules:

1. Never send a param that is not in the registry for that type. Never add a registry row from memory.
2. `reference-only` params (the Parameter Reference calls them compatible, the per-type guide does not list them) are refused until the spike confirms them with a with/without test. This includes `feature.explainability`, `page`, `operator.signal.interests.tags` and the `signal.location*` params.
3. Even a `listed` param can do nothing for a type. To prove a param works, call with and without it and compare. Identical results mean it was ignored. The spike does this for every param Atelier relies on.
4. When the docs disagree, the per-type guide decides what is allowed, and the spike decides what actually works.

## How Atelier maps onto the params

- Seeds -> `signal.interests.entities` (ids from `/search`). A theme carried across domains -> `signal.interests.tags` (ids from `/v2/tags`). Never pass freeform strings as tags.
- **No per-seed weights on GET.** Per-entity and per-tag weights are POST-only. Emphasis between seeds has to come from selection: pass the seeds that sit on the relevant axis, not all seeds. Whether POST works is an open decision in `docs/DECISIONS.md`. Group-level weights (`signal.interests.entities.weight`, `signal.interests.tags.weight`) are documented on GET (reference-only, test): they set how much the entity signal counts against the tag signal when both are sent.
- Several theme tags in `signal.interests.tags` combine by intersection by default (all must match), which can empty the frontier. Pass `operator.signal.interests.tags=union` when you want any-of, once the spike confirms it. Use intersection on purpose, when a path needs several shared tags.
- Stretch and Match depth -> `filter.popularity.min` and `filter.popularity.max` (0 to 1 percentile). **`bias.trends` defaults to `medium`**, so trending already pulls toward the popular. Send it explicitly (start with `off`) and test its effect.
- Exclusions -> `filter.exclude.entities` must include every seed and every pick already shown. Add `filter.exclude.tags` (with `operator.exclude.tags`) to remove dominant generic tags when results are too obvious.
- Attribution -> `feature.explainability=true` (once confirmed) gives, per result, which input entities drove it and by how much. Use it to choose each path's anchor seed instead of guessing.
- Scoring outside candidates -> `filter.results.entities` shows how given entity ids score against the signal (test). Possible use for lineage candidates or LLM-bridged ideas.
- Size: `take` is 1 to 50, default 20. Page with `offset`, or `page` once confirmed.
- Location is for place and destination only. Atelier does not need it.

## Gotchas to verify in the spike

- Popularity may bunch close to 1 for some types, which makes absolute thresholds weak. The agent loop ranks popularity within the returned pool when that happens.
- `/search` can return ambiguous candidates (albums vs artists, remakes). Flag ambiguity, do not pick silently. Use `types` to scope by domain, and `sort_by=popularity` to see the most popular match first.
- **Four response envelopes.** Insights: `results.entities`. Search: `results` is a flat array. Tags: `results.tags`. Tag insights: `results.tags` with `duration` at top level. One parser will not fit all.
- Explainability covers input entities. It may not say which tags drove a result. Tag-level paths still come from tag overlap.
- **Backfill.** Results can be padded with cross-domain or content-based backfill (`backfill.cross_domain.take`, `backfill.content_based.take`, reference-only) when primary results are insufficient. Atelier queries across domains, so expect it. Find out whether padded entries are marked, and whether lowering both caps to 1 reduces padding. Never count a padded result as evidence of connection without checking.
- `bias.content_based` (0 to 1, default 0.5, reference-only) may be a second dial lever besides popularity. Test.
- `filter.exists=properties.description` or `properties.image` (reference-only) limits results to entities with a description or image, for cards. Never commit that text or those images.
- The hackathon environment may lack data for some entities or places. A niche seed can come back thin or empty. That is a finding, not a bug.
- The response envelope is `{ success, results: { entities, duration } }` plus query metadata. The fields of an entity item are not documented. Record them in words in the spike report so fixtures can match.

## Handling data

- All calls go through `src/lib/qloo/client.ts`. No raw `fetch` to Qloo anywhere else.
- Cache server-side and private (a Supabase table with RLS or similar), never exported, never committed.
- Logs and traces containing Qloo data stay in `.qloo-private/`. Committed fixtures use invented names and IDs shaped `00000000-0000-4000-8000-0000000000NN`.
- Keep the fixture shape equal to the real response shape, so the same parsing code runs on both. There is one envelope per endpoint (see the gotcha above), so fixtures need one synthetic shape each. Entity-item fields are undocumented and come from the spike.
