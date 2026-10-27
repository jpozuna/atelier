# T-30: Suggestion list above the chart, reasoning on the right

Status: todo
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
