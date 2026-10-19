---
name: qloo-spike
description: "Run the Qloo API spike that decides Atelier's domain list. Probes every candidate domain for seed resolution, tags, popularity, cross-domain signals, param validity (including silent-ignore detection) and lineage coverage, then writes docs/spike-report.md with a recommended domain lock. Use only when the user runs /qloo-spike or explicitly asks to run, redo or extend the API spike."
disable-model-invocation: true
---

# Qloo spike

Goal: before the domain list is locked (Oct 19), find out what Qloo actually gives us, so the profile, scoring and references are built on real shapes. The spike answers the brief's four questions and produces the recommended domain list. It does not build product code. The throwaway scripts live in `scripts/spike/` and are committed. The outputs are not.

Read the `qloo-api` skill and `references/param-registry.md` first.

## Ground rules

- Qloo response data never goes into tracked files. Raw responses, tables of returned entities and tags go in `.qloo-private/spike/` (gitignored). Confirm `.qloo-private/` is in `.gitignore` before the first call.
- `docs/spike-report.md` (committed) holds only: counts, yes/no findings, response shapes described in words, param names, timings. Where an example is needed, use placeholders (`<entity>`, `<tag>`). No returned names, IDs or tag strings.
- Host `hackathon.api.qloo.com`, GET, `X-Api-Key` header, key from the environment. Keep calls modest: small `take`, a few seeds, and cache every response in `.qloo-private/spike/` so nothing is called twice.
- The Developer Guide, Entity Type Parameter Guide, Parameter Reference, Insights Deep Dive, Search Entities, Search Tags, Taste Analysis, API Overview and Parameter Overview are already summarized in `qloo-api/references/official-guide-notes.md`, and the per-type params and endpoint params are seeded in `registry.seed.json`. Still unread: Get Entities, Get Tag Types, Get Audiences, Get Audience Types and Analysis Compare. If they cannot be fetched, ask the user to paste them into `.qloo-private/param-guide.md` before probing the endpoints they cover. Do not guess.

## Inputs to ask for

Ask the user once, in one message: 3 seeds per candidate domain, mixing well-known and niche, using things they really love (music, film, TV, books, food and places, fashion brands). Optionally 2 each for architecture, cars and theater. Also ask which city to use for places, if any. Seeds are queries the user chose, so they may appear in `.qloo-private/` only.

## Probes (per domain)

Candidate domains: music (artist), film (movie), TV (tv_show), books (book), food and places (place), fashion (brand). Extra probes for architecture, cars and theater: search with each seed, and look for any entity type or tag family that fits. Report yes, thin or no.

1. **Seed resolution.** `/search` for each seed with the domain's type. Record: resolved cleanly, ambiguous (several plausible candidates), or missing.
2. **Entity detail.** What does a result carry: tags, popularity, affinity, external ids, descriptions? Is that enough to compute tag overlap and tag rarity, and reach and connection (see `atelier-agent-loop/references/scoring.md`)?
3. **Tags.** `/v2/tags` and `/v2/tags/types` for the domain. How many tag types, and are tags specific (a distinctive style) or generic (genre only)? How do we get dominant tags for a set of seeds? Use the taste-analysis call in probe 15 (`filter.type=urn:tag`); there is no `/analysis` route.
4. **Same-domain insights.** `/v2/insights` with seeds as `signal.interests.entities`. Non-empty? How many?
5. **Cross-domain insights.** Seeds from domain A, `filter.type` of domain B, for every ordered pair you can afford. Non-empty? Plausible? Record the matrix of nonempty counts.
6. **Popularity.** Distribution of popularity in results for each type (bunching near 1? spread?). Does `filter.popularity.max` shift the distribution? Report medians with and without, at max 0.3 and 0.6.
7. **Cross-domain tag comparability.** Do tags from different entity types share a namespace or tag types, so a theme can carry across fields? Or does each type have its own vocabulary? This decides whether paths can be Qloo-grounded across domains.
8. **Explanation data.** Does insights return anything saying which signal drove a result (an explainability field or similar)? Check the guide for the param that enables it.
9. **Lineage and references.** Does Qloo return anything lineage-like? Does `/entities` give external ids (Wikidata and similar) that could link out to a lineage source? Rate coverage per domain: yes, thin, no. Check license notes for the candidate sources (Wikidata CC0, Wikipedia attribution).
10. **Frontier emptiness.** For each domain, with a plausible profile from the user's seeds, how often does a tight `filter.popularity.max` plus exclusions leave fewer than 5 results?
11. **Explainability.** Call insights for each domain with and without `feature.explainability=true` (it is reference-only: the Parameter Reference lists it, the per-type guide does not). Does it change the response? Describe the shape of `query.explainability` in words. Is it present for all six types? How concentrated is it (does one seed dominate, or is it spread)? Any `warning`? This is the most valuable test: if it works, paths can be anchored in Qloo's own attribution.
12. **Tag-signal operator.** With 2 to 4 theme tags as `signal.interests.tags`, compare result counts with no operator, `operator.signal.interests.tags=union` and `=intersection`. The docs say the default is intersection. Does it empty the frontier?
13. **Other reference-only params.** Test `page` vs `offset`, `sort_by` on a non-place type, and `signal.location.query` on a non-place type. Also `bias.trends=off|medium|high`: does it shift popularity?
14. **Candidate scoring.** Does `filter.results.entities` return affinity scores for supplied entity ids? If so, it can score lineage candidates and LLM-bridged ideas against a profile.
15. **Taste analysis.** Call `GET /v2/insights?filter.type=urn:tag&signal.interests.entities=<seeds of one domain>`, then add `filter.tag.types` and `filter.parents.types` (entity type). The per-type guide lists almost none of these for tags, so each is reference-only: test them with and without. Do tags come back ranked or scored for the signal (look inside each `query` object), or just listed? Are results different per seed set, or the same list? Does it work per domain? Does `urn:heatmap` give a 403 or a result?
16. **POST (one call only).** The Developer Guide says POST fails; the Parameter Reference documents weighted signals as POST arrays. Make ONE POST call with weighted `signal.interests.entities` and report whether it works. Do not adopt POST. Report the result and let the user decide (see DECISIONS.md).
17. **Page size.** `take=50` accepted? `take=51`?
18. **Backfill.** Do result sets contain padded backfill? Is it marked in the response? Compare default vs `backfill.cross_domain.take=1` and `backfill.content_based.take=1`, for same-domain and cross-domain queries. Report the share of results that look like backfill per domain pair.
19. **Trending and content bias.** Compare `bias.trends` at default (`medium`), `off` and `high`, and `bias.content_based` at 0, 0.5 and 1: how do popularity and tag overlap shift? Could either serve as a dial lever?
20. **Group weights.** With entities and tags both supplied, does `signal.interests.tags.weight` or `signal.interests.entities.weight` change the results?
21. **Description and image.** Does `filter.exists=properties.description` or `properties.image` change results, and how much of each domain has them? (Never store the text or images.)

