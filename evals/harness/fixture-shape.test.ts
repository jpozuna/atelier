// Proves the T-03 parsers read the synthetic Qloo fixtures, so the same parsing code runs on fixtures and on real
// responses, and that the fixtures stay synthetic.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlatEntities, parseInsightsEntities, parseTags, parseTasteAnalysis } from "@/lib/qloo/parse";
import { FIXTURES_DIR, loadCases } from "./cases";
import { parseTraceJsonl } from "./trace";

const read = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, "qloo", `${name}.json`), "utf8"));
const SYNTHETIC_ID = /^00000000-0000-4000-8000-0000000000\d\d$/;

describe("synthetic Qloo fixtures parse with the T-03 parsers", () => {
  it("/search: flat results array, tags use tag_id, popularity sometimes missing", () => {
    const p = parseFlatEntities("/search", read("search"));
    expect(p.items).toHaveLength(3);
    expect(p.dropped).toBe(0);
    expect(p.items[0].types?.[0]).toBe("urn:entity:movie");
    expect(p.items[0].tags?.[0].tag_id).toMatch(/^urn:tag:fixture:/);
    expect(p.items.some((i) => i.popularity === undefined)).toBe(true);
    expect(p.items.filter((i) => i.disambiguation).length).toBeGreaterThan(1);
  });

  it("/search with no match: 200 with an empty results array", () => {
    const p = parseFlatEntities("/search", read("search-empty"));
    expect(p.items).toEqual([]);
    expect(p.dropped).toBe(0);
  });

  it("/entities: same flat shape as /search", () => {
    expect(parseFlatEntities("/entities", read("entities")).items).toHaveLength(1);
  });

  it("/v2/insights (entity): results.entities, tags use id, explainability under the dotted key, top-level query", () => {
    const p = parseInsightsEntities(read("insights"));
    expect(p.items).toHaveLength(3);
    expect(p.dropped).toBe(0);
    const [first] = p.items;
    expect(first.type).toBe("urn:entity");
    expect(first.subtype).toBe("urn:entity:book");
    expect(first.tags?.[0].id).toMatch(/^urn:tag:fixture:/);
    expect(first.query?.affinity).toBeGreaterThan(0);
    expect(first.query?.explainability?.["signal.interests.entities"]?.[0]).toMatchObject({ entity_id: expect.any(String), score: expect.any(Number) });
    expect(p.query).toBeDefined();
    // A tail item with popularity 0 (unknown on brands) and no tags is still read, not dropped.
    expect(p.items.some((i) => i.popularity === 0 && i.tags?.length === 0)).toBe(true);
  });

  it("/v2/tags: results.tags, items use id", () => {
    const p = parseTags(read("tags"));
    expect(p.items).toHaveLength(3);
    expect(p.items[0].id).toMatch(/^urn:tag:fixture:/);
  });

  it("/v2/insights (urn:tag): results.tags, items use tag_id with a scored affinity", () => {
    const p = parseTasteAnalysis(read("taste-analysis"));
    expect(p.items).toHaveLength(3);
    expect(p.items[0].tag_id).toMatch(/^urn:tag:fixture:/);
    expect(p.items[0].query?.affinity).toBeGreaterThan(0);
  });

  it("each parser rejects the wrong envelope", () => {
    expect(() => parseTags(read("insights"))).toThrow();
    expect(() => parseInsightsEntities(read("tags"))).toThrow();
    // Tag items use `id` on /v2/tags and `tag_id` in taste analysis, so the wrong parser drops every item.
    const wrong = parseTasteAnalysis(read("tags"));
    expect(wrong.items).toEqual([]);
    expect(wrong.dropped).toBe(3);
  });
});

describe("fixtures stay synthetic", () => {
  const dir = join(FIXTURES_DIR, "qloo");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("every entity id is a synthetic id and every name is invented", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/"entity_id":\s*"([^"]+)"/g)) expect(m[1], f).toMatch(SYNTHETIC_ID);
      for (const m of text.matchAll(/"name":\s*"([^"]+)"/g)) expect(m[1], f).toMatch(/fixture|invented|synthetic/i);
    }
  });
});

describe("cases and traces", () => {
  it("cases.json loads and every trace file is parsed as TraceEvent lines", () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(8);
    for (const c of cases) expect(c.input.trace.length, c.id).toBeGreaterThan(0);
  });

  it("every trace file is used by a case, and every case names an existing trace", () => {
    const used = new Set(loadCases().map((c) => c.trace.replace(/^traces\//, "")));
    const onDisk = readdirSync(join(FIXTURES_DIR, "traces")).filter((f) => f.endsWith(".jsonl"));
    expect([...used].sort()).toEqual(onDisk.sort());
  });

  it("a trace line that is not a TraceEvent is refused with its line number", () => {
    expect(() => parseTraceJsonl('{"kind":"nope"}\n', "x.jsonl")).toThrow(/x\.jsonl:1/);
    expect(() => parseTraceJsonl("not json", "x.jsonl")).toThrow(/x\.jsonl:1: not valid JSON/);
  });

  it("legacy endpoints cannot even be written into a trace fixture", () => {
    const line = JSON.stringify({ t: "2026-01-01T00:00:00.000Z", say: "x", kind: "qloo_call", endpoint: "/recommendations", method: "GET", cached: false });
    expect(() => parseTraceJsonl(line)).toThrow(/not a TraceEvent/);
  });
});
