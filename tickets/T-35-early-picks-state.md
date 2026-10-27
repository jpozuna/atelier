# T-35: Early picks in the run state

Status: todo
Mode: inline
Kind: feature
Priority: P1
Depends on: none

## Goal
The picks screen's run state reads the `domain` SSE event that `/api/run` now sends per field (T-31), so each field's picks can be shown the moment they arrive instead of when the whole run ends.

## Owns
- src/components/deck/sse.ts
- src/components/deck/sse.test.ts
- src/components/deck/run-state.ts
- src/components/deck/run-state.test.ts
- src/components/deck/preview.ts (the synthetic stream for /picks/preview also sends `domain` events, with delays, so the early arrival can be seen)

## Reads
- CLAUDE.md, docs/DECISIONS.md (2026-10-27 entry: the order contract)
- src/app/api/run/handler.ts (header comment: `domain` event contract; do not edit)
- tickets/T-31-server-speed.md (hand-off)
- src/components/deck/PicksScreen.tsx, storage.ts, derive.ts (consumers; do not edit. T-34 wires the new state in)

## Skills
- atelier-agent-loop

## Done when
- [ ] `sse.ts` parses `domain` into a typed message, validated like `result`; malformed ones are dropped
- [ ] `RunState` gains `partial: PublicRunResult | null`, built from the domain events of the current stream. `result` stays final-only and unchanged in meaning, so storage never saves a partial run. On the final `result`, `partial` is cleared
- [ ] During a "not me" re-run, a `domain` event for a field being refreshed updates `partial` as a merge onto the current `result` (same rules as `mergeRerun`); events for other fields are ignored
- [ ] A failed or interrupted stream after some `domain` events keeps those picks visible through `partial` and sets the error as today. Documented in the hand-off: exactly what T-34 should render (`state.result ?? state.partial`) and which fields are still pending
- [ ] The state never assumes a pick's `explain` trace has arrived when its `domain` has
- [ ] `/picks/preview` streams domain events one field at a time
- [ ] Tests for all of the above; `npx vitest run src/components/deck`, `npm run typecheck`, `npm run lint` pass

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff
