import { describe, expect, it, vi } from "vitest";
import { createMemoryStore, type Hit } from "./store";
import { createSupabaseStore, getGuardStore, selectGuardStoreKind, storedKey, type GuardRpc } from "./store-supabase";

const hit = (key: string, over: Partial<Hit> = {}): Hit => ({ key, cost: 1, limit: 3, windowMs: 1000, ...over });

describe("storedKey", () => {
  it("keeps global meters by name and hashes everything else, so no address is sent", () => {
    expect(storedKey("global:model")).toBe("global:model");
    const k = storedKey("ip:203.0.113.9:run-hour");
    expect(k).toMatch(/^v:[0-9a-f]{64}$/);
    expect(k).not.toContain("203.0.113.9");
    expect(storedKey("ip:203.0.113.9:run-hour")).toBe(k);
    expect(storedKey("ip:203.0.113.9:run-day")).not.toBe(k);
  });
});

describe("supabase store", () => {
  it("sends hashed keys and the commit flag, and passes an ok reply through", async () => {
    const rpc = vi.fn<GuardRpc>(async () => ({ ok: true }));
    const s = createSupabaseStore(rpc, { fallback: createMemoryStore() });
    expect(await s.consume([hit("ip:a"), hit("global:qloo")], 42)).toEqual({ ok: true });
    expect(await s.check([hit("ip:a")], 43)).toEqual({ ok: true });
    const [sent, now, commit] = rpc.mock.calls[0];
    expect(sent.map((h) => h.key)).toEqual([storedKey("ip:a"), "global:qloo"]);
    expect(sent[0]).toMatchObject({ cost: 1, limit: 3, windowMs: 1000 });
    expect([now, commit]).toEqual([42, true]);
    expect(rpc.mock.calls[1][2]).toBe(false);
  });

  it("maps a refusal back to the caller's own key by index", async () => {
    const rpc: GuardRpc = async (hits) => ({ ok: false, index: 1, key: hits[1].key, retryAfterMs: 600 });
    const s = createSupabaseStore(rpc, { fallback: createMemoryStore() });
    expect(await s.consume([hit("global:model"), hit("ip:a")], 0)).toEqual({ ok: false, index: 1, key: "ip:a", retryAfterMs: 600 });
  });

  it("falls back to memory on an error, and that fallback still enforces the limit", async () => {
    const onFallback = vi.fn();
    const s = createSupabaseStore(async () => Promise.reject(new Error("down")), { fallback: createMemoryStore(), onFallback });
    for (let i = 0; i < 3; i++) expect((await s.consume([hit("ip:a")], i)).ok).toBe(true);
    expect(await s.consume([hit("ip:a")], 500)).toMatchObject({ ok: false, key: "ip:a", retryAfterMs: 500 });
    expect(onFallback).toHaveBeenCalledWith("error");
  });

  it("falls back on a malformed reply, with check never committing", async () => {
    const onFallback = vi.fn();
    const fallback = createMemoryStore();
    const replies: unknown[] = [null, { ok: "yes" }, { ok: false, index: 9, retryAfterMs: 1 }, { ok: false, index: 0, retryAfterMs: -1 }];
    let n = 0;
    const s = createSupabaseStore(async () => replies[n++], { fallback, onFallback });
    for (let i = 0; i < replies.length; i++) expect((await s.check([hit("ip:a", { limit: 1 })], 0)).ok).toBe(true);
    expect(onFallback).toHaveBeenCalledTimes(replies.length);
    expect(onFallback).toHaveBeenLastCalledWith("bad_reply");
    expect((await fallback.consume([hit("ip:a", { limit: 1 })], 0)).ok).toBe(true);
  });

  it("times out, aborts the call and answers from memory", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const rpc: GuardRpc = (_h, _n, _c, signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => (aborted = true));
        });
      const onFallback = vi.fn();
      const s = createSupabaseStore(rpc, { fallback: createMemoryStore(), timeoutMs: 50, onFallback });
      const pending = s.consume([hit("ip:a")], 0);
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toEqual({ ok: true });
      expect(aborted).toBe(true);
      expect(onFallback).toHaveBeenCalledWith("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("store selection", () => {
  const ready = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "x" };

  it("is durable only in production with Supabase configured, unless set explicitly", () => {
    expect(selectGuardStoreKind({ NODE_ENV: "production", ...ready })).toBe("supabase");
    expect(selectGuardStoreKind({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: ready.NEXT_PUBLIC_SUPABASE_URL })).toBe("memory");
    expect(selectGuardStoreKind({ NODE_ENV: "development", ...ready })).toBe("memory");
    expect(selectGuardStoreKind({ NODE_ENV: "production", ...ready, ATELIER_GUARD_STORE: "memory" })).toBe("memory");
    expect(selectGuardStoreKind({ ATELIER_GUARD_STORE: " Supabase " })).toBe("supabase");
  });

  it("hands dev the shared in-memory process store", () => {
    expect(getGuardStore(10, {})).toBe(getGuardStore(10, {}));
  });
});
