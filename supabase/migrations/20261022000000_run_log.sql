-- Private run log (T-27): every run's full reasoning trace, and the signals people give on its picks later.
--
-- Purpose: study which reasoning led to picks people kept and which led to "not me". The learning loop itself is out
-- of scope here; this only stores what it will read.
--
-- Rules this file enforces:
--   * run_log and run_signal are private like qloo_cache and guard_counters: RLS on, NO policies, every grant revoked
--     from anon and authenticated. Only the service role (server code) reads and writes them.
--   * The trace is stored unredacted (popularity summaries, reach and connection numbers, request params with Qloo
--     ids). That is allowed only because nothing here is ever sent to a browser (hard rules 3 and 7).
--   * The Qloo key is deactivated after the hackathon. Purge before then or at the latest right after, with
--     public.purge_run_log (below). One line without the function:
--         delete from public.run_log where created_at < now();     -- signals go with it (on delete cascade)
--   * An account's rows leave with the account (user_id cascades).

-- ---------------------------------------------------------------------------------------------------------------
-- run_log: one row per finished or failed run
-- ---------------------------------------------------------------------------------------------------------------

create table public.run_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- sha256 hex of the run's seeds (id, entity id) and profile tag ids (src/lib/runlog/hash.ts). Stable across re-runs
  -- of the same profile, so a re-run finds the run that showed a pick. Not reversible to names.
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  -- The signed-in person, when there was one. A guest's run has none.
  user_id uuid references public.profiles (id) on delete cascade,
  outcome text not null check (outcome in ('ok', 'failed')),
  -- A fixed code (the same codes /api/run returns) when outcome is failed.
  error_code text,
  -- The request as the run took it: seeds (id, field, typed, why, entity id), exclude, domains.
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  -- {events: TraceEvent[], meta, audit}. Unredacted.
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  -- The run plan (themes and re-queries). Null when the run failed before it had one.
  plan jsonb check (plan is null or jsonb_typeof(plan) = 'object'),
  -- The picks the run showed, as two arrays of equal length: kept_pick_ids[i] is the pick whose Qloo entity id is
  -- kept_entity_ids[i].
  kept_pick_ids text[] not null default '{}',
  kept_entity_ids text[] not null default '{}',
  constraint run_log_kept_parallel check (cardinality(kept_pick_ids) = cardinality(kept_entity_ids))
);

create index run_log_profile_idx on public.run_log (profile_hash, created_at desc);
create index run_log_user_idx on public.run_log (user_id, created_at desc) where user_id is not null;
create index run_log_created_idx on public.run_log (created_at);
create index run_log_kept_entities_idx on public.run_log using gin (kept_entity_ids);
create index run_log_kept_picks_idx on public.run_log using gin (kept_pick_ids);

-- ---------------------------------------------------------------------------------------------------------------
-- run_signal: what a person did with a pick of a run
-- ---------------------------------------------------------------------------------------------------------------

create table public.run_signal (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.run_log (id) on delete cascade,
  pick_id text not null check (length(pick_id) > 0),
  -- The pick's Qloo entity id, when known (a not_me from an exclude list is known by it).
  entity_id text,
  signal text not null check (signal in ('not_me', 'saved_explore', 'saved_later', 'saved_try', 'not_interested', 'tried')),
  -- The person's own words, when they gave any.
  why text,
  -- How it was recorded: a save or reaction; an explicit not-me list in the run request; or inferred from a run's
  -- `exclude` list (which also holds picks that were merely shown, so treat it as weaker evidence).
  source text not null default 'reaction' check (source in ('reaction', 'not_me_list', 'exclude')),
  -- The person who gave the signal, when signed in. May differ from run_log.user_id (a guest ran, then signed in).
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One row per (run, pick, signal, person): repeating a signal updates that row (the app upserts, so a new `why`
  -- wins); a different state is a new row (the history is the point).
  constraint run_signal_once unique nulls not distinct (run_id, pick_id, signal, user_id)
);

create index run_signal_run_idx on public.run_signal (run_id);
create index run_signal_user_idx on public.run_signal (user_id, created_at desc) where user_id is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security: on, with no policies. Nothing but the service role (which bypasses RLS) can touch these.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.run_log enable row level security;
alter table public.run_signal enable row level security;

revoke all on public.run_log, public.run_signal from public, anon, authenticated;
grant all on public.run_log, public.run_signal to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- purge_run_log: delete every run older than the cutoff (signals cascade). Returns how many runs were deleted.
-- ---------------------------------------------------------------------------------------------------------------
-- Run from the SQL editor or with the service role: select public.purge_run_log(now());

create function public.purge_run_log(cutoff timestamptz)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.run_log as r where r.created_at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_run_log(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_run_log(timestamptz) to service_role;
