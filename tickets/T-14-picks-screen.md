# T-14: Calibration and edge picks screen

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-10, T-13, T-15, T-16

## Goal
The picks screen: calibration picks first for the user to correct, then edge picks in three degrees shown together, dealt as decks by field with a quiet card-pack reveal, with fields that can be hidden.

## Owns
- src/app/(picks)/
- src/components/deck/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/app/api/run/
- src/components/chart/
- src/components/card/
- src/components/reasoning/

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [x] Calibration picks (same-field and cross-field) come first. The user can mark one "not me", which re-runs only the affected domains
- [x] Edge picks show moderate, high and extreme together, in decks by field. Hiding a field hides its deck without new calls
- [x] The reveal animates calmly and respects reduced motion
- [x] The chart, the deck and the reasoning panel (streamed from `/api/run`) are on one screen. Selecting a chart node opens its card and vice versa
- [x] Works as a guest
- [x] Lays out the reasoning panel itself (two columns at 64rem and up, collapsible and stacked below on narrow screens). The root layout's Shell has no side region, and T-14 does not edit the root layout
- [x] On narrow screens, where the reasoning panel stacks below, new steps are visible without hunting (auto-scroll within the panel, or a "latest step" line near the top)
- [x] Passes a stable, memoized `picks` array to `AttributeChart` (T-13 resets hover and focus when the array identity changes)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: yes
- design-reviewer: yes
- research question: none

## Evals
- call-budget
- card-completeness

## Qloo calls
- via /api/run only

## Handoff
Zero live Qloo and zero live Anthropic calls (no .env or .qloo-private read; no QLOO_LIVE). The dev server was run briefly to fetch /picks and /picks/preview (both 200, then stopped); no browser interaction or screenshot was done, so nothing is visually reviewed. 65 tests in src/components/deck (node env, pure logic). typecheck, lint, build and `npm run evals` pass. `npm test` has ONE failure outside my paths: evals/harness/fixture-shape.test.ts ("every trace file is used by a case") because the other worker's t19-*.jsonl traces have no case in cases.json yet. It is the evals worker's in-progress state, not this ticket.

### Routes
- `/picks` (PICKS_PATH, as T-12 links to it): `src/app/(picks)/picks/page.tsx`, a server page that mounts `<PicksView/>`.
- Dev preview (mine, dev-only, `notFound()` in production): `src/app/(picks)/picks/preview/page.tsx` renders `<PicksDemo/>` on a synthetic run, with a scenario switch (finishes, slow, picks not enabled, fails). Manager: if you want it at /dev/picks like the other demos, add `src/app/dev/picks/page.tsx` with `if (process.env.NODE_ENV === "production") notFound(); return <PicksDemo />;` (import from `@/components/deck`) and delete mine.

### Files (src/components/deck/)
`PicksScreen.tsx` (+ `.module.css`; the screen), `PicksView.tsx` (reads the taste session after hydration; no session -> message plus `router.replace("/start")`), `EdgeDeck.tsx`, `PickTile.tsx`, `FieldToggles.tsx`, `Deck.module.css`, `PicksDemo.tsx` (+ css), `fixture.ts` (synthetic run, plan, trace, inputs), `copy.ts`, `constants.ts`, `types.ts` (type-only imports), pure logic: `sse.ts`, `run-state.ts`, `request.ts`, `grouping.ts`, `storage.ts`, `source.ts` (the fetch stream, the only impure piece), `index.ts`, and `*.test.ts` for sse, run-state, grouping, request, storage, copy.

