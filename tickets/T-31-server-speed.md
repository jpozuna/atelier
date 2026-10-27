# T-31: Faster onboarding and picks on the server

Status: done
Mode: inline
Kind: fix
Priority: P1
Depends on: none

## Goal
Cut the wall-clock time of seed lookup, the profile build and the picks run (`/api/seeds/resolve`, `/api/profile`, `/api/profile/why`, `/api/run`) without changing what they return or how many Qloo calls they make.

## Owns
- src/lib/agent/loop.ts
- src/lib/agent/llm.ts
- src/lib/agent/explain.ts
- src/lib/agent/prompts.ts
- src/lib/profile/ (handler, naming, build, why; and their tests)
- src/app/api/run/
- src/app/api/profile/
- src/app/api/seeds/
- src/lib/agent/config.ts, config.test.ts (manager at accept: LLM_EXPLAIN_CONCURRENCY 6, NAMER_CONCURRENCY 8)
- scripts/perf/ (new: timing script; output goes to .qloo-private/perf/, never committed)
- src/lib/agent/loop.test.ts (test-writer: onDomain and parallel re-queries)

## Reads
- CLAUDE.md (hard rules 1, 8, 10), docs/DECISIONS.md
- src/lib/agent/config.ts (manager-only: propose any concurrency or token-limit changes in the hand-off; do not edit)
- src/lib/qloo/client.ts, cache.ts, cache-select.ts (do not edit)
- src/components/onboarding/OnboardingFlow.tsx (how the client calls these routes; T-32 owns it)

## Skills
- atelier-agent-loop, qloo-api, atelier-evals

