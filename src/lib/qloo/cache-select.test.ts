import { describe, expect, it, vi } from "vitest";
import type { CacheEntry, QlooCacheAdapter } from "./cache";
import { createDefaultCache, selectCacheKind, type CacheLoaders } from "./cache-select";

// `server-only` throws outside the react-server condition; stub it for node tests.
vi.mock("server-only", () => ({}));

const KEY = "a".repeat(64);
const entry: CacheEntry = { v: 1, key: KEY, endpoint: "/search", method: "GET", status: 200, body: { ok: true }, createdAt: "2026-01-01T00:00:00.000Z" };
const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key" };

describe("selectCacheKind", () => {
  it("defaults to file outside production", () => {
    expect(selectCacheKind({})).toBe("file");
    expect(selectCacheKind({ NODE_ENV: "development", ...SB })).toBe("file");
    expect(selectCacheKind({ NODE_ENV: "test", ...SB })).toBe("file");
  });

  it("defaults to supabase in production when both Supabase vars are set", () => {
    expect(selectCacheKind({ NODE_ENV: "production", ...SB })).toBe("supabase");
  });

  it("stays on file in production when a Supabase var is missing or blank", () => {
    expect(selectCacheKind({ NODE_ENV: "production" })).toBe("file");
    expect(selectCacheKind({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: SB.NEXT_PUBLIC_SUPABASE_URL })).toBe("file");
    expect(selectCacheKind({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: SB.SUPABASE_SERVICE_ROLE_KEY })).toBe("file");
    expect(selectCacheKind({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: " ", SUPABASE_SERVICE_ROLE_KEY: "your-key" })).toBe("file");
  });

  it("QLOO_CACHE overrides the default either way", () => {
    expect(selectCacheKind({ QLOO_CACHE: "supabase" })).toBe("supabase");
    expect(selectCacheKind({ QLOO_CACHE: "file", NODE_ENV: "production", ...SB })).toBe("file");
    expect(selectCacheKind({ QLOO_CACHE: " Supabase " })).toBe("supabase");
  });

  it("ignores an unknown QLOO_CACHE value and falls back to the default", () => {
    expect(selectCacheKind({ QLOO_CACHE: "redis" })).toBe("file");
    expect(selectCacheKind({ QLOO_CACHE: "redis", NODE_ENV: "production", ...SB })).toBe("supabase");
  });
});

function loaders() {
  const make = (): QlooCacheAdapter => ({ get: vi.fn(async () => entry), set: vi.fn(async () => undefined) });
  const sb = make();
  const file = make();
  const l: CacheLoaders = { supabase: vi.fn(async () => sb), file: vi.fn(async () => file) };
  return { l, sb, file };
}

describe("createDefaultCache", () => {
  it("loads nothing until the first call", () => {
    const { l } = loaders();
    createDefaultCache({ NODE_ENV: "production", ...SB }, l);
    expect(l.supabase).not.toHaveBeenCalled();
    expect(l.file).not.toHaveBeenCalled();
  });

  it("uses the Supabase adapter only, loaded once, when selected", async () => {
    const { l, sb, file } = loaders();
    const cache = createDefaultCache({ QLOO_CACHE: "supabase" }, l);
    expect(await cache.get(KEY)).toEqual(entry);
    await cache.set(entry);
    expect(sb.get).toHaveBeenCalledWith(KEY);
    expect(sb.set).toHaveBeenCalledWith(entry);
    expect(l.supabase).toHaveBeenCalledTimes(1);
    expect(l.file).not.toHaveBeenCalled();
    expect(file.get).not.toHaveBeenCalled();
  });

  it("uses the file adapter only when selected", async () => {
    const { l, file } = loaders();
    const cache = createDefaultCache({ NODE_ENV: "development" }, l);
    await cache.get(KEY);
    expect(file.get).toHaveBeenCalledWith(KEY);
    expect(l.supabase).not.toHaveBeenCalled();
  });

  it("retries the load after a failure instead of caching it", async () => {
    const adapter: QlooCacheAdapter = { get: async () => null, set: async () => undefined };
    const supabase = vi.fn().mockRejectedValueOnce(new Error("missing env")).mockResolvedValue(adapter);
    const cache = createDefaultCache({ QLOO_CACHE: "supabase" }, { supabase, file: async () => adapter });
    await expect(cache.get(KEY)).rejects.toThrow("missing env");
    await expect(cache.get(KEY)).resolves.toBeNull();
    expect(supabase).toHaveBeenCalledTimes(2);
  });
});
