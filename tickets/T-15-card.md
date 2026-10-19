# T-15: Pick card

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
The four-part card: the path back to the user, why this one, what is different, and provenance per hop, followed by the user's reaction in their own words.

## Owns
- src/components/card/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- .claude/skills/atelier-agent-loop/references/path-and-card-schema.md
- src/types/

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [ ] Renders the path as seed -> theme -> [lineage] -> pick, labeling each hop sourced (with a link) or inferred. Readings are labeled "a reading". Provenance is shown in words ("Sourced", "Inferred", "a reading"), not only by the solid and dashed line tokens, since the two hues are close in luminance
- [ ] Shows why this one and what is different, from the Card fields only
- [ ] A reaction area offers the four save states and a free-text why box. Emits `onReact`
- [ ] No scores or rankings shown
- [ ] Built against synthetic mock cards, with an accessible structure (headings, lists)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: yes
- research question: none

## Evals
- card-completeness
- provenance

## Qloo calls
- none

## Handoff
Files: `src/components/card/{PickCard.tsx, PickCard.module.css, helpers.ts, helpers.test.ts, mock.ts, CardDemo.tsx, index.ts}`. Typecheck, lint and tests (24, card folder) pass after the review fixes. No Qloo calls, no data, no dependencies added. Mock data is synthetic (invented names, ids `00000000-0000-4000-8000-0000000000NN`, `example.org` URLs).

### Component API
`import { PickCard } from "@/components/card"` (client component).
```ts
type PickCardProps = {
  card: Card;                       // only its fields are used
  title?: string;                   // default: label of the final (pick) hop, else "Untitled pick"
  field?: Field;                    // plain-text field label
  headingLevel?: 2 | 3 | 4 | 5;     // title level, default 3; section headings sit one level below
  onReact?: (reaction: Reaction) => void;  // { state, words?, at }; words omitted if blank
  reveal?: boolean;                 // quiet fade-in on mount, default false; reduced-motion via tokens
};
```
Renders in order: path (ordered list, one item per hop), Why this one, What is different, Provenance (summary and legend), then "A reading" (only when `card.reading` exists, with its source link), then the reaction area. Section headings are plain headings in divs.

### Provenance display (manager decision)
- A Sourced or Inferred badge, with the solid or dashed line cue, appears only on theme and lineage hops. Seed and pick hops have no badge, no link and no line cue (just a plain hairline connector).
- Summary reads "Connecting steps: N sourced, M inferred." and counts theme and lineage hops only (`countProvenance`). Mock `card.provenance` equals these counts (tested).
- Lineage hops are labeled "Lineage, a reading" and render as sourced. An inferred lineage hop is omitted and `console.warn`ed outside production; it is never drawn as lineage and not counted.
- Source links appear once, on the hop. No separate Sources list. Links are http(s) only; a sourced hop with no usable URL says "Link unavailable". Every link is at least 44px tall.

### Reaction area
Radio group of four save states (`SAVE_STATES`: later, will_try, explore, not_interested) plus a "Why, in your own words" textarea; Save emits `onReact`. `offeredStates(reaction)` adds `tried` only when the incoming `card.reaction.state` is `tried` (the follow-up belongs to T-17). Prefills from `card.reaction`; "Saved: ..." clears when the user edits afterwards. The parent persists.

Pure helpers (exported, tested): `pathToDisplaySteps`, `countProvenance`, `provenanceSummary`, `buildReaction`, `offeredStates`, `pickTitle`, `safeHref`, `hasProvenance`, `SAVE_STATES`, `REACTION_LABEL`.

Never shown: anchor contribution, reach parts, connection, popularity, band, theme tag ids. Only a plain note when `path.anchor.thin`. Mock copy describes difference in form, texture and field, with no popularity or audience wording (tested).

### Route to add (manager; src/app is not mine)
`src/app/dev/card/page.tsx`:
```tsx
import { Shell } from "@/components/shell";
import { CardDemo } from "@/components/card";
export default function Page() { return <Shell><CardDemo /></Shell>; }
```

### Known gaps
- Not rendered in a browser (no jsdom, no dev server run). Contrast, focus and target sizes rely on tokens.
- Deck behavior (card-pack reveal across cards) is not here; `reveal` is a single-card fade.
