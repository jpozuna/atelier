# T-38: Document the edge-cap scorer, test the "held back" note

Status: done
Mode: inline
Kind: polish
Priority: P2
Depends on: none

## Goal
Close two eval gaps from the board: `edge-cap` is listed in the scorer reference, and a loop test pins the "held back to keep the mix balanced" field note.

## Owns
- .claude/skills/atelier-evals/references/scorers.md
- src/lib/agent/loop.test.ts

## Reads
- evals/scorers/edge-cap.ts, evals/scorers/index.ts
- src/lib/agent/loop.ts (around `heldBack`, the domain result and its `note`; do not edit)
- src/lib/agent/config.ts (do not edit)
- evals/fixtures/ and the existing cases in src/lib/agent/loop.test.ts (synthetic only)

## Skills
- atelier-evals
- atelier-agent-loop

## Done when
- [x] scorers.md has an `edge-cap` row in the code scorer table, in the same style as the others, stating what passes and its inputs, matching what evals/scorers/edge-cap.ts actually checks.
- [x] loop.test.ts has a case where one field has more qualifying edge picks than the per-field share allows: that field's result carries the note "More from <field phrase> was held back to keep the mix balanced.", its status is not `empty`, and a field that was not held back does not carry the note.
- [x] The new test fails if the held-back note line in loop.ts is removed (check by temporarily commenting it out, then restore it; loop.ts is unchanged at hand-off).
- [x] Fixtures are synthetic (invented names, ids shaped 00000000-0000-4000-8000-0000000000NN). No live calls.
- [x] npm test, npm run evals, npm run lint, npm run typecheck pass.

## Specialists
- tests: no (this ticket is the test)
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- edge-cap
- repo-hygiene

## Qloo calls
- none

## Handoff
Changed:
- `.claude/skills/atelier-evals/references/scorers.md`: new `edge-cap` row (after `reach-margin`), stating the caps, the field limit (strict share vs fixed, and when each applies), strength words and thirds, `poolBands`, and the legacy and live handling, as evals/scorers/edge-cap.ts checks them.
- `src/lib/agent/loop.test.ts`: import of `entity` from `@/lib/frontier/fixtures`, and a new `describe("a field the cap sets aside entirely")` inside "the edge cap" with two tests (fashion, and food and places for the two-word phrase). Both check the exact note text, status not `empty`, no picks, and that the other fields have picks and no "held back" note.

Decision to check: the ticket describes the trigger as a field with more qualifying edge picks than the share allows. In the code that cannot empty a field, because the cap first keeps each field's strongest edge pick (cap.ts "field minimum"). `heldBack` is only set when a field has picks before the cap and none after, which (as T-23 notes) happens only for a field whose floor-clearing picks are all calibration and whose calibration slots go to same-field picks of other fields. The test builds exactly that (synthetic: music, film, books pools anchored on their own seeds; a 3-candidate fashion pool where the far candidate is more popular than the close one, so Stretch is not eligible). The edge-share path is not what the note covers.

Mutation check: with the note line in loop.ts replaced by `noteFor(d, status)`, both new tests fail; loop.ts restored byte for byte (no diff).

Known gaps: `npm test` and `npm run evals` currently have failures that are not from this ticket: the dial-behavior scorer, runner.test, smoke-run.test and pool.test fail on the `filter.exclude.entities` body gate. At the time of the run other workers had uncommitted edits in src/lib/qloo/registry.ts, registry.test.ts, client.test.ts, validate.test.ts and src/lib/agent/testing.ts, which I did not touch. loop.test.ts (79 tests), edge-cap evals, lint and typecheck pass.
