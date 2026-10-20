// Client mechanics for the Qloo client: concurrency, spacing, backoff, timeout. The numbers live in
// src/lib/agent/config.ts ("Qloo client", plus MAX_LIVE_CALLS_PER_RUN); this file assembles them into the object
// the client and cache read (tests pass their own).

import {
  MAX_LIVE_CALLS_PER_RUN,
  QLOO_BACKOFF_BASE_MS,
  QLOO_BACKOFF_CAP_MS,
  QLOO_DEFAULT_RESERVE,
  QLOO_MAX_429_RETRIES,
  QLOO_MAX_IN_FLIGHT,
  QLOO_MIN_REQUEST_INTERVAL_MS,
  QLOO_REQUEST_TIMEOUT_MS,
  QLOO_STRIP_MAX_STRING,
} from "@/lib/agent/config";

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
  MAX_IN_FLIGHT: QLOO_MAX_IN_FLIGHT,
  MAX_429_RETRIES: QLOO_MAX_429_RETRIES,
  BACKOFF_BASE_MS: QLOO_BACKOFF_BASE_MS,
  BACKOFF_CAP_MS: QLOO_BACKOFF_CAP_MS,
  MIN_REQUEST_INTERVAL_MS: QLOO_MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS: QLOO_REQUEST_TIMEOUT_MS,
  DEFAULT_RESERVE: QLOO_DEFAULT_RESERVE,
  STRIP_MAX_STRING: QLOO_STRIP_MAX_STRING,
};

/** Keys dropped (at any depth) before a response is stored. Bulky, and not used by Atelier. */
export const STRIP_KEYS: readonly string[] = ["akas", "websites", "keywords"];

/** The only host the hackathon key works on. Staging and production return 401. */
export const QLOO_HOST = "hackathon.api.qloo.com";
