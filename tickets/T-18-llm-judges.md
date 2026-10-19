# T-18: LLM judges in the eval harness

Status: todo
Mode: inline
Kind: feature
Priority: P1
Depends on: T-04, T-10

## Goal
The judge rubrics run as scorers over recorded or synthetic runs: bridge groundedness, bridge quality, stretch defensibility, lineage groundedness, reading restraint and rubric fit.

## Owns
- evals/judges/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-evals/references/judge-rubrics.md
- .claude/agents/bridge-judge.md
- evals/harness/

## Skills
- atelier-evals

## Done when
- [ ] Each judge has a rubric prompt, a structured output and a calibration set of synthetic good and bad cards
- [ ] `npm run evals:judges` runs them on synthetic fixtures and reports pass rates. The model comes from an env var
- [ ] Each judge agrees with its calibration labels on at least 80%
- [ ] No Qloo data is written to tracked files
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: no
- research question: none

## Evals
- bridge-groundedness
- bridge-quality
- stretch-defensibility
- lineage-groundedness
- reading-restraint
- rubric-fit

## Qloo calls
- none

## Handoff
(Worker fills in.)
