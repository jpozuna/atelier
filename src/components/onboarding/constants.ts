// Onboarding names: routes and storage keys. The limits (MIN_SEEDS, MIN_FIELDS, MIN_WHY_CHARS, MAX_SEEDS_PER_USER,
// MAX_WHY_CHARS, query lengths, MAX_CANDIDATES) live in src/lib/agent/config.ts, so the form and the server never
// disagree.

/** Routes. The flow lives at START_PATH, the chart screen at TASTE_PATH, and T-14 owns PICKS_PATH. */
export const START_PATH = "/start";
export const TASTE_PATH = "/taste";
export const PICKS_PATH = "/picks";

/** Where the flow state is kept between screens (sessionStorage, per tab). Bump the version on a shape change. */
export const FLOW_STORAGE_KEY = "atelier.onboarding.v1";
export const TASTE_STORAGE_KEY = "atelier.taste.v1";
