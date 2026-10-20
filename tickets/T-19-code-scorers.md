# T-19: Remaining code scorers

Status: review
Mode: inline
Kind: feature
Priority: P0
Depends on: T-04, T-10

## Goal
Code scorers for dial behavior, re-query logic, domain coverage, path presence, distinctive hop, reach margin, connection floor, provenance, card completeness and seed resolution, all running in `npm run evals`.

## Owns
- evals/scorers/dial-behavior.ts
- evals/scorers/requery-logic.ts
- evals/scorers/domain-coverage.ts
- evals/scorers/path-presence.ts
- evals/scorers/distinctive-hop.ts
- evals/scorers/reach-margin.ts
- evals/scorers/connection-floor.ts
- evals/scorers/provenance.ts
- evals/scorers/card-completeness.ts
- evals/scorers/seed-resolution.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/scorers.md
- evals/harness/
- evals/scorers/index.ts
- src/types/

## Skills
- atelier-evals

## Done when
- [ ] Each scorer matches its definition in `scorers.md` and has a passing and a failing synthetic fixture
- [ ] The handoff lists the registration lines for `evals/scorers/index.ts` (owned by T-04, so the manager adds them)
- [ ] `npm run evals` is green on the synthetic fixtures
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- all named in Goal

## Qloo calls
- none

## Handoff
Status: review. Zero Qloo or Anthropic calls; no .env or .qloo-private/ read. Only the ten Owns scorer files, new fixture files under `evals/fixtures/`, and this ticket were touched. Not committed.

**Manager: merge steps (one commit, or `npm test` is red in between).** `evals/harness/fixture-shape.test.ts` ("every trace file is used by a case") fails until the 26 new cases are in `cases.json`, because the new traces are on disk. Exactly one test fails today; everything else is green (`tsc --noEmit` clean, `eslint` clean, `vitest run` 842 passed, 1 failed for this reason).
1. `evals/scorers/index.ts`: add the imports and extend `SCORERS` (order is the report order):
```ts
import { cardCompleteness } from "./card-completeness";
import { connectionFloor } from "./connection-floor";
import { dialBehavior } from "./dial-behavior";
import { distinctiveHop } from "./distinctive-hop";
import { domainCoverage } from "./domain-coverage";
import { pathPresence } from "./path-presence";
import { provenance } from "./provenance";
import { reachMargin } from "./reach-margin";
import { requeryLogic } from "./requery-logic";
import { seedResolution } from "./seed-resolution";

export const SCORERS: readonly Scorer[] = [
  repoHygiene, paramValidity, callBudget,
  dialBehavior, requeryLogic, domainCoverage, pathPresence, distinctiveHop,
  reachMargin, connectionFloor, provenance, cardCompleteness, seedResolution,
];
```
2. `evals/fixtures/cases.json`: append the `cases` array of `evals/fixtures/cases-t19.json` (26 entries, ready to paste; the file is a merge helper the loader ignores, delete it after merging), and merge its `existingCaseExpect` into the `expect` of two existing cases. Those two old fixtures carry fabricated re-query reasons (a `too_weak` re-query after 11 candidates cleared the floor), which `requery-logic` correctly rejects:
   - `at-limits-12-calls-2-requeries`: `"requery-logic": { "fail": "too_weak" }`
   - `too-many-requeries`: `"requery-logic": { "fail": "limit is 2" }`
