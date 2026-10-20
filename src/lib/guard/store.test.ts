import { describe, expect, it } from "vitest";
import { createMemoryStore, type Hit } from "./store";

const hit = (key: string, over: Partial<Hit> = {}): Hit => ({ key, cost: 1, limit: 3, windowMs: 1000, ...over });

describe("memory store", () => {
  it("admits up to the limit, then refuses with the time until a slot frees", async () => {
    const s = createMemoryStore();
    for (let i = 0; i < 3; i++) expect((await s.consume([hit("ip:a")], 100 + i)).ok).toBe(true);
    const r = await s.consume([hit("ip:a")], 500);
    expect(r).toMatchObject({ ok: false, index: 0, key: "ip:a", retryAfterMs: 600 });
  });

  it("is a rolling window: old entries age out", async () => {
    const s = createMemoryStore();
    for (let i = 0; i < 3; i++) await s.consume([hit("ip:a")], 0);
    expect((await s.consume([hit("ip:a")], 999)).ok).toBe(false);
    expect((await s.consume([hit("ip:a")], 1001)).ok).toBe(true);
  });

  it("is all-or-nothing: a failing hit commits none of the others", async () => {
    const s = createMemoryStore();
    for (let i = 0; i < 3; i++) await s.consume([hit("global:m")], 0);
    const r = await s.consume([hit("ip:a"), hit("global:m")], 10);
    expect(r).toMatchObject({ ok: false, index: 1 });
    for (let i = 0; i < 3; i++) expect((await s.consume([hit("ip:a")], 20)).ok).toBe(true);
  });

  it("charges cost, and refuses a cost that cannot fit with the full window", async () => {
    const s = createMemoryStore();
    expect((await s.consume([hit("global:m", { cost: 8, limit: 10 })], 0)).ok).toBe(true);
    expect((await s.consume([hit("global:m", { cost: 8, limit: 10 })], 1)).ok).toBe(false);
    expect(await s.consume([hit("global:big", { cost: 11, limit: 10 })], 0)).toMatchObject({ ok: false, retryAfterMs: 1000 });
  });

  it("check never commits; gate with cost 0 only needs the meter not to be full", async () => {
    const s = createMemoryStore();
    const meter = (cost: number): Hit => ({ key: "global:m", cost, gate: Math.max(cost, 1), limit: 2, windowMs: 1000 });
    expect((await s.check([meter(0)], 0)).ok).toBe(true);
    await s.consume([meter(2)], 0);
    expect((await s.check([meter(0)], 1)).ok).toBe(false);
    expect((await s.consume([meter(0)], 2)).ok).toBe(false);
    expect((await s.check([meter(0)], 1001)).ok).toBe(true);
  });

  it("bounds visitor keys but never drops a global meter", async () => {
    const s = createMemoryStore({ maxKeys: 2 });
    await s.consume([hit("global:m", { limit: 1 })], 0);
    for (const k of ["ip:1", "ip:2", "ip:3"]) await s.consume([hit(k)], 1);
    expect((await s.consume([hit("global:m", { limit: 1 })], 2)).ok).toBe(false);
    // ip:1 was evicted, so it starts fresh.
    for (let i = 0; i < 3; i++) expect((await s.consume([hit("ip:1")], 3)).ok).toBe(true);
  });
});
