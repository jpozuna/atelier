# T-27: Private run log for learning from reasoning

Status: done
Mode: inline
Kind: feature
Priority: P1
Depends on: none

## Goal
Every run's full reasoning trace, and the user's later signals on its picks, are stored server-side in a private log. Later work can then study which reasoning led to picks people kept and which led to "not me".

## Owns
- supabase/migrations/20261022000000_run_log.sql (new)
- src/lib/runlog/ (new)
- src/app/api/run/
- src/app/api/reactions/

## Reads
- CLAUDE.md, docs/DECISIONS.md (the "Nothing numeric about taste leaves the server" and "Stored server-side traces may keep them" entries)
- supabase/migrations/20261019000000_init.sql (qloo_cache RLS pattern)
- src/lib/agent/types.ts, src/lib/agent/public.ts
- .claude/skills/qloo-api/SKILL.md (data handling)

## Skills
- qloo-api
- atelier-evals
- supabase:supabase-postgres-best-practices

## Done when
- [x] Table `run_log` (id, created_at, profile hash, optional user id, unredacted trace jsonb, kept pick ids, plan). RLS enabled with no anon or authenticated policies, so only the service role can read or write it. A `run_signal` table (run id, pick id, signal: not_me | saved_explore | saved_later | saved_try | not_interested | tried, optional why text, created_at) uses the same lock-down
- [x] `/api/run` writes one log row per finished or failed run, after the response stream ends, and never blocks or fails the run. A re-run with `exclude` records each newly excluded id as `not_me` against the run that showed it, when known. `/api/reactions` records saves and "not interested" as signals
- [x] Without Supabase env (local dev, evals), logging goes to `.qloo-private/runlog/` as JSONL, or is a no-op when `ATELIER_RUNLOG=off`. Nothing is written to tracked paths
- [x] Rows older than the hackathon window can be purged (a SQL function or a documented one-line delete). Mention in the hand-off that Qloo data leaves when the key is deactivated
- [x] No Qloo call, model call or numeric taste data is added to any browser response. Tests cover: write is fire-and-forget, failure is swallowed, the client never sees log ids or contents. Repo checks pass
- [x] Hand-off: a short note on how to read the log, which the manager adds to docs. The learning loop itself is out of scope

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- call-budget, repo-hygiene

## Qloo calls
- none

## Handoff

**What changed**
- `supabase/migrations/20261022000000_run_log.sql` (new, not applied anywhere): `run_log` and `run_signal`, RLS on, no policies, all grants revoked from public/anon/authenticated, service role only. `public.purge_run_log(cutoff timestamptz) returns bigint` (service role only) deletes older runs; signals cascade. One-liner without it: `delete from public.run_log where created_at < now();`. Rows cascade with the account (`user_id` on delete cascade).
- `src/lib/runlog/` (new, server only): types, `hashProfile`, `createRunLog(store)` (`recordRun`, `recordReactions`), `runInBackground`, three stores (Supabase service role, JSONL under `.qloo-private/runlog/`, no-op/memory), and the read API below. Store choice (`createRunLogStore`): `ATELIER_RUNLOG=off` writes nothing, `file`, `supabase`; unset means Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set, else off on Vercel (`VERCEL` set, read-only filesystem), else file; off under `NODE_ENV=test`. Nothing is written to a tracked path.
- `/api/run` (`handler.ts`, `route.ts`): collects every raw trace event, and after the stream has closed calls `runLog.recordRun` through `runInBackground` (never awaited, every failure swallowed, a fixed `console.warn` line only). The route passes `getRunLog()`, the signed-in user id (`getCurrentUser`, started at request time, failure means guest) and Next's `after`. One row per finished or failed run; a client cancel is logged as failed with code `cancelled`. Requests refused before streaming log nothing.
- `/api/reactions` (`handler.ts`, `route.ts`, `[pickId]/route.ts`): after a successful save or update, signals are recorded in the background: `later`->`saved_later`, `will_try`->`saved_try`, `explore`->`saved_explore`, `not_interested`, `tried`; a PUT with `tried: true` also records `tried`. The person's words go in `why`. The run is found by user id and pick id, then by profile hash (a save with a snapshot), then by the person's earlier signal on that pick (guest ran, then signed in). Unknown run: skipped. `how` (liked/mixed/not_liked) is not recorded.
- No Qloo call, model call or numeric taste data is added to any browser response. The stream and results are unchanged; the log id, hash and contents are never sent (tested).

