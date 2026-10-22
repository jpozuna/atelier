# T-25: Picks screen as a suggestion list with final reasoning

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-23, T-24

## Goal
The picks screen replaces the field decks and the live trace with three parts: the chart; a compact, clickable suggestion list that can be sorted and filtered by field and supports multi-select onto the chart; and a reasoning area for the selected suggestion that shows only its final reasoning, where it sits on the chart, and its sources.

## Owns
- src/components/deck/
- src/app/(picks)/

## Reads
- CLAUDE.md, docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- tickets/T-24-chart-rework.md (hand-off: `selectedIds`, tag dialog)
- tickets/T-23-edge-cap-balance.md (hand-off: `Pick.strength`)
- tickets/T-27-private-run-log.md (hand-off: optional `notMe` in the /api/run body)
- src/types/card.ts, src/lib/agent/config.ts (`CHART_STRENGTH_CONNECTION`)
- src/components/chart/, src/components/card/
- src/components/reactions/ (save flow stays wired)

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [x] Layout: at 64rem and up, the chart and the reasoning area sit side by side, with the list below. On narrow screens they stack. No empty side column, and no tall blank blocks at 375, 768 or 1280px
- [x] Edge suggestions are one list (row: name, field mark and label, stretch word low/medium/high, mapped from moderate/high/extreme). Sort options are field or stretch, with no score or rank sort (hard rule 7). A field filter shows or hides fields with 0 new calls (existing tested behavior kept)
- [x] Clicking a row selects it: the chart highlights it and the reasoning area shows it. Each row also has a checkbox. Checking one or more shows all of them at once on the chart (`selectedIds`), with a "Clear" control. Keyboard- and screen-reader-operable
- [x] Calibration stays a short separate group above the list with "Not me" re-run behavior unchanged. The re-run body also sends `notMe` (the entity ids newly set aside, a subset of `exclude`) so the run log records exact signals (T-27 hand-off)
- [x] The reasoning area for a selected pick shows: the card's explanation and path (via `PickCard`), one line saying where it sits on the chart (its axis label and stretch word, in words only), and its sources with provenance labels. The streamed `ReasoningPanel`, the "Latest step" line and "Read all steps" are gone from this screen. The run still streams; show a quiet working line until the result arrives
- [x] `readPick` keeps `strength` when it is one of `CONNECTION_STRENGTHS`. `toChartPick` maps it through `CHART_STRENGTH_CONNECTION` (falling back to `CHART_NEUTRAL_CONNECTION`), and the screen passes `showConnectionWeight` true once any pick has a strength, so the chart's "heavier line" sentence is true. Strength is never shown as a word, number or sort option in the list
- [x] The chart on this screen is about 40rem or wider at 1280px: remove the `.chart` cap of `min(100%, 34rem, ...)` in `PicksScreen.module.css` (T-24 hand-off)
- [x] After a "Not me" re-run of one field, the merge keeps that field at no more edge picks than it showed before. The edge total stays at 20 or fewer, and no field goes over its earlier count, so the 40% balance holds (T-23 hand-off)
- [x] The "Compare with a plain model" link and the `COMPARE_PATH` import are removed
- [x] The card-pack reveal is replaced by a calm list fade-in that respects reduced motion (or dropped). Memoized `chartPicks` identity is kept
- [x] Guest flow, session storage (bump the key version if the shape changes), failure states and reactions still work. Tests updated in `src/components/deck`. Repo checks pass

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes (spot-check that the reasoning area shows only path-based text)
- design-reviewer: yes
- research question: none

## Evals
- card-completeness, call-budget

## Qloo calls
- via /api/run only (unchanged)

## Handoff

Screen is rebuilt as chart + reasoning area, calibration group, one suggestion list. `tsc`, `eslint` (deck and `(picks)`) and the tests for deck, reactions, api/reactions, saved and compare pass (268). I did not run the whole `npm test` or `npm run evals`. No Qloo or Anthropic call; dev server on a private port with the synthetic `/picks/preview`. Screenshots at 375, 768, 1280 in light and dark (idle, and three ticked with one open, plus a mid-run working view and a 375 list view) are in `<scratchpad>/s25/` (not in the repo).

