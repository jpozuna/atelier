# T-22: Qloo vs plain-LLM side-by-side

Status: done
Mode: inline
Kind: feature
Priority: P2
Depends on: T-10

## Goal
A demo and eval view showing the same profile's picks from Atelier and from a plain LLM with no Qloo grounding, to show what grounding adds.

## Owns
- src/app/(compare)/
- src/app/api/compare/
- src/components/compare/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/app/api/run/
- src/components/card/

## Skills
- atelier-design
- atelier-evals

## Done when
- [ ] Side-by-side for one profile, with plain-LLM picks clearly labeled ungrounded
- [ ] Uses cached Atelier runs only (0 live Qloo calls)
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: no
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- none

## Qloo calls
- none (cached runs only)

## Handoff
**What changed** (Owns, plus the paths the manager authorized for this round)
- `POST /api/compare` (`src/app/api/compare/`: `route.ts`, `handler.ts`, `prompt.ts`, `handler.test.ts`). Body `{ seeds: [{field, typed, why}], fields }`; only those three seed keys are read, so ids, candidates and tags never reach the model. Reply `{ picks: [{name, field, why}] }`. One forced-tool call through `createLlm`, model from `ATELIER_MODEL`. Replies are checked: requested fields only; no ids, links or `urn:` in names or reasons; reasons have no digit, no score/rank/percent wording and no bare domain (names are not checked for score words and may hold digits and dots); not the user's own seeds; no repeats; at most `COMPARE_PICKS_PER_FIELD` per field. A failing pick is dropped, not repaired. Fixed calm messages by code: `bad_request` 400, `upstream`/`unusable` 502, `model_off` 503 (no `ANTHROPIC_API_KEY`: refused before reading the body, nothing sent). No Qloo call, no stored run read.
- `/compare` (`src/app/(compare)/compare/page.tsx`, `src/components/compare/`) reads the taste session and the picks screen's stored run; with none it shows a calm link to `/picks`. Left: Atelier's edge picks by field as `<PickCard readOnly>`. Right: the plain list, each item reading "Ungrounded: no Qloo link, no source". Neutral explanation, no scores.
- Dev preview `/compare/preview` (synthetic run, fake model, 404 in production; may move to `/dev/compare`).

**Review round (items 1 to 16)**
- Code: all tunables are now in `src/lib/agent/config.ts` ("Compare" section: `COMPARE_PICKS_PER_FIELD`, `COMPARE_MAX_NAME_CHARS`, `COMPARE_MAX_PLAIN_WHY_CHARS`, `COMPARE_WHY_WORDS`, `COMPARE_MAX_TOKENS`, `COMPARE_MAX_BODY_CHARS`, `COMPARE_CACHE_MAX`), pinned in `config.test.ts`. Seed count, typed length and why length use `MAX_SEEDS_PER_USER`, `MAX_QUERY_LENGTH` (100) and `MAX_WHY_CHARS` (120), so they cannot drift (the why limit is now 120, was 300). Local `constants.ts` keeps only routes, storage keys and the label. The local limiter and `busy` code are gone (the guard covers `/api/compare`; the screen maps the guard's `too_many_requests` and `demo_resting` to a calm message). Singleflight: the shared call gets no request signal; it never rejects; cleanup is `pending.then(clear, clear)` set right after the entry, so it holds even if the client throws synchronously (tested). Seeds are sorted in the cache key. `PickCard` has `readOnly?: boolean` (no reaction area, nothing else changes; test in `src/components/card/readonly.test.ts`); `CompareCard` is now `<PickCard readOnly .../>`, with the copied markup and the CSS import deleted. `policy.test.ts` asserts `/api/compare` is guarded with cost `{model: 1, qloo: 0}`. The manager's `GUARD_COMPARE_*` additions are untouched.
- Design: the ask button uses `aria-disabled` with a guarded handler and a constant label; the status region is always rendered (visually hidden when empty, not `display:none`) and is the only place progress is announced. After a success focus goes to the first plain list heading (`tabIndex -1`); after any failure focus goes to the message. A "Jump to the plain model's list" link sits beside the status (shown below 56rem). Calm states (`model_off`, `too_many_requests`, `demo_resting`) use muted style in the status region; red `role="alert"` is for upstream, unusable, network and bad requests. The "one model call is made" body is hidden when the model is off. Before asking, the right column says "Not asked yet." Columns are `1fr 1fr`. The ungrounded label is `--text-sm` in `--color-text`, still with the dotted border. h4/h5 get a margin reset and long names wrap (`overflow-wrap`).
- Picks screen: a quiet "Compare with a plain model" link after the edge decks, shown only when the run has finished (`src/components/deck/PicksScreen.tsx`, `copy.ts`).

**Model calls per use**
- Opening `/compare`: 0 model calls, 0 Qloo calls. Pressing "Ask a plain model": at most 1 model call, 0 on a server cache hit (sha256 of model, tool, fields and sorted seeds' field/typed/why; identical concurrent asks share one). The list is also kept in sessionStorage (`atelier.compare.v1`, keyed by session key plus fields), so a revisit in the tab sends nothing. Failures are never cached.

**Guard**: entry exists (manager's): 6 an hour per IP, body 32,000 bytes, cost `{model: 1, qloo: 0}`. `COMPARE_MAX_BODY_CHARS` (20,000) is pinned to stay under it.

**Contracts**: `POST /api/compare` as above; `CompareView`, `CompareScreen`, `CompareEmpty` from `@/components/compare`; `COMPARE_PATH` = `/compare`; `PickCard` `readOnly`. The deck imports `COMPARE_PATH` from `@/components/compare/constants`.

**Checks**: typecheck, lint, `npm test` (1178 pass), `npm run build` (/api/compare, /compare, /compare/preview listed), `npm run evals` green. Synthetic tests only, fake model and fake fetch; zero live Qloo or Anthropic calls; `.env` and `.qloo-private/` not read. One transient typecheck error appeared mid-round in `evals/harness/live.ts` (another worker's file, missing `../live/smoke-run`); it was gone on rerun.

**Known gaps**: no browser run, so focus moves, the jump link, phone layout and dark theme are checked by server-render tests and reading only; a design-reviewer pass in a browser is still worth doing. The server cache and in-flight table are per process, in memory.
