# T-16: Reasoning panel

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-11

## Goal
A side panel that turns streamed TraceEvents into short readable steps (what the agent looked at, what it decided and why, including re-queries), so the reasoning is visible.

## Owns
- src/components/reasoning/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- .claude/skills/atelier-design/SKILL.md
- .claude/skills/atelier-evals/SKILL.md (trace format)
- src/types/

## Skills
- atelier-design

## Done when
- [ ] Each TraceEvent type has a one-line human rendering. Re-queries show their reason code in words. Cached calls are not shown as separate steps
- [ ] Never shows ids, raw params, scores or the API key
- [ ] Streams in order, can be collapsed, and is announced politely to screen readers
- [ ] Built against a synthetic trace fixture
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

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
Files (all under `src/components/reasoning/`): `ReasoningPanel.tsx` + `.module.css`, `ReasoningDemo.tsx` + `.module.css`, `helpers.ts`, `fixture.ts`, `index.ts`, `helpers.test.ts` (24 tests, node env, pure helpers only). typecheck, lint and test pass for these paths. No Qloo calls, no data, no deps added, no route added.

### Props API
`import { ReasoningPanel } from "@/components/reasoning"` (client component).
- `events: readonly TraceEvent[]` required. Append-only accumulated list: keep it in state, push each streamed event, pass the whole list every render. Step keys are the source event's index, so earlier lines never re-mount; only new lines animate in.
- `streaming?: boolean` (default false). True while more events can arrive. Drives the polite announcements and the "More steps will follow" note. When it flips to false after streaming, one closing line "The reasoning is complete." is announced.
- `seedNames?: Record<seedId, typed name>`, `pickNames?: Record<pickId, display name>`: so lines can name seeds and picks. Without them lines say "One of your picks" / "a pick". Ids are never displayed.
- `title` (default "Reasoning"), `headingLevel` (2 | 3 | 4, default 2), `defaultOpen` (default true), controlled `open` + `onOpenChange`, `announceEveryMs` (default 1500).
- Streaming a JSONL trace: `parseTraceLine(line): TraceEvent | null` (uses `isTraceEvent`) for turning SSE/JSONL lines into events; pass `events` as a growing array.
- Other exports: `buildSteps`, `renderEvent`, `cleanText`, `announcementText`, `REQUERY_TEXT`, `FIELD_NOUN`, `FIXTURE_TRACE` (synthetic, covers every kind and every re-query reason), `ReasoningDemo`.

### Behaviour
- One line per event, built from structured fields in fixed wording (not from `say`). Deviation from the design skill ("using each event's `say`"): `say` is free text with no guarantee it omits ids or numbers, so it is used only as a fallback for an unknown future event kind. Model-written `choose_theme.reason` and `relax.reason` are shown as a muted second line after `cleanText` (strips UUIDs and urns; drops the text entirely if it mentions a key, has a long token, or contains a decimal or percentage).
- Never shown: ids, tag ids, params, popularity or any number, call counts, status codes, key. Cached `qloo_call` events produce no step. Consecutive identical lines collapse so repetition never reveals a count. Live `qloo_call` lines are small quiet lines ("Looked up what you named in the taste graph.").
- Re-queries: too_obvious, too_weak, empty and weak_connection each have a plain sentence (`REQUERY_TEXT`). Relax: "Nothing connected strongly enough at the extreme band, so showing high." Re-queries, relaxed bands and unresolved seeds ("notice" tone) are marked by a label word and a heavier rule, not by color alone.
- `fetch_refs` with nothing sourced says lineage and symbolism are left out (hard rule 6).
- Accessibility: collapse button with `aria-expanded`/`aria-controls` (44px target), list is an `<ol>`, separate visually hidden `role="status"` polite region that holds only the latest step, at most once per `announceEveryMs`, so the list itself is not a live region and a burst reads as one update. Animation uses token durations, so it drops to ~0 under reduced motion.

### Contracts and notes for the manager
- Dev route to add (manager owns `src/app/`): `src/app/dev/reasoning/page.tsx` rendering `<ReasoningDemo />` from `@/components/reasoning`, like the card and chart demos. The demo draws its own two-column layout (panel beside content at >= 64rem) because the root layout wraps pages in a `Shell` without a `side`.
- Integration: the root layout's `Shell` has no `side`, so a real page that wants the panel in the shell's side region needs a Shell per page or a layout change. The panel itself is layout-agnostic (fills its container).
- Loop/stream ticket (T-10 and the run route): events must have a valid `kind` and structured fields; the panel does not read `say`.
- Wording is code-owned in `helpers.ts`; design-reviewer may want to adjust copy there.

### Known gaps
- No auto-scroll to the newest step (the panel flows in the page).
- Not rendered or visually reviewed in a browser by me; only typecheck, lint and node-env tests.
- Seed ids without a name in `seedNames` produce the generic "One of your picks", which can read the same for several seeds and then collapses.


### Review fixes (round 2)
All nine review items done; typecheck, lint and test pass (49 tests in `helpers.test.ts`).
- Sanitizers: `cleanText` is gone. `cleanReason` is an allowlist for model-written text (`choose_theme.reason`, and `say` for malformed or unknown events): only letters, spaces and ordinary punctuation; no digits, slashes or symbols; no dotted or colon identifiers; no long letters-only tokens; no urn, uuid, url or host, key-like prefixes (sk-, ant-, key-, token-) or key words; no score, rank, percent or popularity words. Any hit drops the whole text, nothing is stripped mid-sentence. `cleanName` is the looser sanitizer for seed and pick names (digits and symbols allowed); it drops urns, uuids, urls and hosts, key-like strings and 32+ character tokens. Tests cover every leak case in the review.
- Copy: seeds are labelled "What you shared": "Something you shared matched a single entry." / "... could mean more than one thing." / "... was not found." (named: "“Name” ..."). "Pick" is used only for suggestions. The relax reason line is dropped; only the fixed sentence is shown.
- New prop `landmark` (default true). With `landmark={false}` the panel renders a `div` instead of a named `section`, so inside an already labelled "Reasoning" container (the Shell side region) it is not announced twice. The demo passes `landmark={false}`.
- Each step animates only on first appearance (it drops the animation class on `animationend`), so expanding a collapsed panel does not replay it. Steps that arrive while collapsed animate once when first shown.
- Consecutive identical re-queries are kept; other identical consecutive lines still collapse.
- Closing announcement: a `closePending` ref is raised while streaming and cleared only when the line has been spoken, so effect re-runs cannot drop it. The effect now depends on the latest line text, not the steps array. `seedNames` and `pickNames` should still be memoized or module-level (documented on the props).
- `parseTraceLine` accepts `data:` lines (with or without a space), and returns null for SSE comments, `event:`, `id:`, `retry:` fields and `[DONE]`. `events` is typed `readonly unknown[]`; `renderEvent` and `buildSteps` never throw: anything failing `isTraceEvent`, or a throw while rendering, becomes the loop's `say` if it passes `cleanReason`, else "Took another step.".
- CSS: the 3px rule is `calc(var(--border-width) * 3)`; label text is `--text-xs`.
- Known gap unchanged: several seeds with no name in `seedNames` render the same generic line and collapse into one.
