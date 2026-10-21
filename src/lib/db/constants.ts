// Names shared by the db helpers. No tunable numbers here (those live in src/lib/agent/config.ts, e.g. MAX_SEEDS_PER_USER).

/** Route the magic-link email lands on. The route itself belongs to the UI/app ticket; it calls `exchangeAuthCode`. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Short-lived cookie that carries the post-sign-in path across the magic link (see `sendMagicLink`). */
export const NEXT_PATH_COOKIE = "atelier_next";

/** Tables that belong to one user and are owner-only under RLS. */
export const USER_TABLES = ["profiles", "seeds", "picks", "reactions", "profile_snapshots"] as const;

/** Private table: service role only. */
export const CACHE_TABLE = "qloo_cache";

/** Private table for the deploy guard's counters: service role only. */
export const GUARD_TABLE = "guard_counters";

/** RPC that admits a request's hits all-or-nothing against GUARD_TABLE: service role only. */
export const GUARD_CONSUME_FN = "guard_consume";

/**
 * How a tried pick went. Null (no answer) is not a value in this list: `mixed` is an answer and `null` is not
 * answered. Mirrors the CHECK on reactions.how (migrations.test.ts fails on drift).
 */
export const REACTION_HOWS = ["liked", "mixed", "not_liked"] as const;
export type ReactionHow = (typeof REACTION_HOWS)[number];
