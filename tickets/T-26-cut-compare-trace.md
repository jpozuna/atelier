# T-26: Cut the plain-model comparison and the trace panel

Status: done
Mode: inline
Kind: polish
Priority: P0
Depends on: T-25

## Goal
Remove the Qloo-vs-plain-LLM comparison (T-22) and the user-facing step-by-step reasoning trace from the product, so nothing links to them, nothing serves them, and the build stays green.

## Owns
- src/app/(compare)/ (delete)
- src/app/api/compare/ (delete)
- src/components/compare/ (delete)
- src/components/reasoning/ (delete, unless T-27 or evals still need a pure helper; then keep only that file and say so)
- src/app/dev/reasoning/ (delete)
- src/components/onboarding/TasteView.tsx (drop the ReasoningPanel)
- src/lib/guard/limits.ts, src/lib/guard/policy.test.ts (drop the /api/compare route policy)

## Reads
- CLAUDE.md, docs/DECISIONS.md
- tickets/T-22-qloo-vs-llm.md, tickets/T-16-reasoning-panel.md
- src/lib/agent/config.ts (the manager removes the `GUARD_COMPARE_*` and Compare constants at accept; list them in the hand-off)

## Skills
- none

## Done when
- [ ] `grep -rn "compare" src` finds no route, link, component or guard for the comparison
- [ ] `/compare` and `/api/compare` return 404. `/taste` shows no trace panel
- [ ] No file outside Owns imports a deleted module. Repo checks and `npm run evals` pass
- [ ] Hand-off lists every config constant that is now unused, plus README lines that mention compare (the manager edits both)

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes (TasteView only)
- research question: none

## Evals
- call-budget, repo-hygiene

## Qloo calls
- none

## Handoff

Done. `npm test` (95 files pass, 4 skipped), `npm run typecheck`, `npm run lint`, `npm run evals` and `npm run build` all pass. No Qloo calls. The built route list has no `/compare`, `/api/compare` or `/dev/reasoning`, so all three are 404. `/taste` renders no panel.

What changed
- Deleted: `src/app/(compare)/`, `src/app/api/compare/`, `src/components/compare/`, `src/components/reasoning/` (whole folder, including `helpers.ts`; nothing in `src`, `evals` or `scripts` imported a helper from it, so no file was kept), `src/app/dev/reasoning/`.
- `src/components/onboarding/TasteView.tsx`: ReasoningPanel and the now-unused `seedNames` memo removed. The stored `session.trace` is still written by the flow (not mine); `/taste` just does not show it.
- `src/lib/guard/limits.ts`: `/api/compare` route policy and its two GUARD_COMPARE imports removed (`GUARDED_ROUTES` is now four routes).
- `src/lib/guard/policy.test.ts`: the compare test removed, and `/api/compare` added to the unguarded paths in the `matchRoute` test. Unused `GUARDED_ROUTES` import dropped.
- Extra, granted by manager: `CapTraceEvent.fieldLimit` and `trimmed` are now required in `src/types/trace.ts` and in `isTraceEvent` (`src/types/guards.ts`); `guards.test.ts` now rejects a cap event missing either. The reasoning fixture that forced them optional is gone. Typecheck needed no fixture edits (the four `t23-*` traces already carry both).
- `grep -rni compare src` now finds only: config.ts and config.test.ts (below), a negative assertion in `deck/render.test.ts` ("Compare with a plain model" must not appear), `deck/copy.test.ts` (`compareLink` must not be a key), the `matchRoute` test line, and unrelated uses of the word "compared".

Imports of deleted modules outside Owns: none. (`src/components/deck/reasoning.ts` is deck's own local module, not the deleted one.)

Manager to do: unused constants in `src/lib/agent/config.ts` (no file outside config.ts and config.test.ts uses them)
- Guard: `GUARD_COMPARE_PER_HOUR` (line ~357) and `GUARD_COMPARE_MAX_BODY_BYTES` (~359).
- The whole "Compare" section (~471 to 491): `COMPARE_PICKS_PER_FIELD`, `COMPARE_MAX_NAME_CHARS`, `COMPARE_MAX_PLAIN_WHY_CHARS`, `COMPARE_WHY_WORDS`, `COMPARE_MAX_TOKENS`, `COMPARE_MAX_BODY_CHARS`, `COMPARE_CACHE_MAX`.
- Reveal: `REVEAL_STAGGER_MS`, `REVEAL_MAX_DELAY_MS`, `REVEAL_TOTAL_MS` (~411 to 414, with its comment).
- Panel scroll: `FOLLOW_THRESHOLD_PX` (~430 to 431, with its comment).
- Also remove their entries in `src/lib/agent/config.test.ts`: the "config.ts compare section" describe (~364 to 390) and the REVEAL_* and FOLLOW_THRESHOLD_PX lines (~309 to 317 and ~338 to 346). My scan was for exported names with zero uses outside those two files, so these are all of them. Not unused but worth a look: the comment on `MAX_REQUERIES`-style trace constants ("The reasoning stays readable", ~416) still describes trace events kept in storage, which the flow still uses.

Manager to do: README lines that mention compare (and the removed panel)
- Line 25: item 8 "Compared with a plain model" (whole item).
- Line 109: `/compare` in the `src/app/` row. Line 110: "reasoning panel" and "compare" in the `src/components/` row.
- Line 103: "and compare with a plain model without an account".
- Line 225: "`/api/compare`" in the list of guarded routes (five becomes four). Line 227: "For `/api/compare` it is 6 an hour." Line 228: "a compare ask charges 1 and no Qloo call". Line 251: "The compare route's own cache and backstop are in memory...".
- Related to the panel cut: line 23 (item 7 "Visible reasoning. A reasoning panel streams ...") and line 105 (`/api/run` streams trace events "which drive the reasoning panel"). Line 241 ("no compare-with-others overlay") is about social features and is unrelated.
- Also outside README: `docs/submission/demo-script.md` lines 5, 15, 16, 18 and 32 describe the `/compare` beat.

Known gaps
- The stale `.next/dev/types` (gitignored generated output) still named the deleted pages and failed typecheck and build; I deleted `.next/dev/types` so it regenerates. No tracked file was touched.
- design-reviewer (TasteView only) not run by me.
