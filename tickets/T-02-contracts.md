# T-02: Shared contracts and agent constants

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-01

## Goal
Typed contracts every other ticket builds against (Seed, ProfileTag, Axis, Candidate, Path, Card, Pick, TraceEvent, Band), plus the first version of the tunable constants.

## Owns
- src/types/
- src/lib/agent/config.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-agent-loop/references/path-and-card-schema.md
- .claude/skills/atelier-agent-loop/references/scoring.md
- docs/spike-report.md (the Item fields section)

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] `src/types/` exports Seed (with `status: clean | ambiguous | missing` and candidates), ProfileTag (with `tagType`, `affinity`, `types[]`), Axis (with its member tags), Candidate, Path (seed -> shared theme -> optional lineage hop -> pick, each hop with `provenance: sourced | inferred`), Card (four parts), Pick, Band (`calibration | moderate | high | extreme`) and TraceEvent (one variant per event in the atelier-evals trace format, including `qloo_call` with `cached` and `endpoint`)
- [ ] The types match the path-and-card schema reference. Any change to that schema is listed in the handoff
- [ ] `src/lib/agent/config.ts` holds the reach weights, the connection floor, band edges, `MAX_REQUERIES_PER_RUN = 2`, `MAX_LIVE_CALLS_PER_RUN = 12`, `POOL_TAKE = 50`, `POOL_POPULARITY_MAX = 0.6`, each with a one-line comment
- [ ] Typecheck passes. There is no runtime code beyond constants and type guards
- [ ] A unit test covers each type guard
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- none (contracts only)

## Qloo calls
- none

## Handoff
(Worker fills in.)