**Contracts other tickets rely on**
- Read API (`@/lib/runlog`, server only, optional `{store}` for tests): `readSignalsByUser(userId)` and `readSignalsByProfile(profileHash)` return `{signal: SignalRow, run: RunSummary}[]` oldest first (by user: signals the person gave plus signals on runs they made). `readRunsByUser`, `readRunsByProfile` return `RunSummary[]` newest first (no trace). `readRun(runId)` returns the full `RunRow` with `input` and unredacted `trace: {events, meta, audit}`. `hashProfile({seeds, tagIds})` makes the profile hash (sha256 of sorted seed id and entity id pairs plus sorted profile tag ids; reasons are left out). A `RunSummary` has `plan`, `keptPickIds` and `keptEntityIds` (parallel arrays), `outcome`, `errorCode`, `userId`, `profileHash`. `SignalRow` has `runId, pickId, entityId, signal, why, source, userId, createdAt`.
- Signal values (`RUN_SIGNALS`): not_me, saved_explore, saved_later, saved_try, not_interested, tried. `source`: `reaction`, `not_me_list` (exact), `exclude` (inferred, weaker).
- `/api/run` accepts an optional `notMe: string[]` (entity ids, a subset of `exclude`). The run ignores it; only the log reads it.

**Decision needed (not_me semantics)**: the picks screen sends `exclude` as "every pick shown in the affected fields plus everything set aside" (`rerunExclude` in `src/components/deck/request.ts`), and the follow-up run also puts the tried pick in `exclude`. The server cannot tell "set aside" from "merely shown" in that list. As the ticket says, a re-run with `exclude` records each excluded id that a known run showed as `not_me`, but labelled `source = 'exclude'` so it can be filtered out. For exact data, the client should also send `notMe` (the newly set-aside ids; `setAside` in `PicksScreen.tsx` has them). That is a one-line change in `src/components/deck/` (not my paths); then the signals are `source = 'not_me_list'`. Signals are one row per (run, pick, signal, user): a repeat is a real upsert (last write wins, so a new `why` replaces the old one; a repeat with no words keeps the earlier words). The file store appends and reads keep the last line per key.

**How to read the log (for docs)**
- Local (no Supabase env): `.qloo-private/runlog/runs.jsonl` and `signals.jsonl`, one JSON object per line. Example: `jq -c '{id, outcome, kept: (.keptPickIds|length)}' .qloo-private/runlog/runs.jsonl`; signals: `jq -c '[.runId,.pickId,.signal,.source,.why]' .qloo-private/runlog/signals.jsonl`.
- Supabase: service role only (SQL editor, or `createServiceClient`). Example: `select r.id, r.outcome, s.pick_id, s.signal, s.source, s.why from run_log r join run_signal s on s.run_id = r.id order by s.created_at;`. The full trace is `run_log.trace -> 'events'`.
- Qloo data leaves when the key is deactivated: the traces hold Qloo entity ids and request params. Guest rows keep the typed text and why words (`run_log.input`) until purged. Purge after Nov 16 with `select public.purge_run_log(now());` (or the delete above). Never export the table to a tracked path.

**Known gaps**
- `src/lib/db/migrations.test.ts` (not in my Owns) now fails "create exactly the seven tables": it must list `run_log` and `run_signal` (e.g. a `RUNLOG_TABLES` list in `src/lib/db/constants.ts`). My own static migration checks are in `src/lib/runlog/migration.test.ts`. The other failing test in `npm test`, `evals/harness/runner.test.ts` (registered scorers order), is from T-23's evals work, not mine.
- `src/lib/db/database.types.ts` does not describe the two tables; the store uses an untyped client on purpose.
- No size cap on a stored trace and no retention job beyond the purge function; the migration is not applied to any Supabase project (Prod `QLOO_MODE=replay` with Supabase env would log there only after it is applied; until then writes fail quietly with a fixed warning). The learning loop is out of scope. The `after` hook relies on Next 16 `after()` being callable from inside the stream callback, which was not run against a real server.

**Review fixes (manager round)**
- `/api/reactions`: the log entry (profile hash, signal mapping) is built inside the background task (a thunk), so a throw there cannot fail a save or update (`reactions/runlog-throw.test.ts`).
- Not-me lookup: matches earlier runs by profile hash, then falls back to the signed-in person's newest run that showed the entity.
- Signals use a real upsert on conflict in Supabase, memory and file stores (see above). The `recordRun` ordering comment now says what happens (this run is stored first and skipped by id in the lookup).
- Cancelled runs (logged as failed/`cancelled`) and trace events failing `isTraceEvent` (kept out of the log) are tested in `run/runlog.test.ts`.
