# T-10: Agent loop with tools and re-query

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-08, T-09

## Goal
The agent plans a run (themes to carry, which seeds lead each domain), calls the computed tools, re-queries on computed reason codes within budget, and writes each explanation only from the stored path, streaming trace events as it goes.

## Owns
- src/lib/agent/loop.ts
- src/lib/agent/tools.ts
- src/lib/agent/prompts.ts
- src/lib/agent/explain.ts
- src/app/api/run/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/lib/frontier/
- src/lib/profile/
- src/lib/refs/
- src/lib/agent/config.ts
- src/types/

## Skills
- atelier-agent-loop
- atelier-evals
- qloo-api

## Done when
- [ ] The loop uses the Anthropic API with `ATELIER_MODEL` (default `claude-sonnet-5-5`) and tool use. The model chooses themes and re-queries; code computes reach, connection and popularity
- [ ] Re-queries happen only on reason codes (`too_obvious`, `too_weak`, `empty`, `weak_connection`), at most 2 per run in total, each logged with its code
- [ ] A full new run for 6 domains makes at most 12 live Qloo calls, and a rerun of the same profile makes 0 (the call-budget scorer passes)
- [ ] Each card's explanation is generated from its Path only. The prompt receives the path and its retrieved text, nothing else about the entity
- [ ] `POST /api/run` streams TraceEvents (server-sent events) and finishes with picks by band and domain
- [ ] A stub for T-09 is allowed if it is not done; the handoff says so
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: yes
- design-reviewer: no
- research question: none

## Evals
- re-query-logic
- call-budget
- path-presence
- distinctive-hop
- param-validity

## Qloo calls
- via T-07 and T-08 only: /v2/insights POST (pools, re-queries), /v2/insights urn:tag

## Handoff
(Worker fills in.)