3. `evals/harness/runner.test.ts` line 70 asserts the registered names equal the first three; update it to the thirteen names above.
After that `npm run evals` runs 13 scorers over 39 cases. I ran exactly that merge in a scratch config outside the repo (scorers + merged cases through `runEvals`, plus the CLI test's positive and negative case check): 13/13 scorers pass, every trace scorer has at least one positive and one negative case, each negative fails for its stated reason. The repo-hygiene scan over the new untracked fixtures passed too.

**Contracts other tickets rely on**
- Result shape the scorers read (server-side fixture, a `RunResult` plus optional extras): `domains[]` of `{ domain, status, thin, picks[], byBand? }` with full `Pick`s and their `Card`s (picks keep popularity, reach, connection; public results do not, so scorers must read server-side fixtures), and optional `seeds[]` (the run's seeds), `exclude[]` (entity ids shown by earlier runs, `RunInput.exclude`), `tagRarity` (`{ <domain>: { <tagId>: rarity } }`, the `ScoredPool.tagRarity` map). `result.meta.notRequeried` is read by `requery-logic`. Fixtures are in `evals/fixtures/results/`.
- A case with no `result` passes every result-reading scorer with the note "no result in this case; nothing to check" (the 13 older trace-only cases are not run results). `seed-resolution` and `requery-logic` still check the trace on those cases. Any scorer that reads a result fails when the result is not a run result (no `domains` array).
- Shared readers (`readResult`, `withResult`, `isObj`, `pickLabel`, ...) are exported from `evals/scorers/path-presence.ts` because the Owns list has no shared helper file. They could move to `evals/harness/` later.
- Each scorer is exported by name (`dialBehavior`, `requeryLogic`, ...) with the `score*` function beside it.

**Decisions for the manager to check**
1. Closed POST-body gate. `registry.post.confirmedBodyParams` is empty, so `param-validity` rejects any insights call that sends `filter.exclude.entities` (or `filter.popularity.max`) today. The real pool code sends both, so live traces will fail `param-validity` until the manager records the spike result, and no committed fixture can carry the exclusion param yet. `dial-behavior` therefore checks the call-level exclusion only when the registry confirms the param (otherwise it checks the results, and still checks any call that does send the param, by count since ids are redacted, or by id when listed). The call-level negative (calls that exclude fewer ids than seeds plus shown picks) has no committed fixture for that reason. I verified it in a scratch run with the gate opened in memory: a trace with `"filter.exclude.entities":"[5 ids]"` on every pool passes, one with `"[2 ids]"` fails with "excludes 2 id(s) but there are 5 seed(s) and shown pick(s)", and no param at all fails once the gate is open. Re-queries in the fixtures change `take` (a baseline param) for the same reason. Add the two exclusion cases once the gate opens.
2. `requery-logic` reads the trace as the loop writes it: first `score`, then `requery`, then the second pool. It can prove `empty`, `weak_connection` and `too_weak` from `scored` and `clearedFloor`, and can reject `too_obvious` only when too few candidates cleared the floor (a higher-priority reason applies). The obvious-share behind `too_obvious` is not in the trace, so a `too_obvious` re-query after a healthy pool cannot be refuted. If the manager wants that checked, `score` events need an `obviousShare` (types are shared, not mine). A flagged first pool with no re-query fails unless the budget is spent or `result.meta.notRequeried` lists the domain. The "floor never lowered" check is: no re-query param named like a connection or floor param, and `relax` events relax the reach band only (the type guard already enforces the latter).
3. `domain-coverage`: a `Pick` has no creator field, so "one pick per creator or franchise" is read from the path's lineage hop label and the pick name; picks that share either count as one. All six locked domains must have an entry in the result (the loop returns one per domain); a domain under `MIN_PICKS_PER_FIELD` passes only when reported thin, empty or unavailable. A backfilled pick under the floor is padding and fails. A domain is `llmBridged` all or none, and a pick with no shared tags and no lineage hop must be labeled `llmBridged`. No positive fixture for an `llmBridged` domain: its path would have no shared tags, which `path-presence` rejects by definition.
4. `dial-behavior` compares Stretch with Match per domain (popularity is ranked within one pool), skipping domains where either side has no known popularity, and says how many were compared.
5. `distinctive-hop` recomputes from `result.tagRarity` when present. The real `RunResult` does not carry it, so on live results it can only check the `distinctive` flag and sourced lineage hops, and says how many picks it took on the flag alone. Exposing the pool's `tagRarity` in the server-side result would close that gap.
6. `card-completeness`: "marked as a reading" is a UI concern the data cannot show. The scorer checks that a reading has text and its own `sourceUrl`, and that its text is not repeated inside `why` or `different`. Taste-score checks are narrow text patterns (percentages, "x out of 10", "match score", ranking words, "#3", "best match", stars) plus score-like field names on the card; subtler wording is for the bridge judges.
7. `seed-resolution`: the trace checks `resolve_seed` statuses against candidate counts (clean 1+, ambiguous 2+, missing 0), requires a later non-429 `/search` after a 429, and, when any `/search` came back 200 empty, bounds how many seeds may resolve clean or ambiguous by the searches that found something. The result check (when `seeds` is present) rejects an ambiguous seed with a Qloo id (a silent pick), a clean seed without one, a missing seed with an id or candidates, and a trace/result status mismatch. `path-presence` also requires a path's seed to be one of the run's seeds and clean.

**Fixtures added (synthetic only, ids `00000000-0000-4000-8000-0000000000NN`, tags `urn:tag:fixture:...`, names "Fixture ...")**
- `evals/fixtures/results/` (20 files): `t19-good-run` (3 clean seeds; film, books, tv with picks in several bands; thin music; unavailable and empty fields; a sourced lineage hop and reading) and one single-fault variant per negative case; `t19-seeds-mixed` and `t19-seeds-silent-pick` for seed resolution.
- `evals/fixtures/traces/` (8 files): `t19-good-run`, `t19-requery-two-matching`, `t19-requery-on-good-result`, `t19-requery-missing`, `t19-requery-no-change`, `t19-seeds-mixed`, `t19-seed-429-not-retried`, `t19-seed-empty-guessed`. Every new trace also passes `param-validity` and `call-budget`.
- `evals/fixtures/cases-t19.json`: the 26 case entries and the two `existingCaseExpect` entries. Negative cases that trip two scorers on purpose (`t19-coverage-padded`, `t19-path-no-shared-tags`, `t19-card-reading-no-source`) list both.
- Fixtures were generated by a throwaway script kept outside the repo; edit the JSON directly from here on.

**Known gaps**
- No scorer unit-test files (outside Owns); the eval cases are the tests. The test-writer specialist can add `evals/scorers/*.test.ts` for the pure `score*` functions.
- The call-level exclusion negative and positive (decision 1) have no committed fixture until the POST-body gate opens.
- `too_obvious` cannot be refuted from the trace (decision 2); creator or franchise is approximated from lineage labels and names (decision 3).
- Reasons printed for failures carry synthetic ids and numbers only; on live runs they include pick ids and counts (never names) and go to the console, not a tracked file.
