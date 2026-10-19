# T-02: Shared contracts and agent constants

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-01

## Goal
Typed contracts every other ticket builds against (Seed, ProfileTag, Axis, Candidate, Path, Card, Pick, TraceEvent, Band), plus the first version of the tunable constants.

## Owns
- src/types/
- src/lib/agent/config.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-agent-loop/references/path-and-card-schema.md
- .claude/skills/atelier-agent-loop/references/scoring.md
- docs/spike-report.md (the Item fields section)

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] `src/types/` exports Seed (with `status: clean | ambiguous | missing` and candidates), ProfileTag (with `tagType`, `affinity`, `types[]`), Axis (with its member tags), Candidate, Path (seed -> shared theme -> optional lineage hop -> pick, each hop with `provenance: sourced | inferred`), Card (four parts), Pick, Band (`calibration | moderate | high | extreme`) and TraceEvent (one variant per event in the atelier-evals trace format, including `qloo_call` with `cached` and `endpoint`)
- [ ] The types match the path-and-card schema reference. Any change to that schema is listed in the handoff
- [ ] `src/lib/agent/config.ts` holds the reach weights, the connection floor, band edges, `MAX_REQUERIES_PER_RUN = 2`, `MAX_LIVE_CALLS_PER_RUN = 12`, `POOL_TAKE = 50`, `POOL_POPULARITY_MAX = 0.6`, each with a one-line comment
- [ ] Typecheck passes. There is no runtime code beyond constants and type guards
- [ ] A unit test covers each type guard
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- none (contracts only)

## Qloo calls
- none

## Handoff
Files: `src/types/{field,seed,profile,candidate,path,card,trace,guards,index}.ts`, `src/types/guards.test.ts` (20 tests, also covers config sanity), `src/lib/agent/config.ts`. Import everything from `@/types` (barrel) and config from `@/lib/agent/config`. typecheck, lint and test pass. No runtime code beyond `as const` lists, constants and type guards. No Qloo data; fixtures use invented names and ids.

