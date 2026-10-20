// Limits and names for saving, revisiting and the follow-up. Tunable numbers belong in src/lib/agent/config.ts, which
// this ticket cannot edit; the manager moves the numbers here (see the T-17 Handoff). No Qloo data here.

import { PICKS_PATH } from "@/components/onboarding/constants";

export { PICKS_PATH };

export const SAVED_PATH = "/saved";
export const SIGN_IN_PATH = "/auth/sign-in";
export const REACTIONS_URL = "/api/reactions";

/**
 * Where a guest's work waits while they sign in (localStorage, so a magic link opened in a new tab still finds it).
 * The record carries a random token that is also set as a session cookie (`CARRY_COOKIE`): a record whose token does
 * not match the cookie belongs to another browser session and is deleted on read.
 */
export const CARRY_STORAGE_KEY = "atelier.carry.v1";
export const CARRY_COOKIE = "atelier_carry";
export const CARRY_VERSION = 1;
/** A guest's waiting work is forgotten after this long if they never finish signing in. */
export const CARRY_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_URL = "/api/reactions/session";
export const SNAPSHOT_URL = "/api/reactions/snapshot";

/** POST /api/reactions limits. Picks per request, and the body size (a pick carries its whole card). */
export const MAX_SAVE_ITEMS = 60;
export const MAX_SAVE_BODY_CHARS = 400_000;
/** Longest reaction text kept, in the browser and on the server. */
export const MAX_REACTION_WORDS = 2000;
export const MAX_ID_CHARS = 200;
/** Most seeds an account keeps (mirrors MAX_SEEDS_PER_USER in src/lib/db/constants.ts). */
export const MAX_SAVE_SEEDS = 10;

/**
 * A follow-up looks at one field again: one pool plus at most the loop's own re-query cap (2), so at most 3 live
 * Qloo calls. Documented here for the reader; the cap itself is enforced by the loop (MAX_REQUERIES_PER_RUN).
 */
export const FOLLOW_UP_MAX_LIVE_CALLS = 3;
