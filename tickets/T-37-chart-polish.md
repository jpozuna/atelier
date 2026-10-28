# T-37: Chart text list fits its column, shorter phone key, AA axis labels

Status: done
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
Changed: src/components/chart/AttributeChart.module.css only (one new `@media (max-width: 40rem)` block before the axis card rules). No markup change, no token change.

1. Text list overflow: does not reproduce, so no CSS change for it. Measured on /picks/preview (synthetic) after the streamed fields arrived, with the text list open and 5, 6 and 12 suggestions ticked or selected. The text list's right edge equals the column's right edge and nothing inside it passes it: 1024 col 24..616, list 24..616; 1280 col 24..776, list 24..776; 1440 col 104..856, list 104..856. The existing `.text { overflow-wrap: anywhere }` and the `minmax(0, 1fr)` chart column hold. Long path lines (lineage hops) wrap inside the column.
2. Phone key at 390 with six fields and seven axes (the preview has seven): 278px before, 212px after (legend toggles 88, note 36, axis key 80, gaps 8). At 320 it is 230px. The note and its weight samples now run on as one paragraph, the axis key uses 18px letters with tighter gaps, and the gaps between the three blocks shrink. Nothing is cut off or overlapping (checked by screenshot, dark and light). The "about 120px" target is not reachable here: the field toggles keep 44px touch targets and two rows of them are 88px alone. The "~170px" in the board predates the toggles. Without toggles the same key is about 150px (note 36 + axis key 80 + legend 1 to 2 rows + gaps). To get nearer 120 on a phone the toggles would have to move out of the key (PicksScreen, not in my Owns) or the 44px floor would have to give; I did neither.
3. Contrast, measured from computed styles in headless Chrome against the page background (no change needed, both already pass AA 4.5:1): dark axis label (and letter marker) rgb(183,187,181) on rgb(14,18,17) = 9.69:1; dark key note, weight sample labels, axis key letters and hint, same colour = 9.69:1; light axis label and key text rgb(74,82,78) on rgb(242,239,234) = 7.02:1. Emphasised axis label (text token) is 16.45:1 in both themes. No ancestor opacity applies to these. No token needs to change.
4. No horizontal page scroll: scrollWidth equals the viewport at 320, 390, 1024, 1280 and 1440.
5. npm run lint, npm run typecheck and npm test pass (101 files passed, 4 skipped; 1565 tests passed).

Qloo calls: none. Scripts and screenshots are in the session scratchpad, not the repo.
Not run: design-reviewer (the ticket lists it).
