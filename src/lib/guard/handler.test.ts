import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { runProxy } from "./handler";
import { loadGuardConfig } from "./limits";
import { createMemoryStore } from "./store";

const config = loadGuardConfig({ ATELIER_GUARD: "1" });
const make = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: init.method ?? "POST", headers: { "x-real-ip": "203.0.113.5", ...init.headers }, body: init.method === "GET" ? undefined : "{}" });

function deps(over: Partial<Parameters<typeof runProxy>[1]> = {}) {
  const session = vi.fn(async () => NextResponse.next());
  return { session, d: { config, store: createMemoryStore(), now: () => 0, session, ...over } };
}

describe("runProxy", () => {
  it("passes ordinary requests to the session step", async () => {
    const { d, session } = deps();
    await runProxy(make("/picks", { method: "GET" }), d);
    expect(session).toHaveBeenCalledOnce();
  });

  it("refuses the fourth run in an hour with a 429, Retry-After, no-store, and no session work", async () => {
    const { d, session } = deps();
    for (let i = 0; i < 3; i++) await runProxy(make("/api/run"), d);
    session.mockClear();
    const res = await runProxy(make("/api/run"), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("too_many_requests");
    expect(session).not.toHaveBeenCalled();
  });

  it("answers the resting state as JSON 503 with demo_resting, never HTML", async () => {
    const { d } = deps({ config: { ...config, rest: true } });
    const res = await runProxy(make("/api/profile"), d);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-atelier-demo")).toBe("resting");
    expect((await res.json()).error.code).toBe("demo_resting");
  });

  it("serves GET /api/demo-status itself", async () => {
    const { d, session } = deps({ config: { ...config, rest: true } });
    const res = await runProxy(make("/api/demo-status", { method: "GET" }), d);
    expect(await res.json()).toEqual({ state: "resting", reason: "paused" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(session).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared body", async () => {
    const { d } = deps();
    const res = await runProxy(make("/api/seeds/resolve", { headers: { "content-length": "999999" } }), d);
    expect(res.status).toBe(413);
  });

  it("does not guard GET on a guarded path (the route returns its own 405)", async () => {
    const { d, session } = deps({ config: { ...config, rest: true } });
    await runProxy(make("/api/run", { method: "GET" }), d);
    expect(session).toHaveBeenCalledOnce();
  });
});
