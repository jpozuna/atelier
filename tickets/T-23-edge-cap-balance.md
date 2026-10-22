# T-23: Edge cap of 20, balanced by stretch and field

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: none

## Goal
A run shows at most 20 edge suggestions: the strongest-connected low (moderate), medium (high) and high (extreme) stretch picks, with no field above 40% of what is shown, and calibration capped separately at 6. The cut happens in code before references and explanations, so trimmed picks cost no lookups or model tokens.

## Owns
- src/lib/frontier/cap.ts (new)
- src/lib/frontier/cap.test.ts (new)
- src/lib/frontier/index.ts
- src/lib/agent/loop.ts
- src/lib/agent/loop.test.ts
- src/lib/agent/public.ts
- src/lib/agent/public.test.ts (if present)
- evals/scorers/edge-cap.ts (new)
- evals/scorers/index.ts
- evals/scorers/domain-coverage.ts
- evals/fixtures/cases.json
- evals/fixtures/traces/ (new synthetic t23-* traces only)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- src/lib/agent/config.ts (manager already added `EDGE_PICKS_MAX` 20, `EDGE_FIELD_SHARE_MAX` 0.4, `CALIBRATION_PICKS_MAX` 6 and raised `RUN_PICKS_PER_BAND` to 4 for headroom; ask the manager for any other constant)
- src/types/card.ts (manager already added `ConnectionStrength` and optional `Pick.strength`)
- Known state at start: one failing test in loop.test.ts ("with a plan, one domain makes 1 pool...") caused by `RUN_PICKS_PER_BAND` 4. This ticket's cap should fix it; update the test only if its expectation is about the old per-band count
- src/lib/frontier/bands.ts, src/lib/frontier/score.ts
- evals/scorers/*.ts, evals/harness/

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] `capEdgePicks(selections)` (pure, in `cap.ts`) takes the per-domain band selections and returns at most `EDGE_PICKS_MAX` edge picks across moderate, high and extreme. Band shares are as even as the pool allows (for 20: 7, 7, 6). Within a band, the strongest connection wins, with ties broken deterministically
- [ ] No field holds more than `floor(EDGE_FIELD_SHARE_MAX * shown)` edge picks. When the fields are too few to fill 20 under that cap, fewer are shown. Never pad (hard rule 4); the connection floor never drops
- [ ] If a band runs short, its slots go to the other bands, as long as each field stays under its cap and the reach margin between bands still holds
- [ ] Every kept edge pick gets `strength`: `strong`, `steady` or `light`, by thirds of the kept edge picks ordered by connection (deterministic ties). `public.ts` keeps `strength` while still stripping `connection`, `reach` and `popularity`. Test: no number about taste reaches the public pick
- [ ] Calibration picks are capped at `CALIBRATION_PICKS_MAX` across fields (same-field before other-field) and never count toward the 20
- [ ] The loop applies both caps after section 4 (bands) and before 5a, so refs and explanations run only for kept picks. One trace event records what was kept per band and field, as words and counts only, with no scores
- [ ] A domain trimmed by the cap is not reported as "thin". `domain-coverage` understands a capped run, and a field may legitimately show fewer than `MIN_PICKS_PER_FIELD`
- [ ] New `edge-cap` scorer: edge total ≤ 20, no field above 40%, calibration ≤ 6, every band present when the pool has it. It is green on new synthetic fixtures, including a 6-field run, a 2-field run and a run with one dominant field
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run evals` pass. No Qloo data in fixtures

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- edge-cap (new)
- domain-coverage, connection-floor, reach-margin, dial-behavior, call-budget, path-presence

## Qloo calls
- none (no change to calls; selection only)

## Handoff

Done, with three things the manager must do (below). `npm run typecheck`, `npm run lint` and `npm run evals` pass. `npm test` has one failure, `evals/harness/runner.test.ts` "registers every scorer, in order", because it lists the scorers exactly and that file is not in Owns: add `"edge-cap"` after `"domain-coverage"` in its list (line 70 to 72). Nothing else fails; the known loop.test failure is fixed by the cap (no test expectation was edited).

What changed
- `src/lib/frontier/cap.ts` (new): `capEdgePicks(selections, { seedFields?, fieldShareOf? })` returns the same selections with `picks` and `byBand` cut, plus a `CapSummary` (counts only). `capTraceEvent(summary, now)` builds the trace event; `asTraceEvent` casts it. Exported from `frontier/index.ts`.
  - Edge: largest N up to `EDGE_PICKS_MAX` that the fields can fill under `floor(EDGE_FIELD_SHARE_MAX * N)`; band quotas as even as the pool allows (20 gives 7, 7, 6; moderate gets the extra first), a short band hands slots on; within a band the strongest connection wins, ties by entity id. Feasibility is an exact min-cut check, so the choice is deterministic and independent of input order.
  - After choosing, each field is checked for the reach margin between bands (the reach-margin scorer's rule) and for Stretch being less popular than Match (the dial-behavior rule). A pick that would break either is set aside and the selection redone, so trimming never breaks what `selectBands` guaranteed.
  - `strength`: thirds of the kept edge picks by connection (`floor(i * 3 / n)`). Calibration: at most `CALIBRATION_PICKS_MAX`, same-field first (pick's field equals its seed's field, via `seedFields`), then other-field, one field after another so no field fills it alone. Calibration picks have no `strength`.
- `src/lib/agent/loop.ts`: after section 4 (bands), before 5a, applies the cap, replaces `selections` with the capped ones (refs and explanations then run only for kept picks), emits the cap event. `thin` stays computed from the cleared pool, so a trimmed domain is not "thin".
- `src/lib/agent/public.ts`: no behaviour change needed (`strength` already survived the `...rest`); comment added. New `public.test.ts`: `strength` kept, no number about taste.
- `evals/scorers/edge-cap.ts` (new, registered in `index.ts`), `domain-coverage.ts` (a capped run may show a field fewer than `MIN_PICKS_PER_FIELD`), `cases.json` (9 new t23 cases, plus `edge-cap` expected to fail "not verifiable" on `t19-no-audit-live`).
- Tests: `cap.test.ts` (21), new cases in `loop.test.ts` (5), `public.test.ts` (2).

Decisions and contracts other tickets rely on
1. Trace event kind `cap` is NOT in `src/types/trace.ts` (shared, not in Owns). The loop emits it only when `isTraceEvent` accepts it, because an unknown kind fails `isTraceEvent` in `handler.test.ts`, `loop.test.ts` and the run route (which drops it). Until you add it, no cap event reaches the stream. To switch it on: add `CapTraceEvent` (exported from `cap.ts`: `kind: 'cap'`, `edgeShown`, `calibrationShown`, `byBand: Record<Band, number>`, `byField: Partial<Record<Field, {edge:number; calibration:number}>>`) to `TraceEvent` and `TRACE_EVENT_KINDS`, validate it in `isTraceEvent`, add an example in `guards.test.ts`, then render it in the reasoning panel. The event has words and counts only. The unit test for its content is in `cap.test.ts`.
2. With 1 or 2 fields holding edge picks the literal rule shows zero edge picks (two fields can never each be at most 40%). I followed the ticket and did not pad; calibration still shows. Please confirm this is what you want. The `t23-two-field-run` case encodes it (reach-margin and dial-behavior are expected to fail there as "would pass on nothing").
3. A run limited to some fields (`input.domains`, the "not me" follow-up) uses `fieldShareOf: "max"`: the field limit is `floor(0.4 * 20)` = 8 of that field's picks, because one field alone would otherwise always show zero. It still caps at 20 edge and 6 calibration across the fields it covers; the client merges the result into what it has, so the merged screen can exceed 20 unless T-27/the client trims. Check this.
4. Fixture results for the new cases are in `evals/fixtures/traces/t23-*.json` (not `evals/fixtures/results/`, which is not in Owns); move them and update the paths in `cases.json` if you prefer. All synthetic (invented names, ids 6 to 34).
5. `edge-cap` treats a result as legacy (pass with a note) when no edge pick carries `strength`; on a `live` case that is a failure. Band presence uses an optional `poolBands` extra in a fixture result; a live `RunResult` has none, so it is only noted. Adding per-band pool counts to `RunAudit` would make it checkable live.
6. `domain-coverage` counts a result as capped when edge picks carry `strength` and a limit was binding (edge total 20, or the largest field exactly at its limit). That is a heuristic from the result alone. `t19-coverage-under-minimum` still fails as before.

Known gaps
- `docs`/`scorers.md` do not list `edge-cap` yet (not in Owns).
- Loop run, not scorers, covers strength thirds exactly; the scorer checks only that the words follow connection order.

### Revision after manager review (fewer-field fallback, cap event wired)

- Fewer fields: with 3 or more fields holding edge picks the strict rule is unchanged. With 1 or 2 fields the per-field limit is the fixed `floor(EDGE_FIELD_SHARE_MAX * EDGE_PICKS_MAX)` = 8 (2 fields show at most 16, 1 field at most 8; never padded). `fieldShareOf: "max"` (follow-ups) uses the same fixed limit. `edge-cap` applies the same rule (fixed limit when fewer than 3 fields show edge picks). `t23-two-field-run` now shows 16 edge picks (6, 5, 5; 8 per field) plus 3 calibration per field and passes every scorer, including reach-margin and dial-behavior, with no expectations.
- Cap event: `CapTraceEvent` (`kind: 'cap'`, `edgeShown`, `calibrationShown`, `byBand`, `byField`, with the `say` line) is in `src/types/trace.ts` (`TraceEvent`, `TRACE_EVENT_KINDS`), accepted by `isTraceEvent` in `guards.ts` (counts only; byBand needs all four bands, byField keys must be fields), and covered in `guards.test.ts`. The loop emits it unconditionally, after the bands and before references. `publicTrace` passes it through unchanged (`public.ts` untouched; a loop test checks it equals the input and has no taste numbers). The local type and `asTraceEvent` are gone from `cap.ts`.
- Not mine, now failing because of the new kind: `src/components/reasoning/helpers.test.ts` "is a valid trace covering every event kind" requires `FIXTURE_TRACE` (`src/components/reasoning/fixture.ts`) to include every kind. Add a `cap` event to that fixture, or drop the test with the panel (T-26). The other two failures in `npm test` are T-27's in-progress runlog tests (`store-file`, `store-supabase`).
- Typecheck, lint and `npm run evals` pass.

### Revision, round 2

- No literal 3: `EDGE_SHARE_MIN_FIELDS` is used in `cap.ts`, `edge-cap.ts` (and through its helper `fixedWithoutEvent`, `domain-coverage.ts`). The old `shown >= 2` is gone; strength words come from `CONNECTION_STRENGTHS`, thirds from its length.
- Cliff: the cap computes the strict result and the fixed result (8 per field) and uses fixed only when strict shows fewer picks. Two full fields plus a third with one pick now show 17 (8, 8, 1), not 5. The event says which applied (`fieldLimit: "share" | "fixed"`). Tests: cliff, 3 deep fields (strict wins, 20 shown), 3 fields with 4 picks each (strict wins), thin pool (18, fixed).
- Field minimum: before the rest is filled, each field with an eligible edge pick gets its strongest one (band evenness counts it). A margin or popularity offender is set aside first and the field's next strongest takes its place. Tests: a weak field keeps its strongest pick, a trimmed field keeps one. In the loop, if the cap still leaves a field with pre-cap picks and none shown (only possible when it has calibration picks only and calibration trimmed it), its status is `ok` with the note "More from X was held back to keep the mix balanced." instead of "Nothing in X connected closely enough".
- Follow-ups keep the fixed limit (`fieldShareOf: "max"`).
- `CapTraceEvent` gained two OPTIONAL fields, `fieldLimit` and `trimmed` (a count of picks set aside), validated in `isTraceEvent` when present. They are optional only because `src/components/reasoning/fixture.ts` (not mine) already builds a cap event without them; make them required once that file has them or is gone.
- `edge-cap`: same rule as the cap (cap event's `fieldLimit`; with no event, fixed when fewer than `EDGE_SHARE_MIN_FIELDS` fields show edge picks or the result holds fewer domains than fields, i.e. a follow-up). More than the edge or calibration maximum fails on any non-live result, legacy or not. The strength words must split in thirds (never all strong).
- `domain-coverage`: reads the trace's cap event (`trimmed` above 0 means capped); without an event it falls back to the result heuristic, now consistent with the fixed limit (two fields at 8 and 8).
- Real output through the scorers: `loop.test.ts` runs a real loop result (and a one-field follow-up) through edge-cap, reach-margin and dial-behavior; `cap.test.ts` does it for `capEdgePicks` with 6, 3 and 2 fields. Domain-coverage is not run on loop output because the fake pool's names trip its franchise rule, which has nothing to do with the cap.
- New fixtures: `t23-cliff-run` (+ no-event negative), `t23-legacy-over-twenty`, `t23-strength-all-strong`; `t23-six-field-run`, `t23-dominant-field-run`, `t23-two-field-run` and `t23-cliff-run` now have their own trace with a cap event.
- `npm test`, typecheck, lint and `npm run evals` all pass.
