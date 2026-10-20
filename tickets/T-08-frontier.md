# T-08: Frontier scoring, bands and dial

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-07

## Goal
Score one candidate pool per domain for reach and connection, bucket it into calibration, moderate, high and extreme, and enforce the connection floor and fallback order, all in code.

## Owns
- src/lib/frontier/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-agent-loop/references/scoring.md
- docs/spike-report.md (probes 6, 10, 11, 18)
- src/lib/agent/config.ts
- src/types/

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] `buildPool(domain, profile, exclusions)` makes ONE insights POST per domain (`take=50`, `filter.popularity.max=POOL_POPULARITY_MAX`, `feature.explainability`, seeds weighted toward the axis being explored, all seeds and shown picks excluded)
- [ ] Reach uses popularity ranked within the pool (not absolute values; brand popularity 0 counts as unknown), tag distance and field unfamiliarity. Connection uses shared rare tags, bridge tags, explainability (anchor seed = top scorer) and lineage when present. Cross-domain presence alone is never counted as connection (backfill is invisible)
- [ ] Bands are computed from one pool: calibration (highest affinity and popularity), then moderate, high, extreme by reach. Every shown pick clears `CONNECTION_FLOOR`. An empty band relaxes reach one band, never connection, and says so in the trace
- [ ] No band ever triggers its own Qloo call
- [ ] Tests: the dial-behavior, reach-margin and connection-floor scorers pass on synthetic fixtures
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- dial-behavior
- reach-margin
- connection-floor
- call-budget

## Qloo calls
- /v2/insights POST: filter.type, signal.interests.entities [{id, weight}], filter.popularity.max, filter.exclude.entities, feature.explainability, take

