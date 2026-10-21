-- Durable counters for the deploy guard (src/lib/guard): per-visitor rate limits and the global daily meters.
--
-- Before this, the counters lived in each server process's memory, so every serverless instance counted on its own
-- and a cold start reset them. This table and guard_consume() hold one count for all instances. The app keeps the
-- in-memory store as a fallback when this is unreachable (src/lib/guard/store-supabase.ts).
--
-- Rules this file enforces:
--   * guard_counters is private like qloo_cache: RLS on, no policies, every grant revoked from anon and
--     authenticated. Only the service role (server code in the proxy) reads and writes it.
--   * guard_consume() is executable by the service role only.
--   * No caller addresses are stored: visitor keys arrive hashed (`v:<sha256 hex>`); global meters are named
--     (`global:model`, `global:qloo`). Rows are pruned after the longest window (24 hours).

-- guard_counters: one row per admitted hit
create table public.guard_counters (
  key text not null check (key ~ '^(v:[0-9a-f]{64}|global:[a-z_]+)$'),
  -- Epoch milliseconds, the same clock CounterStore uses.
  at_ms bigint not null,
  cost integer not null check (cost > 0)
);

create index guard_counters_key_at_idx on public.guard_counters (key, at_ms);
create index guard_counters_at_idx on public.guard_counters (at_ms);

alter table public.guard_counters enable row level security;

-- guard_consume: admit and commit, or refuse and commit nothing (all-or-nothing across a request's hits)
-- `hits` is a JSON array of {key, cost, gate?, limit, windowMs}, as in src/lib/guard/store.ts. With do_commit false it
-- is the same decision without writing (CounterStore.check). Returns {"ok":true} or
-- {"ok":false,"index":n,"key":k,"retryAfterMs":ms}, where index is the first hit that failed.
create function public.guard_consume(hits jsonb, now_ms bigint, do_commit boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_hit jsonb;
  v_idx bigint;
  v_key text;
  v_cost integer;
  v_need integer;
  v_limit integer;
  v_window bigint;
  v_used bigint;
  v_over bigint;
  v_retry bigint;
  v_row record;
begin
  if jsonb_typeof(hits) is distinct from 'array' then
    raise exception 'hits must be a JSON array';
  end if;

  -- Lock every key for this transaction, in a fixed order, so two instances never both pass and never deadlock.
  perform pg_advisory_xact_lock(hashtextextended(k.key, 0))
  from (select distinct h.value ->> 'key' as key from jsonb_array_elements(hits) as h) as k
  order by k.key;

  for v_hit, v_idx in select h.value, h.ordinality - 1 from jsonb_array_elements(hits) with ordinality as h loop
    v_key := v_hit ->> 'key';
    v_cost := (v_hit ->> 'cost')::integer;
    v_need := coalesce((v_hit ->> 'gate')::integer, v_cost);
    v_limit := (v_hit ->> 'limit')::integer;
    v_window := (v_hit ->> 'windowMs')::bigint;
    if v_need <= 0 then
      continue;
    end if;

    select coalesce(sum(c.cost), 0) into v_used
    from public.guard_counters as c
    where c.key = v_key and c.at_ms > now_ms - v_window;

    if v_used + v_need <= v_limit then
      continue;
    end if;

    -- Wait until enough of the oldest entries have aged out for v_need to fit. A request bigger than the whole
    -- limit can never fit: report the full window.
    v_retry := v_window;
    if v_need <= v_limit then
      v_over := v_used + v_need - v_limit;
      for v_row in
        select c.at_ms, c.cost from public.guard_counters as c
        where c.key = v_key and c.at_ms > now_ms - v_window
        order by c.at_ms
      loop
        v_over := v_over - v_row.cost;
        if v_over <= 0 then
          v_retry := greatest(0, v_row.at_ms + v_window - now_ms);
          exit;
        end if;
      end loop;
    end if;
    return jsonb_build_object('ok', false, 'index', v_idx, 'key', v_key, 'retryAfterMs', v_retry);
  end loop;

  if do_commit then
    insert into public.guard_counters (key, at_ms, cost)
    select h.value ->> 'key', now_ms, (h.value ->> 'cost')::integer
    from jsonb_array_elements(hits) as h
    where (h.value ->> 'cost')::integer > 0;

    -- Keep the table bounded: no window is longer than a day (DAY_MS in src/lib/guard/limits.ts).
    delete from public.guard_counters as c where c.at_ms <= now_ms - 86400000;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Privileges
revoke all on public.guard_counters from public, anon, authenticated;
grant all on public.guard_counters to service_role;

revoke all on function public.guard_consume(jsonb, bigint, boolean) from public, anon, authenticated;
grant execute on function public.guard_consume(jsonb, bigint, boolean) to service_role;
