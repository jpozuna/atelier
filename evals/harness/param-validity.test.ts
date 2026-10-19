import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/types";
import { restoreRedacted, scoreParamValidity, validateCall } from "../scorers/param-validity";

const T = "2026-01-01T00:00:00.000Z";
const MOVIE = "urn:entity:movie";
const callEv = (endpoint: string, method: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ t: T, say: "x", kind: "qloo_call", endpoint, method, cached: false, status: 200, params, ...extra }) as unknown as TraceEvent;
const score = (trace: TraceEvent[]) => scoreParamValidity({ id: "t", run: "new_profile", trace });
const pool = (extra: Record<string, unknown> = {}) => ({ "filter.type": MOVIE, "signal.interests.entities": "[3 ids]", take: 50, ...extra });
const has = (problems: string[], text: string) => problems.some((p) => p.includes(text));

describe("restoreRedacted", () => {
  it("turns placeholders back into ids of the right shape", () => {
    const r = restoreRedacted({ "signal.interests.entities": "[2 ids]", "filter.tags": "[1 ids]", "filter.exclude.entities": ["[id]", "[id]"], take: 5 });
    expect(r["signal.interests.entities"]).toHaveLength(2);
    expect((r["signal.interests.entities"] as string[])[0]).toMatch(/^00000000-0000-4000-8000-/);
    expect((r["filter.tags"] as string[])[0]).toMatch(/^urn:tag:fixture:/);
    expect(r["filter.exclude.entities"]).toHaveLength(2);
    expect(r.take).toBe(5);
  });

  it("leaves freeform strings under tag keys alone so they are caught", () => {
    expect(restoreRedacted({ "filter.tags": ["melancholy"] })["filter.tags"]).toEqual(["melancholy"]);
  });
});

describe("validateCall", () => {
  it("accepts a valid call to each endpoint", () => {
    expect(validateCall("/search", "GET", { query: "Fixture Film One", types: MOVIE, take: 5 })).toEqual([]);
    expect(validateCall("/search", "GET", { query: "x", take: 100 })).toEqual([]);
    expect(validateCall("/v2/tags", "GET", { "filter.query": "quiet", "feature.semantic_search": true, take: 20 })).toEqual([]);
    expect(validateCall("/entities", "GET", { entity_ids: "[2 ids]" })).toEqual([]);
    expect(validateCall("/v2/insights", "POST", pool())).toEqual([]);
    expect(validateCall("/v2/insights", "GET", { "filter.type": "urn:tag", "signal.interests.entities": "[3 ids]", "filter.parents.types": MOVIE, take: 20 })).toEqual([]);
  });

  it("refuses endpoints outside the four, legacy paths included", () => {
    for (const ep of ["/recommendations", "/recs", "/v2/recs", "/v1/anything"]) {
      expect(has(validateCall(ep, "GET", {}), "not allowed"), ep).toBe(true);
    }
  });

  it("refuses a param the registry does not list for that type", () => {
    expect(has(validateCall("/v2/insights", "POST", pool({ "totally.invented": 1 })), "totally.invented: unknown")).toBe(true);
  });

  it("refuses a param the spike showed is silently ignored", () => {
    expect(has(validateCall("/v2/insights", "POST", pool({ sort_by: "rating" })), "sort_by")).toBe(true);
  });

  it("refuses take above 50 on insights and tags, above 100 on search", () => {
    expect(has(validateCall("/v2/insights", "POST", pool({ take: 51 })), "take")).toBe(true);
    expect(has(validateCall("/v2/tags", "GET", { "filter.query": "x", take: 51 }), "take")).toBe(true);
    expect(has(validateCall("/search", "GET", { query: "x", take: 101 }), "take")).toBe(true);
  });

  it("checks popularity bounds and min <= max", () => {
    expect(has(validateCall("/v2/tags", "GET", { "filter.query": "x", "filter.popularity.max": 1.5 }), "filter.popularity.max")).toBe(true);
    expect(has(validateCall("/v2/tags", "GET", { "filter.query": "x", "filter.popularity.min": 0.8, "filter.popularity.max": 0.2 }), "min must be <= max")).toBe(true);
    expect(validateCall("/v2/tags", "GET", { "filter.query": "x", "filter.popularity.min": 0.2, "filter.popularity.max": 0.8 })).toEqual([]);
  });

  it("requires filter.type, and a supported one", () => {
    expect(has(validateCall("/v2/insights", "POST", { "signal.interests.entities": "[1 ids]", take: 5 }), "filter.type")).toBe(true);
    expect(has(validateCall("/v2/insights", "POST", pool({ "filter.type": "urn:entity:spaceship" })), "filter.type")).toBe(true);
  });

  it("tag params hold ids, never freeform strings", () => {
    expect(has(validateCall("/v2/insights", "POST", pool({ "filter.tags": ["melancholy mood"] })), "filter.tags")).toBe(true);
    expect(has(validateCall("/v2/insights", "POST", pool({ "signal.interests.tags": "melancholy" })), "signal.interests.tags")).toBe(true);
  });

  it("tag insights send only params the registry lists or confirms, and need entity seeds", () => {
    const base = { "filter.type": "urn:tag", "signal.interests.entities": "[2 ids]" };
    expect(has(validateCall("/v2/insights", "GET", { ...base, sort_by: "match" }), "sort_by")).toBe(true);
    expect(has(validateCall("/v2/insights", "GET", { "filter.type": "urn:tag", take: 5 }), "signal.interests.entities")).toBe(true);
  });

  it("checks the HTTP method per endpoint", () => {
    expect(has(validateCall("/v2/insights", "GET", pool()), "must be POST")).toBe(true);
    expect(has(validateCall("/search", "POST", { query: "x" }), "must be GET")).toBe(true);
    expect(has(validateCall("/v2/tags", "POST", { "filter.query": "x" }), "must be GET")).toBe(true);
  });

  it("does not report a validator crash as a pass", () => {
    expect(validateCall("/search", "GET", { query: 5 as unknown as string }).length).toBeGreaterThan(0);
  });
});

