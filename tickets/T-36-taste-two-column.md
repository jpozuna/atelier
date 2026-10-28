# T-36: Taste screen in two columns, next step on the right

Status: todo
Mode: inline
Kind: polish
Priority: P0
Depends on: none

## Goal
The /taste screen matches the user's outline: chart on the left with its title row and lede, the "Look past the edge" step on the right, and a pinned axis's tags shown above the chart instead of below it.

## Owns
- src/components/onboarding/TasteView.tsx
- src/components/onboarding/Onboarding.module.css
- src/components/onboarding/copy.ts
- src/components/chart/AttributeChart.tsx
- src/components/chart/AttributeChart.module.css
- src/components/chart/AttributeChart.slot.test.ts

## Reads
- CLAUDE.md, docs/DECISIONS.md
- The user's outline (described below)
- src/components/deck/PicksScreen.tsx and PicksScreen.module.css (the two-column pattern, 64rem breakpoint, sticky right column; do not edit)

## Skills
- atelier-design

## Done when
The user's outline, from 64rem:
- [ ] Left column, top row: "Your taste" title, then on the same row a quiet "Start over" text link and a "Back to my list" secondary button (the start-over confirm step still works and keeps focus handling). Under it the lede, then the chart key note, then (when an axis is pinned) "<axis> is made of" with its tag chips, then the chart
- [ ] Right column: the primary "Look past the edge" button at the top, then the "Next" heading and the one-line hint ("Next come suggestions from other fields, each with its path back to what you love."). Skipped-seed and shortfall notes go in the right column under the hint. The right column sticks while the page scrolls, like the picks screen
- [ ] New optional chart prop `axisInfoAbove?: boolean` (default false): when true, the pinned-axis tag panel renders after the key and before the plot instead of in the readout below. /taste passes it; /picks is unchanged
- [ ] The whole chart with its bottom axis labels is in the first viewport at 1280x800 on /taste
- [ ] Below 64rem: no design work (the user said not to worry about mobile); it just stacks without horizontal scroll
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass

## Specialists
- tests: yes (slot test: axisInfoAbove order; default unchanged)
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff
