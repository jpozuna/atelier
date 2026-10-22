# T-24: Chart rework: legend placement, tag chips, multi-select, tighter layout

Status: todo
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