### Behavior
- Order on the page: heading, chart, selected card (or a one-line prompt), calibration, edge decks. The reasoning panel is a second column at >= 64rem (sticky, scrolls inside itself, follows the newest step unless the person scrolled up) and stacks below on narrow screens (max-height 24rem, scrolls inside, same follow). While streaming, a "Latest step" line with a "Read all steps" button sits near the top (hidden at >= 64rem unless the panel is collapsed). The panel is collapsible (controlled `open`, passes `landmark={false}` inside my own labelled aside).
- Calibration: same-field picks first, then other-field, each tile says "Same field as <seed>" / "A different field from <seed>". "Not me" sets the pick aside at once (it leaves every list and the chart, and its entity id is excluded from later runs), then re-runs. Replacement: only that pick's field; its calibration picks are refreshed (the set-aside one goes, new ones fill in, never more than before) and its edge picks are kept. Every other field keeps what was shown whatever the response holds (`mergeRerun`). At most 3 re-runs per visit (`MAX_NOT_ME_RERUNS`), then it only sets aside and says so.
- Edge decks: one per field, moderate, high and extreme together on tiles (degree is a word on the tile, never a number). A degree with no pick of its own says so. Thin or unavailable fields show the server's fixed `note`. A "Fields" toggle row (aria-pressed plus the words Shown/Hidden and a dashed edge) and a "Hide <field>" button per deck. Hiding removes the deck, the field's calibration picks and its marks from the chart; the result is untouched, so showing again makes no call (tested).
- Selection: one `selectedId`. A chart node or a tile opens that pick's `PickCard` in the panel under the chart; a tile click also moves focus to the card and scrolls it into view, and "Close" returns focus to the tile. A pick that gets hidden or set aside is simply not found, so the card closes (derived, no effect). Reactions from `PickCard.onReact` are kept in the tab only (session storage), not sent anywhere.
- Reveal: tiles turn over one at a time (pure CSS animation, per-tile `--reveal-delay` from `revealDelays`, calibration first then decks in field order, capped at 7 s). Content is in the DOM from the start, paint waits via `visibility`. Reduced motion: the delay is forced to 0 and durations are ~0 (tokens plus the global rule). Only a result that arrived live animates; a restored result does not. After the reveal window a field shown again just appears.
- Memoization: `view` is memoized on (result, hidden, notMe, seeds); `chartPicks = view.picks.map(toChartPick)` is memoized on `view.picks`, so the array keeps its identity across selection, hover, reactions and reasoning updates. `seedNames`/`pickNames` are memoized too.
- Guest: nothing needs an account. State is in `sessionStorage` key `atelier.picks.v1` (per tab): result (with its `plan`), trace, set-aside ids, hidden fields, reactions, re-run count, keyed by a hash of the taste session (seed ids, entity ids, whys, axis tag ids). A revisit with a matching key renders from storage with NO run (0 Qloo calls, 0 model calls). A different taste session starts a new run. `plan` is stored in the result and sent back on every re-run.
- States: running with no result (quiet line plus the panel streaming), `picks_not_enabled` -> calm "Picks aren't ready yet" section with a link back to /taste and the chart still shown (not an error page); any other error code -> "The picks did not arrive" with a fixed sentence by code (busy, rate_limited, budget, lookups_off, else generic) and a Try again button; a stream that ends with no result is an "incomplete" failure, never a blank screen. Non-200 JSON bodies (400, 422, 503 busy) are read too. The server's message text is never shown, only its code.
- Wording is in `copy.ts` (tested: no exclamation marks, no score/rank/percent words, no first-person taste claims).

### Contracts and things other tickets rely on
- `PicksScreen` props: `{ inputs: {seeds, profile, axes}, source?: RunSource, persist?: boolean }`. `RunSource = (body, {onMessage, onEnd}) => {cancel}`. The default is `fetchRunSource()` (POST /api/run, `fetch` stream). The preview injects a synthetic source.
- Guards now accept public data: `isTraceEvent` allows a `score` event with no `popularity`, and `isPath`/`isCard` allow `contribution: null`, so T-10's note about needing a public guard variant is already resolved. I validate every stream message with them (plus `readPick`, which keeps only the fields the public pick contract lists, so a stray number cannot reach the screen).
- I import `parseTasteSession`, `rawTasteSession` from `@/components/onboarding/session`, `useHydrated` from `.../hooks` and the path constants from `.../constants` (not through its index, which only exports `readTasteSession`).

