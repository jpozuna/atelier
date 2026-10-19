# T-04: Eval harness and first scorers

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-03

## Goal
A runner that replays a trace against scorers, with synthetic fixtures and the first three scorers, so every later behavior change can be measured.

## Owns
- evals/harness/
- evals/fixtures/
- evals/run.ts
- evals/scorers/repo-hygiene.ts
- evals/scorers/param-validity.ts
- evals/scorers/call-budget.ts
- evals/scorers/index.ts

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/scorers.md
- src/types/
- src/lib/qloo/registry.ts

## Skills
- atelier-evals

## Done when
- [ ] `npm run evals` runs every registered scorer on the synthetic fixtures and prints pass/fail per scorer. It exits non-zero on any failure
- [ ] `npm run evals:live` exists. It refuses to run unless `QLOO_LIVE=1`, and it prints the expected number of live calls first. Recordings go to `.qloo-private/evals/`
- [ ] The `repo-hygiene` scorer fails on any tracked file containing a non-synthetic UUID, a `urn:tag:` id with a value part, a `hack_` key, or raw Qloo JSON
- [ ] The `param-validity` scorer checks every `qloo_call` event against the registry
- [ ] The `call-budget` scorer fails a run with more than 12 live calls, a repeat view with more than 0, or more than 2 re-queries
- [ ] Fixtures are synthetic and match the item shapes described in `docs/spike-report.md`. A fixture-shape test proves the T-03 parsers read them
- [ ] CLAUDE.md eval commands are given to the manager in the handoff (the manager writes them)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- repo-hygiene
- param-validity
- call-budget

## Qloo calls
- none

## Handoff
(Worker fills in.)
