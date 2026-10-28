# T-38: Document the edge-cap scorer, test the "held back" note

Status: todo
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
- [ ] scorers.md has an `edge-cap` row in the code scorer table, in the same style as the others, stating what passes and its inputs, matching what evals/scorers/edge-cap.ts actually checks.
- [ ] loop.test.ts has a case where one field has more qualifying edge picks than the per-field share allows: that field's result carries the note "More from <field phrase> was held back to keep the mix balanced.", its status is not `empty`, and a field that was not held back does not carry the note.
- [ ] The new test fails if the held-back note line in loop.ts is removed (check by temporarily commenting it out, then restore it; loop.ts is unchanged at hand-off).
- [ ] Fixtures are synthetic (invented names, ids shaped 00000000-0000-4000-8000-0000000000NN). No live calls.
- [ ] npm test, npm run evals, npm run lint, npm run typecheck pass.

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
(Worker fills in.)
