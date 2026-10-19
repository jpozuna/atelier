import { describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "./cache";
import { createQlooClient, parseMode, resolveBaseUrl, type QlooClientOptions } from "./client";
import { QlooBudgetError, QlooCacheMissError, QlooConfigError, QlooHttpError, QlooNetworkError, QlooParamError, QlooParseError } from "./errors";
import { REGISTRY } from "./registry";
import type { QlooCallTraceEvent } from "./types";
import { ENV, fakeFetch, id, insightsBody, searchBody, tagId, tagsBody, tasteBody, type FakeResponse } from "./testing";

// `server-only` throws outside the react-server condition; stub it for node tests.
vi.mock("server-only", () => ({}));

type Respond = Parameters<typeof fakeFetch>[0];

function setup(respond: Respond, opts: Partial<QlooClientOptions> & { env?: () => Record<string, string | undefined> } = {}) {
  const f = fakeFetch(respond);
  const events: QlooCallTraceEvent[] = [];
  const cache = createMemoryCache();
  const sleeps: number[] = [];
  const client = createQlooClient({
    mode: "record",
    cache,
    fetch: f.fetch,
    env: () => ENV,
    onTrace: (e) => events.push(e),
    sleep: async (ms) => void sleeps.push(ms),
    limits: { MIN_REQUEST_INTERVAL_MS: 0 },
    ...opts,
  });
  return { client, calls: f.calls, events, cache, sleeps };
}

const insightsReq = (n = 1, extra: Record<string, unknown> = {}) => ({ "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(n), weight: 1 }], take: 20, ...extra });
const okInsights = (): Respond => () => ({ body: insightsBody([10, 11]) });

describe("requests", () => {
  it("sends search as GET with the key only in X-Api-Key", async () => {
    const { client, calls } = setup(() => ({ body: searchBody([1]) }));
    const r = await client.search({ query: "an invented title", types: ["urn:entity:movie"], take: 5 });
    expect(r.outcome).toBe("ok");
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.method).toBe("GET");
    expect(c.url.origin).toBe("https://hackathon.api.qloo.com");
    expect(c.url.pathname).toBe("/search");
    expect(c.url.searchParams.get("query")).toBe("an invented title");
    expect(c.headers["X-Api-Key"]).toBe(ENV.QLOO_API_KEY);
    expect(c.url.toString()).not.toContain(ENV.QLOO_API_KEY);
    expect(c.body).toBeUndefined();
  });

  it("sends insights as POST with a JSON body and seeds as [{id, weight}]", async () => {
    const { client, calls } = setup(okInsights());
    const r = await client.insights(insightsReq(1, { "signal.interests.entities": [{ id: id(1), weight: 3 }, { id: id(2) }] }));
    expect(r.items).toHaveLength(2);
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/v2/insights");
    expect(c.url.search).toBe("");
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(c.body).toEqual({ "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(1), weight: 3 }, { id: id(2), weight: 1 }], take: 20 });
  });

  it("sends tags and entities as GET and taste analysis as GET with filter.type=urn:tag", async () => {
    const { client, calls } = setup((c) => ({ body: c.url.pathname === "/v2/tags" ? tagsBody([1]) : c.url.pathname === "/entities" ? searchBody([1]) : tasteBody([1, 2]) }));
    await client.tags({ "filter.query": "quiet dread", "feature.semantic_search": true });
    await client.entities({ entity_ids: [id(2), id(1)] });
    const t = await client.tasteAnalysis({ "signal.interests.entities": [id(1), id(2)], "filter.parents.types": ["urn:entity:book"], take: 50 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
    expect(calls[0].url.searchParams.get("feature.semantic_search")).toBe("true");
    expect(calls[1].url.searchParams.get("entity_ids")).toBe(`${id(2)},${id(1)}`);
    expect(calls[2].url.pathname).toBe("/v2/insights");
    expect(calls[2].url.searchParams.get("filter.type")).toBe("urn:tag");
    expect(t.items[0].tag_id).toBe(tagId(1));
  });

  it("can send taste analysis by POST once the body params are recorded", async () => {
    const registry = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["filter.parents.types"] } };
    const { client, calls } = setup(() => ({ body: tasteBody([1]) }), { tasteAnalysisMethod: "POST", registry });
    await client.tasteAnalysis({ "signal.interests.entities": [{ id: id(1), weight: 2 }], "filter.parents.types": ["urn:entity:movie"] });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ "filter.type": "urn:tag", "signal.interests.entities": [{ id: id(1), weight: 2 }] });
  });

  it("refuses invalid params before any request or cache read", async () => {
    const { client, calls, events } = setup(okInsights());
    await expect(client.insights(insightsReq(1, { "filter.popularity.max": 0.6 }))).rejects.toBeInstanceOf(QlooParamError);
    await expect(client.insights(insightsReq(1, { "filter.type": "urn:entity:book", "bias.trends": "off" }))).rejects.toMatchObject({ kind: "param_invalid" });
    expect(calls).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "qloo_call", outcome: "error", errorKind: "param_invalid", cached: false });
    expect(events[0]).not.toHaveProperty("status");
  });

  it("never sends the key outside the header and never calls another path or host", async () => {
    const { client, calls } = setup(() => ({ body: searchBody([1]) }));
    await client.search({ query: "x" });
    for (const c of calls) {
      expect(c.url.host).toBe("hackathon.api.qloo.com");
      expect(["/search", "/entities", "/v2/tags", "/v2/insights"]).toContain(c.url.pathname);
      expect(JSON.stringify(c.body ?? {})).not.toContain(ENV.QLOO_API_KEY);
    }
  });
});

