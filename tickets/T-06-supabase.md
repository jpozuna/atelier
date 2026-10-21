# T-06: Supabase schema, auth and private cache table

Status: done
Mode: inline
Kind: feature
Priority: P0
Depends on: T-02, T-03

## Goal
Postgres tables for profiles, seeds with reasons, picks with stored paths and reactions, plus a private Qloo cache table, all behind RLS, with auth helpers.

## Owns
- supabase/migrations/
- supabase/config.toml
- src/lib/db/

## Reads
- CLAUDE.md
- docs/DECISIONS.md
- src/types/
- src/lib/qloo/ (the cache adapter interface)

## Skills
- qloo-api

## Done when
- [ ] Migrations create `profiles`, `seeds` (field, entity id, reason text), `picks` (band, stored path as jsonb, card as jsonb), `reactions` (save state, why text, tried, liked, notes) and `qloo_cache` (request key, stripped body, created_at)
- [ ] RLS is on for every table. User tables are owner-only. `qloo_cache` has no anon or authenticated access, only the service role
- [ ] `src/lib/db/qloo-cache.ts` implements the T-03 cache adapter against `qloo_cache`, server-only
- [ ] `src/lib/db/auth.ts` gives server helpers for the current user and for magic-link sign-in. A guest session can run onboarding and see picks without an account; saving requires one
- [ ] `supabase db reset` applies cleanly on a local Supabase. The handoff lists any setup the user must do (create the project, copy keys into `.env`)
- [ ] Tests cover the cache adapter on a local or mocked client, and an RLS check shows user A cannot read user B's picks
- [ ] Repo checks in CLAUDE.md pass; no Qloo data or secrets in tracked files

## Specialists
- tests: yes
- qloo-param-auditor: no
- bridge-judge: no
- design-reviewer: no
- research question: none

## Evals
- repo-hygiene

## Qloo calls
- none

## Handoff

Zero Qloo calls (no .env read, no network, no live script). `npm run typecheck`, `lint`, `test` (517 passed, 12 skipped repo-wide; 60 in src/lib/db) and `npm run evals` (repo-hygiene included) are green. **Not verified against a real database**: Docker is not running and there is no Supabase project, so `supabase db reset` and the RLS test have not been run. The CLI did parse `supabase/config.toml` without error (it only failed later, on Docker).

### Files
- `supabase/config.toml`: local stack trimmed to Postgres 17, Auth, REST API, Studio and the inbucket mail catcher (Realtime and Storage off). Anonymous sign-ins off. Email confirmation on (see review fixes). Redirect allow-list has `/auth/callback` on localhost and 127.0.0.1:3000. Seed data off. No secrets.
- `supabase/migrations/20261019000000_init.sql`: everything below, one migration.
- `src/lib/db/`: `server.ts`, `auth.ts`, `qloo-cache.ts`, `mappers.ts`, `saves.ts`, `database.types.ts`, `constants.ts`, `testing.ts` (test helpers, not imported by production code), and tests (`migrations.test.ts`, `qloo-cache.test.ts`, `auth.test.ts`, `server.test.ts`, `mappers.test.ts`, `saves.test.ts`, `rls.live.test.ts`).

### Schema (public)
- `profiles` (id = auth.users.id, display_name). A trigger on auth.users creates the row on sign-up.
- `seeds` pk (user_id, id): field, typed, `reason`, `qloo_id` text (required when status is clean), status, `why_tag_ids text[]` (a CHECK requires every element to start `urn:tag:`).
- `picks` pk (user_id, id): seed_id (nullable), field, band, name, `qloo_id` text (null allowed only when llm_bridged), llm_bridged, origin, `path jsonb`, `card jsonb`. CHECKs: path has hops, at least 3, first `seed`, second `theme`, last `pick`, plus `sharedTags` array; `card.path` equals `path`; the card has no `reaction` key (the reaction lives in its own table). No reach, connection or popularity columns, so no scores are stored. Composite FKs (user_id, seed_id) and (user_id, pick_id) make cross-user references impossible. Deleting a seed nulls `picks.seed_id` and keeps the pick and path.
- `reactions` pk (user_id, pick_id), one per pick: `state` (later, will_try, explore, not_interested, tried), `why`, `tried`, `how` (liked, mixed, not_liked; null = not answered), `notes`, updated_at. CHECKs: state tried implies tried; how only when tried. (`liked` was replaced by `how` before the first apply.)
- `qloo_cache`: key (64 hex), endpoint (only the four hackathon endpoints), method, status (200 or 404), body jsonb (null for 404), version, created_at.
- ids on seeds and picks are `text`, scoped per user, because `Seed.id` and `Pick.id` are arbitrary strings (fixtures use `seed-1`). So the client ids are stored as is and `Path.seedId` stays valid.
- RLS on all five tables. User tables: select, insert, update (and delete on seeds, picks, reactions) `to authenticated` with `user_id = (select auth.uid())` (profiles: `id`), with `with check` on writes. No policy for anon anywhere. `qloo_cache` has no policy and every privilege is revoked from public, anon and authenticated; only `service_role` is granted. Grants are explicit, not default-dependent.
- Static checks in `migrations.test.ts` (RLS on every table, no open or anon policy, no qloo_cache grant, value lists equal to `src/types`, config keeps anon sign-ins off).

