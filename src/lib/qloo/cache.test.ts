import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CACHE_ENTRY_VERSION, canonicalJson, createMemoryCache, requestKey, stripBody } from "./cache";
import { createFileCache } from "./cache-file";
import { prepareInsights, prepareSearch, prepareTags } from "./validate";
import { id, insightsEntity, tagId } from "./testing";
import { REGISTRY } from "./registry";

// `server-only` throws outside the react-server condition; stub it for node tests.
vi.mock("server-only", () => ({}));

const reg = { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["signal.interests.tags", "filter.exclude.entities"] } };

describe("requestKey", () => {
  it("is independent of param order and id order", () => {
    const a = prepareInsights(
      { "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(1), weight: 1 }, { id: id(2), weight: 3 }], "signal.interests.tags": [tagId(1), tagId(2)], "filter.exclude.entities": [id(5), id(4)], take: 10 },
      reg,
    );
    const b = prepareInsights(
      { take: 10, "filter.exclude.entities": [id(4), id(5)], "signal.interests.tags": [tagId(2), tagId(1)], "signal.interests.entities": [{ id: id(2), weight: 3 }, { id: id(1) }], "filter.type": "urn:entity:movie" },
      reg,
    );
    expect(requestKey(a)).toBe(requestKey(b));
    expect(requestKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a value or weight changes", () => {
    const base = { "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(1), weight: 1 }], take: 10 };
    const k = requestKey(prepareInsights(base));
    expect(requestKey(prepareInsights({ ...base, take: 11 }))).not.toBe(k);
    expect(requestKey(prepareInsights({ ...base, "signal.interests.entities": [{ id: id(1), weight: 5 }] }))).not.toBe(k);
    expect(requestKey(prepareInsights({ ...base, "filter.type": "urn:entity:book" }))).not.toBe(k);
  });

  it("folds case and spacing in search text", () => {
    expect(requestKey(prepareSearch({ query: "  An  Invented Title " }))).toBe(requestKey(prepareSearch({ query: "an invented title" })));
    expect(requestKey(prepareTags({ "filter.query": "Quiet Dread" }))).toBe(requestKey(prepareTags({ "filter.query": "quiet dread" })));
    expect(requestKey(prepareSearch({ query: "a" }))).not.toBe(requestKey(prepareSearch({ query: "b" })));
  });

  it("gives repeated seeds the same key as a single seed", () => {
    const a = prepareInsights({ "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(1), weight: 2 }, { id: id(1), weight: 2 }] });
    const b = prepareInsights({ "filter.type": "urn:entity:movie", "signal.interests.entities": [{ id: id(1), weight: 2 }] });
    expect(requestKey(a)).toBe(requestKey(b));
  });

  it("canonicalJson sorts keys at every depth", () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}],"b":{"c":2,"d":1}}');
  });
});

describe("stripBody", () => {
  it("drops bulky keys at any depth, truncates long strings, keeps the rest", () => {
    const body = { results: { entities: [insightsEntity(1, { properties: { akas: ["x"], websites: ["w"], keywords: ["k"], biography: "b".repeat(2000), influenced_by: ["Invented Influence"] } })] } };
    const out = stripBody(body) as typeof body;
    const e = out.results.entities[0] as Record<string, unknown>;
    expect(e.akas).toBeUndefined();
    const props = e.properties as Record<string, string | string[]>;
    expect(props.akas).toBeUndefined();
    expect(props.websites).toBeUndefined();
    expect(props.keywords).toBeUndefined();
    expect((props.biography as string).length).toBe(500);
    expect(props.influenced_by).toEqual(["Invented Influence"]);
    expect(e.query).toEqual(insightsEntity(1).query);
    // input untouched
    expect(((body.results.entities[0] as Record<string, unknown>).akas as unknown[]).length).toBe(1);
  });
});

describe("adapters", () => {
  const entry = (key: string) => ({ v: CACHE_ENTRY_VERSION, key, endpoint: "/search" as const, method: "GET" as const, status: 200, body: { ok: 1 }, createdAt: "2026-01-01T00:00:00.000Z" });
  const key = "a".repeat(64);

  it("memory adapter round-trips and copies", async () => {
    const c = createMemoryCache();
    expect(await c.get(key)).toBeNull();
    await c.set(entry(key));
    expect((await c.get(key))?.body).toEqual({ ok: 1 });
    expect(c.size()).toBe(1);
  });

  it("file adapter round-trips under a .qloo-private directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "atelier-test-"));
    const dir = join(root, ".qloo-private", "cache");
    const c = createFileCache(dir);
    expect(await c.get(key)).toBeNull();
    await c.set(entry(key));
    expect((await c.get(key))?.status).toBe(200);
    expect(await readdir(dir)).toEqual([`${key}.json`]);
    expect(JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")).key).toBe(key);
    await c.set({ ...entry(key), body: { ok: 2 } });
    expect((await c.get(key))?.body).toEqual({ ok: 2 });
  });

  it("file adapter refuses a directory outside .qloo-private and bad keys", async () => {
    expect(() => createFileCache(join(tmpdir(), "not-private"))).toThrow(/\.qloo-private/);
    const root = await mkdtemp(join(tmpdir(), "atelier-test-"));
    const c = createFileCache(join(root, ".qloo-private", "cache"));
    await expect(c.get("../escape")).rejects.toThrow(/invalid cache key/);
  });
});
