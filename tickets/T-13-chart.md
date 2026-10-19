# T-13: Attribute chart

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
The centerpiece chart: the profile's axes, the user's shape, and pick nodes beyond the edge (distance = reach, line weight = connection), where selecting a node highlights its path.

## Owns
- src/components/chart/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/types/
- src/styles/tokens.css

## Skills
- atelier-design

## Done when
- [ ] Renders 6 to 8 axes with labels, and the profile shape from axis weights. Hovering or focusing an axis lists its tags
- [ ] Pick nodes sit outside the shape at radius by reach, with one mark per field and line weight by connection strength
- [ ] Selecting a node (click or keyboard) highlights its path and calls `onSelect(pick)`
- [ ] Built and demoed against synthetic mock data (a story or test page under the component folder)
- [ ] No scores, ranks or numbers are shown to the user (hard rule 7)
- [ ] Has an accessible text alternative (a list of axes and picks)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none

## Handoff
(Worker fills in.)
