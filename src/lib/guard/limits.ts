// The deploy guard's route table and env loading. The tunable numbers (body sizes, per-visitor limits, the daily
// allowance, tracked keys) live in src/lib/agent/config.ts ("Guard"). Numbers tied to the run's own budget
// (calls per run) are imported from there too, never repeated. No Qloo data here.

import {
  DAILY_MODEL_CALLS,
  DAILY_QLOO_CALLS,
  GUARD_PROFILE_MAX_BODY_BYTES,
  GUARD_PROFILE_PER_HOUR,
  GUARD_RESOLVE_MAX_BODY_BYTES,
  GUARD_RESOLVE_PER_HOUR,
  GUARD_RESOLVE_PER_MINUTE,
  GUARD_RUN_MAX_BODY_BYTES,
  GUARD_WHY_MAX_BODY_BYTES,
  GUARD_WHY_PER_HOUR,
  LLM_MAX_CALLS_PER_RUN,
  MAX_REQUERIES_PER_RUN,
  MAX_TRACKED_KEYS,
  RUNS_PER_DAY_PER_IP,
  RUNS_PER_HOUR_PER_IP,
} from "@/lib/agent/config";
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

/** POST routes the guard protects. Every other path passes through untouched. */
export const GUARDED_ROUTES: readonly GuardedRoute[] = [
  {
    path: "/api/run",
    maxBodyBytes: GUARD_RUN_MAX_BODY_BYTES,
    cost: { model: LLM_MAX_CALLS_PER_RUN, qloo: RUN_QLOO_CALLS },
    ipLimits: [
      { name: RUN_HOUR_LIMIT, limit: RUNS_PER_HOUR_PER_IP, windowMs: HOUR_MS },
      { name: "run-day", limit: RUNS_PER_DAY_PER_IP, windowMs: DAY_MS },
    ],
  },
  {
    // Profile build: one taste-analysis call and at most one model call to name axes.
    path: "/api/profile",
    maxBodyBytes: GUARD_PROFILE_MAX_BODY_BYTES,
    cost: { model: 1, qloo: 1 },
    ipLimits: [{ name: "profile-hour", limit: GUARD_PROFILE_PER_HOUR, windowMs: HOUR_MS }],
  },
  {
    // "Why" to tags: one semantic tag lookup per answer, at most 10 seeds, with retries and edits.
    path: "/api/profile/why",
    maxBodyBytes: GUARD_WHY_MAX_BODY_BYTES,
    cost: { model: 0, qloo: 1 },
    ipLimits: [{ name: "why-hour", limit: GUARD_WHY_PER_HOUR, windowMs: HOUR_MS }],
  },
  {
    // Seed lookup: one search per submit (debounced), cached by query.
    path: "/api/seeds/resolve",
    maxBodyBytes: GUARD_RESOLVE_MAX_BODY_BYTES,
    cost: { model: 0, qloo: 1 },
    ipLimits: [
      { name: "resolve-minute", limit: GUARD_RESOLVE_PER_MINUTE, windowMs: MINUTE_MS },
      { name: "resolve-hour", limit: GUARD_RESOLVE_PER_HOUR, windowMs: HOUR_MS },
    ],
  },
];

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