What changed (all under `src/components/deck/`; `src/app/(picks)/` needed no change)
- `PicksScreen.tsx` rewritten. Top: chart and, from 64rem, the reasoning area beside it (stacked below 64rem). Then the calibration group (PickTile, "Not me" unchanged), then the edge section: field toggles (unchanged), field notes, `SuggestionList`. `ReasoningPanel`, "Latest step", "Read all steps", the compare link and `COMPARE_PATH` are gone. No import from `components/compare` or `components/reasoning`. The run still streams into `run-state` (events are still stored); nothing renders them. While there is no result the reasoning area shows one quiet working line. If the run failed or is not enabled, no side column is drawn.
- New: `SuggestionList.tsx/.module.css` (rows: checkbox, field mark, name, field word, "Low/Medium/High stretch"; sort Field or Stretch; "N suggestions on the chart" plus "Clear" when any are ticked), `ReasoningArea.tsx/.module.css`, `suggestions.ts` (stretch words, sorts, selection helpers), `reasoning.ts` (`placement`, `sourcesOf`). `EdgeDeck.tsx` deleted. `Deck.module.css` trimmed to what calibration tiles and toggles use. `revealDelays`, `pickNameMap`, `seedNameMap` and the card-pack reveal are removed; the list has a calm opacity fade-in (none under reduced motion).
- Selection: two things. `focusId` is the pick read in the reasoning area (row click, chart node). `checked` is the ticked set. The chart gets `selectedIds = chartSelection(checked, focusId, visible)` (memoized), so the read pick is always drawn with the ticked ones. A row click moves focus to the card title (as before), Close returns focus to the row or chart node, Clear (and ticking) never moves focus except Clear, which goes to the edge heading. Esc on the chart clears both.
- Reasoning area for a pick: one "On the chart: beside <axis>, at <low|medium|high> stretch." line (axis from the chart's own `anchorAxes`, tested equal to `layoutChart`'s `axisIndex`; calibration says "very close to what you named"), then `PickCard`, `SaveNotice`, a compact Sources block (sourced steps with a "Sourced" word and link or "Source: label"; inferred steps only counted under an "Inferred" word, never on the same line; "No retrieved source ... every connecting step is inferred" when none; reading note when a reading exists), then Close. It is all from the stored path/card. At 64rem and up it scrolls inside itself (max-height one viewport) so a tall card leaves no blank block under the chart.
- `sse.ts` `readPick` keeps `strength` only if it is one of `CONNECTION_STRENGTHS`. `grouping.toChartPick` maps it through `CHART_STRENGTH_CONNECTION`, falling back to `CHART_NEUTRAL_CONNECTION` (calibration picks and old stored results have none, so they draw at the steady weight). The screen passes `showConnectionWeight` true once any pick has a strength. Strength never appears as a word, number or sort in the list (a test scans the markup).
- `request.ts`: `RunOptions.notMe` and `RunBody.notMe` (cleaned, only ids that are also in `exclude`, omitted when empty). `setAside` sends `notMe: [the id just set aside]` with the re-run.
- Merge cap: `mergeRerun` already never merges incoming edge picks (only calibration is refreshed), so a re-run field keeps at most its earlier edge count and the total stays at 20 or fewer. I made that explicit in the doc comment and added a test where the response carries 8 new edge picks.
- Layout CSS: the `.chart` cap is gone; columns are `minmax(0,1fr) minmax(0,28rem)` from 64rem. Chart reads about 47rem wide at 1280. The list is 1, 2 or 3 columns (below 48rem, 48rem, 80rem). No horizontal overflow at 375, 768 or 1280 (scrollWidth equals width).
- Fixture (`fixture.ts`, used by other tests too, all still pass): a capped run of 20 edge picks (music 7, film 4, tv 3, books 4, food 2; fashion unavailable), 7/7/6 across the degrees, 7 strong / 7 steady / 6 light, 6 calibration picks. No field above 8. The "again" variant's replacement calibration ids no longer collide (34 to 45). Storage shape is unchanged, so `PICKS_STORAGE_VERSION` stays 1.
- Tests: new `suggestions.test.ts`, `reasoning.test.ts`, `render.test.ts` (static markup); additions to `grouping`, `request`, `sse`, `copy` tests.

