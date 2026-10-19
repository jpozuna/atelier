# T-15: Pick card

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
The four-part card: the path back to the user, why this one, what is different, and provenance per hop, followed by the user's reaction in their own words.

## Owns
- src/components/card/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- .claude/skills/atelier-agent-loop/references/path-and-card-schema.md
- src/types/

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [ ] Renders the path as seed -> theme -> [lineage] -> pick, labeling each hop sourced (with a link) or inferred. Readings are labeled "a reading". Provenance is shown in words ("Sourced", "Inferred", "a reading"), not only by the solid and dashed line tokens, since the two hues are close in luminance
- [ ] Shows why this one and what is different, from the Card fields only
- [ ] A reaction area offers the four save states and a free-text why box. Emits `onReact`
- [ ] No scores or rankings shown
- [ ] Built against synthetic mock cards, with an accessible structure (headings, lists)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: yes
- research question: none

## Evals
- card-completeness
- provenance

## Qloo calls
- none

## Handoff
(Worker fills in.)
