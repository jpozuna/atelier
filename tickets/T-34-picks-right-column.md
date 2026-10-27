# T-34: Suggestions at the top of the right column, one quiet control

Status: done
Mode: inline
Kind: polish
Priority: P0
Depends on: T-33, T-35

## Goal
The picks screen is calm and the suggestions are hard to miss: the chart has the left column to itself, and the edge suggestions are the first thing in the right column, with no sort or field menus. Fields are filtered from the chart key (T-33). Picks appear per field as they arrive (T-35).

## Owns
- src/components/deck/PicksScreen.tsx
- src/components/deck/PicksScreen.module.css
- src/components/deck/SuggestionList.tsx
- src/components/deck/SuggestionList.module.css
- src/components/deck/ReasoningArea.tsx
- src/components/deck/ReasoningArea.module.css
- src/components/deck/FieldToggles.tsx (delete if unused)
- src/components/deck/Deck.module.css
- src/components/deck/suggestions.ts, suggestions.test.ts (drop the sort if nothing else needs it)
- src/components/deck/copy.ts, copy.test.ts
- src/components/deck/render.test.ts
- src/components/deck/PicksDemo.tsx (schedule T-35's `domainSteps(...)` in `demoSource` before the final result, per T-35's hand-off)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- tickets/T-33-key-filters-fields.md and tickets/T-35-early-picks-state.md (hand-offs)
- tickets/T-30-picks-layout.md (current layout and focus contract)
- src/components/chart/AttributeChart.tsx (do not edit)

## Skills
- atelier-design

## Done when
- [ ] From 64rem, left: title, the chart's key (now the field filter, via `onToggleField`/`hiddenFields`/`fieldsInKey`), the whole chart. Nothing passed through `aboveStage`. The whole plot, with its bottom axis labels, is in the first viewport at 1280x800 on /picks (restore the viewport-height width cap)
- [ ] From 64rem, right column, top to bottom: "At the edge of your taste" with a one-line lede, the suggestions grouped by field (each row keeps its stretch word and tick box), then "Close to what you named". At 1280x800 at least four suggestion rows are visible without scrolling. No sort control, no field-toggle row, no "Sort by"/"Fields" labels. Opening a suggestion still shows the reasoning in the right column with "Back to suggestions"; Back returns focus to the row or node
- [ ] Below 64rem: title, key, chart, the suggestions, then the close picks. No horizontal scroll at 390
- [ ] Hiding a field from the key removes its picks from the chart and the list, keeps the announcements and focus on the key button, and the "all hidden" note still shows when needed
- [ ] Early picks: the screen renders `shownResult(state)` (T-35; not `result ?? partial`) and keeps `state.result` for storage, the saver and re-run bodies. While `pendingFields(state)` is non-empty, one quiet line says which fields are still coming. A failed stream that delivered some fields shows those picks plus a calm note and retry, not the bare failure screen. Nothing partial is saved for a revisit
- [ ] Ticking, hover preview, set-aside and re-run, revisit restore and the phone "back to list" bar behave as before. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass. `/picks/preview` shows the new layout and picks arriving per field

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

