# T-17: Save, revisit and follow-up

Status: done
Mode: inline
Kind: feature
Priority: P1
Depends on: T-06, T-14

## Goal
Users with an account can save picks in one of the save states, give a reason for "not for me", come back later, say whether they tried a pick and how it went, and see the edges of their profile move.

## Owns
- src/app/(saved)/
- src/app/api/reactions/
- src/components/reactions/
- src/app/auth/ (sign-in page and /auth/callback route)

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/lib/db/
- src/components/card/
- .claude/skills/atelier-design/SKILL.md

## Skills
- atelier-design
- atelier-agent-loop

## Done when
- [x] Saving asks a guest to create an account (magic link) and keeps their onboarding (needs the wiring below in src/components/deck and the picks page)
- [x] The saved list groups picks by state, and each opens its stored card (no Qloo call)
- [x] Follow-up asks: tried it? how was it? why? On submit, re-run only the domains affected (at most 3 live calls)
- [x] RLS: only the owner sees their picks and reactions (every call uses the cookie-bound client; T-06's policies do the enforcing; not run against a live database)
- [x] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: yes
- research question: none

## Evals
- call-budget

## Qloo calls
- via /api/run only

## Handoff
Zero live Qloo, Anthropic or Supabase calls, no network, `.env` and `.qloo-private/` not read, nothing committed. After review round 1 and the db change (commit 934e12d): `npm run typecheck`, `lint`, `test` (1120 passed), `build` and `npm run evals` all pass. Database paths are tested against T-06's in-memory fake (no RLS or constraints); the components are covered by server-render smoke tests and pure-logic tests, not a browser. Synthetic ids ...091/...092 kept.

### What exists
- **Auth** (`src/app/auth/`): `/auth/sign-in` (page, `SignInForm`, Server Action `requestSignIn`), `/auth/callback` (route + `handler.ts`, 303 with `Cache-Control: private, no-store`, session headers applied; a bad link returns to sign-in with a fixed code), `actions.ts` (`signOutAction`).
- **API** (`src/app/api/reactions/`): `POST /api/reactions` `{seeds, items:[{pick, reaction:{state, words?}}], snapshot?}` saves seeds, the profile snapshot, picks (stored path and card) and reactions under the caller's id, idempotent. `PUT /api/reactions/<pickId>` `{state, words?, tried?, how?, addSeed?}`. `PUT /api/reactions/snapshot` `{profile, axes, plan}`. `GET /api/reactions/session` -> `{userId|null}` (reads the cookie, spends nothing). Guests get 401; fixed codes only: `sign_in_required`, `not_ready` 503, `bad_request` 400 (includes DbMappingError, e.g. a `how` on an untried pick), `seed_missing` 422, `too_many_seeds` 422 (DbLimitError), `not_found`, `save_failed`. JSON content type required. Words: a string replaces the stored words ("" clears), absent keeps them; `tried`/`how` pass through only when present (db merge semantics).
- **Saved** (`src/app/(saved)/`): `/saved` (groups in the card's own order, the card's own labels: Save for later, I will try it, Explore further, Not for me, I tried it, then Not sorted yet; wrapped in `PendingSave refreshOnSaved`) and `/saved/[id]` (the pick name is the one h1, per-pick document title via a cached load). `load.ts`: `loadSaved` (one `listPicks`, `followUp` read from it, no extra query) and `loadFollowUpSource` (the account's seeds, `getProfileSnapshot`, and the saved picks' entity ids for that field).
- **Components** (`src/components/reactions/`): see `index.ts`.

### Review fixes
1. `SavedCard` sends `reactionUpdate(r)` = state plus words only when the card gave some; never tried, how or addSeed. Tested at the request level and against the handler (a state or words change keeps `tried` and `how`).
2. Guest carry is pending-only now and bound to the browser session: the record's random token must equal a session cookie (`atelier_carry`); expired, damaged or other-session records are deleted on read; `PendingSave` asks "Save the N picks you chose before signing in?" (Save them / Forget the waiting picks) via `GET /api/reactions/session`; a record offered to one account is deleted if a different account turns up; `SignOutButton` calls `clearLocalWork()` (record, cookie, this tab's onboarding, picks and flow). Nothing is saved without the yes. Because of the confirm, sign-in copy says "then confirm, and what you chose is saved".
3. Order in the follow-up: the answer (and a liked pick as a seed) is saved by the PUT, then the run, then the new plan is stored with `PUT /api/reactions/snapshot`. The carry no longer holds follow-up state, so DB and device cannot drift; a failed run leaves the seed and answer saved and the old plan stored.
4. `PendingSave` is mounted on `/saved`.
5. The tag literal in handler.test.ts was already `urn:tag:fixture:theme:...`.
6. Focus: sign-in success -> new h1 (tabIndex -1); error -> email input (invalid) or the message. Follow-up uses `aria-disabled`, guarded handlers and `readOnly` (nothing focused is disabled); an error focuses the first radio or the message; a finished look focuses the result heading. PendingSave actions focus its status region.
7. "How was it?" is a required radiogroup (visible "Required", `aria-required`, error tied by `aria-describedby`/`aria-invalid`, first radio focused on error); no empty alert region reserved (sign-in and follow-up).
8. Nothing preselected; an outcome word only when `how` is stored (`mixed` is its own value).
9. After a save the button reads "Update"; a submit with an unchanged answer does nothing ("Nothing has changed since you last saved this."); words-only changes save without a run; only a changed `how` runs again (up to 3 live calls). Note: `/api/run` is also under the T-20 guard (3 runs an hour per visitor); a refusal shows a calm line (resting or "used your share"), mapped with `isRestingCode`/`TOO_MANY_REQUESTS_CODE`.
10. Further picks: one column, a visible "Show path and reasons" / "Hide" text plus chevron (summary), reduced-motion aware.
11-15. Copy per the review (sign-in reason, one-hour link and spam folder, softened addedSeed, "Forget the waiting picks", `openCard` dropped), neutral group order and card labels, h1 `pageTitle` size on every page of mine, 2px/1.1rem/1px literals replaced by tokens (the 1px sr-only clip excepted).