describe("config", () => {
  it("accepts only the hackathon host", () => {
    expect(resolveBaseUrl("https://hackathon.api.qloo.com").hostname).toBe("hackathon.api.qloo.com");
    expect(resolveBaseUrl("https://hackathon.api.qloo.com/").hostname).toBe("hackathon.api.qloo.com");
    for (const bad of [
      undefined,
      "",
      "not a url",
      "https://api.qloo.com",
      "https://staging.api.qloo.com",
      "http://hackathon.api.qloo.com",
      "https://hackathon.api.qloo.com.evil.example",
      "https://evil.example/hackathon.api.qloo.com",
      "https://user:pw@hackathon.api.qloo.com",
      "https://hackathon.api.qloo.com/v2",
      "https://hackathon.api.qloo.com:8443",
    ]) {
      expect(() => resolveBaseUrl(bad)).toThrow(QlooConfigError);
    }
  });

  it("throws on a wrong host or a missing key at call time, without calling", async () => {
    const wrong = setup(okInsights(), { env: () => ({ ...ENV, QLOO_BASE_URL: "https://api.qloo.com" }) });
    await expect(wrong.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooConfigError);
    const nokey = setup(okInsights(), { env: () => ({ ...ENV, QLOO_API_KEY: undefined }) });
    await expect(nokey.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooConfigError);
    expect(wrong.calls.length + nokey.calls.length).toBe(0);
  });

  it("defaults to replay and rejects unknown modes", () => {
    expect(parseMode(undefined)).toBe("replay");
    expect(parseMode("")).toBe("replay");
    expect(parseMode("live")).toBe("live");
    expect(() => parseMode("yolo")).toThrow(QlooConfigError);
    expect(createQlooClient({ cache: null, env: () => ({}) }).mode).toBe("replay");
    expect(() => createQlooClient({ cache: null, env: () => ({ QLOO_MODE: "yolo" }) })).toThrow(QlooConfigError);
  });
});