## Done when
- [ ] Zero live Qloo calls: timing runs use `QLOO_MODE=replay`/cache or synthetic data with a stubbed LLM that adds a fixed delay per call. If any step would need a live call, stop and report the dry-run count instead
- [ ] A timing script under scripts/perf/ prints per-stage times (LLM calls, Qloo calls, total) for each route, and the hand-off has a before/after table
- [ ] Every await chain that does not depend on the previous result runs in parallel (e.g. theme choice vs. pool prefetch, references vs. explanations, why-text vs. axis naming), and LLM calls use prompt caching and sensible `max_tokens` where safe
- [ ] `/api/run` streams the first picks as soon as they are ready rather than at the end, if it does not already (the client already reads a stream)
- [ ] Same outputs: call counts per run unchanged or lower (call-budget scorer green), path and explanation contracts unchanged, all evals green
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run evals` pass

## Specialists
- tests: yes
- qloo-param-auditor: yes (only if any Qloo call is touched)
- bridge-judge: yes (only if prompts.ts or explain.ts change)
- design-reviewer: no
- research question: none

## Evals
- call-budget, path-complete, explanation-grounded, frontier-only, repo-hygiene (and every scorer in `npm run evals`)

## Qloo calls
- none new. Existing calls may be reordered or run concurrently within the 5/second limit in src/lib/qloo/limits.ts; params unchanged

## Handoff

### What changed
- `src/lib/agent/loop.ts`
  - Re-queries (at most 2, always for different domains) run at the same time. Each one's events are held and emitted in decision order, so the trace reads as before (`requery`, then that pool's own events).
  - References and cards are per domain instead of two global phases. Every finalist's lookup starts at once, in the same round-robin order as before, so the Wikidata lookup cap is spent exactly as before (the Wikidata client still sends one request at a time). A domain's cards start as soon as its own picks' references are in, behind a gate of `LLM_EXPLAIN_CONCURRENCY`.
  - `fetch_refs` is still one event, emitted when every lookup has settled; `explain` events of a domain that finished earlier are held until it is out, so the trace order is unchanged.
  - New optional hook `RunStreamDeps.onDomain(domain)` (exported from loop.ts; `RunDeps` in types.ts is untouched). Called once per queried domain with a selection, as soon as its cards are written. A throw in the hook is ignored. `meta.fallbacks` are now pushed in field order (they were in completion order).
- `src/app/api/run/handler.ts`: new SSE event `domain` (one `DomainResult<PublicPick>`, stripped by the same `toPublicResult` code as the result), sent as each field's cards are written, before `result`. `result` is unchanged and still the whole answer; the `domain` payload equals the same field's entry in `result` (tested).
- `src/app/api/run/handler.test.ts`: stream test now allows `domain` events and checks they match `result`; new test for trace order under overlap (one `fetch_refs` before every `explain`, each re-query before its own pool events, 8 Qloo calls).
- `scripts/perf/` (new): `timing.perf.ts` and `vitest.config.ts`. See "Timing" below.
- Not changed, on purpose: `llm.ts`, `explain.ts`, `prompts.ts`, `src/lib/profile/*`, `src/app/api/profile`, `src/app/api/seeds`. Reasons below. Because `prompts.ts` and `explain.ts` are untouched, no bridge-judge run is needed. No Qloo call was added, moved between params or reordered beyond the two re-queries now overlapping (same params, same count; the client's limiter still spaces starts), so qloo-param-auditor has nothing new to check.

### Contracts other tickets rely on
- SSE: a new `domain` event may appear between `trace` events and before `result`. The existing client (`src/components/deck/sse.ts`, `readMessage`) returns null for unknown events and skips them, so nothing breaks. To show picks early, the deck owner adds a `domain` case to `readMessage` and merges by field. Not done here (not my path).
- Unchanged: path and card contracts, `result` shape, trace event kinds and their order, call counts (6 pools, at most 2 re-queries, at most 8 model calls).

### Timing (all stubbed: 0 live Qloo, 0 Anthropic, 0 Wikidata calls)
Run: `PERF_LABEL=after npx vitest run --config scripts/perf/vitest.config.ts` (add `PERF_CONFIG=proposed` for the config values below; `PERF_DRY_RUN=1` prints what would run). The real Qloo client (limiter, cache, param checks) runs over a fake network; the model is a stub with a fixed delay per call; Wikidata is the real refs client over a fake fetch. Delays (placeholders, not measurements of the real services): Qloo 600 ms per request (5 ms for "cached"), taste analysis 900, Wikidata 350 per request, themes 2500, review 1500, cards 3500, axis name 1200 (each overridable with `PERF_*_MS`). Read the table for what overlaps, not for absolute seconds. JSON goes to `.qloo-private/perf/`.

Milliseconds, total wall time (first picks = first `domain` event; before, picks arrived only at `result`):

| route / scenario | before | after (config.ts as is) | after (+ proposed config) |
|---|---|---|---|
| /api/seeds/resolve (1 search) | 608 | 606 | 607 |
| /api/profile/why (1 tags call) | 604 | 604 | 603 |
| /api/profile (taste call + 8 axis names) | 4522 | 4535 | 2119 |
| /api/run healthy, Wikidata on | 15531 | 11969 | 11983 |
| /api/run healthy, first picks | 15529 | 7750 | 7758 |
| /api/run flagged (review + 2 re-queries), Wikidata on | 18187 | 14259 | 14246 |
| /api/run flagged, first picks | 18177 | 10042 | 10038 |
| /api/run healthy, no Wikidata | 11230 | 11215 | 7718 |
| /api/run healthy, no Wikidata, first picks | 11230 | 7711 | 7712 |
| /api/run healthy, Qloo cached, no Wikidata | 10637 | 10620 | 7119 |
| /api/run healthy, Qloo cached, no Wikidata, first picks | 10636 | 7114 | 7113 |

("before" for the proposed-config column of /api/run, i.e. config change alone: healthy 12058, flagged 14653, no Wikidata 7717, cached 7118, profile 2128.)

Counts per run are identical before and after: healthy 6 Qloo calls and 7 model calls; flagged 8 and 8; profile 1 Qloo call and 8 axis-name calls; Wikidata 12 requests (6 lookups x 2).

### Proposed config.ts changes (manager-only; `config.test.ts` pins values)
- `LLM_EXPLAIN_CONCURRENCY` 3 to 6 (one cards call per field, six fields). With 3, six fields are written in two waves. This is the whole gain in the "no Wikidata" and "cached" rows (11.2 s to 7.7 s; 10.6 s to 7.1 s) and it matters most in production, where Qloo is replayed and the cards calls are the longest wait. Cost: up to 6 model calls in flight per run (RUN_MAX_CONCURRENT is 3, so 18 at the extreme).
- `NAMER_CONCURRENCY` 3 to 8 (equals `MAX_AXES`). Six to eight axis names run in three waves now; at 8 they run at once. Profile build 4.5 s to 2.1 s in the stub.
- `RUN_POOL_CONCURRENCY`: no change proposed. Going 3 to 6 made no difference in the stub because the Qloo client spaces request starts by 220 ms with 4 in flight.
- `LLM_EXPLAIN_MAX_TOKENS` and the other token caps: no change. `max_tokens` is a ceiling, not a speed lever (output length sets the time); 2400 per field is already tight for the pick cap.

### Known gaps and decisions
- With Wikidata on, the critical path is now the Wikidata queue (12 requests one after another, about 4 s in the stub) followed by the cards call of the field whose lookups finish last. That queue is serial on purpose (Wikimedia etiquette, `src/lib/refs/wikidata.ts`, not mine). Ordering lookups by field instead of round-robin would let early fields finish sooner but would change which picks spend the 6-lookup cap, so I left the order alone.
- Theme choice vs pool prefetch: not done. A pool's request depends on the chosen axis, so starting pools before the themes call returns would be a guess, and a wrong guess is an extra Qloo call (the call-budget rule says unchanged or lower). The only exact overlap is a field whose offered axes all give the same seed weights; that is rare with seeds in several fields and bounded by the pool phase, so I judged it not worth the extra ordering code.
- References vs explanations: done (per field, above). Why-text vs axis naming: there is nothing to overlap. The why is mapped at onboarding (`/api/profile/why`, one call) and arrives on the seed, so `/api/profile` is one taste call followed by axis names, which need that call's tags.
- Prompt caching: not added. A system block with `cache_control` changes the request body (`system` becomes an array), which breaks `src/lib/agent/llm.test.ts` and the fake model in `src/lib/agent/testing.ts` (neither is in this ticket's Owns). The cards system prompt plus tool schema is also near or under the minimum cacheable length, and the six cards calls start together, so within a run none could read a cache. If wanted: add an opt-in `LlmRequest.cacheSystem` that sends `system: [{type:"text", text, cache_control:{type:"ephemeral"}}]`, with a test, in a ticket that owns those two files.
- `/api/seeds/resolve` and `/api/profile/why` are one Qloo call each with nothing to overlap server-side. Onboarding calls resolve then why one after the other from the client (`OnboardingFlow.tsx`, T-32); starting the why call for a seed as soon as the user submits the text, or both together, is a client-side change.
- The `domain` event needs a reader in the deck (`src/components/deck/sse.ts`, `PicksScreen.tsx`) before users see picks early; until then the screen behaves exactly as before.
- Two run tests (`loop.test.ts`) could add cases for `onDomain` (called once per queried field, before the result; a throwing hook does not fail the run) and for parallel re-queries; the handler test covers the streamed side. A transient `npm test` failure appeared once while other workers were editing; two reruns were green (1437 passed, 19 skipped), as were `npm run evals` (17 passed), `npm run lint` and `npm run typecheck`.


## Review fixes

Status stays `review`. Checks after the fixes: `npx vitest run src/lib/agent src/app/api/run` (8 files, 216 tests), `npm run typecheck`, `npm run lint` and `npm run evals` (17) all green. 0 live Qloo, Anthropic or Wikidata calls; no Qloo call added or changed.

1. Orphaned work after a failure or cancel (`src/lib/agent/loop.ts`).
   - The re-queries and the per-domain cards tasks are now run by `settleAll` (allSettled). The first rejection is remembered in a shared `failure`; `checkAbort` throws once it is set (as it does for an aborted signal), so every sibling stops at its next step (next Qloo call, next model step, next pick, the gate). `settleAll` waits for all of them to settle and then rethrows the first rejection, not a sibling's "run stopped" error. In-flight Qloo or model requests are not cancelled (no signal reaches them); only the next step is refused.
   - The up-front Wikidata lookups: each lookup is now handed to `deps.refs.wikidata.lookup` in the original round-robin order but one after another (a promise chain in the loop; `getReferences` gets a derived context whose `lookup` is that chain). Each link calls `checkAbort` first, so after an abort or failure no further lookup starts (the client has no signal; `src/lib/refs` is not touched). The cap is spent exactly as before (a slot is taken when the client's `lookup` is called, and the calls still come in the same order); the client already sent one request at a time, so wall time is unchanged. Re-run of the perf script: 12 Wikidata requests, peak 1, healthy 12032 ms and first picks 7784 ms (same as before the fix within noise).
   - `fetch_refs` is not emitted if the run has already stopped.
   - Tests (`loop.test.ts`, describe "failure and cancel stop the concurrent work"; `runStreamed` got `throwFor` and `onEvent` options): one re-query throws, the other is already in flight; the run rejects with the first error after it settles, only that one extra Qloo call reached the network, no cards call, no Wikidata lookup, no `onDomain`. A cancel in the middle of the lookups: exactly 1 lookup started, no cards call. A cancel when the first cards call arrives: the run ends with "cancelled" and no `onDomain`.
2. Determinism and the `domain` event.
   - Held `explain` events are now kept per domain and released in field order: a domain's events go out only after the one `fetch_refs` and after every earlier field's events have gone out, however the fields finish (an in-order release, so a later field never overtakes an earlier one). This also removes the completion-order dependence of events that used to be sent live after `fetch_refs`.
   - Chosen: do NOT hold the `domain` SSE event for the trace. Holding it until its `explain` events were out would delay every field's picks until all Wikidata lookups settle (about 4 s in the stub: first picks 11.9 s instead of 7.8 s with Wikidata on, and the same for the flagged run), which loses the early-picks gain this ticket exists for. Where there are no lookups the order is trace first, picks second anyway; with lookups, picks can precede their own `fetch_refs` and `explain` events. The contract is written in the header of `src/app/api/run/handler.ts` and on `RunStreamDeps.onDomain` in `loop.ts`: a client must not assume a pick's `explain` event has been seen when its `domain` arrives; every trace event is sent before `result`; `explain` events of different fields are in field order. Tests: the explain events are in field order under reversed and forward cards timing, with and without lookups, and identical across the two timings; `onDomain` for a no-lookup field fires before any `explain` event while another field's lookup is held. Deck owner: if the reasoning panel needs a pick's trace on arrival, wait for `result` or the `explain` events rather than assuming they precede `domain`.
3. `refsReport` has a `.catch(() => undefined)` branch attached when it is created; the later `await refsReport` still rethrows.
4. Perf script (`scripts/perf/timing.perf.ts`): `globalThis.fetch` is replaced with a function that throws for the duration of the run (restored in `afterAll`), so any unstubbed call fails loudly; the output directory is resolved from the repo root with `fileURLToPath(new URL("../../", import.meta.url))`. The stubs inject their own fetch, so nothing else changed (verified by a full run, output `after-review-current.json`).
   - How the "before" numbers were produced: from the same script run against the loop and handler as they were before this ticket (`before-current.json` and `before-proposed.json` under `.qloo-private/perf/`, written at 11:40 and 11:41 by the first implementation pass). I did not regenerate them in this review pass and cannot show the exact procedure beyond that. "After" in the table is the first implementation; the review pass's re-run (config.ts now has `LLM_EXPLAIN_CONCURRENCY` 6 and `NAMER_CONCURRENCY` 8) gives resolve 607, why 605, profile 2127, run healthy 12032 (first picks 7784), flagged 14270 (10051), no Wikidata 7727, Qloo cached 7134.
