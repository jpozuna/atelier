# T-19: Remaining code scorers

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-04, T-10

## Goal
Code scorers for dial behavior, re-query logic, domain coverage, path presence, distinctive hop, reach margin, connection floor, provenance, card completeness and seed resolution, all running in `npm run evals`.

## Owns
- evals/scorers/dial-behavior.ts
- evals/scorers/requery-logic.ts
- evals/scorers/domain-coverage.ts
- evals/scorers/path-presence.ts
- evals/scorers/distinctive-hop.ts
- evals/scorers/reach-margin.ts
- evals/scorers/connection-floor.ts
- evals/scorers/provenance.ts
- evals/scorers/card-completeness.ts
- evals/scorers/seed-resolution.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/scorers.md
- evals/harness/
- evals/scorers/index.ts
- src/types/

## Skills
- atelier-evals

## Done when
- [ ] Each scorer matches its definition in `scorers.md` and has a passing and a failing synthetic fixture
- [ ] The handoff lists the registration lines for `evals/scorers/index.ts` (owned by T-04, so the manager adds them)
- [ ] `npm run evals` is green on the synthetic fixtures
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- all named in Goal

## Qloo calls
- none

## Handoff
(Worker fills in.)
