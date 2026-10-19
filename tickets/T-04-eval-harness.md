# T-04: Eval harness and first scorers

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-03

## Goal
A runner that replays a trace against scorers, with synthetic fixtures and the first three scorers, so every later behavior change can be measured.

## Owns
- evals/harness/
- evals/fixtures/
- evals/run.ts
- evals/scorers/repo-hygiene.ts
- evals/scorers/param-validity.ts
- evals/scorers/call-budget.ts
- evals/scorers/index.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/scorers.md
- src/types/
- src/lib/qloo/registry.ts

## Skills
- atelier-evals

## Done when
- [x] `npm run evals` runs every registered scorer on the synthetic fixtures and prints pass/fail per scorer. It exits non-zero on any failure
- [x] `npm run evals:live` exists. It refuses to run unless `QLOO_LIVE=1`, and it prints the expected number of live calls first. Recordings go to `.qloo-private/evals/`
- [x] The `repo-hygiene` scorer fails on any tracked file containing a non-synthetic UUID, a `urn:tag:` id with a value part, a `hack_` key, or raw Qloo JSON
- [x] The `param-validity` scorer checks every `qloo_call` event against the registry
- [x] The `call-budget` scorer fails a run with more than 12 live calls, a repeat view with more than 0, or more than 2 re-queries
- [x] Fixtures are synthetic and match the item shapes described in `docs/spike-report.md`. A fixture-shape test proves the T-03 parsers read them
- [x] CLAUDE.md eval commands are given to the manager in the handoff (the manager writes them)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- repo-hygiene
- param-validity
- call-budget

## Qloo calls
- none

## Handoff
Status: done (revision 2, after code review). Zero Qloo calls. Only `evals/` and this ticket were edited this round.

**Manager: one script change needed (item 4).** `vitest.config.ts` sets `passWithNoTests: true`, so if `evals/harness/evals.cli.test.ts` were ever deleted or renamed, `npm run evals` would exit 0 with nothing run. Add the flag to both scripts (checked: with it the missing-file case exits 1):
```
"evals": "ATELIER_EVALS_RUN=1 vitest run evals/harness/evals.cli.test.ts --reporter=verbose --passWithNoTests=false",
"evals:live": "ATELIER_EVALS_LIVE=1 vitest run evals/harness/live.cli.test.ts --reporter=verbose --passWithNoTests=false"
```

**Review fixes**
1. `repo-hygiene` UUIDs: a hyphen next to an id no longer hides it (`movie-<uuid>`, `<uuid>-x`); hex adjacency is still respected so a longer hex run (sha256) is not an id. Added a dashless 32-hex rule (only the synthetic id without dashes passes). Case-insensitive, tested uppercase. `package-lock.json` does not trip it.
2. Secrets: `sk-ant-...` (20+), JWT shape, `hack_` case-insensitive (8+ alnum, which covers `hack_[0-9a-f]{10,}`), and any non-placeholder value assigned to `QLOO_API_KEY`, `ANTHROPIC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` (`=`, or `:` with a quoted value or a 20+ char token). Placeholders (`your-...`, `synthetic...`, `test...`, `fixture...`, `example`, `placeholder`, `changeme`, `xxx`, `<...>`, `$...`, `process.`/`env.` expressions, `undefined`, `null`, empty) pass. An unquoted `NAME: identifier` under 20 chars is treated as code (`QLOO_API_KEY: undefined`, type fields), not a secret. `X-Api-Key` keeps its 20+ char rule. `.env.example` passes.
3. `call-budget`: a live attempt that failed still counts. `isLiveCall` is true for `source:"live"`, or `source:"none"` with a `status` (failed after sending). Network failures with no status are caught by the client's `runLiveCalls`: `live = max(live-attempt events, max runLiveCalls)`. A repeat view fails on any live attempt. Pre-send refusals (`source:"none"`, no status, runLiveCalls unchanged) are not live. New negative fixtures: `over-budget-errored-attempt` (12 good calls plus a 504), `repeat-view-errored-attempt` (network error, no status). Unit-tested for each variant. Now 13 cases.
4. `npm run evals` cannot pass silently: `evals.cli.test.ts` and `live.cli.test.ts` now fail (not skip) when reached through the matching npm script (`npm_lifecycle_event`) without their env var. When it runs, it asserts `caseCount > 0`, that the reported scorers equal the registered ones, that each trace scorer ran every case, and that every trace scorer has at least one positive and one negative case. Plain `npm test` still skips both files.
5. Tracked `.png/.jpg/.jpeg/.webp/.gif` fail (`image`) unless the allow list has an `image:<path prefix>` entry in `evals/harness/hygiene-allow.txt` (none added). Files that cannot be scanned (binary, over 2 MB, unreadable; images excluded) produce a non-failing `WARNING: n file(s) not scanned ...` note, printed under the repo-hygiene line.
6. Under `evals/fixtures/`, every non-empty `name`, `title` and `label` string in a Qloo-shaped JSON file must contain fixture, invented or synthetic.
7. URL-encoded `urn%3Atag%3A` ids (either case) are decoded before the tag rule.
8. Removed the unused `errorKind` from `isLiveCall`.

**Checks run:** `tsc --noEmit` clean, `eslint evals` clean, `vitest run` 365 passed and 3 skipped, `npm run evals`: 3/3 scorers over 13 cases (repo-hygiene scanned 182 files and about 21k added history lines, no warnings), exit 0. Without the env var through the script path the evals and live entries exit 1. `npm run evals:live` without `QLOO_LIVE=1` exits 1 after printing the expected count.

**Earlier handoff (still true):** trace fixture format, scorer registration, decisions on param-validity (inherits the POST body gate in `registry.ts`; a refused `param_invalid` call still fails; an empty 200 on insights or tags fails, an empty `/search` passes) and the hygiene allow-list location (`evals/harness/hygiene-allow.txt`, one entry kept because it is in git history at 7e0b124). Files: `evals/run.ts`; `evals/scorers/{repo-hygiene,param-validity,call-budget,index}.ts`; `evals/harness/*`; `evals/fixtures/{cases.json,traces/,qloo/}`. Case file `expect` shape: `"pass" | "fail" | { "fail": "text that must appear in a reason" }`; unlisted scorers expect pass. To register a scorer, export a `TraceScorer` or `RepoScorer`, add it to `SCORERS` in `evals/scorers/index.ts`, and add at least one positive and one negative case (the CLI test enforces this for trace scorers).

**Known gaps:** `evals/history.md` is not created (outside `Owns`). No live suites yet. `filter.tag.types` values cannot be checked after the client's redaction. The `X-Api-Key` rule needs 20+ chars; short real-looking values after it are not caught.
