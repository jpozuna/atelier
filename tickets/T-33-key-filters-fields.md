# T-33: The chart key filters fields

Status: done
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
- [x] New optional props `hiddenFields?: readonly Field[]`, `fieldsInKey?: readonly Field[]` and `onToggleField?: (field: Field) => void`. With `onToggleField`, each key entry is a button with `aria-pressed` (pressed = shown), its mark and label, a 44px touch target, and a visible hidden state that is not color alone (e.g. struck or hollow mark plus "hidden" in its accessible name). `fieldsInKey` lists fields to show in the key even when all their picks are hidden (so a hidden field can be shown again). Without `onToggleField` the key renders exactly as now
- [x] The key stays one quiet row at 1280 (wrapping at 390 is fine); no "Fields" label or extra row is added
- [x] `/dev/chart` demonstrates the toggles
- [x] Tests cover: buttons only when `onToggleField` is passed, aria-pressed state, toggle callback, a field with hidden picks still listed via `fieldsInKey`. `npx vitest run src/components/chart`, `npm run typecheck`, `npm run lint` pass

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
What changed: the chart key's field entries can now toggle a field. `AttributeChart.tsx` gets three optional props and a `KeyToggle` button; `AttributeChart.module.css` gets `.keyToggle` and `.legendMarkHidden`; `/dev/chart` (`ChartDemo.tsx`) filters its picks with the toggles and passes `fieldsInKey`; `AttributeChart.key.test.ts` covers it (6 tests, mocked-hooks approach, function components expanded in the walk). `npx vitest run src/components/chart`, typecheck and eslint on `src/components/chart` pass. No Qloo calls. `npm run build` not run, as instructed.

Prop contract for T-34 (all optional, on `AttributeChartProps`):
- `onToggleField?: (field: Field) => void`. Passing it turns every key entry into `<button type="button" id="chart-key-{field}" aria-pressed={shown}>` (mark + label, min-height `--size-touch` 44px). Without it the key renders exactly as before and the other two props are ignored.
- `hiddenFields?: readonly Field[]`. Entries for these fields show hidden: hollow dashed mark, struck label, `aria-pressed="false"`, and ", hidden" (sr-only) appended to the accessible name ("Music, hidden").
- `fieldsInKey?: readonly Field[]`. Fields listed in the key even when no pick in `picks` has them. Key order is always the chart's FIELDS order. T-34 should pass the fields present in the full result (the old `fieldsInResult`).
- The chart holds no hidden state and does not filter `picks`: the caller must pass `picks` already without hidden fields' picks (as PicksScreen's `chartPicks` does) and handle announcements, clearing selection of hidden picks and focus. Focus handoff: the toggle's DOM id is `chart-key-{field}` (the old one was `field-toggle-{field}`); the button keeps focus on its own across re-render since it is keyed and not remounted.
- Key stays one `figcaption` row; no "Fields" label or extra row is added. Entries are borderless 44px targets, so the key row is taller than before when toggles are on (note for design review at 1280).

Known gaps: no visual check done in a browser (design-reviewer should look at `/dev/chart` at 1280 and 390). A field whose only picks are hidden is shown in the key only if the caller passes `fieldsInKey`.

### Review fixes
- Hover on hidden entries: the label rules now set `text-decoration-line`. Hover is underline, hidden is line-through, and `[aria-pressed='false']:hover` is `underline line-through` with the entry's color back to `--color-text` (higher specificity than the plain hidden rule, so hover no longer loses).
- Left edge and spacing: in toggle mode the `ul` also gets `.legendListToggles` (`margin-inline-start: calc(-1 * var(--space-2))`, `gap: 0`). Each entry's own 8px side padding is the spacing, so the space between one label and the next mark is 16px, the same as the plain key's gap, and the first mark lines up with the note. Plain mode keeps its exact `className` (no extra class or trailing space).
- Shown labels stay at full text color; the ", hidden" accessible-name suffix is unchanged.
- Note clause "Select a field to hide it." was left out. No browser was available to measure, so this rests on an estimate: at `--text-xs` (13px) the existing note is about 70 characters (~435px) plus the three weight samples (~225px), roughly 670px of the ~750px column. The clause adds about 160px, which would push the samples onto a second line. design-reviewer can confirm at 1280; if the picks screen wants the hint, the cleaner place is outside the chart (T-34's file), not this note.
- `fieldsInKey` JSDoc now says a hidden field left out of it drops out of the key and loses focus.
- Tests (10 in `AttributeChart.key.test.ts`): each button's `onClick` is called and yields its own field (buttons found by label); key order equals FIELDS order with picks reversed (the test checks the reversal changes the picks' own order first); ids are `chart-key-{field}`; the plain key's `li` children are the mark svg and a span (no button, no sr-only); hidden mark's path class is `legendMarkHidden`, a shown one's is `legendMark`.
- Checks: `npx vitest run src/components/chart` (122 pass), `npm run typecheck`, `npx eslint src/components/chart` all clean. No Qloo calls.
