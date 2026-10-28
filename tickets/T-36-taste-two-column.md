# T-36: Taste screen in two columns, next step on the right

Status: done
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
- [x] Left column, top row: "Your taste" title, then on the same row a quiet "Start over" text link and a "Back to my list" secondary button (the start-over confirm step still works and keeps focus handling). Under it the lede, then the chart key note, then (when an axis is pinned) "<axis> is made of" with its tag chips, then the chart
- [x] Right column: the primary "Look past the edge" button at the top, then the "Next" heading and the one-line hint ("Next come suggestions from other fields, each with its path back to what you love."). Skipped-seed and shortfall notes go in the right column under the hint. The right column sticks while the page scrolls, like the picks screen
- [x] New optional chart prop `axisInfoAbove?: boolean` (default false): when true, the pinned-axis tag panel renders after the key and before the plot instead of in the readout below. /taste passes it; /picks is unchanged
- [x] The whole chart with its bottom axis labels is in the first viewport at 1280x800 on /taste
- [x] Below 64rem: no design work (the user said not to worry about mobile); it just stacks without horizontal scroll
- [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass

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
Changed:
- `AttributeChart.tsx`: new optional prop `axisInfoAbove?: boolean` (default false). The pinned-axis "is made of" panel is now one `axisPanel` element (same `id`/`aria-controls` target). When the prop is set it renders after the key (and after `aboveStage` if any) and before the plot, in a `.axisAbove` wrapper (same 860px cap as the key); otherwise it renders in the readout exactly as before. /picks is unchanged (server markup identical).
- `AttributeChart.module.css`: `.axisAbove` joins the shared width-cap rule.
- `TasteView.tsx`: two-column layout. Left: title row ("Your taste", quiet underlined "Start over", bordered "Back to my list"), lede, then the chart with `axisInfoAbove` (key note, pinned tags, plot). Right: gold "Look past the edge", then "Next" heading and hint, then skipped/shortfall notes. The start-over confirm group replaces the two controls in the title row; focus handling (confirm focus on open, back to "Start over" on dismiss) is unchanged.
- `Onboarding.module.css`: `.tasteLayout` (max 64rem, centred), from 64rem a 1fr / 22rem grid, sticky right column with a left rule (as on /picks), chart capped at `max(30rem, (100dvh - 19.5rem) * 1.1)` and left-aligned so the key note lines up with the lede. Old `.actions`/`.startOver` rules removed (unused). `copy.ts` needed no change.
- `AttributeChart.slot.test.ts`: 4 new tests for `axisInfoAbove` (default places the panel after the plot; set places it after the key and before the plot, once; aria-controls target present either way; server render identical when nothing is pinned). They use a small in-memory hook stand-in switched on only for those tests, because the pinned axis is client state.

Measured at 1280x800 headless Chrome, synthetic 7-axis taste session in sessionStorage (no Qloo calls):
- Before pin: h1 top 121; lede ends ~225; key note ~252; plot svg (labels included) y 275 to 750, 537x475, so the whole plot with bottom labels (Water, Memory) and its "Select an axis" hint is inside the 800px first viewport. Right column: primary button y 117-161, "Next" heading 177, hint under it.
- After pinning "Solitude": the panel ("Solitude is made of" with chips Solitude, Exile, Distance, Quiet) sits y 284-363, above the plot; the plot moves down 101px (svg bottom 851), so bottom labels leave the first screen while an axis is pinned. Inherent to putting the tags above the plot.
- Stacked (800 and 390 wide): scrollWidth equals viewport, no horizontal scroll. At 1024x768 the plot bottom is 821 (below the fold); only 1280x800 was the target.
- `npm test` (1560 passed), typecheck, lint, build all pass.

Notes for the manager: README.md shows as modified in git status but was not touched by this ticket. Screenshots are in the scratchpad only, not in the repo. Design-reviewer pass still to do.

### Review fixes
Design review (blocking item first):
1. Chart width floor raised from 30rem to 32.5rem (520px, equal to MARKER_BELOW), so a short window no longer switches to A-G letter markers.
2. From 64rem `.tasteLayout` is `max-width: none` with `minmax(0,1fr) minmax(0,22rem)`, and `minmax(0,1fr) minmax(0,28rem)` from 72rem, same gap as /picks. The title x matches /picks/preview (24 at 1280, 104 at 1440).
3. Pinning no longer moves the plot.
   - With `axisInfoAbove` the `.axisAbove` slot is always rendered, `min-height: 3.2rem`. Unpinned it holds the axis hint (letter wording when narrow); the hint under the plot drops its axis text in that mode (the pick hint stays). Pinned, `.axisAbove .panel` is one flex row (head `nowrap`, chips after it, wraps only if they do not fit).
   - The plot is capped, not the figure: `.stage { max-width: min(860px, var(--chart-plot-max, 860px)) }`. Unset (/picks) it computes to 860px as before; the /picks server markup is unchanged. `.tasteChart` sets `--chart-plot-max: max(32.5rem, calc((100dvh - 20.5rem) * 1.1))` (offset raised from 19.5rem, because the reserved slot adds one row). No need to tighten `.tasteMain` gap; chips stay 44px.
4. `.titleActions .confirm .note { flex: 0 1 auto }`: prompt and both buttons share one row (group 44px tall; the lede does not move).
Code review:
5. Comment in `AttributeChart.slot.test.ts`: the hook stand-in must be extended if AttributeChart gains a new hook type. Two tests changed/added for the new slot: the old "server render identical when nothing is pinned" became "default markup unchanged" (false and undefined identical, axis hint under the plot) plus "holds the slot while nothing is pinned" and "keeps the slot while pinned".

Measured, synthetic 7-axis session, headless Chrome (plot svg width / svg bottom / lowest label bottom vs fold; letter markers 0 in every case; plot top 338 and bottom identical pinned and unpinned):
- 1280x800: 520 / 796 / 784 / fold 800. Pinned panel one row (chips and head at the same y, slot 51px).
- 1440x900: 629 / 903 / 890 / fold 900.
- 1700x1000: 739 / 1010 / 997 / fold 1000.
- At 1280x800 the plot sits on the 520px floor, so the labels clear the fold by 16px (svg box by 4px). No horizontal scroll at any size.
- /picks/preview at 1280x800: stage max-width computes to 860px, unchanged (svg 653 wide). Preview svg bottom is 836 at 1280x800; I had no earlier measurement to diff, the markup test and the computed cap are the evidence.
- `npm test` (1562 passed), typecheck, lint and build pass. Build ran while a dev server was on :3000, so restart it if it looks stale.
