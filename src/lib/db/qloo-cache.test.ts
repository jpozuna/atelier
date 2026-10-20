import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CACHE_ENTRY_VERSION, createMemoryCache, type CacheEntry } from "@/lib/qloo/cache";
import { createSupabaseQlooCache, QlooCacheDbError } from "./qloo-cache";
import { createFakeDb } from "./testing";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function entry(over: Partial<CacheEntry> = {}): CacheEntry {
  return {
    v: CACHE_ENTRY_VERSION,
    key: KEY_A,
    endpoint: "/v2/insights",
    method: "POST",
    status: 200,
    body: { results: { entities: [{ entity_id: "00000000-0000-4000-8000-000000000001", name: "Invented Entity" }] } },
    createdAt: "2026-10-19T12:00:00.000Z",
    ...over,
  };
}

describe("supabase qloo cache adapter", () => {
  it("returns null on a miss", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    expect(await cache.get(KEY_A)).toBeNull();
  });

  it("round-trips an entry through qloo_cache columns", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    await cache.set(entry());
    expect(db.tables.qloo_cache).toHaveLength(1);
    expect(Object.keys(db.tables.qloo_cache[0]).sort()).toEqual(
      ["body", "created_at", "endpoint", "key", "method", "status", "version"].sort(),
    );
    expect(await cache.get(KEY_A)).toEqual(entry());
  });

  it("overwrites the same key and keeps other keys apart", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    await cache.set(entry({ body: { n: 1 } }));
    await cache.set(entry({ key: KEY_B, body: { n: 2 } }));
    await cache.set(entry({ body: { n: 3 } }));
    expect(db.tables.qloo_cache).toHaveLength(2);
    expect((await cache.get(KEY_A))?.body).toEqual({ n: 3 });
    expect((await cache.get(KEY_B))?.body).toEqual({ n: 2 });
    expect(db.calls.filter((c) => c.op === "upsert").every((c) => c.onConflict === "key")).toBe(true);
  });

  it("stores an empty 404 as SQL null and reads it back as null body", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    await cache.set(entry({ endpoint: "/search", method: "GET", status: 404, body: null }));
    expect(db.tables.qloo_cache[0].body).toBeNull();
    const got = await cache.get(KEY_A);
    expect(got).toMatchObject({ status: 404, body: null, endpoint: "/search", method: "GET" });
  });

  it("behaves like the in-memory adapter for the same sequence", async () => {
    const mem = createMemoryCache();
    const sb = createSupabaseQlooCache({ client: createFakeDb().client });
    for (const c of [mem, sb]) {
      await c.set(entry());
      await c.set(entry({ key: KEY_B, status: 404, body: null, endpoint: "/entities", method: "GET" }));
    }
    for (const key of [KEY_A, KEY_B, "c".repeat(64)]) expect(await sb.get(key)).toEqual(await mem.get(key));
  });

  it("treats a malformed key as a miss and refuses to write it, without touching the database", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    expect(await cache.get("not-a-key")).toBeNull();
    await expect(cache.set(entry({ key: "'; drop table qloo_cache; --" }))).rejects.toBeInstanceOf(QlooCacheDbError);
    expect(db.calls).toHaveLength(0);
  });

  it("throws a typed error on database failure, without the body in the message", async () => {
    const db = createFakeDb();
    const cache = createSupabaseQlooCache({ client: db.client });
    db.failNext({ code: "42501", message: "permission denied for table qloo_cache" });
    await expect(cache.get(KEY_A)).rejects.toThrow(/qloo_cache get failed: 42501/);
    db.failNext({ code: "23514", message: "check constraint violated" });
    const err = await cache.set(entry({ body: { secret: "invented-body-marker" } })).catch((e) => e);
    expect(err).toBeInstanceOf(QlooCacheDbError);
    expect(String(err.message)).not.toContain("invented-body-marker");
  });

  it("does not create a client until first use", async () => {
    // No env and no injected client: constructing must not throw.
    expect(() => createSupabaseQlooCache()).not.toThrow();
  });
});
