# T-08: Frontier scoring, bands and dial

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-07

## Goal
Score one candidate pool per domain for reach and connection, bucket it into calibration, moderate, high and extreme, and enforce the connection floor and fallback order, all in code.

## Owns
- src/lib/frontier/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-agent-loop/references/scoring.md
- docs/spike-report.md (probes 6, 10, 11, 18)
- src/lib/agent/config.ts
- src/types/

## Skills
- atelier-agent-loop
- atelier-evals

## Done when
- [ ] `buildPool(domain, profile, exclusions)` makes ONE insights POST per domain (`take=50`, `filter.popularity.max=POOL_POPULARITY_MAX`, `feature.explainability`, seeds weighted toward the axis being explored, all seeds and shown picks excluded)
- [ ] Reach uses popularity ranked within the pool (not absolute values; brand popularity 0 counts as unknown), tag distance and field unfamiliarity. Connection uses shared rare tags, bridge tags, explainability (anchor seed = top scorer) and lineage when present. Cross-domain presence alone is never counted as connection (backfill is invisible)
- [ ] Bands are computed from one pool: calibration (highest affinity and popularity), then moderate, high, extreme by reach. Every shown pick clears `CONNECTION_FLOOR`. An empty band relaxes reach one band, never connection, and says so in the trace
- [ ] No band ever triggers its own Qloo call
- [ ] Tests: the dial-behavior, reach-margin and connection-floor scorers pass on synthetic fixtures
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: yes
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- dial-behavior
- reach-margin
- connection-floor
- call-budget

## Qloo calls
- /v2/insights POST: filter.type, signal.interests.entities [{id, weight}], filter.popularity.max, filter.exclude.entities, feature.explainability, take

## Handoff
(Worker fills in.)