describe("modes", () => {
  it("replay never touches the network and throws on a miss", async () => {
    const { client, calls, events } = setup(okInsights(), { mode: "replay" });
    await expect(client.insights(insightsReq())).rejects.toBeInstanceOf(QlooCacheMissError);
    expect(calls).toHaveLength(0);
    expect(events[0]).toMatchObject({ outcome: "error", errorKind: "cache_miss", cached: false });
  });

  it("replay serves what record stored, with no call", async () => {
    const recorder = setup(okInsights(), { mode: "record" });
    await recorder.client.insights(insightsReq());
    const replay = createQlooClient({ mode: "replay", cache: recorder.cache, fetch: (() => { throw new Error("network!"); }) as unknown as typeof fetch, env: () => ENV });
    const r = await replay.insights(insightsReq());
    expect(r.items).toHaveLength(2);
    expect(r.meta).toMatchObject({ cached: true, source: "cache" });
    expect(replay.stats()).toMatchObject({ liveCalls: 0, cacheHits: 1 });
  });

  it("record calls once on a miss and then serves the cache", async () => {
    const { client, calls, cache } = setup(okInsights());
    const a = await client.insights(insightsReq());
    const b = await client.insights(insightsReq());
    expect(calls).toHaveLength(1);
    expect(a.meta.cached).toBe(false);
    expect(b.meta.cached).toBe(true);
    expect(cache.size()).toBe(1);
    expect(client.stats()).toMatchObject({ liveCalls: 1, cacheHits: 1 });
  });

  it("live always calls, and still stores", async () => {
    const { client, calls, cache } = setup(okInsights(), { mode: "live" });
    await client.insights(insightsReq());
    await client.insights(insightsReq());
    expect(calls).toHaveLength(2);
    expect(cache.size()).toBe(1);
  });

  it("stores stripped bodies", async () => {
    const { client, cache } = setup(okInsights());
    await client.insights(insightsReq());
    const stored = JSON.stringify(cache.entries()[0].body);
    expect(stored).not.toContain("Invented Alias");
    expect(stored).not.toContain('"akas"');
  });

  it("does not cache errors", async () => {
    let n = 0;
    const { client, cache } = setup(() => (++n === 1 ? { status: 500, body: { errors: [{ message: "boom" }] } } : { body: insightsBody([1]) }));
    await expect(client.insights(insightsReq())).rejects.toMatchObject({ kind: "server_error" });
    expect(cache.size()).toBe(0);
    expect((await client.insights(insightsReq())).outcome).toBe("ok");
  });

  it("treats a failed cache read as a miss in record mode and a failed write as harmless", async () => {
    const broken = { get: async () => { throw new Error("db down"); }, set: async () => { throw new Error("db down"); } };
    const { client, calls } = setup(okInsights(), { cache: broken });
    expect((await client.insights(insightsReq())).outcome).toBe("ok");
    expect(calls).toHaveLength(1);
    const replay = setup(okInsights(), { cache: broken, mode: "replay" });
    await expect(replay.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooCacheMissError);
  });
});

describe("singleflight", () => {
  it("shares one call between identical concurrent requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls, events } = setup(async () => { await gate; return { body: insightsBody([1]) }; });
    const ps = [client.insights(insightsReq()), client.insights(insightsReq()), client.insights(insightsReq())];
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release();
    const rs = await Promise.all(ps);
    expect(calls).toHaveLength(1);
    expect(rs.map((r) => r.meta.source).sort()).toEqual(["live", "shared", "shared"]);
    expect(client.stats()).toMatchObject({ liveCalls: 1, sharedCalls: 2 });
    // only the leader counts as a live call in the trace
    expect(events.filter((e) => !e.cached)).toHaveLength(1);
  });

  it("does not share different requests", async () => {
    const { client, calls } = setup(okInsights());
    await Promise.all([client.insights(insightsReq(1)), client.insights(insightsReq(2))]);
    expect(calls).toHaveLength(2);
  });
});

