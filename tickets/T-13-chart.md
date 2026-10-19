# T-13: Attribute chart

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
The centerpiece chart: the profile's axes, the user's shape, and pick nodes beyond the edge (distance = reach, line weight = connection), where selecting a node highlights its path.

## Owns
- src/components/chart/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/types/
- src/styles/tokens.css

## Skills
- atelier-design

## Done when
- [x] Renders 6 to 8 axes with labels, and the profile shape from axis weights. Hovering or focusing an axis lists its tags
- [x] Pick nodes sit outside the shape at radius by reach, with one mark per field and line weight by connection strength
- [x] Selecting a node (click or keyboard) highlights its path and calls `onSelect(pick)`
- [x] Built and demoed against synthetic mock data (a story or test page under the component folder)
- [x] No scores, ranks or numbers are shown to the user (hard rule 7)
- [x] Has an accessible text alternative (a list of axes and picks)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

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
Files (all under src/components/chart/): `AttributeChart.tsx` (+ `.module.css`), `geometry.ts` (pure layout, tested), `marks.ts` (field marks and labels), `mock.ts` (synthetic data), `ChartDemo.tsx` (+ `.module.css`), `index.ts`, `geometry.test.ts` (34 tests). typecheck, lint and test pass repo-wide. No dependencies added; plain SVG + React. No Qloo calls, no env access, no Qloo data (mock names are invented, ids are `00000000-0000-4000-8000-0000000000NN`).

### Props API
Import from `@/components/chart` (client component, `'use client'`):
```ts
interface AttributeChartProps {
  axes: Axis[];                    // 6 to 8 read best; array order = position, clockwise from 12 o'clock
  picks: Pick[];                   // reads well with 6 and with 30
  selectedId?: string | null;      // controlled selection (Pick.id). Omit for internal state
  onSelect?: (pick: Pick) => void; // click, Enter or Space on a node (or its button in the text list)
  onClear?: () => void;            // Escape on a focused node
  label?: string;                  // accessible name
  className?: string;
}
```
The chart sizes itself to its container (ResizeObserver, max 860 px, compact layout below 520 px). Wrap it in a container with a real width. The card ticket can drive it by holding `selectedId` and rendering the card from `onSelect`.

### Contracts the chart relies on
- Pick angle comes from the axes whose member tag ids appear in `pick.path.sharedTags` or the theme hop's `tags` (most hits wins; falls back to the heaviest axis). So `Axis.tags[].tag` and `Path.sharedTags` must be real, matching tag ids.
- Radius = `pick.reach.reach` (0 to 1, outside the profile ring); line weight = `pick.connection` mapped between `CONNECTION_FLOOR` and `CONNECTION_NORM` from config. Axis radius = `axis.weight` relative to the heaviest axis.
- Mark shape per field (circle music, square film, triangle tv, diamond books, hexagon food_places, cross fashion). The mark carries no provenance cue. `llmBridged` picks are marked in text only: the path trail, the list and the node's aria-label say "Bridged by the agent, no Qloo link."
- Path trail under the chart: one box per hop, neutral connectors (`--color-border-strong`). Per docs/DECISIONS.md only theme and lineage hop boxes carry a cue: solid border in `--color-sourced` or dashed in `--color-inferred`, the visible word Sourced or Inferred, and an aria-label. `hop.provenance` is ignored on seed and pick hops. The card ticket owns the "reading" label.

### Behavior
Hover or focus an axis lists its tags (input order, no sorting, no numbers); Enter, Space or click pins it. Nodes: roving tab stop with arrow keys, Home and End (clockwise order); hover, focus and selection all highlight the path (lines to up to 3 anchor axes, emphasised axes, name label). Text alternative: a visible "Read this chart as a list" details element with axes and tags, and picks with their path (picks are buttons that select); the SVG is `role="group"` with title and desc. No scores, ranks, percentages or counts shown. Reduced motion handled by tokens plus `animation: none` on node entry. Selection is announced through one `role=status` sr-only line (selection only, so hover and focus do not double-read). Selected node = thin accent ring close to the mark; keyboard focus = larger, heavier ring in the text color. Connection lines use full-strength `--color-border-strong` (>= 3:1) and are never dimmed; the active pick's lines are accent and drawn last. Non-active nodes dim to 0.6 on an outer wrapper, so the entry animation does not override it.

### Route line for the manager
No route added. To view the demo, create e.g. `src/app/chart-demo/page.tsx`:
```tsx
import { Shell } from '@/components/shell';
import { ChartDemo } from '@/components/chart';
export default function Page() { return <Shell><ChartDemo /></Shell>; }
```
(Check Shell's props in `src/components/shell/Shell.tsx`; drop the wrapper if it is applied in the root layout.) I have not rendered it in a browser: layout was verified by unit tests only, so design-reviewer should check it visually.

### Known gaps
- Phone width: label room is derived from the widest wrapped label, and every label and hit area is clamped inside the viewBox (tested at 320, 375 and 860, including a long label); the stage uses `overflow-x: clip`. Nodes do not overlap at 320 px with about 10 picks (tested). At 320 px or narrower with 30 picks, marks may touch; the list alternative covers it.
- Not visually reviewed in a browser (no jsdom, no dev-server run). Label placement and hit-rect sizes are computed from character counts, not measured text.
- With 30 picks at phone width, nodes are separated by at least their visual size, but 44 px hit areas overlap; the list alternative covers this.
- Radius is never adjusted to avoid collisions (only angle), so very dense reach values cluster around one angle sector spreading across neighbors.
- Band is not drawn on the chart (position and line weight only); the deck/card tickets show bands.

### Review round 2 changes
- Escape on a node clears hover, focus highlight and selection (and calls `onClear` only when something is selected); Escape or a second click/Enter/Space on an axis closes its tag panel even while focused or hovered. Handled Escape calls preventDefault and stopPropagation.
- Picks whose `reach.reach` is missing or NaN are not drawn (they would otherwise read as innermost); they stay in the text list, and a dev-only `console.warn` reports them. `layoutChart` returns them as `skipped`.
- Connection scale ceiling is `CONNECTION_CEILING = 1 / CONNECTION_NORM` (config defines connection = min(1, sum) / norm), so tuning the norm keeps the scale right.
- Hover and focus highlight are tied to the `picks` array identity and drop when a new array arrives. Pass a stable (memoized) `picks` array, or hover and focus highlight reset on every parent render.
- New tests: exact radius after relaxation, exact stroke widths at floor, midpoint and ceiling, one-axis picks, no axes, anchor tie-break, skipped picks, 320 px compact overlap.
