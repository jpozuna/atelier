// The "demo is resting" contract. Client-safe: constants and one pure function, no server imports, so /start,
// /taste and /picks can import it. The server side (proxy and guard) never sends anything else for these cases.
//
// Resting is a calm state, not an error page. It means: this demo has used its allowance for now (the daily model or
// Qloo allowance, the Qloo monthly reserve, or the manual pause). Nothing that is already on screen or saved is
// affected; only requests that would spend a model or Qloo call are paused.

/** Error code of the 503 the proxy returns when the daily allowance is used up or the demo is paused by hand. */
export const DEMO_RESTING_CODE = "demo_resting";
/** Error code of the 429 for one visitor (IP) who has used their share. Not resting: the demo is open for others. */
export const TOO_MANY_REQUESTS_CODE = "too_many_requests";
/** Error code of the 413 for an oversized body. */
export const PAYLOAD_TOO_LARGE_CODE = "payload_too_large";

/**
 * Every error code that means "resting" to the person looking at the screen. `demo_resting` comes from the proxy.
 * `budget` is the Qloo client refusing a live call below the monthly reserve (QlooBudgetError), and `lookups_off` is
 * a cache miss with live calls off (QLOO_MODE=replay). The routes already return those two, so the screens treat
 * all three alike: show the resting state and serve what is already cached.
 */
export const RESTING_CODES: readonly string[] = [DEMO_RESTING_CODE, "budget", "lookups_off"];

export function isRestingCode(code: string | undefined | null): boolean {
  return typeof code === "string" && RESTING_CODES.includes(code);
}

/** Default wording. Screens may use their own copy as long as it stays calm and says what still works. */
export const RESTING_MESSAGE =
  "The demo is resting for now. Picks already on your screen and anything you saved are still here. Come back a little later for a fresh run.";
export const TOO_MANY_MESSAGE = "You have used your share of runs for now. Try again a little later.";

/** Body of `GET /api/demo-status` (answered by the proxy; it never spends anything). */
export interface DemoStatus {
  state: "open" | "resting";
  /** Why it is resting. `paused` is the manual switch, `daily_limit` is the daily allowance. */
  reason?: "paused" | "daily_limit";
  /** Seconds until a call may succeed again, when known. */
  retryAfterSeconds?: number;
}

/** JSON body of an error from the guard: `{ error: { code, message, retryAfterSeconds? } }`. */
export interface GuardErrorBody {
  error: { code: typeof DEMO_RESTING_CODE | typeof TOO_MANY_REQUESTS_CODE | typeof PAYLOAD_TOO_LARGE_CODE; message: string; retryAfterSeconds?: number };
}
