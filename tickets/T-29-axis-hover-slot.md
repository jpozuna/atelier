# T-29: Axis hover card and a slot above the plot

Status: todo
Mode: inline
Kind: polish
Priority: P0
Depends on: none

## Goal
Hovering or focusing an axis on the attribute chart shows a small card with that axis's info (its name and the tags it is made of), and the chart can take content to render between its key and the plot, so the picks screen can put its suggestion list there (T-30).

## Owns
- src/components/chart/AttributeChart.tsx
- src/components/chart/AttributeChart.module.css
- src/components/chart/ChartDemo.tsx
- src/components/chart/axisHover.test.ts (new, if a pure helper is extracted, e.g. card placement)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- src/components/chart/geometry.ts, marks.ts, TagChip.tsx, index.ts
- src/components/deck/PicksScreen.tsx (the caller; do not edit)
- src/types/ (Axis shape)

## Skills
- atelier-design

## Done when
- [ ] Pointer over an axis (label, spoke or hit area) shows a hover card near that axis's label with the axis name and its tag names, within ~150ms, and hides on pointer leave. Keyboard focus on an axis shows the same card. Escape hides it
- [ ] The card stays inside the chart's box at 1280x800 and at 390px wide (flips side or clamps near edges) and never covers the axis it describes
- [ ] The card is read-only text (no buttons inside), is tied to the axis with `aria-describedby`, and respects reduced motion. Click/Enter still pins the axis and shows the existing tag chips as now
- [ ] Narrow layout (letter markers): hovering or focusing a letter shows the same card with the full axis name
- [ ] New optional prop `aboveStage?: ReactNode` renders after the key (figcaption) and before the plot. Omitted, the chart renders exactly as before
- [ ] Polish item from BOARD: the "Read this chart as a list" block no longer overflows the left column at 1280 with several picks selected
- [ ] No taste scores or numbers in the card (hard rule 7). `npm test`, `npm run typecheck`, `npm run lint` pass

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff
