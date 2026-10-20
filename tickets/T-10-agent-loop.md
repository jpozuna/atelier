# T-10: Agent loop with tools and re-query

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-08, T-09

## Goal
The agent plans a run (themes to carry, which seeds lead each domain), calls the computed tools, re-queries on computed reason codes within budget, and writes each explanation only from the stored path, streaming trace events as it goes.

## Owns
- src/lib/agent/loop.ts
- src/lib/agent/tools.ts
- src/lib/agent/prompts.ts
- src/lib/agent/explain.ts
- src/app/api/run/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/lib/frontier/
- src/lib/profile/
- src/lib/refs/
- src/lib/agent/config.ts
- src/types/

## Skills
- atelier-agent-loop
- atelier-evals
- qloo-api

## Done when
- [ ] The loop uses the Anthropic API with `ATELIER_MODEL` (default `claude-sonnet-5-5`) and tool use. The model chooses themes and re-queries; code computes reach, connection and popularity
- [ ] Re-queries happen only on reason codes (`too_obvious`, `too_weak`, `empty`, `weak_connection`), at most 2 per run in total, each logged with its code
- [ ] A full new run for 6 domains makes at most 12 live Qloo calls, and a rerun of the same profile makes 0 (the call-budget scorer passes)
- [ ] Each card's explanation is generated from its Path only. The prompt receives the path and its retrieved text, nothing else about the entity
- [ ] `POST /api/run` streams TraceEvents (server-sent events) and finishes with picks by band and domain
- [ ] Every TraceEvent carries complete structured fields (the reasoning panel renders from them, not from `say`). Model-written `reason` text never restates the main line, never claims taste of its own, and never uses internal terms (connection floor, reach, band edges)
- [ ] A stub for T-09 is allowed if it is not done; the handoff says so
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: yes
- design-reviewer: no
- research question: none

## Evals
- re-query-logic
- call-budget
- path-presence
- distinctive-hop
- param-validity

## Qloo calls
- via T-07 and T-08 only: /v2/insights POST (pools, re-queries), /v2/insights urn:tag

## Handoff
Zero live Qloo and zero live Anthropic calls (no .env read, no QLOO_LIVE, no QLOO_MODE=live). 132 tests in src/lib/agent and src/app/api/run on synthetic data: the REAL Qloo client (record mode, in-memory cache, fake fetch, POST body gate opened on a copy of the registry) and the REAL model client (fake endpoint). `npm run typecheck`, `lint`, `test` (778 pass), `build` and `npm run evals` pass. T-09 is real (not stubbed). No change to src/types, config.ts or any frontier/profile/refs file. Round 2 (review, param audit, bridge-judge) is done; see "Round 2" below.

### Files
`src/lib/agent/`: `loop.ts` (`runAgent`, `withLineage`, `RunInputError`), `tools.ts` (3 model tools plus parsers), `prompts.ts`, `explain.ts`, `llm.ts` (Anthropic client, cache, `limitCalls`), `signals.ts` (re-query reason codes), `text.ts` (model-text checks), `public.ts` (what leaves the server), `names.ts`, `types.ts`, `run-constants.ts` (tunables), `testing.ts` (test-only fixtures, never imported by production code), `*.test.ts`. `src/app/api/run/`: `route.ts`, `handler.ts`, `handler.test.ts`.

### POST /api/run (for T-14)
Request JSON (at most 150000 chars): `{ seeds: ProfileSeed[], profile: Profile, axes: Axis[], exclude?: string[], plan?: RunPlan }`. That is `readTasteSession()` (`seeds`, `profile`, `axes`) as is, plus an optional list of entity ids already shown (a "show more" run; at most 200) and optionally the `plan` an earlier result returned. The profile is passed in, so the run makes NO profile call. Validation (400 JSON `{error:{code,message}}` before streaming): 1 to 10 seeds (`isSeed`, UUID `qlooId`, `whyTags` cleaned), profile tags (`isProfileTag`, id `urn:tag:...`, at most 120), 1 to 12 axes (`isAxis`, real tag ids), exclude UUIDs, plan shape. 422 `no_usable_seeds`; 499 when the request is already cancelled; 503 `busy` when 3 runs are in progress in the process.

