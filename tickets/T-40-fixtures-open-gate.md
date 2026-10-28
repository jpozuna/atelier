# T-40: Synthetic fixtures and gate tests match the open POST body gate

Status: done
Mode: inline
Kind: fix
Priority: P0
Depends on: none (builds on the manager's uncommitted gate change in src/lib/qloo/registry.ts and its test edits; do not edit those)

## Goal
With `POST_BODY.confirmedBodyParams` now holding filter.popularity.max, filter.exclude.entities and feature.explainability, `npm test` and `npm run evals` pass again: the synthetic traces carry what the pool really sends, and tests that pinned a closed gate either pin it on an explicitly closed registry copy or pin the open gate.

## Owns
- evals/fixtures/traces/
- evals/fixtures/cases.json (only if a case's expectation must change; say why for each in the hand-off)
- evals/live/smoke-run.test.ts
- src/lib/frontier/pool.test.ts

## Reads
- git diff src/lib/qloo/ src/lib/agent/testing.ts (the manager's change; do not edit)
- evals/scorers/dial-behavior.ts (the `gateOpen` branch, lines ~60-125)
- src/lib/frontier/pool.ts (what is sent: filter.type, signal.interests.entities, filter.popularity.max, filter.exclude.entities with every seed and every shown pick, feature.explainability, take)
- evals/live/smoke-run.ts
- evals/harness/runner.test.ts
- .claude/skills/atelier-evals/references/scorers.md

## Skills
- atelier-evals
- qloo-api

## Done when
- [ ] Every `query_insights` event in evals/fixtures/traces/*.jsonl that stands for a real pool call carries the params pool.ts sends, in the trace's id-free form (for example "filter.exclude.entities": "[N ids]" with N equal to that case's seeds plus shown picks, and matching the result's audit exclude list length where there is one).
- [ ] Negative cases still fail for their stated reason. A case built to show a missing or short exclusion list keeps that defect; if one exists and now fails for a different reason, fix the fixture, not the scorer.
- [ ] src/lib/frontier/pool.test.ts: the "is refused today only for the body params still gated" test pins the open gate (the pool's params pass the real registry with no issues) and a second assertion keeps the closed-gate refusal on a registry copy with an empty confirmedBodyParams.
- [ ] evals/live/smoke-run.test.ts: the closed-gate tests use an explicitly closed registry copy (or are reworded to test the open gate where that is the real behavior now); the recorded-run tests pass. smoke-run.ts itself is not edited unless a test cannot be fixed otherwise; if so, explain.
- [ ] No scorer logic is changed. Fixtures stay synthetic (ids shaped 00000000-0000-4000-8000-0000000000NN, invented names). No live calls.
- [ ] npm test, npm run evals, npm run lint, npm run typecheck pass.

## Specialists
- tests: no (this ticket is tests and fixtures)
- qloo-param-auditor: no (the manager already audited the gate)
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- dial-behavior
- param-validity
- repo-hygiene

## Qloo calls
- none

## Handoff
Changed
- evals/fixtures/traces/*.jsonl (26 files): every `query_insights` event, and the matching POST `/v2/insights` `qloo_call` event for an entity type, now carries `filter.popularity.max` 0.6, `filter.exclude.entities` "[N ids]" and `feature.explainability` true before `take`. The taste-analysis (urn:tag) calls are untouched. N is 5 (3 seeds plus 2 shown) in the traces whose results carry an audit of 5 (t19-good-run, t19-provenance-wrong-pick-refs, t19-requery-missing, t23-six-field-run, t23-dominant-field-run, t23-two-field-run, t23-capped-run, t23-cliff-run), and the sent seed count (3) in the result-less traces. The `explainability` boolean on the event is left as it was (no scorer reads it).
- New traces t28-learned-run.jsonl (9), t28-not-me-returned.jsonl (10), t28-not-me-not-excluded.jsonl (film 8, others 9): the t28 results carry audit exclude lists of 9, 10 and 8, and dial-behavior compares the call's count to the audit length, so they could not keep sharing t23-six-field-run.jsonl (5).
- evals/fixtures/cases.json: only the `trace` pointer of 6 t28 cases changed (t28-learned-run, t28-lean-no-drop, t28-floor-under, t28-over-cap -> t28-learned-run; t28-not-me-returned; t28-not-me-not-excluded). No `expect` block changed.
- src/lib/frontier/pool.test.ts: the "refused today" test now pins that the pool's params pass the real registry, and keeps the refusal (the three body_unconfirmed issues, nothing else) on a copy with empty confirmedBodyParams.
- evals/live/smoke-run.test.ts: added CLOSED_REGISTRY (explicit copy); the closed-gate tests use it; added a test that the real registry passes assertPicksEnabled; the recorded-run and repeat-run tests now expect every scorer to pass and `ok` true (param-validity used to fail on body_unconfirmed against the real registry). smoke-run.ts and runner.test.ts not touched.

Negative cases: all still fail for their stated reason (the runner test asserts it). t19-dial-audit-exclude-short keeps its short audit list (film 2) and still fails "leaves out"; its shared trace (5) now also adds "the call excludes 5 id(s) but the audit says 2" as a second reason. Fixtures stay synthetic; no live calls; no scorer changed.

Checks: npm test (1565 passed), npm run evals, npm run lint, npm run typecheck all pass.

Known gap: no fixture case pins "an insights call that omits filter.exclude.entities fails dial-behavior" now the gate is open (it was only seen as a side effect of the old fixtures). Adding one needs a new cases.json entry, outside this ticket.