## Handoff
Zero live Qloo calls (no .env or .qloo-private read; every test injects a fake `insights`). 67 tests in src/lib/frontier on synthetic fixtures. Lint and `npm test` (645 pass) pass; typecheck is clean for src/lib/frontier (the only errors are in src/lib/db/auth.test.ts, another worker's); `npm run evals` passes all three scorers. Revised after review (relax order, margin re-check, wording, tests, NEUTRAL_OBSCURITY).

### Files (all under src/lib/frontier/)
`index.ts` (public API), `pool.ts` (buildPool), `score.ts` (scorePool), `bands.ts` (bucket, selectBands, bandsForDial), `types.ts`, `stats.ts`, `constants.ts`, `fixtures.ts` (test-only), `pool.test.ts`, `score.test.ts`, `bands.test.ts`, `scorers.test.ts`.

### API (`@/lib/frontier`)
```ts
buildPool(domain: Field, ctx: FrontierContext, exclusions: Exclusions, deps: PoolDeps, options?: PoolOptions): Promise<Pool>
scorePool(pool: Pool, ctx: FrontierContext, options?: ScoreOptions): ScoredPool          // pure, no calls
selectBands(scored: ScoredPool, options: SelectOptions): BandSelection                  // pure, no calls
bucket(scored: ScoredCandidate[]): Map<qlooId, Band>                                    // floor-clearing only, by reach quantile
bandsForDial(dial): Band[]   // develop [], match [calibration, moderate], stretch [high, extreme]
EDGE_BANDS                   // [moderate, high, extreme]
withPoolRarity(profileTags, scored.tagRarity): ProfileTag[]   // fills ProfileTag.rarity, pool-relative
```
- `FrontierContext = { profile: Profile; seeds: ProfileSeed[] }`. The ticket's `buildPool(domain, profile, exclusions)` got a `ctx` because `Profile` holds seed ids, not seeds. T-10 passes the same `ProfileSeed[]` it gave `buildProfile`.
- `Exclusions = { entityIds }` (shown picks). Every seed with a `qlooId` is excluded automatically.
- `PoolDeps = { insights: InsightsFn; emit?; now? }`. `InsightsFn` is `(params, {purpose}) => Promise<QlooResponse<InsightsEntity>>`, so `client.insights` fits as is (pass `client.insights.bind(client)` if it needs `this`; it is a closure today). Always called with `purpose: "picks"`.
- `PoolOptions = { focusTagIds?, popularityMax? }`. `focusTagIds` are ids of the profile tags on the axis being explored (an `Axis.tags[].tag`); seeds carrying one (`ProfileTag.fields` includes the seed's field, or the seed's own `whyTags`) weigh `SEED_WEIGHT_ON_AXIS`, the rest `SEED_WEIGHT_OFF_AXIS`; all are still sent. `popularityMax` is the re-query action "tighten filter.popularity.max". Other re-query actions (theme tags, exclude tags) need body params that are not confirmed yet and are not built here.
- `Pool = { domain, entityType, candidates: Candidate[], outcome: "ok" | "empty", sentSeedIds, popularityMax, returned, droppedExcluded, droppedMalformed, explainabilityPresent, events }`. `outcome: "empty"` means no usable entity: the loop re-queries with reason `empty`. Throws `FrontierInputError` (`no_seeds` | `bad_domain`) before any call; client errors (budget, param, HTTP) pass through.
- `ScoredCandidate = { candidate, reach: ReachParts, connection, popularityRank (null = unknown), path: Path | null, clearsFloor }`. `ScoredPool = { domain, scored, tagRarity, signals, events }`; `signals = { scored, clearedFloor, distinctive, thin, clearedMedianReach, clearedMedianPopularity }` (numbers for the loop's re-query decision: `empty` = 0 scored, `too_weak` = `thin`, `weak_connection` = none distinctive; `too_obvious` is left to the loop, see gaps).
- `BandSelection = { domain, picks: FrontierPick[] (lowest band first), byBand, emptyBands, thin, clearedCount, dial: { matchMedianPopularity, stretchMedianPopularity }, events }`. `FrontierPick = Omit<Pick, "card">`: `id` is `pick-<qlooId>`, `llmBridged: false`, `origin` is `unknown`, `path` is a full `Path` (passes `isPath`). T-10 adds the `card`.
- Call `selectBands` ONCE per domain with every band the run will show (for example `["calibration", ...EDGE_BANDS]`). The reach margin is enforced between the bands in that call, so separate calls could show bands that are too close.

### Qloo call added (for qloo-param-auditor)
Exactly one per `buildPool`: `POST /v2/insights` with `filter.type` (FIELD_SEARCH_TYPE of the domain), `signal.interests.entities` `[{id, weight}]`, `filter.popularity.max` (POOL_POPULARITY_MAX, or the override), `filter.exclude.entities` (all seeds plus shown picks), `feature.explainability: true`, `take` (POOL_TAKE). Nothing else; no `bias.trends`. Tests run these params through `prepareInsights` for all six types with the three body params added to a COPY of the registry's `confirmedBodyParams`, and assert that with today's registry exactly those three are refused as `body_unconfirmed`. **Live use waits for the manager to open the POST body gate** (`POST_BODY.confirmedBodyParams` = `filter.popularity.max`, `filter.exclude.entities`, `feature.explainability`) after the user approves the 04-post-check.

### Rules as built
- Reach = `REACH_WEIGHTS` over tagDistance, obscurity, fieldUnfamiliarity. Obscurity = 1 - popularity mid-rank percentile within the pool (ties share a rank); popularity 0 or missing is unknown: neutral 0.5 and left out of the ranking. fieldUnfamiliarity = 1 - share of the sent seeds in the candidate's field. tagDistance = 1 - weighted overlap, measured over the profile tags whose `types` include the candidate's entity type (all tags if none do). Decision: a tag that cannot apply to a type should not count against it.
- Rarity = 1 - (share of the pool carrying the tag). Connection = `min(1, sum(weight * rarity)) / CONNECTION_NORM`, clamped 0..1, plus `LINEAGE_CONNECTION_WEIGHT` when a valid sourced lineage hop is supplied. Only shared profile tags count; presence in the results never does. In a field with no sent seed, a shared tag counts only if the profile marks it `bridge` or its `types` include the candidate's type. A shared tag every candidate carries (rarity 0) adds nothing and is not in `sharedTags`.
- Distinctive = a counted shared tag at rarity >= DISTINCTIVE_RARITY or a sourced lineage hop. `clearsFloor` = has a path, distinctive, connection >= CONNECTION_FLOOR. Never relaxed.
- A path needs at least one shared tag (the contract is seed > theme > [lineage] > pick), so lineage adds to connection but never replaces a shared tag. Hops: seed (inferred), theme (inferred, `tags` = all shared), optional lineage (as supplied), pick (inferred). Pass lineage as `ScoreOptions.lineage: Map<pickQlooId, PathHop>`, the one hop from T-09's `lineageTouchingSeeds`; a hop that is not `lineage`, not `sourced` or has no `sourceUrl` is ignored. It is for finalists, so re-run `scorePool` with it for them.
- Anchor: top explainability contributor among the seeds sent (`qloo_explainability`, `thin` below MIN_ANCHOR_CONTRIBUTION; entities that are not sent seeds are ignored). Otherwise the seed carrying the most shared-tag contribution (`ProfileTag.fields` or the seed's `whyTags`), ties by why-tag matches then seed order, labelled `tag_overlap` with `contribution: null`. If no seed carries any shared tag, the first sent seed is used: the profile has no per-seed attribution (known gap).
- Bands: quantiles of reach among floor-clearing candidates only (`BAND_EDGES`). Per requested band, lowest first: picks must reach at least `MIN_REACH_MARGIN` above the median reach of the picks shown in the nearest band below. Calibration shows highest affinity then popularity (the band is the lowest reach quantile, ordered by affinity then popularity); other bands show the most defensibly connected first. The order only picks which to show and is never stored as a score.
- Dial guard: a Stretch pick (high, extreme) with a known popularity must be below the median popularity of the Match picks (calibration, moderate) chosen in the same call. In a Stretch-only call (the dial shows one setting at a time) the reference is the Match picks this pool would give, and the guard applies to every pick in that call, relaxed extras included. Unknown popularity (0) is exempt. When tag distance and popularity disagree this can leave Stretch thin (see the `disagreeingPool` fixture), and it never lowers the floor to compensate.
- Relax: an empty band steps down the FULL order (extreme, high, moderate, calibration), not only requested bands, so Stretch's lowest band (high) can relax into moderate. One `relax` event per step (`from` to the next lower `to`), the first step with unused picks fills the slot, each pick keeps its true band (so `byBand` can hold a band that was not requested). If nothing is left to show, one more `relax` event with `from === to` says the band stayed empty (there is no dedicated trace kind in src/types; a `stayed_empty` variant would be cleaner, manager's call). Extras are added only as far as the whole selection stays valid: the reach margin between every pair of neighbouring bands (bands above the extras included) and the dial guard are re-checked, and the extras are trimmed or refused otherwise. A randomized test over 300 pools checks the margin, duplicates, floor and dial order, and was confirmed to fail with the re-check removed.
- Relax text is the approved shape: "Nothing connected strongly enough at the extreme band, so showing high." (calibration reads as "close"); the stayed-empty text is "Nothing connected strongly enough at the extreme band, and nothing nearer to show instead." `say` and `reason` carry the same sentence and contain no internal terms.
- `origin` stays `unknown` for every candidate and pick, and `query_insights.primaryCount` and `backfillCount` are 0: nothing in Qloo's response marks backfill (probe 18), so nothing is derived. Domain coverage is protected by requiring every shown pick to clear the floor.
- Trace events emitted: `query_insights` (params with ids as counts, like the client's own trace), `score`, `relax`. Callers add `choose_theme`, `requery`, `fetch_refs`.

### Tunables for the manager (src/lib/frontier/constants.ts, proposed for config.ts under the same names)
`SEED_WEIGHT_ON_AXIS = 1`, `SEED_WEIGHT_OFF_AXIS = 0.3`, `LINEAGE_CONNECTION_WEIGHT = 0.4` (clears the 0.3 floor alone), `NEUTRAL_OBSCURITY = 0.5`, `REACH_EPSILON = 1e-9` (technical). Everything else comes from config.ts: no existing constant was changed. `THEME_LABEL_TAGS = 3` (names in the theme label) is a local structural constant in score.ts.

### For T-10 (read this)
- `Pool.outcome === "empty"` is the `empty` re-query reason. `ScoredPool.signals.thin` is `too_weak`; no distinctive path among the scored is `weak_connection`.
- A relaxed band still appears in `BandSelection.emptyBands` (it had no pick of its own), even though its slot was filled from a lower band; read the `relax` events for what happened. A relax event with `from === to` means the band stayed empty.
- `Pick.reach`, `Pick.connection` and `Pick.popularity` must NEVER be rendered or sent to a card or explanation (hard rule 7: no scores, rankings or audience metrics). They exist for code and evals only. The explanation reads the path.
- Call `selectBands` once per domain with every band the run shows, but for the dial's separate Match and Stretch views a Stretch-only call is also consistent (see the dial guard).

### Scorer tests (T-19 owns the real scorers)
`scorers.test.ts` encodes dial-behavior, reach-margin and connection-floor from scorers.md and runs them through buildPool > scorePool > selectBands on a 40-candidate tiered pool at every dial setting and the edge set, with negative cases for each. A second fixture (`disagreeingPool`) has tag distance and obscurity disagree (asserted in the test) and still passes dial-behavior. The relaxed-floor test asserts a relax event occurred. The one-call-per-pool rule is tested in pool.test.ts (`buildPool` makes exactly one call); `scorePool` and `selectBands` take no client, so there are no call-count tests for them.

### Known gaps
- The dial popularity order is enforced per pool (Stretch picks with a known popularity are below the Match median of the same pool), not across domains: the union of several domains' picks is not checked, and a Match pick can be shown by one call and the same entity by another (T-10 should exclude shown picks, as it already must).
- `too_obvious` has no computed signal here (no threshold for "mostly high-popularity, high-overlap or same creator or franchise"); `signals` gives medians for the loop. Same-creator and one-pick-per-franchise diversity (domain-coverage) is not handled here: the pool has no creator field, so T-10 or T-19 must do it from `Candidate.lineage` or names.
- Qloo entity-item property shapes for lineage names are undocumented; `toCandidate` tolerates strings and `{name}` objects and keeps names only (`Candidate.lineage`).
- No per-seed tag attribution exists (taste analysis is one call over all seeds), so the `tag_overlap` anchor is coarse: it goes by `ProfileTag.fields` and why tags.
- Not run against real data: tuning of `SEED_WEIGHT_OFF_AXIS`, the lineage weight and the band edges waits for a recorded pool.