22. **Semantic tag search.** `/v2/tags` with `filter.query` set to the words of a one-line "why", with and without `feature.semantic_search=true` (beta). Do the tags that come back fit the words? How many are generic? Is it fast enough for the onboarding "why" screen? Also try `feature.typo_tolerance` and `filter.tag.types` to scope by domain.
23. **Search behavior.** For each domain, `/search` with `types` scoped to its entity type: what is the shape of an item (describe in words)? A seed that exists, one that is ambiguous, one that does not (confirm 404 "No results"), `sort_by=popularity`, `take` up to 199. Note any 429 and how it recovers.
24. **Bridge tags.** From the taste-analysis `types` field: how many tags apply to both of two different entity types (for example artist and movie, or movie and book)? List the share per domain pair. This decides whether cross-domain paths can be Qloo-grounded.

## Silent-ignore detection (do this for every param Atelier relies on)

Every param the product relies on is either `listed` (supported on paper) or `reference-only` (must be proven). For each one the product will use, per entity type: make the same call with and without it (and with a different value), and compare the result sets. Identical results mean the param was ignored for that type. Record `ignored for <type>`, and update the registry. This is the spike's most valuable output because ignored params are otherwise invisible.

## Operational checks

- Error behavior: confirm a 403 for an unsupported `filter.type`, and tell an empty 200 caused by an ignored param apart from one caused by missing data for that entity (the guide says the hackathon environment may lack data for some entities or places).
- Quotas: note any rate-limit or quota headers. If limits look tight for the demo, the guide says to ask in #api-help on the hackathon Discord.

- Latency per call and for 5 parallel calls. Any rate-limit responses.
- Response size, to plan the private cache.
- How the key behaves (errors, 401, 429) so the demo can fail gracefully through Nov 16.

## Deliverables

1. `docs/spike-report.md`:
   - Coverage matrix: domain by (resolution, tags, popularity, cross-domain, lineage), each yes / thin / no.
   - Answers to the four spike questions in the brief.
   - Registry changes: rows promoted to `confirmed`, params found ignored, new params found.
   - Recommended locked domain list, which domains (if any) must be LLM-bridged, and why.
   - Risks: sparse tags, bunching popularity, empty frontiers, rate limits, key lifetime.
   - What it means for the open decisions (axes clustering, input process).
2. Updated `registry.seed.json` and `param-registry.md` in the qloo-api skill (promote tested params to `confirmed`, record any `ignored for <type>`), and `src/lib/qloo/registry.ts` if it exists. Also write the entity item fields (nesting, ids, popularity, tags, affinity, explainability placement, any backfill marker) in words into the spike report so fixtures can match them. The envelope is already known: `{ success, results: { entities, duration } }` plus query metadata.
3. Raw outputs in `.qloo-private/spike/`.

Then tell the user the recommendation and ask them to confirm the domain list. Locking the list is the user's decision. Record it in `docs/DECISIONS.md` only after they confirm.
