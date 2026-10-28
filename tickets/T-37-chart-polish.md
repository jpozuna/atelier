# T-37: Chart text list fits its column, shorter phone key, AA axis labels

Status: todo
Mode: inline
Kind: polish
Priority: P1
Depends on: none

## Goal
Three chart polish items from the board's "Polish after freeze" list: "Read this chart as a list" never runs past the left column, the key above the chart on a phone is shorter, and axis labels meet WCAG AA contrast in the dark theme.

## Owns
- src/components/chart/AttributeChart.module.css
- src/components/chart/AttributeChart.tsx (key markup only, if the phone key needs it)

## Reads
- tickets/BOARD.md ("Polish after freeze")
- src/components/deck/PicksScreen.module.css (the left column the chart sits in; do not edit)
- src/components/onboarding/Onboarding.module.css (the taste screen's chart column; do not edit)
- src/styles/tokens.css (do not edit; if a token must change, say so in the hand-off)
- /picks/preview (synthetic, 0 Qloo calls) for checking

## Skills
- atelier-design

## Done when
- [ ] At 1280x800 on /picks/preview with 4 or more suggestions ticked and the text list open, the text list's right edge is inside the left column (measured: its bounding box right <= the column's right). Same at 1024 and 1440.
- [ ] At 390px wide (phone), the key block above the plot (legend, weight note, axis key) is at most about 120px tall with six fields and six axes, down from about 170px, and nothing in it is cut off or overlapping.
- [ ] Axis label text and the muted key text meet 4.5:1 against the page background in the dark theme (and the light theme still does). The hand-off lists each measured ratio.
- [ ] No horizontal page scroll at 390, 1024, 1280 or 1440.
- [ ] npm run lint, npm run typecheck, npm test pass.

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff
(Worker fills in.)
