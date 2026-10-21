// The proxy's logic (src/proxy.ts is a thin wrapper), kept here so it can be tested without Next's runtime.
//
// Order: (1) answer GET /api/demo-status, (2) apply the guard to the guarded POST routes and refuse calmly, (3) refresh
// the Supabase session and apply its auth headers. A refused request does no auth work.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientIp, decide, demoStatus, type Decision } from "./policy";
import { loadGuardConfig, type GuardConfig } from "./limits";
import { refreshSession } from "./session";
import type { CounterStore } from "./store";
import { getGuardStore } from "./store-supabase";

export const DEMO_STATUS_PATH = "/api/demo-status";

export interface ProxyDeps {
  config?: GuardConfig;
  store?: CounterStore;
  now?: () => number;
  /** Session step; tests replace it. */
  session?: (request: NextRequest) => Promise<NextResponse>;
}

const NO_STORE = { "Cache-Control": "no-store" };

function blockResponse(d: Extract<Decision, { action: "block" }>): NextResponse {
  const headers: Record<string, string> = { ...NO_STORE };
  if (d.retryAfterSeconds) headers["Retry-After"] = String(d.retryAfterSeconds);
  if (d.reason === "rest" || d.reason === "daily_limit") headers["X-Atelier-Demo"] = "resting";
  return NextResponse.json(d.body, { status: d.status, headers });
}

export async function runProxy(request: NextRequest, deps: ProxyDeps = {}): Promise<NextResponse> {
  const config = deps.config ?? loadGuardConfig(process.env);
  const store = deps.store ?? getGuardStore(config.maxKeys);
  const now = (deps.now ?? Date.now)();
  const { pathname } = request.nextUrl;

  if (request.method === "GET" && pathname.replace(/\/+$/, "") === DEMO_STATUS_PATH) {
    return NextResponse.json(await demoStatus(config, store, now), { headers: NO_STORE });
  }

  const contentLength = Number(request.headers.get("content-length"));
  const decision = await decide(
    {
      method: request.method,
      pathname,
      ip: clientIp(request.headers),
      contentLength: request.headers.has("content-length") && Number.isFinite(contentLength) ? contentLength : undefined,
    },
    config,
    store,
    now,
  );
  if (decision.action === "block") {
    // Path and reason only: never the caller's address or anything from the body.
    console.warn(`[guard] ${decision.reason} ${request.method} ${pathname}`);
    return blockResponse(decision);
  }

  return (deps.session ?? refreshSession)(request);
}
