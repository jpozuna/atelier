# T-34: Suggestions at the top of the right column, one quiet control

Status: todo
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