Response 200 is `text/event-stream` (`Cache-Control: no-store`). Every message is `event: <name>` then `data: <one line of JSON>`, then a blank line; a `: keepalive` comment line is sent every 12 s (EventSource and fetch-stream parsers must skip lines starting with `:`):
- `trace`: one `TraceEvent` per message, as it happens. Each passes `isTraceEvent` on the server (the handler drops any that does not) and is then stripped for the browser (see Rule 7). Includes the Qloo client's `qloo_call` events, `choose_theme` (one per domain that has an axis), `query_insights` and `score` per pool, `requery`, `relax`, `fetch_refs`, `explain` (one per pick). Render from the structured fields, not `say`.
- `result`: once, before `done`: `PublicRunResult = { domains: DomainResult<PublicPick>[], plan: RunPlan, meta: { requeries, notRequeried } }`. `domains` has one entry per field in field order: `{ domain, status: "ok"|"thin"|"empty"|"unavailable", picks, byBand: {calibration, moderate, high, extreme}, emptyBands, thin, requeried?: reason code, requeryResult?: "improved"|"kept_first", note?: fixed user sentence }`. `picks` is lowest band first. A `PublicPick` is a `Pick` without `reach`, `connection`, `popularity`, and its path anchor is `{ contribution: null, source, thin? }`. Each pick has a complete card (`path`, `why`, `different`, `provenance` equal to the hop counts, `reading?`). Up to 2 picks per band and domain (at most 8 per domain); a thin domain is shown thin, never padded; a relaxed band is in `emptyBands` and the `relax` events say what was shown instead. Send `plan` back unchanged on a repeat.
- `error`: `{ code, message }` if the run fails after streaming began (no `result` follows). Codes: `picks_not_enabled` (the POST body gate is still closed: raised BEFORE any model call), `lookups_off`, `budget`, `rate_limited`, `upstream`, `rejected`, `config`, `internal`. Fixed messages only.
- `done`: `{}`, always last (also after `error`).
A client abort cancels the run between stages (per domain, per card). One domain failing with a cache miss, 429 or 5xx is `status: "unavailable"` and the others still return; the run errors only if every domain fails, or on a config, budget or param error.

### Rule 7 (nothing numeric about taste leaves the server)
`public.ts` (`publicTrace`, `toPublicResult`), applied in the handler after the server-side `isTraceEvent` check: `score` events lose `popularity`; `filter.popularity.*` values in `query_insights.params`, `requery.paramChanges` and `qloo_call.params` become the words "limited" / "tightened"; picks lose `reach`, `connection`, `popularity`; `path.anchor.contribution` becomes null (source and `thin` kept) on both `pick.path` and `card.path`; the result has no `meta.fallbacks`, no model counts and no Qloo call counts (`meta` is only `requeries` and `notRequeried`). The internal `RunResult` keeps all of it for evals and stored traces.
**Contract consequences for the manager:** a public `score` event has no `popularity`, so the shared `isTraceEvent` (which requires it) rejects it on the client; and a public path with `source: "qloo_explainability"` and `contribution: null` fails `isPath`/`isCard`. T-14/T-15/T-16 must not run those guards on public data, or the guards need a public variant (popularity optional on `score`; contribution optional when public). I kept the honest `source` rather than relabel it `tag_overlap`.

