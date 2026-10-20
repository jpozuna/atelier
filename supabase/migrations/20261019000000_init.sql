-- Atelier schema (T-06): profiles, seeds, picks, reactions and the private Qloo cache.
--
-- Rules this file enforces:
--   * RLS is on for every table in public.
--   * User tables are owner-only, for signed-in users (role `authenticated`). The `anon` role (a guest) has no
--     access: a guest runs onboarding and sees picks from client state and the API, and never touches these
--     tables. Saving needs an account (magic link).
--   * qloo_cache is private: no policies, and every grant is revoked from anon and authenticated. Only the
--     service role (which bypasses RLS) reads and writes it, from server code.
--   * Qloo data in user tables is limited to what a card needs: the entity id, why-tag ids, and the stored
--     path and card JSON. Never raw Qloo responses. qloo_cache holds stripped bodies and is the only other place.
--
-- Value lists below (fields, bands, ...) mirror src/types; src/lib/db/migrations.test.ts fails if they drift.

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A schema that the REST API does not expose (config.toml exposes only `public`). Helpers used by CHECK constraints
-- live here so they cannot be called as RPC. A CHECK runs as the inserting role, which therefore needs USAGE on
-- the schema and EXECUTE on the function, so those are granted to authenticated (and service_role) below.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- True when every element is a Qloo tag id (urn:tag:...). Tags are ids from /v2/tags, never freeform strings.
create function private.all_tag_ids(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(t like 'urn:tag:%'), true) from unnest(tags) as t;
$$;

revoke all on function private.all_tag_ids(text[]) from public, anon;
grant execute on function private.all_tag_ids(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- profiles: one row per account
-- ---------------------------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- A profile row is created with the account, so seeds and picks can always reference it.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------------------------
-- seeds: what the user loves, with their reason
-- ---------------------------------------------------------------------------------------------------------------
-- `id` is the client-side seed id (Seed.id, any non-empty string), unique per user, so Path.seedId stays valid
-- when a run is saved. Ambiguous candidates are not stored: they are Qloo names and are resolved before saving.

create table public.seeds (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null check (length(id) > 0),
  field text not null check (field in ('music', 'film', 'tv', 'books', 'food_places', 'fashion')),
  -- What the user typed.
  typed text not null,
  -- The user's one-line reason ("why").
  reason text not null default '',
  -- Resolved Qloo entity id (text: Seed.qlooId is a string). Required once the seed is clean; null if unmatched.
  qloo_id text,
  status text not null check (status in ('clean', 'ambiguous', 'missing')),
  -- Qloo tag ids the reason mapped to (semantic tag search on submit). Ids only.
  why_tag_ids text[] not null default '{}' check (private.all_tag_ids(why_tag_ids)),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint seeds_clean_has_entity check (status <> 'clean' or qloo_id is not null)
);

-- ---------------------------------------------------------------------------------------------------------------
-- picks: a pick with its stored path and card
-- ---------------------------------------------------------------------------------------------------------------
-- No reach, connection or popularity numbers are stored: they are recomputed in code and are not taste scores.
-- The user's reaction lives in `reactions`, never inside `card`.

create table public.picks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null check (length(id) > 0),
  -- The seed this pick's path starts from. Nulled (not cascaded) if the seed is removed; the path keeps the label.
  seed_id text,
  field text not null check (field in ('music', 'film', 'tv', 'books', 'food_places', 'fashion')),
  band text not null check (band in ('calibration', 'moderate', 'high', 'extreme')),
  name text not null,
  -- Null only for a pick bridged by the model in a field with no Qloo coverage (see picks_qloo_id_present).
  qloo_id text,
  -- True when the field has no Qloo coverage and everything is inferred.
  llm_bridged boolean not null default false,
  origin text not null default 'unknown' check (origin in ('primary', 'backfill', 'unknown')),
  -- seed -> shared theme -> [lineage hop] -> pick. Every pick has one; the explanation is generated from it.
  path jsonb not null,
  card jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Composite FK: a pick can only point at a seed of the same user. (user_id stays; only seed_id is nulled.)
  constraint picks_qloo_id_present check (llm_bridged or (qloo_id is not null and length(qloo_id) > 0)),
  constraint picks_seed_fk foreign key (user_id, seed_id) references public.seeds (user_id, id)
    on delete set null (seed_id),
  -- coalesce: a CHECK passes on NULL, so a missing key must count as a failure.
  constraint picks_path_shape check (coalesce(
    jsonb_typeof(path) = 'object'
    and jsonb_typeof(path -> 'hops') = 'array'
    and case when jsonb_typeof(path -> 'hops') = 'array' then jsonb_array_length(path -> 'hops') >= 3 else false end
    and path -> 'hops' -> 0 ->> 'kind' = 'seed'
    and path -> 'hops' -> 1 ->> 'kind' = 'theme'
    and path -> 'hops' -> -1 ->> 'kind' = 'pick'
    and jsonb_typeof(path -> 'sharedTags') = 'array',
    false
  )),
  constraint picks_card_shape check (coalesce(
    jsonb_typeof(card) = 'object'
    -- The card carries the same path as the path column, and no reaction (that lives in `reactions`).
    and card -> 'path' = path
    and (card - 'reaction') = card,
    false
  ))
);

