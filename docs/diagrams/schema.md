# Atelier database schema

The Supabase tables as of the two migrations on main. User tables hold seeds, picks and reactions per account; two private tables back the Qloo cache and the deploy guard.

Source: `supabase/migrations/20261019000000_init.sql`, `supabase/migrations/20261021000000_guard_counters.sql`. Update this file when a migration changes the schema.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "trigger on_auth_user_created"
  PROFILES ||--o{ SEEDS : "user_id, cascade"
  PROFILES ||--o{ PICKS : "user_id, cascade"
  PROFILES ||--o{ REACTIONS : "user_id, cascade"
  PROFILES ||--o| PROFILE_SNAPSHOTS : "user_id, cascade"
  SEEDS |o--o{ PICKS : "(user_id, seed_id), set null"
  PICKS ||--o| REACTIONS : "(user_id, pick_id), cascade"

  AUTH_USERS {
    uuid id PK
  }
  PROFILES {
    uuid id PK "FK auth.users"
    text display_name
    timestamptz created_at
    timestamptz updated_at
  }
  SEEDS {
    uuid user_id PK
    text id PK "client seed id"
    text field "music film tv books food_places fashion"
    text typed
    text reason
    text qloo_id "required when clean"
    text status "clean ambiguous missing"
    text_arr why_tag_ids "urn:tag ids only"
    timestamptz created_at
  }
  PICKS {
    uuid user_id PK
    text id PK
    text seed_id FK "nullable"
    text field
    text band "calibration moderate high extreme"
    text name
    text qloo_id "null only if llm_bridged"
    boolean llm_bridged
    text origin "primary backfill unknown"
    jsonb path "seed, theme, ..., pick"
    jsonb card "card.path equals path"
    timestamptz created_at
  }
  REACTIONS {
    uuid user_id PK
    text pick_id PK
    text state "later will_try explore not_interested tried"
    text why
    boolean tried
    text how "liked mixed not_liked"
    text notes
    timestamptz created_at
    timestamptz updated_at
  }
  PROFILE_SNAPSHOTS {
    uuid user_id PK
    jsonb profile
    jsonb axes
    jsonb plan "null until first run"
    timestamptz updated_at
  }
  QLOO_CACHE {
    text key PK "sha256 hex"
    text endpoint
    text method
    int status "200 or 404"
    jsonb body "stripped"
    int version
    timestamptz created_at
  }
  GUARD_COUNTERS {
    text key "v:sha256 or global:name"
    bigint at_ms
    int cost
  }
```

**User tables**

- RLS on; owner-only policies for `authenticated`. Guests (`anon`) have no access.
- Composite keys `(user_id, id)` so a pick can only point at the same user's seed.
- No reach, connection or popularity is stored. Those are recomputed in code.
- `picks_path_shape` checks hops start with seed then theme and end with pick.

**Private tables**

- `qloo_cache` and `guard_counters`: RLS on, no policies, all grants revoked. Service role only.
- `guard_consume(hits, now_ms, do_commit)` admits or refuses a request's hits atomically, with advisory locks per key.
- Counter rows older than 24 hours are pruned on each commit.
