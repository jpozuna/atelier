# T-28: Suggestions learn from the run log

Status: done
Mode: inline
Kind: feature
Priority: P2
Depends on: T-23, T-27

## Goal
A person's next run uses their signals from the private run log. Picks they set aside or turned down stay out, themes behind turned-down picks are leaned away from, and themes behind picks they saved are leaned toward. A run-wide report also shows which reasoning moves (themes, re-query reasons, bands) led to kept picks and which led to "not me", so tuning is based on evidence.

## Owns
- src/lib/learn/ (new: pure signal-to-adjustment logic and the report builder)
- src/app/api/run/handler.ts, src/app/api/run/handler.test.ts (sequenced: T-27 owns them first; this ticket starts only after T-27 is done)
- scripts/runlog-report.ts (new; output only to .qloo-private/runlog/)
- evals/scorers/learning.ts (new), evals/scorers/index.ts (sequenced after T-23)
- evals/fixtures/cases.json, evals/fixtures/traces/ (new synthetic t28-* traces only)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- tickets/T-27-private-run-log.md and tickets/T-23-edge-cap-balance.md (hand-offs)
- src/lib/runlog/, src/lib/agent/loop.ts, src/lib/agent/config.ts (ask the manager for any new constant, e.g. how much to lean and how many past runs to read)

## Skills
- atelier-agent-loop
- atelier-evals
- qloo-api

## Done when
- [x] `adjustFromSignals(input, signals)` (pure) returns the run input with: every `not_me` or `not_interested` entity added to `exclude`; profile weights of tags that appear only in turned-down picks' theme hops lowered, and those in saved picks' theme hops raised, each by a bounded step from config. The connection floor, the cap and the band rules are untouched (hard rule 4)
- [x] The handler reads the person's signals (by user id, signed-in people only; guests get no learning) server-side and applies them before the loop. No signals means byte-identical input to today. Reading the log makes 0 Qloo calls, and the run still obeys the 12-call cap
- [ ] The planner prompt may receive a short words-only note of past signals (for example "set aside: two picks themed <tag name>"), with no numbers. Code still computes every score (hard rule 8). Built, not wired (planner note deferred)
- [x] `scripts/runlog-report.ts` aggregates the log into counts per theme, re-query reason and band of kept versus set-aside picks, and writes only to `.qloo-private/runlog/`. It has `--dry-run` and makes no Qloo calls
- [x] New `learning` scorer on synthetic fixtures: a not_me pick never reappears, a leaned-away theme's picks drop in share, the floor holds, and the cap holds. `npm test`, typecheck, lint and `npm run evals` pass
- [x] Nothing numeric about taste reaches the browser, and nothing from the log lands in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes (exclude list and any changed insights body)
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- learning (new)
- edge-cap, connection-floor, call-budget, repo-hygiene

## Qloo calls
- /v2/insights via the loop, unchanged params except a longer `filter.exclude.entities` (bounded by `RUN_MAX_EXCLUDE`)

## Handoff

**Status after manager review (round 2).** Constants are in `src/lib/agent/config.ts` (the manager moved them; `src/lib/learn/constants.ts` is gone). `learning` is registered in `evals/harness/runner.test.ts`. Typecheck (outside T-25's `src/components/deck/`), lint, `npm test` and `npm run evals` were re-run after this round; see the end of this section.

**What the feature does now**
- Learning is for signed-in people only. The handler reads signals only when there is a user id; a guest gets no read and exactly today's input (no profile-hash read, so two guests with the same seeds cannot see each other's signals). `readLearnSignals({ userId })` keeps only signals whose user is that account.
- Learning uses exact signals only (`reaction`, `not_me_list`). Rows with `source: "exclude"` are ignored by `planAdjustment` and `adjustFromSignals`: they neither exclude nor lean, and cannot override an earlier save. They stay in the log; `report.ts` counts them separately as `shownAgain` and they never set a stance there either.
- A pick is one pick however it is named: stance key is the entity id when any signal on that run-and-pick knows it, else `runId:pickId`. A reaction with no entity id and a not_me with one on the same pick are one pick.
- Times are compared with `Date.parse` everywhere (`resolve`, `recentRunsOnly`, report `stances`), so `Z` and `+00:00` agree. `read.ts` imports `server-only`.
- Otherwise as in round 1: `adjustFromSignals(input, signals)` (pure) adds exact turned-down entities to `exclude` (newest first, `LEARN_MAX_EXCLUDED`, within `RUN_MAX_EXCLUDE`, request ids first), lowers tags only in turned-down picks' theme hops and raises tags in saved picks' (by `LEARN_LEAN_STEP`, max 1), on `profile.tags` and the axes' tags. The floor, cap, bands and plan are untouched; no signals returns the very same input object. `tried` is neutral, the latest stance wins, a tag in both is raised not lowered. A raised weight can let more picks clear the unchanged connection floor; the floor itself never moves.
- The handler reads under `LEARN_READ_TIMEOUT_MS`, any failure means the request's own input, reading makes 0 Qloo calls, and the log row keeps the request's original `exclude`/`notMe`. The log's audit block gets `picks` (pickId, qlooId, domain, band, themeTags, axisId, requeryReason) and, when learned, `learned` (excluded, awayTags, towardTags); the browser never sees either.
- Learning is off in replay mode (a learned `exclude` is a new request, a cache miss there): `learningEnabled()` is on for `QLOO_MODE=live` or `record` or local `QLOO_SYNTHETIC=1`; `ATELIER_LEARN=on|off` overrides. A learned run is a new run (at most 12 live calls), never a 0-call repeat view.
- `scripts/runlog-report.ts` (`node --experimental-strip-types scripts/runlog-report.ts [--dry-run]`): reads `.qloo-private/runlog/runs.jsonl` and `signals.jsonl`, writes only `report.json` and `report.txt` there; counts only (shown, kept, setAside, shownAgain) per theme tag, axis, re-query reason, band and field; 0 Qloo calls. Tested on synthetic files only; never run on real data.
- `learning` scorer (`evals/scorers/learning.ts`) with six `t28-*` synthetic cases: a not_me pick never reappears and is in every field's exclusion list, a leaned-away theme's share drops, the floor holds (connection-floor), the cap holds (edge-cap).

**Built, not wired: planner note.** `pastSignalsNote(signals, tagNames)` (words only, no digits, exact signals only) is built and tested, but nothing passes it to the planner. Wiring needs an optional `RunInput.pastNote` (`src/lib/agent/types.ts`), the handler setting it, and `themesMessage` in `src/lib/agent/prompts.ts` carrying it. Those files are not mine; the ticket says "may".

**For docs / other tickets**
- `.claude/skills/atelier-evals/references/scorers.md` does not list `learning`; docs should say learning is signed-in only, exact signals only, and off in replay.
- qloo-param-auditor: the only Qloo change is a longer `filter.exclude.entities` (ids only, at most `RUN_MAX_EXCLUDE`, seeds still included). No new param or call. Please confirm Qloo has no limit on that list in the body.
- No live Qloo or Anthropic call was made, and the report script was not run against real data.
