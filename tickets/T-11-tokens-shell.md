# T-11: Design tokens and app shell

Status: todo
Mode: inline
Kind: feature
Priority: P0
Depends on: T-01

## Goal
Atelier's look as tokens and a shell component (wordmark placeholder, serif type, quiet chrome, light and dark), so every screen starts from the same base.

## Owns
- src/styles/tokens.css
- src/components/shell/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md

## Skills
- atelier-design

## Done when
- [ ] `tokens.css` defines color, type scale, spacing, radius and motion tokens for light and dark. The display serif and text faces load through `next/font`
- [ ] A `<Shell>` component renders the text wordmark, the main region and an optional side region for the reasoning panel
- [ ] The handoff gives the manager the exact lines to add to `src/app/layout.tsx` (the manager owns it)
- [ ] Contrast meets WCAG AA in both themes. Visible focus states. Motion respects `prefers-reduced-motion`
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
- none

## Handoff
(Worker fills in.)
