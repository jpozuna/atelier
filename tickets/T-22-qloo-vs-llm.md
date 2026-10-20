# T-22: Qloo vs plain-LLM side-by-side

Status: todo
Mode: inline
Kind: feature
Priority: P2
Depends on: T-10

## Goal
A demo and eval view showing the same profile's picks from Atelier and from a plain LLM with no Qloo grounding, to show what grounding adds.

## Owns
- src/app/(compare)/
- src/app/api/compare/
- src/components/compare/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/app/api/run/
- src/components/card/

## Skills
- atelier-design
- atelier-evals

## Done when
- [ ] Side-by-side for one profile, with plain-LLM picks clearly labeled ungrounded
- [ ] Uses cached Atelier runs only (0 live Qloo calls)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none (cached runs only)

## Handoff
(Worker fills in.)
