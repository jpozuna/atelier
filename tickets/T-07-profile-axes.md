# T-07: Profile and axes from taste analysis

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-05

## Goal
Build the taste profile from resolved seeds and their reasons: one taste-analysis call gives scored tags, each "why" maps to tags, and tags group into 6 to 8 axes by tag type, each listing its tags.

## Owns
- src/lib/profile/
- src/app/api/profile/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- docs/spike-report.md (probes 7, 15, 22, 24)
- .claude/skills/atelier-agent-loop/references/scoring.md (Axes)
- src/lib/qloo/
- src/types/

## Skills
- atelier-agent-loop
- qloo-api
- atelier-evals

## Done when
- [ ] A profile build makes exactly 1 taste-analysis call with all seeds (`take=50`), plus 1 semantic `/v2/tags` call per new "why" (cached, deduped by tag name)
- [ ] Tags are grouped into axes by `subtype` (tag type), weighted by `query.affinity`. Generic tags are dropped (present in most of the pool), axes with fewer than 2 tags are dropped, and 6 to 8 axes are kept. Each axis stores its member tags
- [ ] Axis names come from an LLM call that sees only that axis's tags, and the label must be justified by listed tags (stored with the axis). No tag is invented: every tag id comes from Qloo
- [ ] Bridge tags (a tag whose `types` include another domain's entity type) are flagged for T-08 and T-10
- [ ] `POST /api/profile` returns the profile and axes and emits TraceEvents for each step
- [ ] Tests run on synthetic fixtures. A scorer or test shows every axis has at least 2 Qloo tag ids and no label word missing from its tags without a justification
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
- domain-coverage

## Qloo calls
- /v2/insights (urn:tag): signal.interests.entities, take
- /v2/tags GET: filter.query, feature.semantic_search, filter.parents.types, take

## Handoff
Zero live Qloo and zero live Anthropic calls (no .env or .qloo-private read, mode never live). 44 tests in src/lib/profile on synthetic fixtures with the T-03 fake fetch and a fake Anthropic fetch. `npm run typecheck`, `lint`, `test` (457 pass) and `npm run evals` pass. Revised after review (budget split, rank-based generic drop, strict naming check, trace fields, hardening).

### Budget split (two routes)
- **`POST /api/profile/why`** (onboarding calls it when the user submits each why). Request `{ field, why, seedId? }` (body under 2000 chars, Content-Length checked first). Makes ONE cached semantic `/v2/tags` call (GET: `filter.query` = the whitespace-collapsed why cut to 120 chars, `feature.semantic_search=true`, `filter.parents.types` = the field's entity type, `take=8`). Response 200: `{ tags: WhyTag[], trace, calls? }` with `WhyTag = { tag, name, tagType }` (name-deduped, at most 5, Qloo's order, ids must be `urn:tag:`, `tagType` the `urn:tag:<kind>:<ns>` type). An empty match is a valid answer (`tags: []`). `trace` holds the `qloo_call` event and a `map_why` event (`seedId` = the given one or ""). A lookup that did not complete returns an error body `{ error: {code, message}, trace }` whose trace has `map_why.failed` = `budget` (503 `budget`), `unavailable` (503 `lookups_off` or `rate_limited`, 502 `upstream` for 5xx or network) or `error` (parse); the onboarding client should then keep the seed without `whyTags`. 400/401/403 and param or config errors are NOT treated as a failed why: they return 500 `rejected` (Qloo 400) or 500 `config`, with no trace. `lookups_off` message is generic ("Lookups are unavailable right now.").
- **`POST /api/profile`** makes exactly ONE Qloo call (taste analysis, `signal.interests.entities` = all seed ids, `take=50`, GET) and no `/v2/tags` call. Request `{ seeds: ProfileSeed[] }` where `ProfileSeed = Seed & { whyTags?: WhyTag[] }`: 1 to 10 seeds (400 above), each `isSeed`, UUID `qlooId` if set, `whyTags` at most 5 entries each `{ tag: "urn:tag:...", name (non-blank, <= 120), tagType: "urn:tag:<kind>:<ns>" }` or 400. `whyTags` absent means the why was never mapped (the build emits `map_why.failed: "unavailable"` for that seed); `[]` means nothing matched. Content-Length is checked before the body is read. The ids on `whyTags` can only be shape-checked server-side (no call), so a forged id would only ever be sent back to Qloo as a signal later, which rejects unknown ids.
- Response 200 (`Cache-Control: no-store`): `{ profile, axes, trace, calls? }`; `profile` = `{ seedIds, skippedSeeds, fields, tags (weight desc), bridgeTagIds, droppedGenericCount, droppedAxisTagTypes, axisShortfall?: {wanted, got}, naming: Record<axisId, "model"|"fallback"> }`; `axes` = shared `Axis[]`. Naming rejection reasons are internal (`BuildResult.namingRejections`), never returned. Errors: 400 `bad_request`; 422 `no_usable_seeds` (no call) and `empty_profile`; 503 `lookups_off`, `budget`, `rate_limited`; 502 `upstream`; 500 `rejected`, `config`, `internal`. Fixed messages, no Qloo text or keys.

### Tags, weights, generic, bridge
- Taste tags: `tag_id` must start `urn:tag:`; name, tag type (`subtype`, else the id's `urn:tag:<kind>:<ns>` prefix) and `query.affinity` required, else skipped. `weight = affinity`. Why/taste type format confirmed identical (manager check), so grouping by exact tag-type string is kept.
- **Why tags** enter with `source: "why_search"`, `affinity: 0` (Qloo gave none; the field is never given a made-up number), `weight = WHY_TAG_WEIGHT` (0.1, a documented constant), `types: [seed entity type]`, `fields: [seed field]`, `bridge: false`. They are exempt from the generic drop and never ranked with taste tags. They never create an axis and add nothing to an axis weight sum; a why tag whose tag type matches an axis joins it as a member. A why tag already in the pool keeps its taste entry and gains the seed's field; one dropped as generic re-enters as a why tag. **Ask for src/types:** `ProfileTag.affinity` is required, so I used 0; making it optional (or documenting 0 as "none") would be cleaner.
- **Generic drop is rank-based**: among taste tags with a known popularity (above 0; 0 is unknown), drop the top `GENERIC_DROP_TOP_SHARE` (0.2) by popularity, ties to the lower affinity first, then tag id; nothing is dropped when fewer than `GENERIC_MIN_POOL` (10) tags have a known popularity. Tested with popularity bunched at 0.99 to 1.0.
- **`ProfileTag.fields`**: the fields of the submitted seeds whose entity type is in the tag's `types` (plus the seed's own field for a why tag). Empty when the tag applies only to fields the user has no seed in.
- **Bridge rule**: a tag is a bridge when its `types` include at least one Atelier entity type (the six field types) that none of the submitted seeds has. Unlisted entity types never count. Also documented in `src/lib/profile/tags.ts`.
- Axes: group by exact tag type, an axis needs at least 2 distinct taste-analysis tags, heaviest summed taste weight first, top 8 kept (ids `axis-<slug>`), weight = share of the heaviest axis. Fewer than 6 is reported (`profile.axisShortfall`, `build_axes.axisShortfall: true`), never padded.

### Naming (strict, no escape hatch)
`checkAxisName` (`src/lib/profile/naming.ts`): label 1 to 4 words, at most 40 chars, only letters, digits, spaces and `' & : -`, at least one non-connective word, and every word in a listed tag name or the tag kind (kind = `urn:tag:` and namespace stripped; "urn", "tag", "media", "qloo" never count as kind words). Justification at most 300 chars, restricted characters, cites at least 2 distinct listed tags (names under 3 chars ignored; deduped by normalised name), and every word must be in a tag name, the kind, or the connective allowlist (`JUSTIFICATION_CONNECTIVES`, also sent in the model prompt). No stemming (exact words, accents and case aside). Any failure or error uses `fallbackNamer` and records the reason internally. One model call per axis, input `{ tagType, kind, tagNames }` only; at most `NAMER_CONCURRENCY` (3) in flight; model-named axes are remembered in memory by sorted tag-id set (`createNameCache`, bounded at 200, shared per server process in `route.ts`), so a repeat build makes 0 Anthropic calls. `createAxisNamer()` returns the fallback unless both `ANTHROPIC_API_KEY` and `ATELIER_MODEL` are set. No SDK needed.

### Trace events (all existing variants)
`qloo_call` (client `onTrace`, one in the profile build), `extract_tags` (one per seed field), `map_why` (one per seed with a why; `failed: "unavailable"` when `whyTags` is absent; the why route emits its own with `failed` per above), `build_axes` (last: `axisIds`, `tagCounts`, `droppedGeneric`, `droppedTagTypes`, `axisShortfall` boolean, `naming`). `say` strings are informational only.

### Contracts and files
`buildProfile(seeds, { client (tasteAnalysis only), namer, nameCache?, emit?, now? })` returns `{ profile, axes, namingRejections }`. `mapWhy(client, {field, why})` in `why.ts`. Handlers `handler.ts`, `why-handler.ts`; shared `http.ts`; routes `src/app/api/profile/route.ts` and `.../why/route.ts` (each only wires the client). `ProfileTag.rarity` is never set here (T-08). Qloo calls for qloo-param-auditor: taste analysis uses `signal.interests.entities` and `take` only; `/v2/tags` uses `filter.query`, `feature.semantic_search`, `filter.parents.types`, `take` (all confirmed in the registry).

### Tunables for the manager (src/lib/profile/constants.ts, proposed config.ts names)
TASTE_TAKE=50 -> `PROFILE_TASTE_TAKE`; MIN_AXES=6 -> `MIN_AXES`; MAX_AXES=8 -> `MAX_AXES`; MIN_TAGS_PER_AXIS=2 -> `MIN_TAGS_PER_AXIS`; GENERIC_DROP_TOP_SHARE=0.2 and GENERIC_MIN_POOL=10 (same names); WHY_TAKE=8 -> `WHY_TAG_TAKE`; WHY_TAGS_PER_SEED=5 -> `MAX_WHY_TAGS_PER_SEED`; MAX_WHY_CHARS=120 (same); WHY_TAG_WEIGHT=0.1 (same); MAX_SEEDS=10 -> `MAX_ONBOARDING_SEEDS`; MAX_BODY_CHARS=20000 -> `PROFILE_MAX_BODY_CHARS`; MAX_WHY_BODY_CHARS=2000; MAX_TAG_NAME_CHARS=120; MAX_LABEL_WORDS=4 -> `AXIS_LABEL_MAX_WORDS`; MAX_LABEL_CHARS=40; MAX_JUSTIFICATION_CHARS=300; MIN_CITED_NAME_CHARS=3; NAMER_MAX_TOKENS=300; NAMER_TIMEOUT_MS=15000; NAMER_CONCURRENCY=3; NAME_CACHE_MAX=200. (ANTHROPIC_URL and ANTHROPIC_VERSION are constants, not tunables.) Removed: GENERIC_TAG_POPULARITY, GENERIC_MAX_DROP_SHARE, WHY_TAG_AFFINITY.

### Known gaps
- Axes group by exact tag type only; no model merge of near-duplicates and no co-occurrence step. Naming source is only in `profile.naming` and `build_axes.naming` (no field on `Axis`).
- Taste analysis goes by GET (T-03 default), so per-seed weights are unused.
- The semantic search keeps only the first concept of a long why (spike probe 22); the onboarding UI should ask for a short reason.
- The strict naming check will reject many model answers, so most axes may fall back at first; tune the prompt and allowlist from recorded runs, not by loosening the check.
