// Seed-resolution limits. These are structural limits from the T-05 ticket, not scoring knobs. If the manager
// wants every number in src/lib/agent/config.ts, move them there (see the T-05 Handoff).

/** `take` for the one /search call per seed. The ticket caps it at 10. */
export const SEARCH_TAKE = 10;

/** Most candidates returned to the chooser. */
export const MAX_CANDIDATES = 5;

/** Query length accepted by the route, after trimming. Short titles ("Up") are real, so the floor is 2. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Longest request body the route reads, in characters. */
export const MAX_BODY_CHARS = 2000;

/** Longest disambiguation string passed to a chip. */
export const MAX_DISAMBIGUATION_CHARS = 120;

/** Places default city (New York) and search radius in miles, used when the env vars are unset. */
export const DEFAULT_PLACES_LOCATION = "40.7128,-74.0060";
export const DEFAULT_PLACES_RADIUS = 20;

/** Env vars that override the places default (see .env.example). */
export const ENV_PLACES_LOCATION = "ATELIER_PLACES_LOCATION";
export const ENV_PLACES_RADIUS = "ATELIER_PLACES_RADIUS";
