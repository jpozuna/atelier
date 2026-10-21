import { describe, expect, it } from "vitest";
import { GUARDED_ROUTES, loadGuardConfig, type GuardConfig } from "./limits";
import { clientIp, decide, demoStatus, matchRoute, normalizeIp } from "./policy";
import { createMemoryStore } from "./store";

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({ ...loadGuardConfig({ ATELIER_GUARD: "1" }), ...over });
const post = (pathname: string, ip = "203.0.113.5", contentLength?: number) => ({ method: "POST", pathname, ip, contentLength });
const H = 3_600_000;

describe("loadGuardConfig", () => {
  it("is on in production, off elsewhere, and overridable", () => {
    expect(loadGuardConfig({ NODE_ENV: "production" }).enabled).toBe(true);
    expect(loadGuardConfig({ NODE_ENV: "development" }).enabled).toBe(false);
    expect(loadGuardConfig({ NODE_ENV: "production", ATELIER_GUARD: "0" }).enabled).toBe(false);
    expect(loadGuardConfig({ NODE_ENV: "test", ATELIER_GUARD: "1" }).enabled).toBe(true);
  });
  it("reads numbers and the pause, ignores garbage", () => {
    const c = loadGuardConfig({ ATELIER_RUNS_PER_HOUR: "5", ATELIER_DAILY_MODEL_CALLS: "abc", ATELIER_REST: "1" });
    expect(c).toMatchObject({ runsPerHour: 5, dailyModelCalls: 480, rest: true });
  });
});

describe("clientIp", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.7");
    expect(clientIp(h({ "x-forwarded-for": " 198.51.100.8 , 10.0.0.1" }))).toBe("198.51.100.8");
  });
  it("keeps one bucket for unreadable values and reduces IPv6 to its /64", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(normalizeIp("not an ip")).toBe("unknown");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIp("2001:db8:0:1:aaaa:bbbb:cccc:dddd")).toBe(normalizeIp("2001:db8::1:1:2:3:4"));
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("matchRoute", () => {
  it("matches the four guarded paths, ignoring trailing slashes", () => {
    for (const p of ["/api/run", "/api/profile", "/api/profile/why", "/api/seeds/resolve", "/api/run/"]) expect(matchRoute(p)).toBeDefined();
    for (const p of ["/api/other", "/picks", "/api/runs"]) expect(matchRoute(p)).toBeUndefined();
  });
});

describe("GUARDED_ROUTES", () => {
  it("guards /api/compare: one model call, no Qloo call", () => {
    const route = GUARDED_ROUTES.find((r) => r.path === "/api/compare");
    expect(route?.cost).toEqual({ model: 1, qloo: 0 });
    expect(matchRoute("/api/compare")).toBe(route);
  });
});