### Contracts other tickets rely on
- `@/lib/db/qloo-cache`: `createSupabaseQlooCache({ client? }): QlooCacheAdapter`. Pass as `createQlooClient({ cache })` in server code that should use the shared cache (the default is still the file cache). Uses the service-role client, created lazily on first call, so importing never needs env. `get` returns null on a miss or a malformed key and throws `QlooCacheDbError` on a database error (the client treats a throw as a miss); `set` upserts on key and throws on failure (the client ignores it). Bodies are stored exactly as the client strips them.
- `@/lib/db/server`: `createUserClient({ onHeaders? })` (async, cookie-bound, anon key, RLS applies; Next 16 async `cookies()`), `applyAuthHeaders(response, headers)`, `createServiceClient()` (service role; only for qloo_cache and trusted jobs), `DbConfigError`. The service key is read only here.
- `@/lib/db/auth`: `getSessionState()` returns `{kind:"guest"}` or `{kind:"user", user}`; `getCurrentUser()`; `requireUser()` throws `AuthRequiredError` (status 401) for a guest; `sendMagicLink({email, next?}, {client?, cookies?})` returns `{ok:true}` or `{ok:false, reason: invalid_email | rate_limited | failed}` and throws `DbConfigError` when SITE_URL is missing or invalid; `consumeNextPath(fallback?)` for the callback route; `getSiteOrigin()`; `exchangeAuthCode(code)`; `signOut()`; `safeNextPath()`; `NEXT_PATH_COOKIE` and `AUTH_CALLBACK_PATH = "/auth/callback"` in `constants.ts`. All take an optional client for tests.
- `@/lib/db/saves` (all take an `AuthUser`, so only `requireUser()` output can save): `saveSeeds`, `listSeeds`, `savePicks`, `saveReaction`, `listPicks`. `@/lib/db/mappers`: `seedToRow`, `pickToRow` (throws if the card is invalid or its path differs from the pick's), `rowToCard`, `reactionToRow`, `rowToReaction`.
- Auth routes (`/auth/callback` route handler that calls `exchangeAuthCode` and redirects to `safeNextPath(next)`, plus a sign-in form that calls `sendMagicLink`) are not mine; the UI/app tickets must add them. Next 16 uses `proxy.ts`/middleware for session refresh; not added here (not in Owns). Server Components cannot write cookies, so refresh happens in route handlers or actions unless a proxy is added.

### Decisions I made (manager please check)
1. A guest is a visitor with no Supabase session. Anonymous sign-ins are off, `getSessionState` also treats an `is_anonymous` token as a guest. Guests never touch the database: onboarding and picks run from client state and the API. Only a signed-in user persists anything, and saving calls `requireUser()`.
2. Candidates for ambiguous seeds are not stored (they are Qloo names); an ambiguous seed reads back without them. Entity name is stored on `picks.name` because the card needs it.
3. Superseded by review fix 4 below: the origin comes from SITE_URL, not the caller.
4. No numeric caps on text columns (rule: tunable numbers in config.ts only). Add length limits at the API layer if wanted.
5. `database.types.ts` is hand-written (generating needs a running database). Replace with `supabase gen types typescript --local` output once a database exists, if desired.
6. `supabase/.gitignore` is not created (outside Owns); the root `.gitignore` already ignores `.temp`. Add `supabase/.branches` if you use branching.

### What the user must do
Option A, local (needs Docker):
1. Start Docker Desktop.
2. `cd` to the repo, run `supabase start`, then `supabase db reset`. It must finish with no errors; this is the check that the migration applies.
3. `supabase status -o env` prints the local API URL, anon key and service-role key. Put them in `.env` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the service-role variable named in `.env.example` (local keys only; never commit `.env`).
4. Run the RLS test: export those three variables in the shell, then `SUPABASE_RLS_TEST=1 npx vitest run src/lib/db/rls.live.test.ts`. It refuses a non-local URL unless `SUPABASE_RLS_TEST_ALLOW_REMOTE=1`. It creates two throwaway users, checks that user B cannot read, change, delete or write against user A's seeds, picks and reactions, that a guest gets nothing, that qloo_cache is closed to anon and authenticated and open to the service role, and the path and card CHECKs, then deletes the users. Magic-link emails appear at http://127.0.0.1:54324.

Option B, hosted project:
1. Create a project at supabase.com (free tier). Auth, Providers, Email: keep email on; the magic link needs no password.
2. `supabase login`, then `supabase link --project-ref <ref>`, then `supabase db push` (applies the migration; it does not push app code).
3. Dashboard, Project Settings, API: copy the URL, anon key and service_role key into `.env` (same three variable names). Auth, URL Configuration: set Site URL and add `<site>/auth/callback` (and `http://localhost:3000/auth/callback`) to Redirect URLs. Auth settings, Sign In / Providers: leave anonymous sign-ins off. The default hosted mailer is rate limited; set up custom SMTP before the demo if many people sign in.
4. Optionally run the RLS test with `SUPABASE_RLS_TEST_ALLOW_REMOTE=1` and the hosted values (it only touches rows it creates).
5. Before the demo, set the same three variables in the deploy environment (the service-role key is server-only, never `NEXT_PUBLIC_*`).

### Known gaps
- The migration and `rls.live.test.ts` are unexecuted. Points most worth watching on the first `db reset`: the `on delete set null (seed_id)` column-list FK (needs Postgres 15 or newer; config pins 17), the `-> -1` negative index in the path CHECK, and the trigger on `auth.users`.
- `rls.live.test.ts` signs users in with a password (admin-created, confirmed), which works on a default local stack.
- Server-side requirements and the first-run list are under review fixes. `QLOO_MODE` and cache wiring: no caller uses the Supabase adapter yet; it is the agent route's choice to pass it to `createQlooClient`.

### Review fixes (round 1), all applied
1. **Confirmations.** Chose `enable_confirmations = true` in `[auth.email]`. Supabase has no config switch to disable password sign-up while keeping magic links, so confirmation is the guard: nobody can pre-register someone else's address with a password and then keep a session once the real owner signs in. The app never shows a password form. Magic link behaves as before (clicking it confirms). A static test pins it. Also set the same on the hosted project (Auth, Sign In / Providers, Email: "Confirm email" on).
2. **`qloo_id` is text.** `picks.qloo_id` is `text`, null allowed only when `llm_bridged` (`picks_qloo_id_present`: `llm_bridged or (qloo_id is not null and length(qloo_id) > 0)`). `pickToRow` stores an empty `Pick.qlooId` as null and throws `DbMappingError` for a non-bridged pick with no id. I also changed `seeds.qloo_id` to text (not asked): `Seed.qlooId` is a string too and a non-UUID would otherwise fail the insert. `StoredPick.qlooId` is `string | null`. Types, mappers, static test and live test updated.
3. **Headers from `setAll`.** `createUserClient({ onHeaders })` passes the headers @supabase/ssr 0.12.7 supplies (`Cache-Control: private, no-store`) to the callback whenever cookies are written (even if the cookie store refuses, as in a Server Component). Next's `cookies()` cannot set response headers, so the caller applies them: collect, use the client, then `applyAuthHeaders(response, headers)` on the Route Handler's Response. **The `/auth/callback` route handler and the future proxy must do this too**, or a response carrying a session cookie could be cached. Tested.
4. **SITE_URL.** `sendMagicLink` no longer takes an origin. It reads `SITE_URL` (`getSiteOrigin()`): must be https, or http only on localhost/127.0.0.1, no credentials; path, query and hash are dropped; missing or invalid throws `DbConfigError`. **For `.env.example` (manager-owned): add `SITE_URL=http://localhost:3000` with a comment "site origin for magic-link redirects; https in production".** `next` no longer rides in the link: the email redirect is the fixed `${SITE_URL}/auth/callback` with no query string, and the safe path is stored in an httpOnly, sameSite=lax cookie (`atelier_next`, secure on https, session-lifetime, deleted when unused or consumed). The callback calls `consumeNextPath()`, which re-validates with `safeNextPath`. Open question for the first live run: how the Supabase redirect allow-list matches `emailRedirectTo` (exact URL versus wildcard, and whether `localhost` and `127.0.0.1` count as different origins). The fixed query-less URL is the form most likely to match an exact entry; confirm that the link actually lands on `/auth/callback` and not on Site URL, and add the exact callback URL(s) to Redirect URLs on the hosted project.
5. **Where things run.** Documented in `auth.ts`, `server.ts` and `saves.ts`. `sendMagicLink` and `signOut` must run in a Route Handler or Server Action (they write cookies, including the PKCE code verifier; the link must also be opened in the same browser). Read-only helpers (`getSessionState`, `getCurrentUser`, `requireUser`) work in Server Components, but a Server Component cannot persist a refreshed session: that needs a Next 16 `proxy.ts` (future ticket, not in my Owns). `savePicks` requires `saveSeeds` first for the same run (foreign key from `path.seedId`); otherwise it throws `DbWriteError` (23503).
6. **`all_tag_ids`.** A revoke would break inserts: a CHECK runs as the inserting role, which needs EXECUTE on the function. Instead the function moved to a `private` schema the REST API does not expose (config exposes only `public`), with USAGE and EXECUTE granted to authenticated and service_role only, and revoked from public and anon. So it cannot be called as RPC. The two remaining public functions are trigger functions with EXECUTE revoked. If the hosted project exposes extra schemas in the Data API settings, keep `private` out of them. Static test updated.
7. **Fixture tags.** All tag ids in db tests and fixtures are now `urn:tag:fixture:theme:...`. Also `syntheticPick` ids now stay within the 2-digit synthetic id shape.

Checks after the fixes: typecheck clean for my paths (the one remaining error is in `src/components/onboarding/`, another worker's); lint clean; `src/lib/db` 75 passed, 9 skipped (live RLS); `npm run evals` green. `npm test` repo-wide currently shows failures only in `src/components/onboarding/` and `src/lib/frontier/` (other workers, in progress).

### Before any push to the existing hosted project: read-only comparison checklist
The user's hosted project already has tables with RLS. Do not assume they match this migration, and do not run `supabase db push` until this is done. Everything below is read-only (Dashboard SQL editor with SELECT only, or `supabase db dump --linked --schema public` to a scratch file outside the repo, never committed).
1. List what exists: `select table_name from information_schema.tables where table_schema = 'public' order by 1;` Compare with `profiles, seeds, picks, reactions, profile_snapshots, qloo_cache, guard_counters` (the last from `20261021000000_guard_counters.sql`). Note any same-named table that is not ours, and any extra table.
2. For each same-named table, compare columns: `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name = '<t>' order by ordinal_position;` against the migration (types: ids and qloo_id text, user_id uuid, path and card jsonb, why_tag_ids text[]).
3. Primary keys and foreign keys: `select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;` Expect composite pks (user_id, id) and the composite FKs, plus the CHECKs `picks_path_shape`, `picks_card_shape`, `picks_qloo_id_present`, `reactions_*`, `seeds_clean_has_entity`.
4. RLS state: `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';` RLS must be on for all seven.
5. Policies: `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2;` Expect owner-only policies `to authenticated` using `auth.uid()`, none for anon or public, none on qloo_cache. Flag any `using (true)` or a policy for `anon`/`public`.
6. Grants: `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','public') order by 2, 1, 3;` Expect nothing for anon, and nothing at all on qloo_cache for anon or authenticated.
7. Functions and triggers: `select p.proname, n.nspname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private');` and `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal;` Check for `handle_new_user` and a trigger on `auth.users`; an existing profile trigger would conflict with `on_auth_user_created`.
8. Existing rows: `select count(*)` per table. A non-empty table whose columns differ needs a data migration plan, not a blind push.
9. Migration history: `supabase migration list` (read-only, after `supabase link`) shows what the remote believes is applied; a mismatch means the remote was edited by hand.
10. Data API and auth settings (Dashboard, read only): exposed schemas must not include `private`; anonymous sign-ins off; "Confirm email" on; Site URL and Redirect URLs include the callback.
Decision rule: if the hosted tables match, record that and skip the push. If they differ, either adapt this migration into an additive one (new file, never edit the applied one) or use a fresh project; the manager and user decide. The local `supabase db reset` path is unaffected.