### Decisions I made (manager please check)
1. **Chart position and line weight on public data.** `/api/run` strips reach and connection (rule 7) and the chart does not draw a pick without `reach.reach`. So `toChartPick` places each pick by its BAND (`BAND_CHART_REACH`: calibration 0.12, moderate 0.4, high 0.65, extreme 0.9, in deck/constants.ts) and gives every pick the same neutral line weight (middle of the floor-to-ceiling scale). These filler numbers are never displayed. If you want line weight to carry connection, T-10 would have to expose a coarse tier (for example three words), not a number.
2. **A "not me" re-run cannot be limited to one field by the current route.** `/api/run` has no per-domain option, so a re-run still runs all six pools and all six card calls (up to 6 live Qloo calls plus model calls, since `exclude` changes every pool's request and so misses the cache), even though the screen keeps only the affected field's answer. That is outside the "12 live calls per run" budget if repeated. I send `domains: [field]` in the body anyway (the route ignores unknown keys today) and cap re-runs at 3 per visit. **Needs a T-10 follow-up:** accept `domains?: Field[]` in the request and run only those fields (and have `exclude` apply only to them). Until then the done-when item "re-runs only affected domains" holds for what is shown, not for calls made. All of this is behind the closed POST gate today.
3. A "not me" sets the pick aside optimistically and permanently for the tab (its entity id is in every later `exclude`), and the unit of "affected" is the pick's own field.
4. `maxDuration`, the busy limit and similar server limits are unchanged; the screen handles `busy` with a calm retry message.
5. Tunables are in `src/components/deck/constants.ts` (not config.ts, which I do not own). Manager: move `BAND_CHART_REACH`, `REVEAL_STAGGER_MS`, `REVEAL_MAX_DELAY_MS`, `REVEAL_TOTAL_MS`, `MAX_EXCLUDE` (mirrors RUN_MAX_EXCLUDE = 200), `MAX_TRACE_EVENTS`, `MAX_NOT_ME_RERUNS`, `FOLLOW_THRESHOLD_PX` there.

### Qloo calls
None added. The only call path is POST /api/run via `source.ts` (client to our own route). Nothing in this ticket touches the Qloo client, the key or any env var.

### Known gaps
- Not rendered in a browser: no screenshot, no keyboard walk-through, no phone-width check. design-reviewer should check the two-column layout at 64rem, the sticky panel, the tile grid, focus after opening a card and after Close, the reveal and reduced motion, and the dark theme.
- Tests are node-only: the React components (screen, tiles, toggles) are covered by typecheck, lint, build and the SSR fetch, not by interaction tests.
- The default source (`fetchRunSource`) was not exercised against the real route (the gate is closed and I made no calls); its parser is tested against the exact wire format from T-10's handler and handoff.
- The card's reaction (T-17 will own persistence) is stored in the tab only.
- A pick set aside with "Not me" is not shown anywhere afterwards and there is no undo.
- Edge picks have no "Not me" (only calibration picks, as the ticket asks).

### Review round 1 (reviews of code and design; /api/run now honours `domains`, commit 8b5d3aa)
Zero live calls. 72 tests in src/components/deck pass; lint passes. `npm run typecheck`, `npm run build` (its type-check step) and `npm run evals` currently FAIL, all in the other worker's in-progress files under evals/scorers (seed-resolution.ts: `nonEmpty` not exported from path-presence, `input.result` unknown, `withResult is not a function`). `tsc` output with the evals/ lines removed is empty, and the Next compile step succeeds. Re-run those three once the evals worker is done.

Design (blocking)
1. Focus never falls to the body. "Not me" focuses the next calibration tile, else the previous one, else the calibration heading (now `tabIndex=-1`). "Hide <field>" (and any toggle) focuses that field's toggle (`toggleDomId`). Card Close returns focus to the control the card came from (tile, chart node or chart list button, recorded as `document.activeElement` at selection), else the chart section (`tabIndex=-1`). One `focusReq` state plus one effect does all focus moves after render.
2. A chart selection now opens the card and moves focus to the card title (the card's h2, given `tabIndex=-1`) and scrolls it into view (smooth unless reduced motion), same as a tile.
3. "Picks aren't ready yet" is `role="status"`, the failure section is `role="alert"`.

Correctness
4. `mergeRerun` merges `plan.themes`, `plan.requeries`, `meta.requeries` and `meta.notRequeried` per field: only fields actually refreshed take the incoming entries, the rest keep the earlier ones (also when a field came back unavailable). A partial plan can never be stored. Tests added.
5. Persist runs while streaming too (set-aside ids, hidden, reactions, re-run count, and the last result); only the trace is held back until the run ends (read through a ref).
6. `needsFirstRun` is set false once the first run launches.
7. `feedSse` holds a trailing lone CR until the next chunk (tests for both cut points).
8. Copy: lede says "Only that field is looked at again, and the rest stay as they are", which matches what happens now. Pressing "Not me" during a run says it is unavailable until the steps finish (visible note plus the status line), not the re-run cap. The cap message is separate.

Coherence and polish
9. At >= 64rem the chart is capped at min(100%, 34rem, 100dvh - 16rem) and centered; the lede above it is two short sentences. Not sticky.
10. Only newly arrived tiles animate: `RunState.freshIds` is the ids not on screen before the result (a restored session has none; a re-run has only its replacements). `live` is gone. The reveal is a fade plus a small lift (no tilt), stagger 240 ms, capped at 2 s (`REVEAL_MAX_DELAY_MS`), so a tile is never hidden long. After a batch's window passes, tiles that appear later (a field shown again) just appear.
11. The "Latest step" slot has a fixed minimum height and stays after the run (label becomes "Last step"); before any step it holds the "Reading your taste" line, which replaced the separate working line.
12. Tiles use `aria-current` (no `aria-pressed`) and an accessible name that starts with the pick name ("Name, Field, Degree"), with the path hint as the description. The card title takes focus, not a div. The reasoning scroller is `tabIndex=0`, `role="group"`, labelled "Reasoning steps". `announce` clears after 5 s; the visible calibration note after 8 s.
13. No `@/lib/agent/config` import in client code: `CHART_NEUTRAL_CONNECTION = 0.65` is local (halfway between the chart's floor and ceiling, a uniform weight in v1). `MAX_NOTE_CHARS`, `MAX_REACTION_WORDS` and the clear delays are in constants.ts. `PicksDemo` is no longer in the index; only the preview page imports it (from its own file), and the /picks page imports `PicksView` from its own file, so the fixture and chart mock stay out of the /picks bundle.

Manager follow-up: `showConnectionWeight={false}` is passed to `AttributeChart` as a spread (`CHART_EXTRA` in PicksScreen.tsx) because the prop is not in the chart's type yet (it compiles and is ignored until you add it). When it exists, make it an inline prop. The earlier "Decisions" item 2 (domains) is resolved by 8b5d3aa: a "not me" re-run now makes only that field's calls; the 3-per-visit cap stays.