describe("param-validity scorer", () => {
  it("passes valid qloo_call and query_insights events", () => {
    const r = score([
      callEv("/search", "GET", { query: "Fixture Film One", types: MOVIE, take: 5 }),
      callEv("/v2/insights", "POST", pool(), { entityType: MOVIE }),
      { t: T, say: "x", kind: "query_insights", domain: "film", endpoint: "/v2/insights", params: pool(), resultCount: 20, explainability: false, primaryCount: 0, backfillCount: 0 },
    ]);
    expect(r).toMatchObject({ pass: true });
  });

  it("fails an invalid param in a qloo_call and names the event", () => {
    const r = score([callEv("/search", "GET", { query: "x" }), callEv("/v2/insights", "POST", pool({ bogus: 1 }))]);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("event 2");
    expect(r.reasons[0]).toContain("bogus");
  });

  it("fails an invalid param in a query_insights event", () => {
    const r = score([{ t: T, say: "x", kind: "query_insights", domain: "film", endpoint: "/v2/insights", params: pool({ bogus: 1 }), resultCount: 20, explainability: false, primaryCount: 0, backfillCount: 0 }]);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("query_insights");
  });

  it("does not count an empty 200 on insights or tags as success, but an empty search is a missing seed", () => {
    const empty = { outcome: "empty", resultCount: 0 };
    expect(score([callEv("/v2/insights", "POST", pool(), empty)]).pass).toBe(false);
    expect(score([callEv("/v2/tags", "GET", { "filter.query": "x" }, empty)]).pass).toBe(false);
    expect(score([callEv("/search", "GET", { query: "x" }, empty)]).pass).toBe(true);
  });

  it("a call the client refused still fails when its params were invalid", () => {
    const r = score([callEv("/v2/insights", "POST", pool({ bogus: 1 }), { cached: false, source: "none", outcome: "error", errorKind: "param_invalid", status: undefined })]);
    expect(r.pass).toBe(false);
  });
});
