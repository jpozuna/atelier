// Tunables of the deploy guard (T-20). CLAUDE.md wants tunable numbers in src/lib/agent/config.ts, which this ticket
// cannot edit, so they live here and the T-20 handoff proposes moving them. Numbers tied to the run's own budget
// (calls per run) are imported from there, never repeated. No Qloo data here.

import { MAX_REQUERIES_PER_RUN } from "@/lib/agent/config";
import { LLM_MAX_CALLS_PER_RUN } from "@/lib/agent/run-constants";
import { FIELDS } from "@/types";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A cap on how much one visitor (IP) may do in a rolling window. */
export interface IpLimit {
  /** Stable name, part of the counter key. */
  name: string;
  limit: number;
  windowMs: number;
}

/** What one accepted request is assumed to cost, worst case. Charged when the request is admitted. */
export interface RouteCost {
  /** Anthropic calls. */
  model: number;
  /** Live Qloo calls (a cache hit costs 0 in reality, so this over-counts on purpose). */
  qloo: number;
}

export interface GuardedRoute {
  path: string;
  /** Largest request body accepted, in bytes. The handlers still check their own, tighter, limits. */
  maxBodyBytes: number;
  cost: RouteCost;
  /** Defaults, before env overrides. */
  ipLimits: IpLimit[];
}

/** Worst case for one run: one pool per field plus the re-queries (the route's 12-call ceiling is never reached). */
export const RUN_QLOO_CALLS = FIELDS.length + MAX_REQUERIES_PER_RUN;

/** Name of the per-hour run limit, the one ATELIER_RUNS_PER_HOUR overrides. */
export const RUN_HOUR_LIMIT = "run-hour";
export const RUNS_PER_HOUR_PER_IP = 3;
export const RUNS_PER_DAY_PER_IP = 8;

/** POST routes the guard protects. Every other path passes through untouched. */
export const GUARDED_ROUTES: readonly GuardedRoute[] = [
  {
    path: "/api/run",
    maxBodyBytes: 1_000_000,
    cost: { model: LLM_MAX_CALLS_PER_RUN, qloo: RUN_QLOO_CALLS },
    ipLimits: [
      { name: RUN_HOUR_LIMIT, limit: RUNS_PER_HOUR_PER_IP, windowMs: HOUR_MS },
      { name: "run-day", limit: RUNS_PER_DAY_PER_IP, windowMs: DAY_MS },
    ],
  },
  {
    // Profile build: one taste-analysis call and at most one model call to name axes.
    path: "/api/profile",
    maxBodyBytes: 256_000,
    cost: { model: 1, qloo: 1 },
    ipLimits: [{ name: "profile-hour", limit: 12, windowMs: HOUR_MS }],
  },
  {
    // "Why" to tags: one semantic tag lookup per answer, at most 10 seeds, with retries and edits.
    path: "/api/profile/why",
    maxBodyBytes: 32_000,
    cost: { model: 0, qloo: 1 },
    ipLimits: [{ name: "why-hour", limit: 60, windowMs: HOUR_MS }],
  },
  {
    // Seed lookup: one search per submit (debounced), cached by query.
    path: "/api/seeds/resolve",
    maxBodyBytes: 32_000,
    cost: { model: 0, qloo: 1 },
    ipLimits: [
      { name: "resolve-minute", limit: 20, windowMs: MINUTE_MS },
      { name: "resolve-hour", limit: 90, windowMs: HOUR_MS },
    ],
  },
];

/** Daily allowance for the whole demo (rolling 24 hours, per server instance). Both are estimates charged at admission. */
export const DAILY_MODEL_CALLS = 480;
export const DAILY_QLOO_CALLS = 480;

/** Most visitor counters kept in memory at once; the oldest are dropped first. The global meters are never dropped. */
export const MAX_TRACKED_KEYS = 5000;

/** Longest IP string accepted from a header. */
export const MAX_IP_CHARS = 64;

export interface GuardConfig {
  /** Off in dev and tests unless ATELIER_GUARD=1; on in production unless ATELIER_GUARD=0. */
  enabled: boolean;
  /** Manual pause (ATELIER_REST=1): every guarded route answers "resting". */
  rest: boolean;
  runsPerHour: number;
  dailyModelCalls: number;
  dailyQlooCalls: number;
  maxKeys: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Read the guard's settings from env. Bad values fall back to the defaults. Nothing secret is read. */
export function loadGuardConfig(env: Record<string, string | undefined>): GuardConfig {
  const flag = env.ATELIER_GUARD?.trim();
  return {
    enabled: flag === "1" ? true : flag === "0" ? false : env.NODE_ENV === "production",
    rest: env.ATELIER_REST?.trim() === "1",
    runsPerHour: positiveInt(env.ATELIER_RUNS_PER_HOUR, RUNS_PER_HOUR_PER_IP),
    dailyModelCalls: positiveInt(env.ATELIER_DAILY_MODEL_CALLS, DAILY_MODEL_CALLS),
    dailyQlooCalls: positiveInt(env.ATELIER_DAILY_QLOO_CALLS, DAILY_QLOO_CALLS),
    maxKeys: MAX_TRACKED_KEYS,
  };
}