What changed (all under Owns):
- Layout. Left column from 64rem: title (with a one-line muted hint "Select a field in the key to hide it." on the same row, right-aligned, so it costs no height), the chart whose key is the field filter (`hiddenFields`, `fieldsInKey` = fields in the shown result, `onToggleField`), nothing through `aboveStage`. The viewport-height width cap is back on `.chart` (`max-width: max(40rem, calc((100dvh - 17.6rem) * 1.3))`). Right column (the sticky panel), top to bottom: "At the edge of your taste", the lede "Each links to something you shared.", the suggestions by field (checkbox + name + "Beside X . Low/Medium/High stretch"), per-field notes, then "Close to what you named". Opening a suggestion swaps both blocks for the reasoning card with "Back to suggestions", as before. Below 64rem: title, hint, key, chart, suggestions, close picks.
- Removed: the sort control, the field-toggle row and the capped scrolling box with its fade and "More below". `FieldToggles.tsx` is deleted; its styles are out of `Deck.module.css`. `SuggestionList` lost `sort`, `onSort`, `tools`; gained `status` (quiet lines between the lede and the rows). Rows sit in one column in the panel and in `auto-fill` columns when stacked wide.
- Early picks. The screen renders `shownResult(state)` for the chart, list, notes, close picks and field ids; `state.result` still feeds storage, the saver, the ready announcement and the re-run body. While `pendingFields(state)` is non-empty in a full run, one quiet line "Still coming: Film, TV." sits under the lede (a re-run shows the existing "Looking again at that field." instead). A failed full run with `partial` shows the picks plus `COPY.partialStopped(missing)` and a "Try again" button (`retry`) at the top of the edge section, in place of the bare failed screen; with nothing delivered the bare `Failed` section is unchanged. `not_ready` is unchanged.
- Focus: key button id `chart-key-{field}` (local `keyDomId`); hiding or showing keeps focus on it and speaks "X is hidden/shown". Phone "Back to the list": with a card open it now also closes the card and focuses the last ticked row, else the open pick's row, else the edge heading (the list is not in the DOM while a card is open).
- `PicksDemo.tsx`: `domainSteps(...)` scheduled one field every 2 steps after the trace, before the result; a re-run sends only the refreshed fields; new scenario "A run that stops partway" (two fields, then an upstream error); "fails" and "not enabled" send no fields.
- Copy: `edgeLede` shortened, `lede` reordered to match (edge first), new `keyHint`, `stillComing`, `partialStopped`, `calibrationComing` (close section while picks are still arriving); removed `sortLabel/sortField/sortStretch/fieldsHeading/fieldsHint/hideField/moreBelow`; `listSummary` is now "N suggestions." (no scroll wording). `hidden` and `deckEmpty` etc. kept.
- `suggestions.ts`: the sort argument now defaults to "field". It is not dropped because `derive.test.ts` (not in Owns) still calls `edgeSuggestions(decks, "stretch")`. Nothing in the UI uses it.
- Tests: `render.test.ts` (list has no sort, no buttons but the rows, no scroll cue; heading/lede/status/rows/notice order; whole screen: title, key, plot, then the panel starts with the edge heading and then close picks; no "Sort by"/"Fields"/"Hidden"; key buttons `chart-key-*` with aria-pressed; hint text), `copy.test.ts` (removed keys, new lines, no error words).

Measured in headless Chrome against the dev server on /picks/preview (no Qloo calls):
- 1280x800, demo buttons hidden to match the real /picks (the preview has ~76px of scenario buttons above the title): plot 250 to 751, lowest axis label text ends at 746, so the whole plot with its bottom labels is inside the 800px viewport; the chart's own note line is at ~775. With the demo buttons showing (as /picks/preview renders): plot bottom 827, labels cut off, so check on the real page, not the preview. 1440x900: plot bottom 828 (fits). 1024x768 (just over 64rem): plot top 407, bottom 887 (does not fit; narrow left column makes the key wrap; no regression target for this ticket).
- Right column at 1280x800: edge heading at y=193 (preview) / 117 (no demo buttons); 6 suggestion rows fully visible with the demo buttons, 7 without. Lede is one line.
- 390x844: no horizontal scroll (scrollWidth 390); order title, hint, key, chart, edge heading (y=1257), close picks; opening a row puts the card section at the top with Back to suggestions twice; "Back to the list" with a card open focuses the ticked row and the list is back.
- Checked by script: hiding Music removes its group and keeps focus on `chart-key-music` ("Music, hidden", "Music is hidden."); showing returns it; all six hidden shows "Every field is hidden..." and the keys stay; opening a row focuses the card title, Back returns focus to that row; ticking shows "2 suggestions on the chart" with Clear. Early picks: at ~8s Music only with "Still coming: Film, TV, Books, Food and places, Fashion.", then more per field, line gone at the end. Stopped scenario shows Music and Film, the note and "Try again", no failed screen.