### Exported types (src/types)
- `Field` = music | film | tv | books | food_places | fashion (`FIELDS`). `Band` = calibration | moderate | high | extreme (`BANDS`). `Provenance` = sourced | inferred (`PROVENANCES`). `Origin` = primary | backfill | unknown (`ORIGINS`).
- `Seed`: id, field, typed, why, qlooId (string | null), `status: SeedStatus`, candidates?: `SeedCandidate[]` ({qlooId, label}). `SeedStatus` = clean | ambiguous | missing (`SEED_STATUSES`).
- `ProfileTag`: tag (Qloo tag id), name, tagType, affinity, types[], weight, fields[], source (`ProfileTagSource`: taste_analysis | seed_detail | why_search), bridge? (true when `types` include an entity type other than the seed's own), rarity? (pool-relative, optional).
- `Axis`: id, label, labelJustification (required: why the label follows from its tags), weight, tagType, tags: ProfileTag[] (guard requires >= 2).
- `Candidate`: qlooId, name, field, entityType, popularity, tags: `CandidateTag[]` ({id, name, type}; always `id`, normalised from search `tag_id`), affinity?, explainability?: `ExplainabilityEntry[]` ({entityId, score}), origin, lineage?: string[].
- `PathHop`: kind (`HopKind`: seed | theme | lineage | pick), label, tags?, provenance, sourceUrl? (required when sourced). `PathAnchor`: contribution (number | null), source (`AnchorSource`: qloo_explainability | tag_overlap), thin?. `Path`: seedId, anchor, hops, sharedTags, distinctive.
- `ReachParts`: tagDistance, obscurity, fieldUnfamiliarity, reach. `Card`: path, why, different, provenance (`ProvenanceCounts` {sourced, inferred}), reading? (`CardReading` {text, sourceUrl}), reaction? (`Reaction` {state: `ReactionState`, words?, at}). `Pick`: id, qlooId, name, field, popularity, reach, connection, band, llmBridged, origin, path, card.
- `TraceEvent` = union on `kind`, every variant has `t`, `say`. Variants: `QlooCallEvent` (qloo_call: endpoint, method: 'GET' | 'POST', cached, entityType?, status?), `ResolveSeedEvent` (seedId, status, candidateCount), `ExtractTagsEvent` (field, tagCount), `BuildAxesEvent` (axisIds, tagCounts), `MapWhyEvent` (seedId, tagIds, semanticSearch), `ChooseThemeEvent` (themeTags, reason), `QueryInsightsEvent` (domain, endpoint, params, resultCount, explainability, primaryCount, backfillCount; Qloo has no backfill marker, so only T-08 derives primary vs backfill and `Origin` defaults to `unknown`), `ScoreEvent` (domain, scored, clearedFloor, popularity {min, median, max}), `RequeryEvent` (domain, reason: `RequeryReason`, paramChanges), `FetchRefsEvent` (pickIds, sourcedCount, inferredCount, sourceUrls?), `RelaxEvent` (relaxed: 'reach_band', from: Band, to: Band, reason), `ExplainEvent` (pickId). Also `TraceEventKind`, `TRACE_EVENT_KINDS`, `QlooEndpoint` (/search | /v2/tags | /v2/insights | /entities; `QLOO_ENDPOINTS`), `RequeryReason` (too_obvious | too_weak | empty | weak_connection; `REQUERY_REASONS`).
- Guards: isField, isBand, isProvenance, isOrigin, isSeedStatus, isSeed, isProfileTag, isAxis, isPathHop, isPath, isCard, isTraceEventKind, isTraceEvent. Guards are structural plus a few invariants: clean seed has qlooId, ambiguous seed has 2+ candidates, sourced hop has sourceUrl, explainability anchor has a contribution, path hops are seed>theme>[lineage]>pick, axis has 2+ tags and a labelJustification, a lineage hop is always `sourced` (hard rule 6), `card.reading.sourceUrl` is non-empty, and `card.provenance` counts are non-negative integers. They do not check cross-field equality (card.path vs pick.path, card.provenance vs hop counts); the `provenance` scorer does that.

### config.ts (src/lib/agent/config.ts)
`REACH_WEIGHTS` {tagDistance 0.45, obscurity 0.35, fieldUnfamiliarity 0.2}, `CONNECTION_FLOOR` 0.3, `CONNECTION_NORM` 1, `DISTINCTIVE_RARITY` 0.6, `MIN_ANCHOR_CONTRIBUTION` 0.25, `BAND_EDGES` {calibration 0.25, moderate 0.6, high 0.85}, `MIN_REACH_MARGIN` 0.05, `MIN_PICKS_PER_FIELD` 3, `MAX_REQUERIES_PER_RUN` 2, `MAX_LIVE_CALLS_PER_RUN` 12, `POOL_TAKE` 50, `POOL_POPULARITY_MAX` 0.6. CONNECTION_FLOOR, DISTINCTIVE_RARITY, MIN_ANCHOR_CONTRIBUTION, MIN_REACH_MARGIN, MIN_PICKS_PER_FIELD and CONNECTION_NORM are placeholders I picked (the docs name them but give no value); T-08 should tune them against real data. The last four constants beyond the ticket's list are there because the scoring reference and scorers name them.

### Changes from path-and-card-schema.md (the reference file is not edited; manager may update it)
- `Seed.resolution: resolved | ambiguous | missing` became `Seed.status: clean | ambiguous | missing`, per this ticket and T-05. `resolve_seed` event carries `status` (not `resolution`). The `seed-resolution` scorer text says `resolved`; it should read `clean`.
- `ProfileTag.appliesTo` renamed `types`; added `tagType` and `affinity`; `rarity` is optional (it is pool-relative).
- `Axis` gained `tagType`. `PathAnchor` gained optional `thin`. `Seed.candidates` is typed `SeedCandidate[]`.
- `Pick.origin` and `Candidate.origin` use the shared `Origin` type. Added `Candidate` (not in the reference) and the `qloo_call` event (named in the evals skill, not in the reference table).
- `relax` event is restricted to reach bands (connection can never be relaxed).

### Known gaps and notes
- `npm run typecheck` currently reports one error in `src/lib/qloo/types.ts` (another worker's file, in progress); nothing in `src/types` or `config.ts` errors.
- `Candidate.lineage` is names only; T-09 may need a richer shape and should ask for a contract change.
- Event `say` is free text; no length limits.
