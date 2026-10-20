// Names shared by the db helpers. No tunable numbers here (those live in src/lib/agent/config.ts).

/** Route the magic-link email lands on. The route itself belongs to the UI/app ticket; it calls `exchangeAuthCode`. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Short-lived cookie that carries the post-sign-in path across the magic link (see `sendMagicLink`). */
export const NEXT_PATH_COOKIE = "atelier_next";

/** Tables that belong to one user and are owner-only under RLS. */
export const USER_TABLES = ["profiles", "seeds", "picks", "reactions"] as const;

/** Private table: service role only. */
export const CACHE_TABLE = "qloo_cache";