create index picks_user_created_idx on public.picks (user_id, created_at desc);
create index picks_seed_idx on public.picks (user_id, seed_id);

-- ---------------------------------------------------------------------------------------------------------------
-- reactions: the user's response to a pick (one row per pick)
-- ---------------------------------------------------------------------------------------------------------------

create table public.reactions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  pick_id text not null,
  -- Save state: later, will_try, explore, not_interested, tried.
  state text not null check (state in ('later', 'will_try', 'explore', 'not_interested', 'tried')),
  -- The "why" box (opened by not_interested, or any words with a reaction).
  why text,
  -- Follow-up after exploring: did they try it, did they like it, and notes on why.
  tried boolean not null default false,
  liked boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, pick_id),
  constraint reactions_pick_fk foreign key (user_id, pick_id) references public.picks (user_id, id)
    on delete cascade,
  constraint reactions_tried_state check (state <> 'tried' or tried),
  constraint reactions_liked_needs_tried check (liked is null or tried)
);

create trigger reactions_set_updated_at
  before update on public.reactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- qloo_cache: private, server-side only
-- ---------------------------------------------------------------------------------------------------------------
-- Implements the T-03 cache adapter (src/lib/qloo/cache.ts). `key` is the sha256 hex of the normalized request,
-- `body` is the stripped response (null for an empty /search or /entities 404). Never exposed to a client.

create table public.qloo_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  endpoint text not null check (endpoint in ('/search', '/v2/tags', '/v2/insights', '/entities')),
  method text not null check (method in ('GET', 'POST')),
  status integer not null check (status in (200, 404)),
  body jsonb,
  version integer not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.seeds enable row level security;
alter table public.picks enable row level security;
alter table public.reactions enable row level security;
alter table public.qloo_cache enable row level security;

-- Owner-only, signed-in users only. `(select auth.uid())` is evaluated once per statement.

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy seeds_select_own on public.seeds
  for select to authenticated using (user_id = (select auth.uid()));
create policy seeds_insert_own on public.seeds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy seeds_update_own on public.seeds
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy seeds_delete_own on public.seeds
  for delete to authenticated using (user_id = (select auth.uid()));

create policy picks_select_own on public.picks
  for select to authenticated using (user_id = (select auth.uid()));
create policy picks_insert_own on public.picks
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy picks_update_own on public.picks
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy picks_delete_own on public.picks
  for delete to authenticated using (user_id = (select auth.uid()));

create policy reactions_select_own on public.reactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy reactions_insert_own on public.reactions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy reactions_update_own on public.reactions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reactions_delete_own on public.reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- qloo_cache: deliberately no policies. With RLS on, that denies every non-bypass role; the revokes below make
-- it explicit and survive a future policy added by mistake.

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------
-- Do not rely on default grants: set exactly what each role may do.

revoke all on public.profiles, public.seeds, public.picks, public.reactions, public.qloo_cache
  from public, anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.seeds, public.picks, public.reactions to authenticated;

grant all on public.profiles, public.seeds, public.picks, public.reactions, public.qloo_cache to service_role;

-- Trigger functions are checked for EXECUTE only when the trigger is created, so these revokes are safe.
-- (private.all_tag_ids is used by a CHECK constraint, so authenticated keeps EXECUTE on it; see the top of the file.)
revoke all on function public.set_updated_at() from public, anon, authenticated;
