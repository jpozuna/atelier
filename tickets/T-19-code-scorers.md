# T-19: Remaining code scorers

Status: done
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

### Review fixes (round 2) - supersedes the points below where they differ
Status: done. Zero Qloo or Anthropic calls. Only the ten scorers, new `_shared.ts`, new fixture files and this ticket were touched.

**Manager: merge steps (one commit; `vitest run` has exactly one failure until then: "every trace file is used by a case", because 5 new traces are on disk).**
1. `evals/fixtures/cases-t19-followup.json` (delete after merging): append its `newCases` (22) to `cases.json`; replace the two `changedCases` by id (`t19-good-run` and `t19-coverage-same-franchise`, descriptions only, optional). The fixtures behind the existing cases changed (good run now has an audit block and a second lineage pick); every existing case still passes as is (`npm run evals` is green on today's 39 cases: 13/13 scorers).
2. Harness change for `live` (not mine to edit): `evals/harness/types.ts`: add `live?: true;` to `CaseSpec` and `live?: boolean;` to `CaseInput`. `evals/harness/cases.ts`: in `parseCaseSpecs` add `if (c.live !== undefined && c.live !== true) throw new Error(`${at} (${c.id}): live must be true when present`);` and in `loadCases` add `live: spec.live === true,` to the `input` object. Scorers already read it (`isLive` in `_shared.ts` casts, so they compile before and after).
3. After step 2, append the `afterHarnessChange` entry (`t19-no-audit-live`) from the helper file. Before step 2 it would pass where it must fail, so do not add it earlier. Its twin `t19-no-audit-legacy` (same result, not live) is in `newCases` and passes with "not verifiable" notes. Verified in a scratch run with `live` set on the input: all four audit-dependent scorers fail the live case with "not verifiable".
Checked: `tsc --noEmit`, `eslint evals` clean; scratch run of today's `cases.json` + the follow-up (62 cases) through the registered scorers: 13/13 pass, every trace scorer still has positive and negative cases, each negative fails for its stated reason; repo-hygiene passes on the new files.

**What changed, per review item**
1. Audit. `result.audit` (`seedIds` as Qloo ids, `exclude` per domain, `tagRarity` per domain) is read through `_shared.ts`. `dial-behavior`: each domain with picks must have an audit exclude list covering every seed and shown pick, no pick may be a seed or in that list, and a trace call's id count must equal the audit list length. `distinctive-hop` recomputes from `audit.tagRarity` (flag alone is never proof). `seed-resolution`: `audit.seedIds` must belong to clean seeds and cannot exceed the clean seeds in the trace. `path-presence`: seed identity needs `result.seeds`. Missing evidence is "not verifiable": fails when `input.live` is true, passes with a note otherwise (`finish` in `_shared.ts`). Good-run fixtures carry an audit block. New negatives: seed returned (via audit alone, no seed list), excluded pick returned, exclude list too short, common tags flagged distinctive (existing case, now judged through the audit).
   **Gap to close on the producer side:** a live `RunResult` has `audit` but no `seeds`, and `audit.seedIds` are Qloo ids, not the request seed ids a path names. So `path-presence` (path seed, seed hop label) and `seed-resolution` (statuses) will report "not verifiable" and fail live cases until the server-side result also exposes the request seeds (`id`, `typed`, `status`, `qlooId`) next to the audit.
2. Vacuous passes. Any result-bearing case needs at least one pick overall (all pick-reading scorers fail otherwise; `seed-resolution` and `requery-logic` do not read picks and are exempt). `dial-behavior` fails when no domain had both Match and Stretch picks with known popularity; `reach-margin` fails when no domain had two bands; `domain-coverage` fails when every domain is unavailable.
3. `card-completeness`: families percent, scale, stars, taste score, numbered match ("92 match"), score with number, best match, ranking, rank number, bare decimal, audience metric (popular, popularity, follower(s), listener(s), million(s), billion(s)) on `why` and `different`. The reading text is exempt from percent, scale, stars, score, ranking, rank number and decimal, and still refused for taste-score and audience wording. Negatives: audience, decimal, numbered match, ranked, reading with an audience metric (percent was already covered). The good run's reading holds "ranks", "3" and "1.5" to prove the exemption.
4. `seed-resolution`: a search is empty on `outcome: "empty"` or `resultCount: 0` whatever its status; errors (`outcome: "error"`, status 400+) do not count as searches that found something; a 429 must be followed by a non-error `/search` with the same `query`. Negatives: 429 followed only by another seed's search, cached empty search with a clean seed.
5. `path-presence`: `card.path` must deep-equal `pick.path`; the pick hop must name the pick; with `seeds`, the path's seed must be clean and the seed hop's label must equal the seed's typed words. Negatives: card path differs, seed hop label wrong.
6. `domain-coverage`: franchise is read from names only (equal; one name opens the other; two shared leading words; or equal after dropping a trailing number, numeral or part/volume/book/season marker). "Fixture", "Invented" and "Synthetic" are ignored when comparing. A shared lineage label no longer counts; the good run has two picks sharing one, as a positive. Negative: "Saga Part 1" and "Saga Part 2".
7. `requery-logic`: `score.obviousShare` decides `too_obvious` when present (refused under `OBVIOUS_SHARE`, required at or above it, so an obvious pool with no re-query fails). A first score without `obviousShare` and with enough cleared candidates is "not verifiable". `meta.notRequeried` excuses a flagged domain only with a reason that is one of the codes its signals call for. Negatives: low share, high share with no re-query, wrong reason, no reason; positive: matching reason.
8. `provenance`: a source counts for a pick only if a `fetch_refs` event listing that pick id retrieved it. Negative: `fetch_refs` for other picks only.
9. Shared readers moved to `evals/scorers/_shared.ts`; `path-presence.ts` no longer exports them.

**Known gaps (new or still open)**
- The call-level exclusion fixtures are still not committed (the POST-body gate is closed, so `param-validity` refuses the param); the audit-based exclusion checks cover the same ground now.
- Franchise detection is name-based and cannot see creators; a real series named without a shared opening will pass.
- The `live` cases need the harness change in step 2.

### Round 1 handoff
Status: done. Zero Qloo or Anthropic calls; no .env or .qloo-private/ read. Only the ten Owns scorer files, new fixture files under `evals/fixtures/`, and this ticket were touched. Not committed.

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
