# T-32: Faster page loads and onboarding steps in the browser

Status: done
Mode: inline
Kind: fix
Priority: P1
Depends on: none

## Goal
Make first load and moving between pages (/, /start, /taste, /picks) and each onboarding step feel quick: smaller client bundles, no render-blocking font or script work, and no waterfalls of requests the browser waits on.

## Owns
- src/app/layout.tsx
- next.config.ts
- src/app/page.tsx, src/app/page.module.css
- src/app/(onboarding)/
- src/app/(picks)/picks/page.tsx
- src/components/onboarding/
- src/components/shell/

## Reads
- CLAUDE.md, docs/DECISIONS.md
- src/app/globals.css, src/styles/tokens.css (do not edit; note any needed change in the hand-off)
- src/components/deck/ and src/components/chart/ (T-30 and T-29 own them; do not edit)
- src/app/api/ routes the onboarding calls (T-31 owns them)

## Skills
- atelier-design

## Done when
- [ ] Hand-off has a before/after table from `npm run build` (first-load JS per route) and a local production run (`npm run build && npm start`) timing of each page's load
- [ ] Fonts load with `next/font` (no layout shift, no blocking external CSS); heavy client components the first paint does not need are split out or loaded lazily; links prefetch the next onboarding step
- [ ] Onboarding fires independent requests together (e.g. resolving several seeds at once, or the profile "why" alongside the profile) instead of one after another, with no change to the number of requests per seed (max 2 live Qloo calls per seed still holds)
- [ ] Each step shows immediate feedback (pending state within 100ms of the action) while a request runs
- [ ] No visual change beyond loading states. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass
- [ ] Zero live Qloo calls while measuring (replay/cache or synthetic only)

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes (loading states only)
- research question: none

## Evals
- call-budget, repo-hygiene

## Qloo calls
- none

## Handoff

Measured against `npm run build && QLOO_MODE=replay next start -p 3100` (zero Qloo calls; pages are static, server time is 2 to 5 ms, so the wins are client-side). Next 16 (Turbopack) prints no first-load JS per route, so the JS figures are the gzipped sizes of the script files each route's HTML references, summed. Timings are headless Chrome, cache disabled, median of 5. "Throttled" is 1.6 Mbps, 150 ms latency, 4x CPU slowdown. Measuring scripts are in the session scratchpad only (nothing added to the repo).

### Before / after (client JS gzipped, KB)

