// Names for saving, revisiting and the follow-up: routes, storage keys, cookie. The limits (save caps, carry TTL,
// follow-up call budget) live in src/lib/agent/config.ts. No Qloo data here.

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
export const SESSION_URL = "/api/reactions/session";
export const SNAPSHOT_URL = "/api/reactions/snapshot";
