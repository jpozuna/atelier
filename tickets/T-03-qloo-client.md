# T-03: Qloo client, registry, cache and budget guard

Status: done
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

Zero live Qloo calls were made (no .env read, no QLOO_LIVE). 128 tests in src/lib/qloo (198 repo-wide), all on synthetic fixtures with a fake `fetch`; no test touches the network. `npm run typecheck`, `lint` and `test` pass.

### Files (all under src/lib/qloo/)
`client.ts` (the only module that calls fetch), `registry.ts` (generated from registry.seed.json), `validate.ts`, `parse.ts`, `cache.ts`, `cache-file.ts`, `trace.ts`, `errors.ts`, `types.ts`, `limits.ts`, `testing.ts` (synthetic fixtures and a fake fetch, not imported by production code), and `*.test.ts`. `client.ts`, `cache.ts` and `cache-file.ts` start with `import "server-only"`.

**Vitest needs a stub for `server-only`** (its default export throws outside the react-server condition). My test files that import those modules use `vi.mock("server-only", () => ({}))`, so they pass today. Any other test that imports them at runtime (not type-only) will fail until the manager adds this to `vitest.config.ts` `resolve.alias` (it makes the per-file mocks unnecessary):
```ts
"server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
```

### Public API (`@/lib/qloo/client`)
```ts
createQlooClient(options?: QlooClientOptions): QlooClient   // one per run
client.search(params)         // GET /search          -> QlooResponse<SearchItem>
client.entities(params)       // GET /entities        -> QlooResponse<SearchItem>
client.tags(params)           // GET /v2/tags         -> QlooResponse<TagItem>  (items use `id`)
client.tasteAnalysis(params)  // /v2/insights urn:tag -> QlooResponse<TasteTag> (items use `tag_id`)
client.insights(params, { purpose? }) // POST /v2/insights -> QlooResponse<InsightsEntity>; purpose "picks" requires filter.exclude.entities to cover every seed
client.stats()                // { liveCalls, httpAttempts, cacheHits, sharedCalls, remaining }
client.mode
```
- Params use the dotted Qloo names (`"filter.popularity.max"`). Insights seeds are `[{id, weight?}]` (weight defaults to 1). Arrays of ids are plain `string[]`; the client comma-joins them on GET.
- `QlooResponse<T> = { outcome: "ok" | "empty", items, query?, diagnosis?, droppedItems?, meta }`. Parsing is lenient: items with no id field are dropped and counted in `droppedItems` (and in the trace and diagnosis); a wrong envelope or a 200 with `success:false` throws `parse`. **Callers must check `outcome`.** `empty` covers a 200 with no items and a 404 on /search and /entities whose body is the `{code, reason, message}` "No results" shape (no match, so treat the seed as missing). Any other 404 throws `not_found` and is not cached. Errors throw.
- `meta = { endpoint, method, requestKey, cached, source: "live"|"cache"|"shared", status, ms, remaining }`. `cached` means no live call was made for this response (cache hit or shared in-flight call).
- Create one client per run (the live-call counter is per client). The concurrency limiter, singleflight map and last-known monthly quota are process-wide, shared by every client unless a test passes its own `shared`/`limits`.
- Env, read at call time: `QLOO_MODE` (replay default; read once at construction; an unknown value throws), `QLOO_BASE_URL` (must be exactly https://hackathon.api.qloo.com, else `QlooConfigError`), `QLOO_API_KEY`, `QLOO_RESERVE` (default 6000), `ATELIER_DEMO=1`.
- Modes: replay never calls the network and throws `QlooCacheMissError` on a miss; record calls on a miss and stores; live always calls (and also stores).
- Guards: `MAX_LIVE_CALLS_PER_RUN` (imported from `src/lib/agent/config.ts`, 12) live calls per client (the next throws `QlooBudgetError` reason `run_limit`, nothing sent). `x-month-ratelimit-remaining` is read on every live response (an empty or non-numeric header is treated as absent, never 0); below `QLOO_RESERVE` live calls throw `QlooBudgetError` reason `reserve` unless `ATELIER_DEMO=1`. Cache hits and shared calls never count. Retries after a 429 do not count as extra live calls (`httpAttempts` counts them). Requests use `redirect: "error"`, so the key cannot follow a redirect to another origin. At most 4 in flight, request starts spaced 220 ms (5/s key limit), 429 backoff 1s/2s/4s (Retry-After honoured, capped 8s), up to 3 retries.

### Errors (`@/lib/qloo/errors`)
All extend `QlooError` (`kind`, `endpoint?`, `status?`, `retryable`). `QlooConfigError` (config), `QlooParamError` (param_invalid, `issues[]` with reasons unknown|ignored|rejected|atelier_refused|body_unconfirmed|bad_value|not_an_id|missing_required), `QlooCacheMissError` (cache_miss), `QlooBudgetError` (budget, `reason`), `QlooHttpError` (bad_request 400, unauthorized 401, forbidden 403, not_found 404, rate_limited 429 after retries, server_error 500 and other 5xx, gateway_timeout 504; has `messages[]`, `html`, `retryAfter`), `QlooNetworkError` (network), `QlooParseError` (parse). Never contains the key.

### Cache adapter interface for T-06 (`@/lib/qloo/cache`)
```ts
interface QlooCacheAdapter {
  get(key: string): Promise<CacheEntry | null>;   // key = 64-char hex sha256
  set(entry: CacheEntry): Promise<void>;          // overwrite same key
}
interface CacheEntry { v: number /* CACHE_ENTRY_VERSION */; key; endpoint; method; status: number /* 200, or 404 for empty search/entities */; body: unknown /* stripped JSON, null for 404 */; createdAt: string }
```
Pass it as `createQlooClient({ cache })`. A throwing `get` is a miss; a throwing `set` is ignored. No TTL. Default is `createFileCache()` (`.qloo-private/cache/<key>.json`, refuses any dir not inside a `.qloo-private` folder); `createMemoryCache()` for tests; `cache: null` disables. Suggested `qloo_cache` columns: key text pk, endpoint, method, status int, body jsonb, version int, created_at. Keys are normalized (sorted params, sorted ids, seeds sorted by id with default weight, canonical JSON, search text trimmed and lowercased) so order never changes the key. Stripping drops `akas`, `websites`, `keywords` at any depth and truncates strings over 500 chars (lineage fields like influenced_by are kept).

### TraceEvent emission hook
`createQlooClient({ onTrace })` receives one `QlooCallTraceEvent` per call, including param refusals, cache misses, budget refusals and HTTP errors. It `extends` the shared `QlooCallEvent` from `src/types` (so it is assignable to the `qloo_call` TraceEvent variant) and adds: `params` (ids redacted: lists become `"[N ids]"`, any scalar under an id key `"[id]"`, anything else `"[ids]"`; keys kept), `source` ("live"|"cache"|"shared"|"none"), `ms`, `outcome` ("ok"|"empty"|"error"), `errorKind?`, `resultCount?`, `droppedItems?`, `runLiveCalls`, `mode`, `requestKey?`. As in the shared contract, `status` is present only when an HTTP response was received for that event (live calls and HTTP errors); it is absent for cache hits, shared calls and refusals. `cached` is true when no live call was made. A `call-budget` scorer can read `runLiveCalls` on the last event of a run, or count events with `cached: false` and a `status`. A throwing sink is ignored.

**Ask for src/types (T-02 owner/manager):** `QlooCallEvent` has no `params`, `ms`, `outcome` or `runLiveCalls`, which the `param-validity` and `call-budget` scorers need. Either move those fields into the shared variant, or leave them as this extension and have the scorers import `QlooCallTraceEvent` from `@/lib/qloo/types`.

### Decisions I made (manager please check)
1. **POST body gate (pending the 04-post-check).** `registry.ts` exports `POST_BODY = { baseline, confirmedBodyParams }`. `baseline` is only what the spike proved on POST: `filter.type`, `signal.interests.entities`, `take`. `confirmedBodyParams` is **empty by default**, and every other body param is refused with `body_unconfirmed`, not just the three named ones. That includes `signal.interests.tags`, `filter.tags`, `filter.exclude.tags`, `filter.results.entities`, `offset`. After the user approves and runs `scripts/spike/04-post-check.mjs`, the manager adds the verified names to `POST_BODY.confirmedBodyParams` (expected: `filter.popularity.max`, `filter.exclude.entities`, `feature.explainability`; the others only if verified). The body sends id lists as JSON arrays, booleans and numbers natively, as the check script does. `purpose: "picks"` (item 12 of the review) is enforced independently of the gate: it requires `filter.exclude.entities` to include every seed, so it is ready when the gate opens. If the check shows another encoding is needed, only the POST body build in `client.ts` (`JSON.stringify(req.params)`) changes.
2. **Taste analysis goes by GET by default**, because the ticket says "the rest go by GET" and its params (`signal.interests.entities`, `filter.parents.types`, `filter.tag.types`) are only confirmed on GET. `createQlooClient({ tasteAnalysisMethod: "POST" })` switches to POST, which then goes through the same body gate. GET cannot carry per-seed weights; unequal weights are refused. If the manager prefers POST (seed ids out of URLs, per DECISIONS.md), record the three params as confirmed body params first.
3. `MAX_LIVE_CALLS_PER_RUN` now comes from `src/lib/agent/config.ts`. `limits.ts` keeps only client mechanics (`MAX_IN_FLIGHT` 4, `MIN_REQUEST_INTERVAL_MS` 220, `MAX_429_RETRIES` 3, backoff 1s base/8s cap, `REQUEST_TIMEOUT_MS`). Two numbers there arguably belong in config.ts: `DEFAULT_RESERVE` (6000, the monthly-quota floor, also the default of `QLOO_RESERVE`) and `STRIP_MAX_STRING` (500).
4. `server-only` is imported in `client.ts`, `cache.ts` and `cache-file.ts`. See the vitest alias above.
5. Param refusals on entity-type insights: `bias.trends` is refused on every type (Atelier does not send it); also `operator.exclude.tags`, `operator.filter.exclude.tags`, `filter.parents.types`, `signal.demographics.*`, `filter.external.exists` (+ operator) and `filter.results.entities.query` (reason `atelier_refused`, from `ATELIER_REFUSED_INSIGHTS_PARAMS` in `registry.ts`; `filter.parents.types` stays allowed for urn:tag and /v2/tags). `filter.exists` is limited to `properties.image` (only artist and brand), `sort_by` is refused everywhere (ignored on all six). Unlisted `filter.type` urns (heatmap, locality, urn:tag through `insights()`) are refused. Seeds are deduplicated by id (max weight) and string id lists are deduplicated before hashing and sending.
6. Search params allowed are everything in the seed's /search list plus `types` (deduplicated); tag params everything in the seed's /v2/tags list. /search `types` is limited to the six Atelier types (`ATELIER_SEARCH_TYPES`); `filter.popularity` and `filter.rating` must be 0..1. /v2/tags: `feature.semantic_search` needs a non-empty trimmed `filter.query`; `filter.tag.types` (here and on taste analysis) must be `urn:tag:<kind>:<ns>`. Other checks: take 1..50 (insights, tags), 1..100 (search); popularity 0..1 with min <= max; ids must be UUIDs; tag ids must start `urn:tag:`.
7. Singleflight: if the leader failed with a budget or config error (its own client's guards), a follower evaluates its own guards instead of inheriting it. HTTP, parse and network failures are still shared.

### Known gaps
- `types.ts` keeps client-local types only where `src/types` has no equivalent: the raw Qloo item shapes (`SearchItem`, `InsightsEntity`, `TagItem`, `TasteTag`; `src/types/candidate.ts` is the normalised form T-08 builds from them), request params, `QlooResponse` and the trace extension. `QlooEndpoint` is re-exported from `@/types`.
- The T-04 `param-validity` scorer can import `paramStatus`, `INSIGHTS_TYPES`, `TAG_INSIGHTS`, `SEARCH_ENDPOINT`, `TAGS_ENDPOINT` from `registry.ts` and `prepareInsights`/`prepareTasteAnalysis`/`prepareSearch`/`prepareTags` from `validate.ts` (pure, no network, no server-only guard). Trace params are redacted, so a scorer can check names and ranges but not id shapes.
- Movie-only confirmations (`operator.signal.interests.tags`, group weights) stay movie-only in the registry, as in the seed; other types refuse them.
- Not verified against the real API (by design, no live calls): the exact POST encoding of body-borne filters, and whether a real "No results" 404 body has all of `code`, `reason`, `message` (the client requires them; a different shape would throw `not_found` instead of returning `empty`).
