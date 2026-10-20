// The guard's decision for one request: allow it, or refuse it with a calm, fixed body. Pure apart from the store.
// No Qloo data, no keys, no request content: only the method, path, caller address and declared size are read.

import { MAX_IP_CHARS } from "@/lib/agent/config";
import {
  DAY_MS,
  GUARDED_ROUTES,
  RUN_HOUR_LIMIT,
  type GuardConfig,
  type GuardedRoute,
} from "./limits";
import {
  DEMO_RESTING_CODE,
  PAYLOAD_TOO_LARGE_CODE,
  RESTING_MESSAGE,
  TOO_MANY_MESSAGE,
  TOO_MANY_REQUESTS_CODE,
  type DemoStatus,
  type GuardErrorBody,
} from "./resting";
import type { CounterStore, Hit } from "./store";

export const GLOBAL_MODEL_KEY = "global:model";
export const GLOBAL_QLOO_KEY = "global:qloo";

export interface GuardRequest {
  method: string;
  pathname: string;
  /** Normalised caller address (see `clientIp`). */
  ip: string;
  /** The declared Content-Length, when the request has one. */
  contentLength?: number;
}

export type Decision =
  | { action: "allow" }
  | { action: "block"; status: 413 | 429 | 503; reason: "size" | "ip" | "rest" | "daily_limit"; retryAfterSeconds?: number; body: GuardErrorBody };

/** The guarded route for a path (trailing slashes ignored), or undefined. */
export function matchRoute(pathname: string): GuardedRoute | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return GUARDED_ROUTES.find((r) => r.path === path);
}

/**
 * A caller's address from the proxy headers. On Vercel `x-forwarded-for` and `x-real-ip` are set by the platform and
 * cannot be forged by the client; a self-hosted server must sit behind a proxy that does the same. IPv6 is reduced
 * to its /64 so rotating the low bits does not dodge a limit. Anything unreadable shares one bucket ("unknown"),
 * which is stricter, never looser.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const raw = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  return normalizeIp(raw);
}

export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (!ip || ip.length > MAX_IP_CHARS || !/^[0-9a-f:.]+$/.test(ip)) return "unknown";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  if (!ip.includes(":")) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : "unknown";
  // IPv6: expand "::" and keep the first four groups.
  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups] : headGroups;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return "unknown";
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Both daily meters as hits. A route with cost 0 on a meter still needs the meter not to be empty. */
function meterHits(cfg: GuardConfig, cost: { model: number; qloo: number }): Hit[] {
  return [
    { key: GLOBAL_MODEL_KEY, cost: cost.model, gate: Math.max(cost.model, 1), limit: cfg.dailyModelCalls, windowMs: DAY_MS },
    { key: GLOBAL_QLOO_KEY, cost: cost.qloo, gate: Math.max(cost.qloo, 1), limit: cfg.dailyQlooCalls, windowMs: DAY_MS },
  ];
}

function ipHits(route: GuardedRoute, cfg: GuardConfig, ip: string): Hit[] {
  return route.ipLimits.map((l) => ({
    key: `ip:${ip}:${l.name}`,
    cost: 1,
    limit: l.name === RUN_HOUR_LIMIT ? cfg.runsPerHour : l.limit,
    windowMs: l.windowMs,
  }));
}

const resting = (reason: "rest" | "daily_limit", retryAfterSeconds?: number): Decision => ({
  action: "block",
  status: 503,
  reason,
  retryAfterSeconds,
  body: { error: { code: DEMO_RESTING_CODE, message: RESTING_MESSAGE, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } },
});

/** Decide one request. Requests on unguarded paths or methods, and everything when the guard is off, are allowed. */
export async function decide(req: GuardRequest, cfg: GuardConfig, store: CounterStore, now: number): Promise<Decision> {
  if (!cfg.enabled || req.method !== "POST") return { action: "allow" };
  const route = matchRoute(req.pathname);
  if (!route) return { action: "allow" };

  if (cfg.rest) return resting("rest");

  if (req.contentLength !== undefined && Number.isFinite(req.contentLength) && req.contentLength > route.maxBodyBytes) {
    return { action: "block", status: 413, reason: "size", body: { error: { code: PAYLOAD_TOO_LARGE_CODE, message: "That request is too large." } } };
  }

  const ips = ipHits(route, cfg, req.ip);
  const hits = [...ips, ...meterHits(cfg, route.cost)];
  const result = await store.consume(hits, now);
  if (result.ok) return { action: "allow" };

  const retryAfterSeconds = seconds(result.retryAfterMs);
  if (result.index < ips.length) {
    return {
      action: "block",
      status: 429,
      reason: "ip",
      retryAfterSeconds,
      body: { error: { code: TOO_MANY_REQUESTS_CODE, message: TOO_MANY_MESSAGE, retryAfterSeconds } },
    };
  }
  return resting("daily_limit", retryAfterSeconds);
}

/** What `GET /api/demo-status` reports. Never spends anything. */
export async function demoStatus(cfg: GuardConfig, store: CounterStore, now: number): Promise<DemoStatus> {
  if (!cfg.enabled) return { state: "open" };
  if (cfg.rest) return { state: "resting", reason: "paused" };
  const result = await store.check(meterHits(cfg, { model: 0, qloo: 0 }), now);
  if (result.ok) return { state: "open" };
  return { state: "resting", reason: "daily_limit", retryAfterSeconds: seconds(result.retryAfterMs) };
}
