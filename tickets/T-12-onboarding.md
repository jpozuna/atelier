# T-12: Onboarding: field, thing, why, repeat

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-05, T-07, T-11

## Goal
A 5 to 10 minute onboarding where the user picks a field, types a thing, picks the right entity chip and writes one line on why they love it, repeating across fields, then lands on their chart.

## Owns
- src/app/(onboarding)/
- src/components/onboarding/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- src/app/api/seeds/
- src/app/api/profile/
- src/components/shell/

## Skills
- atelier-design

## Done when
- [x] Field dropdown with the six locked domains. Search fires on submit only (or debounced, min 3 characters), never per keystroke
- [x] Ambiguous results show up to 5 chips to choose from. Missing shows a gentle retry. Clean auto-selects with a chance to change it
- [x] The "why" line is required, one line, and saved with the seed. On submit it is mapped to tags once (T-07's why endpoint, cached), and the mapped tags travel with the seed into the profile build
- [x] At most 10 seeds
- [x] "Add another" repeats the flow. "See my taste" needs at least 3 seeds across at least 2 fields and calls `/api/profile`
- [x] Keyboard-only completion works. Screen-reader labels on every control
- [x] Works as a guest (no account)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- seed-resolution
- call-budget

## Qloo calls
- via /api/seeds and /api/profile only

## Handoff
Zero live Qloo and zero live Anthropic calls (no .env or .qloo-private read; the dev server was run briefly to check that /start and /taste render, then stopped; no page interaction was exercised in a browser). 46 tests (flow, api, session) on synthetic data (tag ids use the urn:tag:fixture: convention). typecheck, lint, test (645) and build pass after review round 1.

### Routes (route group `src/app/(onboarding)/`, no URL segment)
- `/start`: the flow. Server page (title, intro) that mounts `<OnboardingFlow/>`.
- `/taste`: the chart screen after "See my taste". Mounts `<TasteView/>`. Shows `AttributeChart` (axes from the stored `/api/profile` response, `picks` = a module-level empty array), the `ReasoningPanel` (collapsed by default, below the chart, since the root Shell has no side region), and a next-step Link to `PICKS_PATH`, plus "Back to my list" and "Start over".
- Manager: `/` still has the placeholder page; link it to `/start`. `PICKS_PATH = "/picks"` (src/components/onboarding/constants.ts) is a guess at T-14's route; change that one constant if T-14 uses another path. The link 404s until T-14 lands.

### Behavior
- Field select (six fields, labelled "Field"), a text input labelled per field ("Name a film"), search only on submit (Enter or "Find it"), min 2 chars (the route's minimum), one `/api/seeds/resolve` call per submit. Stale responses are dropped by token.
- clean: shows the match with "Not this one" (returns to the input). ambiguous: up to 5 chips as a radio group (arrow keys), the user must choose. missing: calm retry note. 503 `lookups_off`, budget, rate_limited, upstream: calm fixed messages; the server's message text is never shown.
- After a match the "why" input appears (required, one line, 3 to 120 chars; 120 is MAX_WHY_CHARS, which the why route cuts at). "Add to my list" calls `/api/profile/why {field, why, seedId}` once, then adds the seed with `whyTags`. If that call fails the seed is still added without `whyTags` (the profile build treats absent as "never mapped") and the list says so in plain words.
- List: remove per seed; no repeat of the same entity; at most MAX_SEEDS (10, imported from src/lib/profile/constants.ts) and the form is replaced by a note when full. A seed must be matched to an entity to be added, so every listed seed has a `qlooId`.
- "See my taste": needs 3 seeds across 2 fields (readiness text says what is left, plus a quiet bar, no numbers). Uses `aria-disabled` (not `disabled`) so it stays focusable and its reason is read through `aria-describedby`. On success it posts `{seeds}` to `/api/profile`, saves the result and routes to `/taste`.
- A11y: every control labelled, focus moves to the next step after a lookup (why input after clean, first chip after ambiguous), one polite live region (lookup state, matches, added and removed, building), errors have a "Note:" prefix besides color, 44px targets, tokens only, works with no account.

### State persisted between steps (sessionStorage, per tab, guest-friendly)
- `atelier.onboarding.v1` (FlowSession): `{version: 1, field, entries: Entry[]}` where `Entry = {seed: ProfileSeed, matchedLabel, whyMapped, whyEvent?}`. Restores the list on reload and when coming back from /taste.
- `atelier.taste.v1` (TasteSession): `{version: 1, seeds: ProfileSeed[], profile, axes, trace: TraceEvent[]}`. `seeds` is exactly what was posted to `/api/profile` (Seed plus `whyTags`); `trace` is a `resolve_seed` event per seed, the seed's `map_why` event, then the profile build's events.
- Both are parsed defensively (versioned, guards, freeform tag ids rejected). Bump the version on a shape change.

### How the picks screen (T-14) receives the profile
`import { readTasteSession } from "@/components/onboarding"` (client side only) returns `TasteSession | null`. It reads sessionStorage, so call it after hydration (for example `useSyncExternalStore` as TasteView does, or an effect) and POST `{profile, axes, seeds}` to whatever T-14's route needs. Null means no profile: send the user to `/start`. If T-14 wants a server handoff instead (a signed-in save), that is T-06/T-14's call; nothing here writes to the database.

### Contracts and files
src/components/onboarding/: `flow.ts` (validation, draft reducer, list rules, readiness; pure), `api.ts` (request builders, response readers; pure), `session.ts` (storage parse and wrappers, `assembleTrace`), `copy.ts` (all wording and error-code mapping), `constants.ts`, `OnboardingFlow.tsx`, `MatchPicker.tsx`, `SeedList.tsx`, `TasteView.tsx`, `Onboarding.module.css`, `hooks.ts`, `types.ts` (type-only re-exports so the client never imports server code), `fixtures.ts` (synthetic, tests only), `index.ts`. Client code imports only pure constants from src/lib/profile/constants.ts and src/lib/seeds/constants.ts and `FIELD_LABEL` from src/components/chart/marks.ts.

### Tunables for the manager (src/components/onboarding/constants.ts, move to config.ts)
`MIN_SEEDS = 3`, `MIN_FIELDS = 2`, `MIN_WHY_CHARS = 3`, `MAX_CHIPS = 5`, plus the route paths and storage keys. MAX_SEEDS, MAX_WHY_CHARS, MIN/MAX_QUERY_LENGTH are re-exports of the server constants, so form and server agree.

### Qloo calls
None directly. Through `POST /api/seeds/resolve` (one per submitted search), `POST /api/profile/why` (one per added seed), `POST /api/profile` (one per "See my taste"), all existing routes, so at most 2 live calls per seed during onboarding plus 1 for the profile.

### Known gaps
- No browser or jsdom interaction test: logic is tested as pure modules; rendering was only checked by fetching /start and /taste from a brief dev run. design-reviewer should walk the flow in a browser, especially focus movement, the radio chips and phone width.
- Taste screen shows no picks (T-14). No account prompt or save (T-06 and later); the flow works fully as a guest.
- The "why" is one short line by design, because the semantic search keeps only the first concept of a long why (T-07 gap).
- Chips show label text only, no images (imageUrl is read but not rendered; the year and disambiguation property names are unconfirmed per T-05).
- Calibration recs before account creation (DECISIONS) are not in this ticket.
- Changing the field after a match clears the match but keeps the typed text; there is no per-field progress or "done with this field" step.


### Review round 1 changes
- Focus: a full list moves focus to the list heading after the 10th add. A missing or error result moves focus back to the query input.
- Readiness: full but not across 2 fields says "Your list is full at 10. Remove one and add one from another field to see your taste." All readiness and other strings now live in copy.ts (including "Getting ready", "Your chart", "Next", the shortfall sentence, the unmapped note, the chart label).
- Stale add: the list is held in a ref and every change goes through one `commit`; duplicate and max checks re-run against the current list after the why lookup. Remove is `aria-disabled` while adding or building.
- Query edits: editing the text (beyond spacing) cancels a lookup in flight and drops a stale match; `searchDone` drops a result whose query is not the one in the box; `typed` is stored from the searched query (`Draft.searchedQuery`).
- Validation: new `check.ts` holds `isTagId`, `isTagType` (the server's `[^:\s]` regex copied, not imported, because tags.ts pulls in server modules), `cleanWhyTags` (max 5, trimmed name at most 120) and `readProfileShape` (seedIds, skippedSeeds, fields, tags, bridgeTagIds, droppedGenericCount, droppedAxisTagTypes, axisShortfall, naming). `readProfile`, `readWhy` and `parseTasteSession` use them, so a stale or edited session returns null instead of crashing /taste or T-14. A stored session with more than MAX_SEEDS seeds is also rejected.
- Request size: `profileSeeds(entries)` now sends `{id, field, typed, why, qlooId, status: "clean", whyTags?}` per seed. An ambiguous seed goes as `clean` with the chosen id and no candidate list (the server never reads either; checked in src/lib/profile). `TasteSession.seeds` is this trimmed list, so T-14 sees `status: "clean"` always. The flow session still keeps the full seed with candidates. Test: ten seeds with five long why tags each stay under 60 percent of the server cap.
- Announcements: "Matched to X" is announced after choosing a chip; the blocked "See my taste" reason is a visible `role="alert"` note (re-announced on each press, independent of search state); search state and add/remove messages use two separate status regions.
- Buttons: "Find it" and "Add to my list" use `aria-disabled` while busy (focus is kept), with a dashed edge, not color alone.
- "Start over" on /taste is a small text button below the main actions with a plain confirm step ("Clear your list and your chart?", "Yes, start over" / "Keep them"); focus moves into the confirm and back.
- Intro says it takes a few minutes. `.hint` is now `--text-sm`. CSS literals replaced with tokens where one exists (remaining literals: layout widths, a 0.02em tracking, a 40rem media query).
- Reuse: "See my taste" skips `/api/profile` when the stored taste session has exactly the same request seeds (compared by canonical JSON) and goes straight to /taste. Any add or remove clears the stored taste session, so a stale chart is never shown after the list changes.
