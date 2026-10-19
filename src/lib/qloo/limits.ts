// Client mechanics for the Qloo client: concurrency, spacing, backoff, timeout. The per-run call cap is
// MAX_LIVE_CALLS_PER_RUN from src/lib/agent/config.ts (imported, not redefined). Candidates for config.ts, if the
// manager wants every number in one place: DEFAULT_RESERVE (monthly-quota floor) and STRIP_MAX_STRING.

import { MAX_LIVE_CALLS_PER_RUN } from "@/lib/agent/config";

export interface QlooLimits {
  /** Live (network) calls one run may make; from config.ts. The next one is refused. Cache hits and shared calls do not count. */
  MAX_LIVE_CALLS_PER_RUN: number;
  /** Requests in flight at once, process-wide. */
  MAX_IN_FLIGHT: number;
  /** Retries after a 429, so up to this many + 1 HTTP attempts for one logical call. */
  MAX_429_RETRIES: number;
  BACKOFF_BASE_MS: number;
  BACKOFF_CAP_MS: number;
  /** Minimum spacing between request starts. The key allows 5 per second. */
  MIN_REQUEST_INTERVAL_MS: number;
  REQUEST_TIMEOUT_MS: number;
  /** Remaining monthly calls below which live calls are refused (unless ATELIER_DEMO=1). */
  DEFAULT_RESERVE: number;
  /** Strings longer than this are truncated before storing in the cache. */
  STRIP_MAX_STRING: number;
}

export const LIMITS: QlooLimits = {
  MAX_LIVE_CALLS_PER_RUN,
  MAX_IN_FLIGHT: 4,
  MAX_429_RETRIES: 3,
  BACKOFF_BASE_MS: 1000,
  BACKOFF_CAP_MS: 8000,
  MIN_REQUEST_INTERVAL_MS: 220,
  REQUEST_TIMEOUT_MS: 30000,
  DEFAULT_RESERVE: 6000,
  STRIP_MAX_STRING: 500,
};

/** Keys dropped (at any depth) before a response is stored. Bulky, and not used by Atelier. */
export const STRIP_KEYS: readonly string[] = ["akas", "websites", "keywords"];

/** The only host the hackathon key works on. Staging and production return 401. */
export const QLOO_HOST = "hackathon.api.qloo.com";
