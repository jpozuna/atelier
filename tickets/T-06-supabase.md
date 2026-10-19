# T-06: Supabase schema, auth and private cache table

Status: todo
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
(Worker fills in.)
