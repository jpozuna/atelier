# T-24: Chart rework: legend placement, tag chips, multi-select, tighter layout

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: none

## Goal
The attribute chart puts its reading key above the plot and its "select a suggestion" hint below it. Axis tags become rounded chips that open a list of everything in this run that shares the tag. The chart can show one or several selected suggestions at once, and it wastes less space. The chart gets bigger so that differences in line weight (connection strength) are easy to see.

## Owns
- src/components/chart/

## Reads
- CLAUDE.md, docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/types/ (Pick, Path, Axis)
- src/components/deck/PicksScreen.tsx and src/components/onboarding/TasteView.tsx (current callers; do not edit)

## Skills
- atelier-design

## Done when
- [ ] The key sentence ("Farther out is less familiar." plus "A heavier line is a stronger connection." only when `showConnectionWeight` is true) sits directly above the plot, not in the figcaption below
- [ ] "Select a suggestion to see its path back to you." sits directly below the plot and is hidden while something is selected
- [ ] Axis tags render as rounded chips (tokens only, no raw colors). Each chip is a button. Activating it opens an accessible dialog (focus trapped, Esc closes, focus returns to the chip) listing the seeds and suggestions in this run whose path has that tag as a theme hop, grouped as "Yours" and "Suggestions". Selecting a suggestion there calls `onSelect`. The list is computed from props, with 0 network calls
- [ ] New optional prop `selectedIds?: readonly string[]`. When it is non-empty, those picks are emphasized together (path lines drawn for each) and the rest are dimmed. The existing `selectedId` still works, so TasteView and PicksScreen keep compiling unchanged. New optional `onTagSelect` is not needed if the dialog handles selection itself; keep the API minimal and document it in the hand-off
- [ ] Bigger chart, less dead space: the plot fills its container width (about 40rem or more at desktop, full width on phones), and the panel and legend no longer add tall empty blocks. Check at 375px, 768px and 1280px
- [ ] Line weight from `ChartPick.connection` gives three clearly different stroke widths at the values in `CHART_STRENGTH_CONNECTION` (0.4, 0.65, 0.95), visible at a glance in the demo, and not distinguished by color alone. The `/dev/chart` mock uses all three
- [ ] The text version ("Read this chart as a list") still matches what is drawn, including multi-select
- [ ] `/dev/chart` demo shows multi-select and the tag dialog with mock data. Repo checks pass; no Qloo data

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none

## Handoff

Everything is under `src/components/chart/`. Round 2 (manager review) is folded in below. 66 chart tests pass, eslint clean on the folder, typecheck clean. Screenshots of `/dev/chart` at 375, 768 and 1280 in light and dark, plus the 30-pick phone view, the dark dialog, the no-picks state and a four-pick multi-select, were taken with headless Chrome over the DevTools protocol (scratchpad only, not in the repo). No Qloo or Anthropic calls.

Contract (props of `AttributeChart`; every existing prop still works, TasteView and PicksScreen compile unchanged):
- `selectedIds?: readonly string[]` (new). Those picks are emphasised together (accent path lines, the rest dimmed). Precedence lives in the pure `resolveSelection` (`selection.ts`, unit-tested): `selectedIds` that match at least one pick; else `selectedId` if it matches a pick; else the chart's own selection, only when the caller passed neither prop. A controlled caller whose ids match nothing gets no selection. Passing either prop makes the chart controlled.
- `onSelect(pick)` fires for a node, a list button, or a suggestion chosen in a tag dialog. The chart never decides toggling: the caller's `onSelect` decides what a click adds or removes (the demo toggles in "Select several"). The dialog closes first, so a caller that moves focus in response wins. Already-selected suggestions are marked in the dialog ("Selected" label and `aria-pressed`).
- `selectedId`, `onClear`, `label`, `showConnectionWeight`, `className`, `axes`, `picks`: unchanged. No `onTagSelect`.
- `layout.viewY` / `layout.viewHeight` (new on `ChartLayout`), `AxisGeom.letter` / `AxisGeom.marker` (null in the wide layout). `TagChip` and `tagMembers` are internal, not exported from `index.ts`.

Round 2 changes, by manager item:
1. Narrow widths (below 520px): the rim carries letter markers (A, B, C ...) and the key lists "A Quiet interiors" etc. The outer ring is now 80 to 86 percent of the column at 320 to 480px (test asserts at least 78 percent, with 6 and 30 picks). Markers are 22px circles with 44 by 44 hit areas. At the left and right edges a hit area is slid inward by up to about 12px so it stays inside the box; it still contains its marker, so all targets are 44px, but they overlap the outermost nodes' hit areas slightly (nodes sit on top). The three line weights are now labelled light, steady, strong in the key.
2. In-chart name labels show only for the hovered or focused node, and for a sole selection. With several selected the readout names each, so labels cannot collide.
3. Dialog backdrop mixes `--color-bg` (80 percent). It darkens the page in dark mode; in light mode it fades the page toward the paper color.
4. With no picks: tags are plain rounded chips (a `span`, not a button), the empty field-mark list, the line-weight samples and the heavier-line sentence are all hidden. "Farther out is less familiar." stays. The demo has a "No suggestions" button to see this.
5. The key, hint, readout and text version share the stage's 860px cap. The weight samples sit inline after the heavier-line sentence.
6. See contract above.
7. Done: `resolveSelection` plus `selection.test.ts` (precedence cases).
8. The dialog closes in an effect cleanup on unmount.
9. The crop now takes every node's focus ring and name label (constants `FOCUS_RING_EXTRA`, `NODE_LABEL_OFFSET`, shared with the renderer) as well as axis labels, markers and their hit areas. Tests added, including picks at full reach.
10. Dialog empty-state text is left-aligned.
11. Axis names carry a dotted underline (solid when emphasised or pinned); narrow markers are ringed circles. The two hints under the plot are one paragraph: "Select a suggestion to see its path back to you. Select an axis to see its tags." (narrow: "Select a letter to see its axis and tags."), each part hidden when it no longer applies.

Earlier round (unchanged): key above the plot, hint below it, tag chips with a native `<dialog>` (focus trapped, Esc, backdrop click, focus returns to the chip), list computed from `picks` only via theme-hop tags, plot sized by per-label fit, `DEFAULT_STROKE_RANGE` `{ min: 1.5, max: 5.5 }` (about 2.1, 3.5, 5.1px for light, steady, strong), mock connections cycle all three strengths, `/dev/chart` has multi-select and the dialog. The readout under the chart shows selected picks only (hover and focus emphasise but do not swap it), and tag chips show for the clicked axis only.

Known gaps for the manager (outside this ticket's paths):
- `PicksScreen.module.css` caps `.chart` at `min(100%, 34rem, calc(100dvh - 16rem))` from 64rem up, so the picks screen chart stays narrower than 40rem on desktop until that cap is relaxed.
- `toChartPick` in `src/components/deck/grouping.ts` still sets `CHART_NEUTRAL_CONNECTION` for every pick, so the real screen draws one line weight until it maps `Pick.strength` through `CHART_STRENGTH_CONNECTION`. PicksScreen passes `showConnectionWeight={false}`, so the key stays honest meanwhile.
- On a phone the key (field marks, note, weight samples, axis names) is about 170px tall above the plot. It could be trimmed if wanted.
- Design-reviewer pass not yet done.
