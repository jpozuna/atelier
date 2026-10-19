# T-03: Qloo client, registry, cache and budget guard

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-01

## Goal
One budgeted, validated door to Qloo: a typed client with a per-type param registry, a replay/record/live cache and call accounting, so no other code can call Qloo wrongly or over budget.

## Owns
- src/lib/qloo/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/spike-report.md
- .claude/skills/qloo-api/references/registry.seed.json
- .claude/skills/qloo-api/references/param-registry.md
- scripts/spike/lib.mjs (the cache and budget pattern)

## Skills
- qloo-api

## Done when
- [ ] `src/lib/qloo/client.ts` is the only module that calls `fetch` to Qloo. It exposes `search`, `entities`, `tags`, `tasteAnalysis` and `insights`. Insights goes by POST with a JSON body (seeds as `[{id, weight}]`); the rest go by GET. The key is sent only in `X-Api-Key`. The host comes from `QLOO_BASE_URL` and the client throws unless it is the hackathon host. The module is marked server-only
- [ ] `src/lib/qloo/registry.ts` is generated or hand-built from `registry.seed.json`. The client throws before sending any param that is not `listed` or `confirmed` for the call's type, and also on anything in `ignored` or `rejected` (for example `bias.trends` on book). Body-borne filters on POST stay refused until the manager records the 04-post-check result
- [ ] There is one parser per envelope (search flat array, insights `results.entities`, tags `results.tags`, taste analysis `results.tags`). Errors map to typed errors: a 400 with `errors[]`, the search 400 shape, 401, 429, 500 and HTML 504. An empty 200 is reported as `empty`, never as success
- [ ] Cache: each request is keyed by a normalized form (sorted params, sorted ids, canonical JSON body). Bulky fields are stripped before storing. There is a file adapter under `.qloo-private/cache/` for dev and an adapter interface that T-06 implements for Supabase. Concurrent identical requests share one call (singleflight)
- [ ] `QLOO_MODE=replay` (the default) never calls the network and throws on a miss. `record` calls on a miss and stores the result. `live` always calls. A run-scoped counter refuses live call number 13 (`MAX_LIVE_CALLS_PER_RUN`). `x-month-ratelimit-remaining` is read on every live response, and below `QLOO_RESERVE` the client refuses live calls unless `ATELIER_DEMO=1`
- [ ] At most 4 requests are in flight; a 429 backs off and retries up to 3 times
- [ ] Every call emits a `qloo_call` TraceEvent (endpoint, params with ids redacted, cached flag, status, ms)
- [ ] Tests use synthetic fixtures only (ids shaped `00000000-0000-4000-8000-0000000000NN`), and no test touches the network
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- param-validity
- call-budget
- repo-hygiene

## Qloo calls
- /search GET: query, types, take, filter.location, filter.radius
- /entities GET: entity_ids
- /v2/tags GET: filter.query, feature.semantic_search, feature.typo_tolerance, filter.parents.types, take
- /v2/insights POST: filter.type, signal.interests.entities [{id, weight}], signal.interests.tags, filter.popularity.min|max, filter.exclude.entities, filter.exclude.tags, filter.tags, feature.explainability, filter.results.entities, take, offset
- /v2/insights (urn:tag): signal.interests.entities, filter.parents.types, filter.tag.types, take

## Handoff
(Worker fills in.)
