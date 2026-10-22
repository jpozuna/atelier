# T-25: Picks screen as a suggestion list with final reasoning

Status: todo
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
- src/types/card.ts, src/lib/agent/config.ts (`CHART_STRENGTH_CONNECTION`)
- src/components/chart/, src/components/card/
- src/components/reactions/ (save flow stays wired)

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [ ] Layout: at 64rem and up, the chart and the reasoning area sit side by side, with the list below. On narrow screens they stack. No empty side column, and no tall blank blocks at 375, 768 or 1280px
- [ ] Edge suggestions are one list (row: name, field mark and label, stretch word low/medium/high, mapped from moderate/high/extreme). Sort options are field or stretch, with no score or rank sort (hard rule 7). A field filter shows or hides fields with 0 new calls (existing tested behavior kept)
- [ ] Clicking a row selects it: the chart highlights it and the reasoning area shows it. Each row also has a checkbox. Checking one or more shows all of them at once on the chart (`selectedIds`), with a "Clear" control. Keyboard- and screen-reader-operable
- [ ] Calibration stays a short separate group above the list with "Not me" re-run behavior unchanged
- [ ] The reasoning area for a selected pick shows: the card's explanation and path (via `PickCard`), one line saying where it sits on the chart (its axis label and stretch word, in words only), and its sources with provenance labels. The streamed `ReasoningPanel`, the "Latest step" line and "Read all steps" are gone from this screen. The run still streams; show a quiet working line until the result arrives
- [ ] `readPick` keeps `strength` when it is one of `CONNECTION_STRENGTHS`. `toChartPick` maps it through `CHART_STRENGTH_CONNECTION` (falling back to `CHART_NEUTRAL_CONNECTION`), and the screen passes `showConnectionWeight` true once any pick has a strength, so the chart's "heavier line" sentence is true. Strength is never shown as a word, number or sort option in the list
- [ ] The "Compare with a plain model" link and the `COMPARE_PATH` import are removed
- [ ] The card-pack reveal is replaced by a calm list fade-in that respects reduced motion (or dropped). Memoized `chartPicks` identity is kept
- [ ] Guest flow, session storage (bump the key version if the shape changes), failure states and reactions still work. Tests updated in `src/components/deck`. Repo checks pass

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
