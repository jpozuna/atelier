import { describe, expect, it } from "vitest";
import { createQlooClient } from "@/lib/qloo/client";
import { createMemoryCache } from "@/lib/qloo/cache";
import { ENV, fakeFetch, id, searchItem, type FakeResponse } from "@/lib/qloo/testing";
import { handleResolve } from "./handler";

type Respond = Parameters<typeof fakeFetch>[0];

function setup(respond: Respond, mode: "record" | "replay" = "record") {
  const f = fakeFetch(respond);
  const cache = createMemoryCache();
  const createClient = () =>
    createQlooClient({ mode, cache, fetch: f.fetch, env: () => ENV, sleep: async () => {}, limits: { MIN_REQUEST_INTERVAL_MS: 0 } });
  const post = (body: unknown) =>
    handleResolve(new Request("http://localhost/api/seeds/resolve", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
      createClient,
      env: () => ({}),
    });
  return { post, calls: f.calls };
}

const ok = (...names: string[]): FakeResponse => ({ body: { success: true, duration: 5, results: names.map((name, i) => searchItem(i + 1, { name })) } });

describe("POST /api/seeds/resolve handler", () => {
  it("returns clean with an entity", async () => {
    const { post } = setup(() => ok("Invented Title"));
    const res = await post({ field: "film", query: "Invented Title" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("clean");
    expect(body.entity.qlooId).toBe(id(1));
    expect(body.candidates).toEqual([]);
  });

  it("returns ambiguous with candidates", async () => {
    const { post } = setup(() => ok("Invented Title", "Invented Title"));
    const body = await (await post({ field: "film", query: "Invented Title" })).json();
    expect(body.status).toBe("ambiguous");
    expect(body.entity).toBeUndefined();
    expect(body.candidates).toHaveLength(2);
  });

  it("returns missing for an empty 200", async () => {
    const { post } = setup(() => ok());
    const res = await post({ field: "music", query: "zzqx nothing" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "missing", candidates: [] });
  });

  it("returns 503 lookups_off on a replay cache miss, without crashing or calling out", async () => {
    const { post, calls } = setup(() => ok("Invented Title"), "replay");
    const res = await post({ field: "film", query: "Invented Title" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("lookups_off");
    expect(body.error.message).toContain("QLOO_MODE=replay");
    expect(calls).toHaveLength(0);
  });

  it("returns 502 on an upstream failure without leaking Qloo text or the key", async () => {
    const { post } = setup(() => ({ status: 500, body: { errors: [{ message: "internal secret detail" }] } }));
    const res = await post({ field: "film", query: "Invented Title" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(text).not.toContain(ENV.QLOO_API_KEY);
  });

  it("rejects bad input with 400 and makes no call", async () => {
    const { post, calls } = setup(() => ok("Invented Title"));
    for (const body of [
      "not json",
      "[]",
      "null",
      {},
      { field: "cars", query: "Invented Title" },
      { field: "film" },
      { field: "film", query: 5 },
      { field: "film", query: " " },
      { field: "film", query: "x" },
      { field: "film", query: "y".repeat(101) },
      JSON.stringify({ field: "film", query: "z", pad: "p".repeat(3000) }),
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    expect(calls).toHaveLength(0);
  });
});
