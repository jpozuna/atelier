# T-30: Suggestion list above the chart, reasoning on the right

Status: done
Mode: inline
Kind: polish
Priority: P0
Depends on: T-29

## Goal
On the picks screen the edge suggestion list ("At the edge of your taste") sits above the plot, under the chart key (the field marks and "Farther out is less familiar" line), and opening a suggestion shows its reasoning in the right-hand column instead of under the chart.

## Owns
- src/components/deck/PicksScreen.tsx
- src/components/deck/PicksScreen.module.css
- src/components/deck/ReasoningArea.tsx
- src/components/deck/ReasoningArea.module.css
- src/components/deck/SuggestionList.tsx
- src/components/deck/SuggestionList.module.css
- src/components/deck/copy.ts
- src/components/deck/render.test.ts

## Reads
- CLAUDE.md, docs/DECISIONS.md
- tickets/T-29-axis-hover-slot.md (its hand-off: the `aboveStage` prop)
- src/components/chart/AttributeChart.tsx (do not edit)
- tickets/T-25-suggestion-list.md (current screen's contract)

## Skills
- atelier-design

## Done when
- [ ] From 64rem: left column is title, chart key, the edge suggestion list (passed through `aboveStage`, compact enough that the plot still starts in the first viewport at 1280x800, e.g. a capped-height scroll area or a horizontal row), then the plot. Field toggles, sort and ticking keep working
- [ ] From 64rem: right column shows the close picks ("Close to what you named") when nothing is open. Opening a suggestion (list row or chart node) shows its reasoning card in the right column with a clear "Back to suggestions" control; Close/Back returns focus to the row or node it came from. Nothing opens under the chart any more
- [ ] Below 64rem: the page stacks key, list, chart, then the reasoning card opens in place of the close picks section, and the phone "back to list" bar still works
- [ ] Hover preview, ticking, set-aside, re-run, field toggles, revisit restore and the screen-reader announcements behave as before (existing deck tests pass, render tests updated for the new order)
- [ ] At 1280 with several picks ticked, the chart's "Read this chart as a list" block does not overflow the left column (if it does, fix it in PicksScreen's `.chart` grid, e.g. `grid-template-columns: minmax(0, 1fr)`)
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass. `/picks/preview` shows the new layout

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
- `PicksScreen.tsx`: the edge suggestion block (heading, lede, field toggles, sort, field notes, list) is built once and passed to `AttributeChart` as `aboveStage`, so it sits after the key and before the plot, at every width. The side panel (`.panel`) now holds one thing at a time: the close picks ("Close to what you named") when nothing is open, or the `ReasoningArea` card when a suggestion is open. Nothing opens under the chart. Below 64rem the panel is simply the next block after the chart (key, list, chart, then close picks or card). The old `.reasoning` and `.reasoningIdle` wrappers are gone.
- Focus: opening (row, tile or chart node) still focuses the card title. "Back to suggestions" returns focus to the origin. A close pick's tile is unmounted while its card is open, so `origin` is now a DOM id for list rows and tiles (re-found after the re-render, falls back to the chart section) and an element for chart nodes. The panel scrolls to its top when the open pick changes. Opening from a list clears the hover preview (the tile leaves without a pointer-leave). The phone "Back to the list" bar falls back to the edge heading when the open pick has no row.
- `ReasoningArea.tsx/.css`: "Back to suggestions" leads and ends the card (replaces "Close"; `COPY.close` removed, `COPY.backToSuggestions` added, `COPY.panelLabel` is now "Close picks and reasoning"). The empty-state branch of the component is kept (tests use it) but the screen no longer renders it.
- `SuggestionList.tsx/.css`: new optional props `tools` (first in the toolbar, used for the field toggles) and `notice` (between toolbar and rows, used for field notes and "every field hidden"). Rows sit in a `role="group"` box labelled `COPY.listLabel` that scrolls inside itself: max 22rem/50dvh below 64rem, 9.5rem from 64rem, where rows run in two columns.
- `PicksScreen.module.css`: `.chart` gets `grid-template-columns: minmax(0, 1fr)`; the viewport-height width cap on `.chart` is removed (the list now sits above the plot, so that formula no longer applies; the chart's own 860px cap rules); new `.edge*` styles.
- Tests (`render.test.ts`): Back to suggestions twice and no Close; `tools`/`notice` order; new "PicksScreen order" tests render the whole screen from a stubbed sessionStorage restore and assert title, key, edge heading, list, plot, then close picks after the figure, with no reasoning card or empty note when nothing is open.

Checked in Chrome headless against the dev server on `/picks/preview` (1280x800 and 390 wide): list above the plot, close picks on the right, opening a row shows the card in the right column, Back returns focus to the row; opening from a chart node and Back returns focus to the node; ticking 8 picks leaves the page at 1280 wide with no horizontal overflow (the figure's text list does not overflow the left column; the list box's 4px negative margin, there to keep focus rings from being clipped, is the only thing past the figure edge). At 390 the page stacks key, list, chart, close picks, with no horizontal scroll.

Known gaps:
- At 1280x800 on `/picks/preview` the plot top is at about 770px, but that page has about 65px of demo buttons above the title that the real `/picks` page does not. On the real page it should start around 700px, so a small slice of the plot is in the first viewport and the rest is one scroll away. A tighter fit needs the field toggles and the sort on one row, which means touching `Deck.module.css` (not in Owns).
- `npm run build` not run: it would rewrite `.next` under the running dev server and the other workers. `npm test` (all 1437), `tsc --noEmit` and eslint on `src/components/deck` pass.
- Not covered by tests (no browser): focus return, panel scroll reset and the capped list scroll; checked by hand as above. design-reviewer should look at 1280 and 390, and at the open card with the panel scrolled.

### Review fixes
1. Focus on open no longer scrolls past "Back to suggestions". From 64rem: the title takes focus with `preventScroll` and the panel's `scrollTop` is set to 0. Below 64rem: `scrollIntoView({block:"start"})` on the ReasoningArea section (`.area` has `scroll-margin-top`). Checked in headless Chrome at 1280 (Back at the panel's top, panel scrollTop 0, focus on the title, Back returns focus to the row) and at 390 (section top at 0 after opening a close pick from the bottom of the page).
2. Plot top on `/picks/preview` at 1280x800: 769px before, 611px after (the preview has about 65px of demo buttons, so about 546px on the real `/picks`). What changed: the heading and the sort share one row (`SuggestionList` takes new `heading` and `lede` props; sort, count and Clear sit together at the right of that row; `tools` now has its own row under the lede); per-field notes (`notice`) moved to the end of the scrolling box; `.lede` hidden from 64rem; `COPY.edgeLede` is now one line at 1280 ("Stretch is distance from your profile's centre. Each links to something you shared; none predicts how much you will like it."); `.edge` border and padding dropped from 64rem.
3. The selected row no longer grows an "Open on the chart" line: the visible state is the fill and border only, and the text stays as `sr-only` (row height 63px before and after opening).
4. Overflow cue: the scrolling box is wrapped in `.scroller`; when `scrollHeight` exceeds what is showing (measured on mount, scroll, resize, list change) a bottom fade and the words "More below" appear (`aria-hidden`). A screen-reader summary is the first child in the box (`COPY.listSummary`: "N suggestions, in a list that scrolls."). It is "all N, scrolls" rather than "Showing N of M", since every row is in the DOM. No scores or ranks.
5. Lows: the re-running note and the re-run error also show above the card while it is open; `openFromChart` clears `previewId`; the phone bar is now an exported `ChartBar` (in `SuggestionList.tsx`) rendered at the end of `PicksScreen`'s layout, so it sticks at the plot and the panel too (`SuggestionList` lost its `onViewChart` prop and renders no bar); `overscroll-behavior: contain` on the list box is now 64rem and up only. `PickTile`'s `selected` prop is required and PickTile is not in Owns, so `selected={false}` stays.
6. Tests: updated for the new order (heading, sort, lede, tools, rows, notice inside the box), `ChartBar`, and the scroll summary / no `data-more` on the server. Not added: a "card (not the close picks) is in the panel when a pick is open" assertion on the whole screen. `focusId` is internal state that starts null and the server-render test approach cannot click, so it is not reachable without adding a test-only prop; `ReasoningArea` rendering the card is already covered. Open-state behaviour was checked in the browser instead.

Checks: `npx vitest run src/components/deck` (144 pass), `npm run typecheck`, `npx eslint src/components/deck` all clean.
