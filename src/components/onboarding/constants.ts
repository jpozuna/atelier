// Onboarding limits. Tunable numbers belong in src/lib/agent/config.ts, which this ticket cannot edit; the
// manager moves MIN_SEEDS, MIN_FIELDS and the paths there (see the T-12 Handoff). The seed cap, why length and
// query length are re-exported from the modules that enforce them, so the form and the server never disagree.

export { MAX_SEEDS, MAX_WHY_CHARS } from "@/lib/profile/constants";
export { MIN_QUERY_LENGTH, MAX_QUERY_LENGTH } from "@/lib/seeds/constants";

/** "See my taste" needs at least this many seeds, across at least MIN_FIELDS fields. */
export const MIN_SEEDS = 3;
export const MIN_FIELDS = 2;

/** Shortest "why" worth mapping to tags. A single character is not a reason. */
export const MIN_WHY_CHARS = 3;

/** Ambiguous results show at most this many chips (the route already caps at 5). */
export const MAX_CHIPS = 5;

/** Routes. The flow lives at START_PATH, the chart screen at TASTE_PATH, and T-14 owns PICKS_PATH. */
export const START_PATH = "/start";
export const TASTE_PATH = "/taste";
export const PICKS_PATH = "/picks";

/** Where the flow state is kept between screens (sessionStorage, per tab). Bump the version on a shape change. */
export const FLOW_STORAGE_KEY = "atelier.onboarding.v1";
export const TASTE_STORAGE_KEY = "atelier.taste.v1";