describe("decide", () => {
  it("allows everything when off, and non-POST or unguarded paths", async () => {
    const store = createMemoryStore();
    expect(await decide(post("/api/run"), cfg({ enabled: false }), store, 0)).toEqual({ action: "allow" });
    expect(await decide({ ...post("/api/run"), method: "GET" }, cfg(), store, 0)).toEqual({ action: "allow" });
    expect(await decide(post("/picks"), cfg(), store, 0)).toEqual({ action: "allow" });
  });

  it("allows 3 runs an hour per visitor, then a calm 429 with Retry-After seconds; another visitor is unaffected", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) expect((await decide(post("/api/run"), cfg(), store, i * 1000)).action).toBe("allow");
    const d = await decide(post("/api/run"), cfg(), store, 10_000);
    expect(d).toMatchObject({ action: "block", status: 429, reason: "ip", retryAfterSeconds: Math.ceil((H - 10_000) / 1000) });
    expect(d.action === "block" && d.body.error.code).toBe("too_many_requests");
    expect((await decide(post("/api/run", "203.0.113.99"), cfg(), store, 10_000)).action).toBe("allow");
    expect((await decide(post("/api/run"), cfg(), store, H + 1)).action).toBe("allow");
  });

  it("honours ATELIER_RUNS_PER_HOUR", async () => {
    const store = createMemoryStore();
    const c = cfg({ runsPerHour: 1 });
    expect((await decide(post("/api/run"), c, store, 0)).action).toBe("allow");
    expect((await decide(post("/api/run"), c, store, 1)).action).toBe("block");
  });

  it("limits lookups per minute and per hour", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 20; i++) expect((await decide(post("/api/seeds/resolve"), cfg(), store, i)).action).toBe("allow");
    expect(await decide(post("/api/seeds/resolve"), cfg(), store, 100)).toMatchObject({ action: "block", status: 429 });
    expect((await decide(post("/api/seeds/resolve"), cfg(), store, 61_000)).action).toBe("allow");
  });

  it("answers 'resting' (503, demo_resting) when the daily model allowance is spent, and serves nothing that spends", async () => {
    const store = createMemoryStore();
    // 480 model calls a day = 60 runs at 8 each. Different visitors so no per-IP limit interferes.
    for (let i = 0; i < 60; i++) expect((await decide(post("/api/run", `198.51.100.${i}`), cfg(), store, i)).action).toBe("allow");
    const d = await decide(post("/api/run", "198.51.100.200"), cfg(), store, 100);
    expect(d).toMatchObject({ action: "block", status: 503, reason: "daily_limit" });
    expect(d.action === "block" && d.body.error.code).toBe("demo_resting");
    // The whole demo rests together: a lookup is refused too, so onboarding is never left half-working.
    expect(await decide(post("/api/seeds/resolve", "198.51.100.201"), cfg(), store, 101)).toMatchObject({ status: 503 });
  });

  it("rests on the Qloo daily allowance too", async () => {
    const store = createMemoryStore();
    const c = cfg({ dailyQlooCalls: 8 });
    expect((await decide(post("/api/run"), c, store, 0)).action).toBe("allow");
    expect(await decide(post("/api/run", "198.51.100.1"), c, store, 1)).toMatchObject({ status: 503, reason: "daily_limit" });
  });

  it("a refused request spends nothing: the visitor keeps their runs", async () => {
    const store = createMemoryStore();
    const c = cfg({ dailyModelCalls: 8 });
    expect((await decide(post("/api/run", "198.51.100.1"), c, store, 0)).action).toBe("allow");
    expect((await decide(post("/api/run", "198.51.100.2"), c, store, 1)).action).toBe("block");
    expect((await decide(post("/api/run", "198.51.100.2"), c, store, 2)).action).toBe("block");
    expect((await decide(post("/api/run", "198.51.100.2"), c, store, 24 * H + 5)).action).toBe("allow");
  });

  it("ATELIER_REST pauses every guarded route without touching counters", async () => {
    const store = createMemoryStore();
    const d = await decide(post("/api/profile"), cfg({ rest: true }), store, 0);
    expect(d).toMatchObject({ action: "block", status: 503, reason: "rest" });
    expect((await decide(post("/api/profile"), cfg(), store, 1)).action).toBe("allow");
  });

  it("refuses an oversized declared body with 413", async () => {
    const store = createMemoryStore();
    expect(await decide(post("/api/seeds/resolve", "203.0.113.5", 500_000), cfg(), store, 0)).toMatchObject({ status: 413, reason: "size" });
    expect((await decide(post("/api/run", "203.0.113.5", 150_000), cfg(), store, 0)).action).toBe("allow");
  });

  it("blocked bodies carry only fixed, calm text (no key, no address)", async () => {
    const store = createMemoryStore();
    const d = await decide(post("/api/run", "203.0.113.5"), cfg({ rest: true }), store, 0);
    const text = JSON.stringify(d.action === "block" ? d.body : {});
    expect(text).not.toContain("203.0.113.5");
    expect(text).toContain("resting");
  });
});

describe("demoStatus", () => {
  it("is open, resting when paused, resting when a meter is full, open again after a day", async () => {
    const store = createMemoryStore();
    expect(await demoStatus(cfg({ enabled: false, rest: true }), store, 0)).toEqual({ state: "open" });
    expect(await demoStatus(cfg(), store, 0)).toEqual({ state: "open" });
    expect(await demoStatus(cfg({ rest: true }), store, 0)).toEqual({ state: "resting", reason: "paused" });
    await decide(post("/api/run"), cfg({ dailyModelCalls: 8 }), store, 0);
    const s = await demoStatus(cfg({ dailyModelCalls: 8 }), store, 10);
    expect(s).toMatchObject({ state: "resting", reason: "daily_limit" });
    expect(await demoStatus(cfg({ dailyModelCalls: 8 }), store, 24 * H + 1)).toEqual({ state: "open" });
  });
});