### db change adapted
`liked` -> `how` ("liked" | "mixed" | "not_liked"); `listPicks().followUp`; `saveReaction` merge; `DbLimitError`/`DbMappingError` -> 422/400 with fixed copy; `profile_snapshots` replaces the device snapshot: `POST /api/reactions` carries it (first save of a run, and again only when the plan changes), the follow-up reads seeds + snapshot on the server, and `planFollowUp(source, ...)` now takes that source. A liked pick is saved as a seed only when the account has room (the page knows the count), so the limit is not hit in normal use.

### Needs from the manager (not mine)
1. **PickCard (T-15)**, two minimal changes. (a) a prop `reactionMode?: "full" | "states"`: in "states" never offer `tried`, and show the words box only when "Not for me" is chosen. `SavedCard` already passes `{reactionMode: "states"}` through a spread (ignored until it exists), so until then /saved/[id] shows PickCard's own why box beside the follow-up. (b) allow `headingLevel: 1` in the type (it already renders `h${level}`; `SavedCard` casts `1 as unknown as 2`). PickCard's own h1 stays text-2xl while my other h1s are text-3xl.
2. **Wiring, `src/app/(picks)/picks/page.tsx`:**
```tsx
import { PendingSave } from "@/components/reactions";
export default function PicksPage() {
  return (
    <PendingSave>
      <PicksView />
    </PendingSave>
  );
}
```
3. **Wiring, `src/components/deck/PicksScreen.tsx`** (re-checked, unchanged by the fixes; not applied yet):
```tsx
import { SaveNotice, useReactionSaver } from "@/components/reactions";
// after `state` (the run reducer) is defined, before `function react`:
const saver = useReactionSaver({ inputs, result: state.result });
// in react():
function react(id: string, reaction: Reaction) {
  setReactions((r) => ({ ...r, [id]: reaction }));
  saver.save(id, reaction);
}
// directly after the <div ref={cardRef} className={styles.cardWrap}>...</div>, inside the selected-card <section>:
<SaveNotice saver={saver} />
```
No import cycle.
4. **Shell `/saved` link**, `src/components/shell/Shell.tsx`, inside `<header className={styles.header}>` after the wordmark `<Link>` (add a small `.nav` rule): `<nav aria-label="Main"><Link href="/saved">Saved</Link></nav>`.
5. **next.config**: no `serverActions.allowedOrigins` needed on Vercel or locally (Next compares the Origin header with Host/X-Forwarded-Host, which match). Add it only if sign-in fails with "Invalid Server Actions request" behind a different proxy or custom domain, listing that host.
6. Tunables to move to config.ts (all in `src/components/reactions/constants.ts`): `CARRY_PENDING_TTL_MS` 24 h, `MAX_SAVE_ITEMS` 60, `MAX_SAVE_SEEDS` 10 (mirror of MAX_SEEDS_PER_USER), `MAX_SAVE_BODY_CHARS`, `MAX_REACTION_WORDS` 2000, `MAX_ID_CHARS`, `FOLLOW_UP_MAX_LIVE_CALLS` 3. Also the Supabase magic-link lifetime in the sent copy ("one hour") mirrors `otp_expiry = 3600` in supabase/config.toml; change both together.

### Qloo calls
None added. Only `FollowUp.tsx` reaches `/api/run` (domains = the pick's field, stored plan, exclude): one pool plus at most 2 re-queries, so at most 3 live calls, only when `how` changed. A static test pins this and that no owned file imports the Qloo client, the service-role client or a key.

### Known gaps
- Not run against a live database or in a browser (RLS, magic-link round trip and redirect allow-list, focus order, phone width, dark theme). design-reviewer should recheck /auth/sign-in, /picks with the confirm question, /saved, /saved/<id> (follow-up: required how, Update, further picks).
- The session cookie ties a waiting record to the browser session, not to a person; the confirm question and the "different account" check are what stop it going to the wrong account.
- Follow-up seeds the profile only through the seeds list; profile tags and axes are not rebuilt (no extra call), so the edges move through the new seed, the exclusions and the re-queried plan.
- The `.sr` clip uses 1px literals (standard visually-hidden pattern).