Checks: `npm test` (1556 pass), `npm run typecheck`, `npm run lint`, `npm run build` all pass. No Qloo calls.

Known gaps:
- The key hint is separate from the chart's own note line (T-33's note), in PicksScreen's title row; at stacked widths it sits under the lede, above the key.
- While a card is open the list is not on screen, so ticking needs Back first (the card replaces the whole panel content, as in T-30).
- No automated test for the early-picks wiring in `PicksScreen` (needs a client render); logic is covered by `run-state.test.ts` and the behaviour was checked in the browser via the preview scenarios.
- Not shown on /picks/preview but real: with picks arriving, the chart key gains one entry per arriving field.

## Review fixes

Bugs
- "Not me" on a stopped run's partial picks (no `state.result`): the button is `notMeBusy` (`streaming || !state.result`), and a keyboard press shows `COPY.notMeStopped` ("Not me works once the picks have all arrived. Try again first.") instead of a full run with a thin result.
- Reactions on early picks: kept locally; `react` saves through the saver only when the pick is in `state.result`, otherwise it is held in `pendingReactions`. When the final `state.result` arrives, held reactions whose pick is in it are saved, the rest are dropped. Nothing partial is saved.
- `not_ready` after early domain events: the picks stay, with the same calm stopped note and no retry button; the existing NotReady section (its copy and link back) still shows below the chart.
- "Try again" is outside the `role="status"` note.
- `retry()` clears `checked`, `focusId`, `previewId` and `calibrationNote`.
- Close picks empty during a re-run shows `calibrationEmpty`; `calibrationComing` only for a full run still receiving fields.

Copy
- `edgeLede` is now the stretch definition: "Stretch is distance from your profile, not a grade. Select one to see its path back to you." It wraps to two lines in the panel at 1280 and at 1024 (one line does not fit the 448px panel at this size); the page lede is not drawn at any width.
- `partialStopped(missing)` uses a list-join helper: "The run stopped early. TV, Books, Food and places and Fashion did not arrive; the rest are shown."
- New: `keyHint` "Select a field to hide it.", `suggestionsBelow`, `closeBelow` ("Close to what you named, below"), `notMeStopped`.

Design
- Key hint: shown only with 2+ fields in the key, left-aligned in a row directly above the chart key (inside the chart section), no longer on the title row.
- Phone (<64rem): page `.lede` hidden; a quiet "Suggestions below" text link sits on the hint's row (scrolls to and focuses the edge heading; not drawn from 64rem or while a card is open).
- Panel: "Close to what you named, below" text link after the last field group and notes (scrolls only the panel from 64rem, so the chart stays put). Re-run status lines ("Looking again at that field.", set-aside note, re-run error) now lead the panel, not the close-picks section.
- 64 to 72rem: the panel is 22rem wide (`minmax(0, 22rem)`), which keeps two columns and keeps the key to fewer lines. The viewport-height cap now uses 18.6rem (was 17.6rem) to give the hint's row room. The hint is not hidden at any width.

Measured (headless Chrome, /picks/preview, demo buttons hidden, no Qloo calls)
- 1280x800: plot 279 to 760, lowest label bottom 754 (inside 800; the chart's own note line is in view at ~784); 7 suggestion rows fully visible; edge heading y=117; hint left edge equals the key's left edge; lede two lines.
- 1024x768: plot 303 to 725, labels end 720 (inside 768; was plot 435 to 916, off the screen); 7 rows visible; no horizontal scroll. The key is 97px tall (was 229px).
- 390x844: edge heading y=1023 (was 1257); "Suggestions below" link at y=186 with the hint; no horizontal scroll.
- Checked in the browser: stopped scenario shows the note without a retry button inside the live region, "Not me" gives the stopped note; re-run lines lead the panel; the close-picks link focuses its heading with the page scroll unchanged.

Checks: `npm test` (1556 pass), `npm run typecheck`, `npm run lint`, `npm run build` pass.

Skipped: left title one step quieter (item 11, optional). Not tested automatically: the reaction replay (needs a client render and a signed-in saver).
