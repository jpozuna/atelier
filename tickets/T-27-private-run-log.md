# T-27: Private run log for learning from reasoning

Status: todo
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
- [ ] Table `run_log` (id, created_at, profile hash, optional user id, unredacted trace jsonb, kept pick ids, plan). RLS enabled with no anon or authenticated policies, so only the service role can read or write it. A `run_signal` table (run id, pick id, signal: not_me | saved_explore | saved_later | saved_try | not_interested | tried, optional why text, created_at) uses the same lock-down
- [ ] `/api/run` writes one log row per finished or failed run, after the response stream ends, and never blocks or fails the run. A re-run with `exclude` records each newly excluded id as `not_me` against the run that showed it, when known. `/api/reactions` records saves and "not interested" as signals
- [ ] Without Supabase env (local dev, evals), logging goes to `.qloo-private/runlog/` as JSONL, or is a no-op when `ATELIER_RUNLOG=off`. Nothing is written to tracked paths
- [ ] Rows older than the hackathon window can be purged (a SQL function or a documented one-line delete). Mention in the hand-off that Qloo data leaves when the key is deactivated
- [ ] No Qloo call, model call or numeric taste data is added to any browser response. Tests cover: write is fire-and-forget, failure is swallowed, the client never sees log ids or contents. Repo checks pass
- [ ] Hand-off: a short note on how to read the log, which the manager adds to docs. The learning loop itself is out of scope

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