| Route | Before | After |
|---|---|---|
| / | 173.7 | 173.6 |
| /start | 193.6 | 183.8 |
| /taste | 193.6 | 190.5 |
| /picks | 210.9 | 211.7 (T-29's chart edits landed mid-run; the page file itself no longer pulls the reactions barrel) |

Cause of the /start and /taste saving: both pages imported the `@/components/onboarding` barrel, so /start shipped the chart (via TasteView) and /taste shipped the flow. They now import `OnboardingFlow` and `TasteView` directly.

### Before / after (transfer incl. fonts, KB; first and largest paint, ms)

| Route | Transfer before | after | FCP throttled before | after | LCP throttled before | after | Load event throttled before | after | Load event unthrottled before | after |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 298 | 245 | 508 | 500 | 508 | 500 | 1724 | 1503 | 78 | 83 |
| /start | 297 | 263 | 612 | 576 | 612 | 576 | 1879 | 1597 | 77 | 75 |
| /taste | 299 | 262 | 632 | 576 | 1956 | 1716 | 1874 | 1639 | 77 | 74 |
| /picks | 330 | 298 | 640 | 572 | 2536 | 2308 | 1978 | 1748 | 74 | 71 |

Layout shift (throttled): /start 0.03 before, 0.05 after (still under 0.1; the form is now in the server HTML and the serif swap in moves it a little). All other routes 0. Unthrottled local runs are within noise (about 70 to 130 ms everywhere): there is no real network to wait on.

### What changed
- Fonts were already `next/font`. Preloads cut from 4 to 2 per page: Instrument Serif Italic (70 KB, used nowhere) moved to its own `localFont` with `preload: false` and variable `--font-atelier-serif-italic`; DM Mono set to `preload: false`. No external CSS or font hosts (0 on every page).
- Pages import the component they need, not the barrel (see above). `/picks` imports `PendingSave` directly.
- `/start` now server-renders the real form instead of "Getting ready". After hydration it reads the stored list: if one exists the flow remounts with it, otherwise the same instance carries on and nothing typed is lost. The Find button is `disabled` until hydration so Enter cannot do a native form submit first. The stored list is not written until it has been read.
- Adding a seed no longer waits on the reason lookup. The seed goes on the list at once (note "Reading your reason"), the form is free for the next seed, and the `/api/profile/why` calls run concurrently. "See my taste" awaits all outstanding reason lookups together (`Promise.all`), then makes the single profile request. Requests per seed are unchanged: one resolve, one why.
- `router.prefetch(/taste)` runs when the flow is live. The taste screen's Next link and the home "Begin" link show "Opening" while the next page loads (`useLinkStatus`, new `src/components/shell/LinkLabel.tsx`, exported from `shell/index.ts`). Find, Add (instant), and See my taste already show a pending state on the same tick.

### Contracts and things to know
- Entry/flow/session shapes are unchanged. `OnboardingFlow` internals changed only; `index.ts` exports are the same.
- `/taste` and `/picks` still show a "Getting ready" gate until hydration, because the chart needs sessionStorage; their LCP is the chart, after hydration. A real fix there is server-side (nothing to render without the user's stored session) and the largest remaining cost is the shared 150 KB framework chunks.
- The italic Instrument Serif is now a separate family. If any future CSS sets `font-style: italic` on the serif stack it will get a synthesized italic; use `var(--font-atelier-serif-italic)` for the real one. `src/styles/tokens.css` was not edited; adding that variable to a token is a manager call.
- The proxy (`src/proxy.ts`, free-demo guard plus Supabase session refresh) runs on every page request; locally it added nothing measurable, but in production it is a possible per-page cost. Not in my Owns.
- A reload while a reason lookup is in flight keeps the seed without tags (shows the existing "counts on the name alone" note), the same as a failed lookup.
- Returning users with a stored list see the empty form for one frame before the list restores (previously a placeholder).

### Known gaps
- No new unit tests: the logic I changed is React state in `OnboardingFlow` (the repo's onboarding tests are node-env and pure). The concurrency (several whys at once, "See my taste" waiting for them) is worth a render test or a manual pass in replay mode; I did not run the browser flow end to end because replay data for the resolve/why routes was not checked and I made no live calls.
- design-reviewer: loading states only ("Reading your reason", "Opening").
- Checks: `npm test` (1437 passed), `npm run typecheck`, `npm run lint`, `npm run build` all pass. Zero Qloo calls.


## Review fixes

Status stays `review`. Checks: `npx vitest run src/components/onboarding src/components/shell` (103 passed), `npm run typecheck`, `npm run lint` all clean. No live Qloo calls; per seed still one resolve and one why (no retry anywhere).

1. Seed added during "See my taste". While `building`, the Find and Add buttons are `aria-disabled` and `onFind`/`onAdd` return early. "See my taste" now loops `while (pendingRef.current.size) await Promise.all(...)` before it snapshots the list. `replaceEntry` calls `clearTasteSession()` only when the entry's `whyTags` really changed, and never while a build is running (`buildingRef`, true from the press until the build fails; on success it stays true as the page navigates away), so a late reason cannot drop the chart that is about to be saved.
2. Reload mid-why. `Entry` gains an optional `whyPending?: boolean` (set when the seed is added, cleared when the lookup answers or fails). It is saved with the entry and read back in `session.ts` (`readEntry`). On restore there is no retry. `SeedList` shows the new neutral `COPY.interruptedNote` ("Your reason wasn't read before you left. Remove and re-add this seed to try again.") for it, and still shows `unmappedNote` for a lookup that failed in this visit.
3. Timeout. Each why fetch gets an `AbortController` aborted after `WHY_TIMEOUT_MS` (20 000 ms, in `src/components/onboarding/constants.ts`); the timer is cleared in `finally`, after the body is read. A timeout counts as unmapped (same path as any failure). **Manager: move `WHY_TIMEOUT_MS` to `config.ts` if wanted.** Same for `LINK_PENDING_DELAY_MS` (150, exported from `src/components/shell/LinkLabel.tsx`).
4. `readReason` returns without replacing or announcing when the seed was removed; `onRemove` also deletes the seed's promise from `pendingRef` and `pending`, so See my taste does not wait on it. A failed lookup now announces `addedUnmapped` like a non-ok answer does (before, only a non-ok answer did).
5. `LinkLabel`: `aria-busy` removed; "Opening" shows only after 150 ms of navigation. For the width I did not use a min-width on `.begin` and the taste link: "Opening" is shorter than "Begin"/"Look past the edge", so a min-width could not stop the shift. Instead both wordings are laid out in one grid cell (the unseen one `visibility: hidden` and `aria-hidden`), so the link is always as wide as the longer one. Classes are in `Shell.module.css`; `page.module.css` is untouched.
6. `SeedList`: the per-item `role="status"` is gone (the flow's sr-only region already announces "Added X"). Seeds added in this visit (`reserve` prop, held in `OnboardingFlow` as `fresh`) keep an empty note line of one line height (`.itemNoteHeld`, `min-block-size: 1lh`) after "Reading your reason" clears. Restored seeds do not reserve a line, so a returning list looks as before.
7. Returning visit: done without the remount. `OnboardingFlow` is now one component; after hydration it reads the stored list into the same instance (done during render, the React-advised pattern for state that follows an outside value; an effect would trip `react-hooks/set-state-in-effect`), so a typed query, why, chosen match and focus all stay. The stored field is applied through a new `restoreField` reducer action, and only if the form is untouched (empty query and why, idle search), so the person's own field choice is not overwritten. The list pushing the "See my taste" block down by its height on that one frame is the remaining shift; not reserved, since the size is unknown before the read.
8. `.secondary:disabled` shares the busy style (dashed, muted, `cursor: progress`). The native `disabled` submit block is kept.
9. Nits: `COPY.adding` removed; DM Mono comment in `fonts.ts` updated; a second Add on the same render is ignored (`addedDraftRef`), so no double "duplicate" error.

Tests (all in the mocked-hooks file unless noted): the mini renderer is now a single instance (no keyed child) and its fetch stub honours `signal`. New cases cover building disabling Find/Add, the chart kept during a build and dropped otherwise, `whyPending` set, cleared, restored and shown, the timeout (fake timers), removed seeds, restore without remount, field handling, the double Add, and SeedList's reserved line and missing status role. `src/components/shell/LinkLabel.test.ts` (new) covers the delay, no aria-busy and the shared cell. `flow.test.ts` gains `restoreField` cases.

Contracts: `Entry` and the stored flow record gain the optional `whyPending` flag (older stored records still parse). `draftReducer` gains `restoreField`. `OnboardingFlow` exports are unchanged.
