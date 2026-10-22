# T-28: Suggestions learn from the run log

Status: todo
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
- [ ] `adjustFromSignals(input, signals)` (pure) returns the run input with: every `not_me` or `not_interested` entity added to `exclude`; profile weights of tags that appear only in turned-down picks' theme hops lowered, and those in saved picks' theme hops raised, each by a bounded step from config. The connection floor, the cap and the band rules are untouched (hard rule 4)
- [ ] The handler reads the person's signals (by user id when signed in, else by profile hash) server-side and applies them before the loop. No signals means byte-identical input to today. Reading the log makes 0 Qloo calls, and the run still obeys the 12-call cap
- [ ] The planner prompt may receive a short words-only note of past signals (for example "set aside: two picks themed <tag name>"), with no numbers. Code still computes every score (hard rule 8)
- [ ] `scripts/runlog-report.ts` aggregates the log into counts per theme, re-query reason and band of kept versus set-aside picks, and writes only to `.qloo-private/runlog/`. It has `--dry-run` and makes no Qloo calls
- [ ] New `learning` scorer on synthetic fixtures: a not_me pick never reappears, a leaned-away theme's picks drop in share, the floor holds, and the cap holds. `npm test`, typecheck, lint and `npm run evals` pass
- [ ] Nothing numeric about taste reaches the browser, and nothing from the log lands in tracked files

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