Contracts other tickets rely on
- `RunBody.notMe?: string[]` (entity ids, subset of `exclude`). `Pick.strength` survives `readPick`. `buildView` and `DEGREE_WORD`/`EDGE_BANDS` are unchanged for `FollowUp` and `compare`. The fixture's shown run changed (ids 71 to 96, 26 picks), anything outside deck that hard-coded the old ids would break; none did in the tests I ran.

Known gaps and things to check
- Verified by script in headless Chrome: a row click focuses the card title, Clear unticks everything and focuses `edge-heading`, and none of the removed text is on screen. Not tested by hand: a screen reader, and keyboard order across the whole page.
- With the list under the chart, ticking a row at the bottom of the page does not show the chart on a phone or a short laptop. Ticking does not scroll. A sticky chart or a "view chart" jump would help; left out of scope.
- Reasoning area is hidden below 64rem when nothing is selected (the chart's own hint says it). Design-reviewer and bridge-judge passes not run; the markup is path-only text and the Sources block is intentionally a compact repeat of the card's provenance.
- `REVEAL_*` constants in `config.ts` are now unused (manager-only file). Stored `events` are still saved in sessionStorage though nothing shows them. Reactions saved from the picks screen still log through `/api/reactions` unchanged.

### Revision after manager review (two-column layout, decoupled ticking, sources, announcements)

`npm test` (whole repo: 1482 passed), `npm run typecheck` and `eslint` on deck and `(picks)` pass. Screenshots in `<scratchpad>/s25b/`: 375, 768, 1280x800 and 1280x1800, light and dark, each idle and with two rows ticked and one opened (375 and 768 are full-page). No Qloo or Anthropic call.

Layout and interaction (items 1 to 7)
1. From 64rem: left column is the title, the chart and, directly under it, the reasoning for the open pick. Right column is a panel (close picks as compact rows with "Not me", then the field row, sort and the list). The panel is sticky, one viewport tall (`max-height: 100dvh - space-5`) and scrolls inside itself. Checked at 1280x800 idle and with a card open: no blank blocks; the chart's plot runs below the fold at 800 high because the page header, the preview's own scenario buttons, the title and the key sit above it (on the real page there are no scenario buttons).
2. Ticking only adds to or removes from the chart. `focusAfterCheck` is deleted. A row click opens the reasoning. Unticking the open pick leaves it on the chart (it is still the one being read); Close or Clear removes it.
3. Below 64rem a bar sticks to the bottom of the list section while anything is on the chart: "N on the chart", "View chart", "Clear" (44px, tokens). "View chart" scrolls the chart section to the top of the screen (auto under reduced motion) and focuses it. Way back: a "Back to the list" button under the chart (below 64rem only) scrolls to and focuses the last ticked row, else the open row. "View chart" is also next to the "On the chart" line in the reasoning area. Nothing scrolls on tick. From 64rem the bar is hidden and the count and Clear sit in the list toolbar.
4. Each row has a secondary line: "Beside <axis> · <Low|Medium|High> stretch" (`placement()`, computed once per result in `derive.ts`). Hovering with a mouse or focusing a row (or a calibration row) previews its node: the chart has no hover prop, so the row id goes through `selectedIds` only while it lasts (`previewId`), without touching checked or read. Touch taps do not preview. Checked live in headless Chrome: one more node pressed during hover and on focus, none after.
5. Sorted by field: a heading per field (mark and word), rows say axis and stretch. Sorted by stretch: a heading per stretch word, rows say field and axis.
6. Field toggles are one wrapping row: a "Fields" label, a button per field, the word "Hidden" and a dashed edge only on a hidden one (the hint is screen-reader text). The calibration lede and edge lede are shorter.
7. The reasoning area is no longer a scroll region and has no tabIndex. The right panel is the scroll region and is `tabindex=0 role=region` only from 64rem (`useWide`, `matchMedia`). The section is labelled "Reasoning" when nothing is selected.

Sources (8 to 10)
8. `SourcesBlock` (exported from `ReasoningArea.tsx`) draws only when there is at least one sourced item or a retrieved reading; no "none" line and no inferred count. It sits between the card and the save notice. Decision: a sourced item with a source label but no link (for example Qloo) counts as a source and is listed, so the block appears for it too.
9. Each sourced item keeps its step kind label ("Lineage, a reading").
10. A reading with both a label and a usable link keeps both ("Source: label" and "View source"). This departs from the `CardReading` comment that a labelled source is never linked; I followed the review.

Announcements (11, 12)
11. Ticking says "<name> is on the chart, beside <axis>." Clear says "The chart is cleared." for the Clear button, Esc on the chart and Close-all alike (only when something was selected). "N picks are ready" is said once, when the first result arrives (not for a restored session), no longer re-read after every action.
12. Hiding a field unticks its picks in state, so showing it again does not bring them back (checked live).

Fixture (13): each pick's theme label is a tag name from the same axis its tag comes from, so the card's theme hop and the "On the chart: beside <axis>" line agree (tested).

Tests (14), all under `src/components/deck`
- `notMeRerunBody` (new, in `request.ts`, used by the screen's `setAside`) sends `notMe: [qlooId]` of the pick just set aside, inside `exclude`, for that field only. There is no DOM test setup in this repo (no jsdom or test renderer), so the screen itself is not mounted; the screen calls this one builder.
- `derive.ts` (`createPicksDerivation`, held by the screen) gives the same `chartPicks` array across tick, read, preview and sort, and a new one when the result, hidden fields, set-aside ids, seeds or axes change. `showConnectionWeight` is false for a result with its strengths stripped (and every line is then the neutral weight). Again, structural: the selection state is not an input to the derivation.
- `SourcesBlock`: sourced plus inferred (inferred text absent), reading only (label and link), all-inferred path with a reading, and nothing retrieved (renders nothing).
- The no-score-word scan (score, rank, percent, stars, and the strength words strong, steady, light) now covers the list, the calibration row and the reasoning area around the card, for every fixture pick.
- Also: grouping by field and by stretch, preview selection, ticking separate from reading, group headings and row detail in markup, field toggles, bar shown only when something is on the chart.

Known gaps
- Still no screen-reader pass or hand keyboard pass of the whole page. Hover preview and the bar were checked by script, not by touch on a real phone.
- The chart's "Read this chart as a list" text version (chart folder) can draw wider than the left column when several picks are selected at 1280 (a rule runs under the panel's edge). Not touched.
- On a real page the list is only as sticky as the panel: the page itself still scrolls when the card is tall, so the chart can leave the screen while the card is read (hence "View chart").

### Revision, design re-review round

- Phone clipping: measured at a true device-emulated 375x812 and 768x1024 (mobile emulation, device scale 2, not a stitch), idle and with a pick open: `scrollWidth` equals `innerWidth`, no element in the chart section or header has a rect outside [0, innerWidth], axis labels span 30 to 346 (375) and 40 to 733 (768), the key 16 to 359 and 24 to 744. No clipping, so nothing to fix in `deck/` or `chart/`. The clipped look in the earlier "open" shots came from my script resizing the viewport to the page height under mobile emulation for a full-page capture, which skews the layout viewport; those were not real. New shots in `<scratchpad>/s25c/`.
- Title block from 64rem: `.title` is `--text-2xl`, the lede is one line (copy.ts: "Close picks first, then picks from your taste's edge, each with its path back to you."), `.main` and `.intro` gaps are `--space-3`. That alone left the plot bottom at 850 on an 800 high screen (the plot is 0.77 as tall as wide, and the page header, title and key take 17.6rem above it), so I also capped the chart's width by the viewport height from 64rem: `max-width: max(40rem, (100dvh - 17.6rem) * 1.3)`, centred. Measured at 1280x800 with the preview's scenario buttons hidden (as on the real /picks): plot top 272, plot bottom 773, lowest axis label bottom 767, hint line ends 809. The chart is about 650px wide (not under 40rem). At 1280x1800 the cap does not bind (column width rules).
- The open pick's row says "Open, on the chart" (quiet second detail line) while it is open and not ticked, so the checkbox and "N on the chart" agree. Test added.
- Deck tests, typecheck and eslint pass.