### What the loop does
0. **Preflight**: before any model call, the first pool's real params (built by `buildPool` with a stub that sends nothing) are checked for all six types with `prepareInsights` on the client's registry (`RunDeps.preflight`, wired in route.ts). A closed gate fails with no model spend.
1. **Themes** (model, forced tool `choose_themes`): per domain one axis among options code computed. `reason` is checked; an invalid reason gets a deterministic one. With a `plan`, the themes are replayed and there is no model call. No model: axes rotated across domains.
2. **Pools**: `buildPool` + `scorePool` per domain, 3 at a time, streaming. Abort is checked before each Qloo call (the client has no signal parameter, so an in-flight call is not cancelled).
3. **Review**: code flags `empty`, `weak_connection`, `too_weak`, `too_obvious` (signals.ts). Only if something is flagged (and there is no plan), the model (`decide_requeries`) picks among actions code computed (`tighten_popularity`, not offered for `empty`; `lean_axis`) or skips. With a plan, its re-queries replay for domains that are still flagged. At most 2, each logged with its code, each changing a param. The `requery` event is emitted after the second pool's result is known and before that pool's own events, and its `say` and the domain's `requeryResult` tell whether the new results replaced the first or the first stayed (for `too_obvious`, the new pool wins only if it is no longer obvious or less so, and is not thin).
4. **Bands**: ONE `selectBands` per domain.
5. **Paths**: code adds `Path.pickOnlyTags` (up to 3 of the pick's own tags the profile lacks, pool rarity at least 0.5, rarest first) and `Path.distance` (`other_field` when the pick's field differs from the anchor seed's; `farther_from_tags` when tag distance is at least 0.6; `less_familiar` when obscurity is at least 0.6 and popularity is known). Then refs add the first lineage hop that touches a seed; `path.distinctive` becomes true.
6. **Cards** (model, forced tool `write_cards`, one call per domain). Reading comes from refs.

### Explanations (round 2)
The model sees, per pick: a short `ref` (p1, p2; never the entity id), the seed name, field and the user's own words about it (`whyTheUserLovesIt`), the shared tag NAMES, `pickOnlyTags` names, `distance` as words (a different field from the seed; shares fewer of the usual themes; less familiar territory), the pick name and field, `anchorBasis` (`graph_link`/`shared_tags`) and the retrieved lineage line when there is one. Nothing else about the entity (tested). The prompt tells it to describe each theme only in its tag's words, to avoid years and decades, to match singular and plural, and to write what tracing the theme into the pick's field might help the user notice in the seed.
Validation (`text.ts`, tested): internal PHRASES (connection floor, reach score, extreme band, popularity, percentile, affinity, frontier, algorithm...) plus the words score, rank, popular; band, floor, reach, stretch, anchor, signal, pool and weight alone are fine. Praise is only evaluative words (great, masterpiece, ...); love, roots, heritage, derived are fine; influence/inspiration/lineage words are refused in model text. Names are masked as whole names and as their words of 4+ letters, on word boundaries, names under 3 chars ignored; masking also happens before the restatement check; lineage restatement is compared after folding. New: invented descriptive words (more than 2 words that come from no theme tag, pick-only tag, user's why, path name, distance word or the neutral vocabulary in text.ts), years and decades, and singular/plural against the number of themes.
Fallback text is honest and agrees in number: "<seed> and <pick> share the theme(s) <tags>. Seeing <tags> <in film / on TV / among places to eat and go / in a second work> may help you notice it/them in <seed>." and `different` built from the pick-only tag names ("also carries X, which is not among the themes in your profile") plus the distance words, or "The link runs only through <tags>; the rest of <pick> may differ." A pick whose path names no theme gets no card (left out, recorded). The sourced lineage claim is code-written from the hop's label, completing "<pick> ...": "Qloo lists <pick> as having influenced <names>." (or influenced by / a similar brand to / based on / inspired by), omitted when the source is unknown; it opens the card text when the retrieved names include one of the user's seeds, else it follows the model's sentences.

### Budgets
- Qloo per run: 0 profile calls + 6 pools + at most 2 re-queries = 8 live at most (limit 12). Repeat of the same profile: 0 live. With the returned `plan` this no longer depends on the model-reply cache: themes and re-queries replay, so the requests are identical (tested with an empty model cache and a model that would have answered differently).
- Anthropic per run: at most 8 (1 themes + at most 1 review + at most 1 per domain for cards), now ENFORCED at runtime (`limitCalls` wrapper, `LLM_MAX_CALLS_PER_RUN`; every call counts, cache hits too). A closed gate costs 0. A replay with a plan makes no themes or review call. Each call: 30 s timeout, `redirect: error`, forced tool call, bounded `max_tokens`, replies cached in memory by input hash (300 entries). Status-only errors, no key anywhere. No `temperature` is sent. No ANTHROPIC_API_KEY means no calls and the full deterministic path.
- Model usage is not a `TraceEvent` kind. It is in the internal `RunResult.meta` only (not public).

### Tunables for the manager (src/lib/agent/run-constants.ts; proposed config.ts names are the same)
Run shape: `RUN_PICKS_PER_BAND = 2`, `RUN_POOL_CONCURRENCY = 3`, `RUN_MAX_CONCURRENT = 3`. Re-query: `REQUERY_POPULARITY_STEP = 0.15`, `REQUERY_POPULARITY_MIN = 0.2`, `OBVIOUS_POPULARITY_RANK = 0.75`, `OBVIOUS_TAG_DISTANCE_MAX = 0.3`, `OBVIOUS_SHARE = 0.6`. Model: `LLM_MAX_CALLS_PER_RUN = 8`, `LLM_TIMEOUT_MS = 30000`, `LLM_PLAN_MAX_TOKENS = 900`, `LLM_REVIEW_MAX_TOKENS = 500`, `LLM_EXPLAIN_MAX_TOKENS = 2400`, `LLM_EXPLAIN_CONCURRENCY = 3`, `LLM_CACHE_MAX = 300`. Text: `REASON_MAX_CHARS = 140`, `WHY_MAX_CHARS = 380`, `DIFFERENT_MAX_CHARS = 260`, `RESTATE_OVERLAP = 0.7`, `FALLBACK_TAGS_SHOWN = 3`, `MAX_UNKNOWN_WORDS = 2`, `MIN_CHECKED_WORD_CHARS = 4`, `MIN_MASKED_NAME_CHARS = 3`, `SCHEMA_REASON_MAX = 200`, `SCHEMA_WHY_MAX = 500`, `SCHEMA_DIFFERENT_MAX = 400`. Path details: `PICK_ONLY_MIN_RARITY = 0.5`, `MAX_PICK_ONLY_TAGS = 3`, `DISTANCE_TAG_DISTANCE_MIN = 0.6`, `DISTANCE_OBSCURITY_MIN = 0.6`, `MAX_TAGS_PER_OPTION = 6`, `MAX_THEME_TAGS_IN_INPUT = 5`, `MAX_WHY_CHARS_IN_PROMPT = 160`. Request: `RUN_MAX_BODY_CHARS = 150000`, `RUN_MAX_EXCLUDE = 200`, `RUN_MAX_TAGS = 120`, `RUN_MAX_AXES = 12`, `RUN_MAX_SEEDS = 10` (same as profile MAX_SEEDS), `RUN_MAX_PLAN_REQUERIES = 2` (same as MAX_REQUERIES_PER_RUN), `RUN_MAX_PLAN_ID_CHARS = 200`. Stream: `SSE_HEARTBEAT_MS = 12000`. The `too_obvious`, distance and unknown-word thresholds are untuned (no recorded pool or real model output yet). The neutral vocabulary list in text.ts is text, not a number.

### Qloo calls (for qloo-param-auditor)
None added. The only call is `client.insights` through T-08's `buildPool`, with T-08's exact param set. A re-query changes only the seed weights (via `focusTagIds`) or lowers `filter.popularity.max`. The preflight only validates, it sends nothing. Live use waits for the manager to open the POST body gate.

### Decisions I made (manager please check)
1. Re-query actions are limited to tighten popularity or lean seed weights toward another axis (tags-as-signal and exclude-tags need unconfirmed body params). Reason-specific order: `too_obvious` tightens; `empty` never tightens; the others lean first.
2. 4 bands x 2 picks per domain, calibration included (`RUN_PICKS_PER_BAND`).
3. Forced single-turn tool calls, not a free multi-turn tool loop.
4. The plan carries `axisId` per domain and the executed re-queries (plus informational `leadSeedIds`); code recomputes the seed weights from `axisId`, so the plan holds ids and words, no weights. A replay ignores anything it cannot honour (axis not offered, popularity out of range).
5. `pickOnlyTags` treats "the seed side" as the whole profile tag set (taste analysis is one call over all seeds, so there is no per-seed tag list).
6. Public anchor keeps its honest `source` with `contribution: null` (see Rule 7 consequences).
7. The `requery` event is held until the second pool's result is known, so its text can say whether the first results stayed. The second pool's `qloo_call` event, which the client emits as it happens, therefore comes before the `requery` event in the stream.

### For T-14, T-15, T-16
- T-16: render from structured fields. `score` has no popularity in public data. `requery.paramChanges` values are words or strings; `requery.say` says whether the new results replaced the first. `choose_theme.reason` is model-written but checked.
- T-15: a card's `why` may open or end with a separate sentence "<Source> lists <pick> as ..." when the path has a lineage hop (always sourced); that hop is also in `path.hops` with its badge. Qloo-sourced hops carry `sourceLabel: "Qloo"` and no link; Wikidata hops link `sourceUrl`. `path.pickOnlyTags` are Qloo tag ids and `path.distance` words may be shown as words only.
- T-14: send `plan` back unchanged on a repeat view, `exclude` on "show more". Pick ids are `pick-<qlooId>`. Skip `: keepalive` lines.

### Known gaps
- Same-creator or franchise diversity (domain-coverage) is not enforced: the pool has no creator field.
- Lineage matching uses the user's `typed` seed text (the matched entity label is not in `TasteSession.seeds`).
- The abort signal cannot be passed into the Qloo client (no parameter), so an in-flight Qloo call finishes; no further call or model call starts.
- Replay needs the client to send the plan back and the Qloo cache to hold the pools; with no plan, a repeat still depends on the in-memory model-reply cache for identical weights.
- `maxDuration` is 120 s; a host with a lower function limit (T-20) needs this lowered or the run split. No per-user rate limit beyond 3 concurrent runs (T-20).
- Never run against a real model or real Qloo data: the prompt, the neutral vocabulary and the strict text checks (which will refuse some real sentences and fall back to the deterministic text) need tuning from recorded private runs.
- Observed, not mine: `.env.example` shows as deleted in `git status` (as before).

### Round 2 (what changed)
Rule 7 stripping (1); pick-only tags, distance hints and the user's why in the explain input (2); prompt rewrite (3); validator false refusals fixed (4); invented-description check (5); honest fallback and lineage sentences, empty-theme guard, nicer field phrases (6); run plan returned and accepted (7); preflight before any model call (8); runtime model-call cap (9); abort checks per domain and per card, signal to the model client (10); SSE heartbeat and cancelled-request check (11); `requery` says whether the first results stayed (12); inline numbers moved to run-constants.ts (13).
