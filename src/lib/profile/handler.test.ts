import { describe, expect, it } from "vitest";
import { isAxis, isTraceEvent } from "@/types";
import { createMemoryCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { ENV, fakeFetch, id, type FakeCall, type FakeResponse } from "@/lib/qloo/testing";
import { handleProfile } from "./handler";
import { createNameCache, fallbackNamer } from "./naming";
import { richTaste, seed, tasteResponse, tid, ttype, whyTag } from "./fixtures";

const rich = (): FakeResponse => ({ body: tasteResponse(richTaste()) });

function setup(respond: (c: FakeCall) => FakeResponse = rich, mode: "record" | "replay" = "record") {
  const f = fakeFetch((c) => respond(c));
  const cache = createMemoryCache();
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleProfile(new Request("http://localhost/api/profile", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), {
      createClient: (onTrace) => createQlooClient({ mode, cache, fetch: f.fetch, env: () => ENV, sleep: async () => {}, limits: { MIN_REQUEST_INTERVAL_MS: 0 }, onTrace }),
      createNamer: () => fallbackNamer,
      nameCache: createNameCache(),
    });
  return { post, calls: f.calls };
}

describe("POST /api/profile handler", () => {
  it("returns the profile, axes, trace and call counts, with one Qloo call and no /v2/tags call", async () => {
    const { post, calls } = setup();
    const res = await post({ seeds: [seed(1, { whyTags: [whyTag(90)] }), seed(2)] });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.axes.length).toBeGreaterThanOrEqual(6);
    for (const a of body.axes) expect(isAxis(a)).toBe(true);
    expect(body.profile.seedIds).toEqual(["seed-1", "seed-2"]);
    expect(body.profile.tags.some((t: { tag: string }) => t.tag === tid("theme", 90))).toBe(true);
    expect(Array.isArray(body.profile.bridgeTagIds)).toBe(true);
    expect(body.profile.axes).toBeUndefined();
    expect(body.namingRejections).toBeUndefined();
    const kinds = body.trace.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("qloo_call");
    expect(kinds).toContain("extract_tags");
    expect(kinds).toContain("map_why");
    expect(kinds.at(-1)).toBe("build_axes");
    for (const e of body.trace) expect(isTraceEvent(e)).toBe(true);
    expect(body.calls).toEqual({ live: 1, cached: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/v2/insights");
    expect(JSON.stringify(body)).not.toContain(ENV.QLOO_API_KEY);
  });

  it("returns 400 for a bad body, more than 10 seeds, or malformed why tags, without a call", async () => {
    const { post, calls } = setup();
    const badTags = [
      "nope",
      [{ tag: "x", name: "n", tagType: ttype("theme") }],
      [{ tag: tid("theme", 1), name: "", tagType: ttype("theme") }],
      [{ tag: tid("theme", 1), name: "n", tagType: "theme" }],
      [{ tag: tid("theme", 1), name: "n" }],
      Array.from({ length: 6 }, (_, i) => whyTag(i + 1)),
    ];
    const bad: unknown[] = [
      "not json",
      [],
      {},
      { seeds: [] },
      { seeds: [{ id: "x" }] },
      { seeds: [seed(1, { qlooId: "not-a-uuid" })] },
      { seeds: [seed(1), seed(1)] },
      { seeds: Array.from({ length: 11 }, (_, i) => seed(i + 1)) },
      ...badTags.map((whyTags) => ({ seeds: [{ ...seed(1), whyTags }] })),
    ];
    for (const b of bad) {
      const res = await post(b);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    expect(calls).toHaveLength(0);
    expect((await post({ seeds: Array.from({ length: 10 }, (_, i) => seed(i + 1)) })).status).toBe(200);
  });

  it("refuses an oversize body from Content-Length before reading it", async () => {
    const { post, calls } = setup();
    let read = false;
    const req = new Request("http://localhost/api/profile", { method: "POST", headers: { "content-length": "999999" }, body: "{}" });
    req.text = async () => {
      read = true;
      return "{}";
    };
    const res = await handleProfile(req, { createClient: () => ({ tasteAnalysis: async () => { throw new Error("no"); } }), createNamer: () => fallbackNamer });
    expect(res.status).toBe(400);
    expect(read).toBe(false);
    expect((await post("x".repeat(25000))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 422 when no seed has an entity, without calling Qloo", async () => {
    const { post, calls } = setup();
    const res = await post({ seeds: [seed(1, { qlooId: null, status: "missing" })] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_usable_seeds");
    expect(calls).toHaveLength(0);
  });

  it("returns 422 empty_profile when taste analysis gives nothing", async () => {
    const { post } = setup(() => ({ body: tasteResponse([]) }));
    const res = await post({ seeds: [seed(1)] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("empty_profile");
  });

  it("maps a replay cache miss to 503 lookups_off with a generic message (no env hint)", async () => {
    const { post, calls } = setup(rich, "replay");
    const res = await post({ seeds: [seed(1)] });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("lookups_off");
    expect(JSON.stringify(body)).not.toMatch(/QLOO_MODE|replay|record/i);
    expect(JSON.stringify(body)).not.toContain(id(1));
    expect(calls).toHaveLength(0);
  });

  it("maps an upstream failure to 502 without Qloo text", async () => {
    const { post } = setup(() => ({ status: 500, body: { errors: [{ message: "secret upstream detail" }] } }));
    const res = await post({ seeds: [seed(1)] });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret upstream detail");
  });
});
