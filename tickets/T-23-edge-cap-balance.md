# T-23: Edge cap of 20, balanced by stretch and field

Status: todo
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
