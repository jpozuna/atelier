# T-29: Axis hover card and a slot above the plot

Status: done
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
- src/components/chart/AttributeChart.hover.test.ts, src/components/chart/AttributeChart.slot.test.ts (added by test-writer)

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
Changed (all under Owns):
- `AttributeChart.tsx`: hover or focus on an axis (label, spoke, hit area, or the letter marker when narrow) shows a read-only card (`role="tooltip"`, no buttons) with the axis name and its tag names, joined by commas. No delay beyond a 160ms fade (`--motion-fast`, none under reduced motion). The axis gets `aria-describedby` to the card only while it shows. Pointer leave and blur hide it. Escape hides it, also when only the pointer is over the axis (a window listener while the card is open). Click, Enter and Space still pin the axis and show the chips as before; the card is separate from the pinned panel.
- Placement is a pure, exported helper `placeAxisCard(anchor, card, bounds)` plus `estimateCardSize(...)`, both in `AttributeChart.tsx` (no new non-test file, since only the test file was listed under Owns). It tries the side facing away from the chart's centre first, then the other sides, takes the first where the card fits wholly inside the stage box and clear of the axis's hit area, and slides along that side to stay inside. Card width is at most 248px and shrinks to fit a 390px column. `axisHover.test.ts` covers 390 and 860 wide boxes with anchors all round the rim.
- New optional prop `aboveStage?: ReactNode`: rendered in a `.above` wrapper (same width cap as the key) after the `figcaption` and before the plot. Omitted, no extra element renders.
- CSS: `.stage` is now `position: relative`. Overflow fix for the list block: `.chart` gets `min-width: 0; max-width: 100%`; `.key/.above/.hint/.readout/.text` get `min-width: 0`; `.text` and `.listButton` wrap long text (`overflow-wrap: anywhere`). I could not reproduce the ~40px overflow in a browser (no dev server run, to avoid fighting the other workers), so this is a defensive fix on the likely causes (the figure as a grid item in `PicksScreen`'s `.chart` section had `min-width: auto`). Please confirm at 1280 with several picks selected.
- `ChartDemo.tsx`: a "Content above the plot" toggle on `/dev/chart` exercises the slot (reuses the existing `.note` class).

Contracts: `AttributeChartProps.aboveStage`; the card is `#<useId>-axiscard`. No Qloo calls, no numbers in the card.

Gaps: card height is estimated from text (a bit generous), not measured. Not checked visually at 1280 or 390; design-reviewer should check the card at both and the list overflow. Checks run: `npx vitest run src/components/chart`, `npm run typecheck`, eslint on `src/components/chart` all pass (did not run the full `npm test` or `npm run build`).

### Review fixes
1. Card stuck after a click (medium). Added `keyFocusAxis` state: only focus that matches `:focus-visible` (checked in `onFocus` through a small `focusIsVisible(el)` helper, which treats an unsupported selector as keyboard focus) opens the card. A mouse click or touch tap still sets `focusAxis` (for the emphasis) but not `keyFocusAxis`, so no card is left behind after the pointer leaves. The card is also never shown for the pinned axis (`cardAxisId` is null when the candidate equals `pinnedAxis`); the tag chips cover it. `keyFocusAxis` is cleared on blur, Escape, `closeAxes` and when an axis is pinned. Tests added in `AttributeChart.hover.test.ts`: click/tap focus shows no card and none returns after unpin, tap then pin leaves no card, pinned axis shows no card by pointer or keyboard (another axis still does), Enter on a focused axis hides its card. Existing focus tests now pass a keyboard-focus event.
2. Vertical/horizontal overflow (low). `placeAxisCard` now adds the cross-dimension overshoot (card taller than the box beside a left/right side, wider than the box above/below) to a side's overflow, so a side counts as fitting only if it fits in both dimensions. The fallback (no side fits) picks the least total overflow. New `axisHover.test.ts` tests: a tall card (14 tags) at 390 wide, anchors all round the rim, stays inside the box and clear of the anchor's hit area; a card too tall for the box is not taken as a fit on a side.
3. Narrow layout prefers outside the rim (low, design). Done, kept simple: `placeAxisCard` takes an optional `avoid` disc (the ring: centre and `rOuter`, in box units); among the sides that fit, one that keeps the card off the disc wins, else the first fitting side (overlays the plot). `AttributeChart` passes the disc only when `narrow`. Limit to know: the stage box is cropped to the ring plus markers, so room outside the ring exists only in the corners and beside markers near them. A 248px card rarely fits there at 390 wide, so in practice most cards still overlay the plot. Placing it outside the stage box (above or below the figure) was not done: it would need the card to leave the stage's box, which breaks the "stays inside the chart's box" item and the overflow clipping of the picks column. Tested with a unit test on a corner anchor (small card goes beside the axis, off the disc; a column-wide card still lands inside the box and clear of the axis).

Checks: `npx vitest run src/components/chart` 111 passed; `npx eslint src/components/chart` clean; `npm run typecheck` has two errors, both in `src/app/api/run/handler.ts` (another worker's file, `onDomain` not in `RunDeps`), none in the chart files.
