# T-33: The chart key filters fields

Status: todo
Mode: inline
Kind: polish
Priority: P0
Depends on: none

## Goal
The field entries in the chart's key (Music, Film, TV, ...) can be clicked to hide or show that field, so the picks screen needs no separate field-toggle row.

## Owns
- src/components/chart/AttributeChart.tsx
- src/components/chart/AttributeChart.module.css
- src/components/chart/ChartDemo.tsx
- src/components/chart/AttributeChart.key.test.ts (new)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- src/components/deck/FieldToggles.tsx, src/components/deck/PicksScreen.tsx (current toggle behaviour and announcements; do not edit)
- tickets/T-29-axis-hover-slot.md (hand-off)

## Skills
- atelier-design

## Done when
- [ ] New optional props `hiddenFields?: readonly Field[]`, `fieldsInKey?: readonly Field[]` and `onToggleField?: (field: Field) => void`. With `onToggleField`, each key entry is a button with `aria-pressed` (pressed = shown), its mark and label, a 44px touch target, and a visible hidden state that is not color alone (e.g. struck or hollow mark plus "hidden" in its accessible name). `fieldsInKey` lists fields to show in the key even when all their picks are hidden (so a hidden field can be shown again). Without `onToggleField` the key renders exactly as now
- [ ] The key stays one quiet row at 1280 (wrapping at 390 is fine); no "Fields" label or extra row is added
- [ ] `/dev/chart` demonstrates the toggles
- [ ] Tests cover: buttons only when `onToggleField` is passed, aria-pressed state, toggle callback, a field with hidden picks still listed via `fieldsInKey`. `npx vitest run src/components/chart`, `npm run typecheck`, `npm run lint` pass

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
