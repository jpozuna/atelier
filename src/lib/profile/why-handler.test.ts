import { describe, expect, it } from "vitest";
import { isTraceEvent } from "@/types";
import { createMemoryCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { ENV, fakeFetch, type FakeCall, type FakeResponse } from "@/lib/qloo/testing";
import { handleWhy } from "./why-handler";
import { ARTIST, tagsResponse, tid, ttype } from "./fixtures";

const items = [
  { id: tid("theme", 1), name: "Quiet Ending", type: ttype("theme") },
  { id: tid("keyword", 2), name: "quiet ending", type: ttype("keyword") },
  { id: tid("theme", 3), name: "Long Take", type: ttype("theme") },
  { id: tid("theme", 4), name: "Slow Burn", type: ttype("theme") },
  { id: tid("theme", 5), name: "Hush", type: ttype("theme") },
  { id: tid("theme", 6), name: "Stillness", type: ttype("theme") },
  { id: tid("theme", 7), name: "Seventh", type: ttype("theme") },
  { id: "not-a-tag", name: "Bad Id", type: ttype("theme") },
];

function setup(respond: (c: FakeCall) => FakeResponse = () => ({ body: tagsResponse(items) }), mode: "record" | "replay" = "record") {
  const f = fakeFetch((c) => respond(c));
  const cache = createMemoryCache();
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleWhy(new Request("http://localhost/api/profile/why", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), {
      createClient: (onTrace) => createQlooClient({ mode, cache, fetch: f.fetch, env: () => ENV, sleep: async () => {}, limits: { MIN_REQUEST_INTERVAL_MS: 0 }, onTrace }),
    });
  return { post, calls: f.calls };
}

describe("POST /api/profile/why", () => {
  it("makes one semantic /v2/tags call scoped to the field, dedupes by name, caps at 5", async () => {
    const { post, calls } = setup();
    const res = await post({ field: "music", why: "  it feels   quiet ", seedId: "seed-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.tags.map((t: { tag: string }) => t.tag)).toEqual([tid("theme", 1), tid("theme", 3), tid("theme", 4), tid("theme", 5), tid("theme", 6)]);
    expect(body.tags[0]).toEqual({ tag: tid("theme", 1), name: "Quiet Ending", tagType: ttype("theme") });
    expect(calls).toHaveLength(1);
    const q = calls[0].url;
    expect(q.pathname).toBe("/v2/tags");
    expect(calls[0].method).toBe("GET");
    expect(Object.fromEntries(q.searchParams)).toEqual({ "filter.query": "it feels quiet", "feature.semantic_search": "true", "filter.parents.types": ARTIST, take: "8" });
    const map = body.trace.find((e: { kind: string }) => e.kind === "map_why");
    expect(map).toMatchObject({ seedId: "seed-1", semanticSearch: true, tagIds: body.tags.map((t: { tag: string }) => t.tag) });
    expect(map.failed).toBeUndefined();
    expect(body.trace.some((e: { kind: string }) => e.kind === "qloo_call")).toBe(true);
    for (const e of body.trace) expect(isTraceEvent(e)).toBe(true);
  });

  it("an empty match is a valid answer (no tags), and a repeat is a cache hit with no new call", async () => {
    const { post, calls } = setup(() => ({ body: tagsResponse([]) }));
    const a = await (await post({ field: "film", why: "words" })).json();
    expect(a.tags).toEqual([]);
    await post({ field: "film", why: "words" });
    expect(calls).toHaveLength(1);
  });

  it("returns 400 for a bad field, a blank why, an oversize body or a bad seedId, without a call", async () => {
    const { post, calls } = setup();
    for (const b of ["nope", [], { field: "cars", why: "x" }, { field: "film" }, { field: "film", why: "   " }, { field: "film", why: 5 }, { field: "film", why: "x", seedId: 5 }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect((await post({ field: "film", why: "x" }, { "content-length": "99999" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("reports map_why.failed for a lookup that did not complete, with a generic message", async () => {
    const miss = setup(undefined, "replay");
    const res = await miss.post({ field: "film", why: "words", seedId: "s1" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("lookups_off");
    expect(JSON.stringify(body.error)).not.toMatch(/QLOO_MODE|replay/i);
    expect(body.trace.find((e: { kind: string }) => e.kind === "map_why")).toMatchObject({ seedId: "s1", tagIds: [], failed: "unavailable" });
    expect(miss.calls).toHaveLength(0);

    const down = setup(() => ({ status: 500, body: { errors: [{ message: "secret" }] } }));
    const r2 = await down.post({ field: "film", why: "words" });
    expect(r2.status).toBe(502);
    const b2 = await r2.json();
    expect(JSON.stringify(b2)).not.toContain("secret");
    expect(b2.trace.find((e: { kind: string }) => e.kind === "map_why")).toMatchObject({ failed: "unavailable" });
  });

  it("surfaces a 400, 401 or 403 from /v2/tags as an error, not as a failed why", async () => {
    for (const [status, code, http] of [[400, "rejected", 500], [401, "config", 500], [403, "config", 500]] as const) {
      const { post } = setup(() => ({ status, body: { errors: [{ message: "x" }] } }));
      const res = await post({ field: "film", why: "words" });
      expect(res.status).toBe(http);
      const body = await res.json();
      expect(body.error.code).toBe(code);
      expect(body.trace).toBeUndefined();
    }
  });
});
