# T-35: Early picks in the run state

Status: done
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

### What changed
- `sse.ts`: `RunMessage` has `{ type: "domain"; domain: PublicDomain }`. `readMessage` reads the `domain` event with the same `readDomain` as each entry of `result` (invalid picks dropped, stray fields never kept, `picks` rebuilt from the bands); a malformed one (bad JSON, unknown field name, unknown status, not an object) returns null and is skipped.
- `run-state.ts`: `RunState` gains `partial: PublicRunResult | null` and `arrived: Field[]`. New exports `pendingFields(state)` and `shownResult(state)`. Reducer handles `domain`.
- `preview.ts`: new pure `domainSteps(result, startMs, stepMs, order?)` returning timed `domain` messages, one field per step.
- Tests: `sse.test.ts`, `run-state.test.ts` (including `domainSteps`). `npx vitest run src/components/deck` (165 passed), `npm run typecheck`, eslint on the five files: green. No Qloo calls.

### What T-34 should render
- Render `shownResult(state)`, which is `state.partial ?? state.result`. In a full run this is identical to `state.result ?? state.partial` (result is null until the end, partial is cleared on the result). In a "not me" re-run it is NOT: `result` stays the old one all along, and `partial` is that result with each arrived field merged in, so `result ?? partial` would never show the early merge. Use `partial ?? result`.
- `partial` is a `PublicRunResult` so `derive()` and the grouping code take it as is. Full run: only the arrived fields, sorted in field order, `plan`/`meta` empty. Re-run: all fields, `plan` and `meta` are the result's own.
- Storage, the reaction saver and the "not me" request body must keep reading `state.result` only (PicksScreen lines 74, 138, 295 already do). `partial` must never be saved or sent back.
- Which fields are pending: `pendingFields(state)`. Full run: every field in `FIELDS` whose `domain` has not arrived; re-run: the `refreshing` fields not yet arrived; `[]` whenever no stream is open (phase is not `running`). `state.arrived` lists the fields that did arrive, in arrival order. After a failure, the fields missing from `arrived` are the ones that never came.
- Failure after some `domain` events: phase is `failed` (or `not_ready`) with `errorCode` set as today, `result` null, and `partial` and `arrived` kept. T-34 must draw `partial` when `phase === "failed"` and it is non-null, instead of the bare failed screen (today PicksScreen shows `Failed` and nothing else when `!state.result`; its test at `state.phase === "failed"` and `!state.result` branches need to check `shownResult`). A failed or cut re-run keeps `phase: "done"`, `rerunError` and the old `result`, and clears `partial`, `arrived` and `freshIds` (see Review fixes), so `shownResult` is the stored `result`.
- The state never assumes a pick's `explain` trace event has arrived when its `domain` has: `partial` is built from the domain payload alone and `events` is untouched by it (tested with trace before and after). The reasoning panel must not require the trace of a pick it is showing; wait for the `explain` events or `result` if it needs one.

### Changes in meaning
- `result`: unchanged (final only; the restored result too). `received`: unchanged (set only by the `result` event; `domain` events do not set it). `phase`: unchanged; it stays `running` while early picks show. So `phase === "running"` with a non-null `partial` is the new "picks arriving" state; `phase === "done"` still means there is a final result.
- `freshIds`: now grows while the stream runs. It is the ids of picks that arrived in this stream (domain or result) and were not in the previous `result`. Each `domain` event sets it from the current `partial`; the final `result` recomputes it the same way, so ids revealed early stay in the list and picks are not treated as new twice. Empty for a restored result. Same meaning as before at the end of a run.
- A second `domain` event for the same field is ignored. In a re-run, a `domain` event for a field that is not in `refreshing` is ignored. `start` and the final `result` clear `partial` and `arrived`.
- The re-run merge uses `mergeRerun` with the single incoming field and keeps the result's `plan`/`meta` (mergeRerun would otherwise drop the refreshed field's plan entries when the incoming plan is empty).

### Known gaps and decisions
- The ticket says `preview.ts` holds the synthetic stream for /picks/preview. It does not: `preview.ts` is the hover helper `previewProps`. The synthetic source is `demoSource` in `src/components/deck/PicksDemo.tsx` (not in T-35's Owns, so I did not edit it). I put the pure helper `domainSteps` in `preview.ts` and tested it. To finish "/picks/preview streams domain events one field at a time", T-34 (or whoever owns `PicksDemo.tsx`) adds, inside `demoSource`, for the non-failing scenarios: `domainSteps(result, step * (trace.length + 1) - ..., step).forEach(({ at, message }) => after(at, () => handlers.onMessage(message)))` before the final `result` timer, with `result = makeFixtureResult(partial ? "again" : "first")`, and moves the end timer after the last step. Pass a scrambled `order` to show out-of-order arrival.

### Review fixes
- A `domain` event after the final `result` (before `done`) is ignored (`if (state.received) return state`), for a full run and a re-run: the view no longer shrinks to one field. Tested both ways.
- A failed or cut re-run (error event, or `closed`/`done` without a result; phase `done`, `rerunError` set) now clears `partial` and `arrived` and sets `freshIds` to `[]` (the old result's picks were already revealed), so `shownResult(state)` is the stored `result`: what is on screen is what is saved and what a later "not me" sends. A failed or cut FULL run still keeps `partial` and `arrived`, for both `failed` and `not_ready` (`picks_not_enabled` after early domain events keeps the partial). This replaces the earlier note that the failed re-run state kept the partial merge; T-34 has nothing to decide there.
- A re-run `domain` event whose field has status `unavailable` counts as arrived (it leaves `pendingFields`, enters `arrived`), but the merge leaves that field as it was, the same as `mergeRerun` on the final result.
- New tests: two refreshed fields merging onto the earlier partial; duplicate domain in a re-run; unavailable in a re-run; re-run cut by `closed`; a new `start` clearing a previous partial; `picks_not_enabled` after early domain events; late domain after the result. The `as never` casts in the pendingFields test are replaced by `FIELDS.filter(...)`.