describe("budget", () => {
  it("refuses live call number 13 and does not send it", async () => {
    const { client, calls } = setup(okInsights());
    for (let n = 1; n <= 12; n++) await client.insights(insightsReq(n));
    expect(calls).toHaveLength(12);
    await expect(client.insights(insightsReq(13))).rejects.toMatchObject({ kind: "budget", reason: "run_limit" });
    expect(calls).toHaveLength(12);
    // cache hits are still served after the cap
    expect((await client.insights(insightsReq(5))).meta.cached).toBe(true);
  });

  it("counts per client, so a new run starts at zero", async () => {
    const a = setup(okInsights());
    for (let n = 1; n <= 12; n++) await a.client.insights(insightsReq(n));
    const b = setup(okInsights());
    await expect(b.client.insights(insightsReq(1))).resolves.toBeTruthy();
  });

  it("reads x-month-ratelimit-remaining on every live response and refuses below the reserve", async () => {
    let remaining = 6001;
    const { client, calls } = setup(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": String(remaining--) } }));
    const first = await client.insights(insightsReq(1));
    expect(first.meta.remaining).toBe(6001);
    await client.insights(insightsReq(2)); // remaining was 6001 >= 6000, allowed; now 6000
    await client.insights(insightsReq(3)); // 6000 is not below 6000, allowed; now 5999
    expect(client.stats().remaining).toBe(5999);
    await expect(client.insights(insightsReq(4))).rejects.toMatchObject({ kind: "budget", reason: "reserve" });
    expect(calls).toHaveLength(3);
    // cache still works under the reserve
    expect((await client.insights(insightsReq(1))).meta.cached).toBe(true);
  });

  it("allows live calls below the reserve when ATELIER_DEMO=1", async () => {
    const { client, calls } = setup(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": "100" } }), { env: () => ({ ...ENV, ATELIER_DEMO: "1" }) });
    await client.insights(insightsReq(1));
    await client.insights(insightsReq(2));
    expect(calls).toHaveLength(2);
  });

  it("honours QLOO_RESERVE and rejects a bad value", async () => {
    const low = setup(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": "100" } }), { env: () => ({ ...ENV, QLOO_RESERVE: "50" }) });
    await low.client.insights(insightsReq(1));
    await low.client.insights(insightsReq(2));
    expect(low.calls).toHaveLength(2);
    const bad = setup(okInsights(), { env: () => ({ ...ENV, QLOO_RESERVE: "lots" }) });
    await expect(bad.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooConfigError);
  });

  it("shares the quota reading and singleflight state between clients that use the process default", async () => {
    const f = fakeFetch(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": "10" } }));
    const common = { mode: "record" as const, fetch: f.fetch, env: () => ENV, cache: null };
    const a = createQlooClient(common);
    await a.insights(insightsReq(1));
    const b = createQlooClient(common);
    expect(b.stats().remaining).toBe(10);
    await expect(b.insights(insightsReq(2))).rejects.toMatchObject({ kind: "budget", reason: "reserve" });
    expect(f.calls).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("keeps at most 4 requests in flight", async () => {
    let active = 0;
    let peak = 0;
    const waiters: (() => void)[] = [];
    const { client } = setup(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((r) => waiters.push(r));
      active--;
      return { body: insightsBody([1]) };
    });
    const ps = Array.from({ length: 10 }, (_, i) => client.insights(insightsReq(i + 1)));
    // Pump: release whatever is in flight until everything has finished.
    const done = Promise.all(ps);
    let finished = false;
    void done.then(() => (finished = true));
    while (!finished) {
      await new Promise((r) => setTimeout(r, 1));
      waiters.splice(0).forEach((w) => w());
    }
    expect(peak).toBe(4);
  });

  it("backs off and retries a 429, up to 3 times", async () => {
    let n = 0;
    const { client, calls, sleeps } = setup(() => (++n <= 2 ? { status: 429, body: { code: 429, reason: "Too Many Requests", message: "slow" } } : { body: insightsBody([1]) }));
    const r = await client.insights(insightsReq());
    expect(r.outcome).toBe("ok");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    // one logical live call, three HTTP attempts
    expect(client.stats()).toMatchObject({ liveCalls: 1, httpAttempts: 3 });
  });

  it("gives up after 3 retries with a rate_limited error", async () => {
    const { client, calls, sleeps } = setup(() => ({ status: 429, body: { code: 429, reason: "Too Many Requests", message: "slow" } }));
    await expect(client.insights(insightsReq())).rejects.toMatchObject({ kind: "rate_limited", status: 429, retryable: true });
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("follows Retry-After, capped", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => (++n === 1 ? { status: 429, body: {}, headers: { "retry-after": "2" } } : n === 2 ? { status: 429, body: {}, headers: { "retry-after": "999" } } : { body: insightsBody([1]) }));
    await client.insights(insightsReq());
    expect(sleeps).toEqual([2000, 8000]);
  });

  it("spaces request starts", async () => {
    const f = fakeFetch(() => ({ body: insightsBody([1]) }));
    const sleeps: number[] = [];
    let t = 0;
    const client = createQlooClient({ mode: "record", cache: null, fetch: f.fetch, env: () => ENV, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, limits: { MIN_REQUEST_INTERVAL_MS: 200 } });
    await client.insights(insightsReq(1));
    await client.insights(insightsReq(2));
    expect(sleeps).toEqual([200]);
  });
});

describe("errors", () => {
  const cases: [string, FakeResponse, string, number][] = [
    ["400 with errors[]", { status: 400, body: { errors: [{ message: "not supported for filter.type", path: "filter.type" }] } }, "bad_request", 400],
    ["401", { status: 401, body: { message: "Unauthorized" } }, "unauthorized", 401],
    ["403", { status: 403, body: { message: "no permission" } }, "forbidden", 403],
    ["500", { status: 500, body: { errors: [{ message: "System Error" }] } }, "server_error", 500],
    ["HTML 504", { status: 504, text: "<html><body>504 Gateway Time-out</body></html>" }, "gateway_timeout", 504],
  ];
  for (const [name, resp, kind, status] of cases) {
    it(`maps ${name}`, async () => {
      const { client, events } = setup(() => resp);
      const err = await client.insights(insightsReq()).catch((e) => e);
      expect(err).toBeInstanceOf(QlooHttpError);
      expect(err).toMatchObject({ kind, status });
      expect(events[0]).toMatchObject({ outcome: "error", errorKind: kind, status });
    });
  }

  it("keeps the messages and the HTML flag", async () => {
    const a = await setup(() => cases[0][1]).client.insights(insightsReq()).catch((e) => e);
    expect(a.messages).toEqual(["not supported for filter.type (filter.type)"]);
    const b = await setup(() => cases[4][1]).client.insights(insightsReq()).catch((e) => e);
    expect(b.html).toBe(true);
  });

  it("maps the search 400 shape", async () => {
    const { client } = setup(() => ({ status: 400, body: { error: { reason: "bad_request", message: "take must be <= 100", code: 400, request_id: "r" } } }));
    const err = await client.search({ query: "x" }).catch((e) => e);
    expect(err).toMatchObject({ kind: "bad_request", messages: ["bad_request: take must be <= 100"] });
  });

  it("maps a network failure and a non-JSON 200", async () => {
    const net = setup(() => { throw new Error("socket hang up"); });
    await expect(net.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooNetworkError);
    const junk = setup(() => ({ text: "not json" }));
    await expect(junk.client.insights(insightsReq())).rejects.toBeInstanceOf(QlooParseError);
    expect(junk.cache.size()).toBe(0);
  });

  it("does not cache a 200 whose envelope is wrong", async () => {
    const { client, cache } = setup(() => ({ body: { success: true, results: [] } }));
    await expect(client.insights(insightsReq())).rejects.toBeInstanceOf(QlooParseError);
    expect(cache.size()).toBe(0);
  });

  it("never puts the key in an error message", async () => {
    const { client } = setup(() => ({ status: 401, body: {} }));
    const err = await client.insights(insightsReq()).catch((e) => e);
    expect(String(err.message)).not.toContain(ENV.QLOO_API_KEY);
  });
});

describe("empty results", () => {
  it("reports an empty 200 as empty, with a diagnosis, never as ok", async () => {
    const { client } = setup(() => ({ body: { success: true, results: { entities: [], duration: 3 } } }));
    const r = await client.insights(insightsReq());
    expect(r.outcome).toBe("empty");
    expect(r.items).toEqual([]);
    expect(r.diagnosis).toMatch(/ignored/);
  });

  it("reports a search with no match as empty, from either a 200 [] or a 404", async () => {
    const a = await setup(() => ({ body: { success: true, results: [] } })).client.search({ query: "zzz" });
    expect(a.outcome).toBe("empty");
    const b = setup(() => ({ status: 404, body: { code: 404, reason: "Not Found", message: "No results" } }));
    const rb = await b.client.search({ query: "zzz" });
    expect(rb.outcome).toBe("empty");
    expect(b.cache.size()).toBe(1);
    // a cached 404 replays as empty too
    expect((await b.client.search({ query: "zzz" })).meta.cached).toBe(true);
  });

  it("treats a 404 on insights as an error", async () => {
    const { client } = setup(() => ({ status: 404, body: { errors: [{ message: "No path matching" }] } }));
    await expect(client.insights(insightsReq())).rejects.toMatchObject({ kind: "not_found" });
  });

  it("emits empty in the trace", async () => {
    const { client, events } = setup(() => ({ body: { success: true, results: { entities: [] } } }));
    await client.insights(insightsReq());
    expect(events[0]).toMatchObject({ outcome: "empty", resultCount: 0 });
  });
});

describe("trace events", () => {
  it("emits a qloo_call per call with ids redacted and the cached flag", async () => {
    const { client, events } = setup(okInsights());
    await client.insights(insightsReq(7, { "signal.interests.entities": [{ id: id(7) }, { id: id(8) }] }));
    await client.insights(insightsReq(7, { "signal.interests.entities": [{ id: id(7) }, { id: id(8) }] }));
    const [live, cached] = events;
    expect(live).toMatchObject({ kind: "qloo_call", endpoint: "/v2/insights", method: "POST", cached: false, source: "live", status: 200, outcome: "ok", resultCount: 2, entityType: "urn:entity:movie", runLiveCalls: 1, mode: "record" });
    expect(live.params).toEqual({ "filter.type": "urn:entity:movie", "signal.interests.entities": "[2 ids]", take: 20 });
    expect(cached).toMatchObject({ cached: true, source: "cache", runLiveCalls: 1 });
    expect(cached).not.toHaveProperty("status"); // no HTTP response for a cache hit
    expect(typeof live.ms).toBe("number");
    expect(typeof live.say).toBe("string");
    expect(Date.parse(live.t)).not.toBeNaN();
    const text = JSON.stringify(events);
    expect(text).not.toContain(id(7));
    expect(text).not.toContain(ENV.QLOO_API_KEY);
  });

  it("redacts tag ids and keeps search text and plain values", async () => {
    const registry = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["signal.interests.tags", "filter.popularity.max", "filter.exclude.entities"] } };
    const { client, events } = setup(okInsights(), { registry });
    await client.insights(insightsReq(1, { "signal.interests.tags": [tagId(1)], "filter.popularity.max": 0.6, "filter.exclude.entities": [id(9)] }));
    expect(events[0].params).toMatchObject({ "signal.interests.tags": "[1 ids]", "filter.popularity.max": 0.6, "filter.exclude.entities": "[1 ids]" });
    const s = setup(() => ({ body: searchBody([1]) }));
    await s.client.search({ query: "an invented title" });
    expect(s.events[0].params).toEqual({ query: "an invented title" });
  });

  it("survives a throwing sink", async () => {
    const { client } = setup(okInsights(), { onTrace: () => { throw new Error("sink"); } });
    await expect(client.insights(insightsReq())).resolves.toBeTruthy();
  });

  it("emits for a budget refusal", async () => {
    const { client, events } = setup(okInsights(), { limits: { MIN_REQUEST_INTERVAL_MS: 0, MAX_LIVE_CALLS_PER_RUN: 1 } });
    await client.insights(insightsReq(1));
    await expect(client.insights(insightsReq(2))).rejects.toBeInstanceOf(QlooBudgetError);
    expect(events[1]).toMatchObject({ outcome: "error", errorKind: "budget", cached: false, runLiveCalls: 1 });
  });
});

describe("hardening", () => {
  it("never follows redirects, so the key cannot leave the host", async () => {
    const { client, calls } = setup((c) => ({ body: c.url.pathname === "/search" ? searchBody([1]) : insightsBody([1]) }));
    await client.insights(insightsReq());
    await client.search({ query: "x" });
    expect(calls.map((c) => c.redirect)).toEqual(["error", "error"]);
  });

  it("maps a redirect failure to a network error", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed: redirect mode is set to error");
    });
    await expect(client.search({ query: "x" })).rejects.toBeInstanceOf(QlooNetworkError);
  });

  it("treats a 404 as empty only when the body is the No results shape", async () => {
    const good = setup(() => ({ status: 404, body: { code: 404, reason: "Not Found", message: "No results" } }));
    expect((await good.client.search({ query: "zzz" })).outcome).toBe("empty");
    expect((await good.client.entities({ entity_ids: [id(1)] })).outcome).toBe("empty");
    expect(good.cache.size()).toBe(2);
    for (const resp of [{ status: 404, body: { errors: [{ message: "No path matching" }] } }, { status: 404, text: "<html>Not Found</html>" }, { status: 404, text: "" }]) {
      const bad = setup(() => resp);
      await expect(bad.client.search({ query: "zzz" })).rejects.toMatchObject({ kind: "not_found", status: 404 });
      await expect(bad.client.entities({ entity_ids: [id(1)] })).rejects.toMatchObject({ kind: "not_found" });
      expect(bad.cache.size()).toBe(0);
    }
  });

  it("reads an empty or non-numeric quota header as absent, not 0", async () => {
    for (const h of ["", "  ", "abc", "-5"]) {
      const { client, calls } = setup(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": h } }));
      const r = await client.insights(insightsReq(1));
      expect(r.meta.remaining, JSON.stringify(h)).toBeNull();
      await client.insights(insightsReq(2)); // not refused by the reserve guard
      expect(calls).toHaveLength(2);
    }
    // a good header after a bad one still updates, and a bad one does not overwrite a good one
    let n = 0;
    const { client } = setup(() => ({ body: insightsBody([1]), headers: { "x-month-ratelimit-remaining": ++n === 1 ? "8000" : "" } }));
    await client.insights(insightsReq(1));
    const r = await client.insights(insightsReq(2));
    expect(r.meta.remaining).toBe(8000);
  });

  it("drops items with no id instead of throwing, and reports the count in the response and trace", async () => {
    const body = { success: true, results: { entities: [{ entity_id: id(1), name: "Invented A" }, { name: "no id" }, { entity_id: id(2) }] } };
    const { client, events, cache } = setup(() => ({ body }));
    const r = await client.insights(insightsReq());
    expect(r.outcome).toBe("ok");
    expect(r.items).toHaveLength(2);
    expect(r.droppedItems).toBe(1);
    expect(events[0]).toMatchObject({ resultCount: 2, droppedItems: 1 });
    expect(cache.size()).toBe(1);
    // replay applies the same leniency
    const again = await client.insights(insightsReq());
    expect(again.droppedItems).toBe(1);
  });

  it("reports empty with the dropped count in the diagnosis when every item lacks an id", async () => {
    const { client } = setup(() => ({ body: { success: true, results: { entities: [{ name: "a" }, { name: "b" }] } } }));
    const r = await client.insights(insightsReq());
    expect(r.outcome).toBe("empty");
    expect(r.droppedItems).toBe(2);
    expect(r.diagnosis).toMatch(/^2 item\(s\)/);
  });

  it("treats a 200 with success:false as an error and does not cache it", async () => {
    const { client, cache, events } = setup(() => ({ body: { success: false, errors: [{ message: "upstream failed" }], results: { entities: [] } } }));
    await expect(client.insights(insightsReq())).rejects.toMatchObject({ kind: "parse" });
    expect(cache.size()).toBe(0);
    expect(events[0]).toMatchObject({ outcome: "error", errorKind: "parse" });
  });

  it("omits status from the event unless an HTTP response was received for it", async () => {
    const { client, events } = setup(okInsights());
    await client.insights(insightsReq());
    await client.insights(insightsReq()); // cache hit
    expect(events[0].status).toBe(200);
    expect(events[1]).not.toHaveProperty("status");
  });
});

describe("singleflight and guards across clients", () => {
  it("lets a follower evaluate its own guards when the leader failed on a budget error", async () => {
    const f = fakeFetch(() => ({ body: insightsBody([1]) }));
    const { createSharedState } = await import("./client");
    const shared = createSharedState({ ...(await import("./limits")).LIMITS, MIN_REQUEST_INTERVAL_MS: 0 });
    const common = { mode: "record" as const, fetch: f.fetch, env: () => ENV, cache: null, shared, sleep: async () => {} };
    const follower = createQlooClient(common);
    // A flight from another client that was refused by that client's own run cap.
    const { prepareInsights } = await import("./validate");
    const { requestKey } = await import("./cache");
    const key = requestKey(prepareInsights(insightsReq()));
    const refused = Promise.reject(new QlooBudgetError("/v2/insights", "run_limit", "other client is capped"));
    refused.catch(() => {});
    shared.inflight.set(key, refused as never);
    const r = await follower.insights(insightsReq());
    expect(r.outcome).toBe("ok");
    expect(r.meta.source).toBe("live");
    expect(f.calls).toHaveLength(1);
    expect(follower.stats()).toMatchObject({ liveCalls: 1, sharedCalls: 0 });
  });

  it("still shares a leader's HTTP failure with followers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls } = setup(async () => {
      await gate;
      return { status: 500, body: { errors: [{ message: "boom" }] } };
    });
    const ps = [client.insights(insightsReq()), client.insights(insightsReq())].map((p) => p.catch((e) => e));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release();
    const [a, b] = await Promise.all(ps);
    expect(a).toMatchObject({ kind: "server_error" });
    expect(b).toMatchObject({ kind: "server_error" });
    expect(calls).toHaveLength(1);
  });

  it("applies the follower's own run cap, not the leader's", async () => {
    const f = fakeFetch(() => ({ body: insightsBody([1]) }));
    const { createSharedState } = await import("./client");
    const shared = createSharedState({ ...(await import("./limits")).LIMITS, MIN_REQUEST_INTERVAL_MS: 0 });
    const mk = (cap: number) => createQlooClient({ mode: "record", fetch: f.fetch, env: () => ENV, cache: null, shared, sleep: async () => {}, limits: { MAX_LIVE_CALLS_PER_RUN: cap } });
    const capped = mk(0);
    const roomy = mk(5);
    const [a, b] = await Promise.all([capped.insights(insightsReq()).catch((e) => e), roomy.insights(insightsReq()).catch((e) => e)]);
    // whichever got there first, the capped client is refused and the roomy one is served
    expect(a).toMatchObject({ kind: "budget" });
    expect(b.outcome).toBe("ok");
    expect(f.calls).toHaveLength(1);
  });
});

describe("purpose", () => {
  it("passes purpose through to the picks check", async () => {
    const { client, calls } = setup(okInsights());
    await expect(client.insights(insightsReq(1), { purpose: "picks" })).rejects.toMatchObject({ kind: "param_invalid", issues: [expect.objectContaining({ param: "filter.exclude.entities", reason: "missing_required" })] });
    expect(calls).toHaveLength(0);
    await expect(client.insights(insightsReq(1), { purpose: "other" })).resolves.toBeTruthy();
  });
});
