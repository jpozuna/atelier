import { describe, expect, it } from "vitest";
import { POOL_POPULARITY_MAX, POOL_TAKE } from "@/lib/agent/config";
import { POST_BODY, REGISTRY } from "@/lib/qloo/registry";
import { prepareInsights } from "@/lib/qloo/validate";
import { FIELDS } from "@/types";
import type { Field, TraceEvent } from "@/types";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { buildPool, FrontierInputError, redactForTrace, seedSignals, toCandidate } from "./index";
import { entity, fakeInsights, id, profileOf, profileTag, seedOf, tg, threeSeeds, whyTagOf } from "./fixtures";
import type { FrontierContext } from "./types";

const ctxOf = (seeds = threeSeeds()): FrontierContext => ({
  profile: profileOf([profileTag(1, 0.9, { fields: ["music"] }), profileTag(2, 0.8, { fields: ["film"] })], seeds.map((s) => s.id)),
  seeds,
});

describe("buildPool: one call, the intended params", () => {
  it("makes exactly ONE insights call with take=POOL_TAKE, the popularity ceiling, explainability and every exclusion", async () => {
    const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1] })]);
    const shown = [id(200), id(201)];
    const pool = await buildPool("film", ctxOf(), { entityIds: shown }, { insights: fake.fn });
    expect(fake.calls).toHaveLength(1);
    const { params, purpose } = fake.calls[0]!;
    expect(purpose).toBe("picks");
    expect(params["filter.type"]).toBe("urn:entity:movie");
    expect(params.take).toBe(POOL_TAKE);
    expect(params["filter.popularity.max"]).toBe(POOL_POPULARITY_MAX);
    expect(params["feature.explainability"]).toBe(true);
    const excluded = params["filter.exclude.entities"] as string[];
    for (const s of threeSeeds()) expect(excluded).toContain(s.qlooId);
    for (const s of shown) expect(excluded).toContain(s);
    expect(new Set(excluded).size).toBe(excluded.length);
    expect(Object.keys(params).sort()).toEqual(["feature.explainability", "filter.exclude.entities", "filter.popularity.max", "filter.type", "signal.interests.entities", "take"]);
    expect(pool.sentSeedIds).toEqual(threeSeeds().map((s) => s.qlooId));
  });

  it("the popularity ceiling can be tightened for a re-query", async () => {
    const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1] })]);
    const pool = await buildPool("film", ctxOf(), { entityIds: [] }, { insights: fake.fn }, { popularityMax: 0.4 });
    expect(fake.calls[0]!.params["filter.popularity.max"]).toBe(0.4);
    expect(pool.popularityMax).toBe(0.4);
  });

  it("sends only params the registry lists for every one of the six types, once the body gate is open", async () => {
    const gateOpen = { ...REGISTRY, post: { ...POST_BODY, confirmedBodyParams: ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"] } };
    for (const field of FIELDS) {
      const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1] })]);
      await buildPool(field, ctxOf(), { entityIds: [id(300)] }, { insights: fake.fn });
      const { params } = fake.calls[0]!;
      expect(() => prepareInsights(params, gateOpen, { purpose: "picks" })).not.toThrow();
      expect(params["filter.type"]).toBe(FIELD_SEARCH_TYPE[field]);
    }
  });

  it("passes the real registry with no issues now the body gate is open, and is refused for the body params only on a closed copy", async () => {
    const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1] })]);
    await buildPool("film", ctxOf(), { entityIds: [] }, { insights: fake.fn });
    const params = fake.calls[0]!.params;
    expect(() => prepareInsights(params, REGISTRY, { purpose: "picks" })).not.toThrow();

    // The refusal path stays tested on a copy with nothing confirmed: only the three body params are refused, nothing else.
    const closed = { ...REGISTRY, post: { ...POST_BODY, confirmedBodyParams: [] as string[] } };
    let issues: string[] = [];
    try {
      prepareInsights(params, closed, { purpose: "picks" });
    } catch (e) {
      issues = ((e as { issues?: { param: string; reason: string }[] }).issues ?? []).map((i) => `${i.param}:${i.reason}`);
    }
    expect(issues.sort()).toEqual(["feature.explainability:body_unconfirmed", "filter.exclude.entities:body_unconfirmed", "filter.popularity.max:body_unconfirmed"]);
  });

  it("emits a query_insights trace event with no ids in the params", async () => {
    const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1], explain: [[1, 0.5]] }), entity({ n: 101, tags: [1] })]);
    const seen: TraceEvent[] = [];
    const pool = await buildPool("film", ctxOf(), { entityIds: [id(200)] }, { insights: fake.fn, emit: (e) => seen.push(e), now: () => new Date("2026-10-19T00:00:00Z") });
    expect(seen).toHaveLength(1);
    const ev = seen[0]!;
    expect(pool.events).toEqual(seen);
    if (ev.kind !== "query_insights") throw new Error("wrong kind");
    expect(ev.domain).toBe("film");
    expect(ev.endpoint).toBe("/v2/insights");
    expect(ev.resultCount).toBe(2);
    expect(ev.explainability).toBe(true);
    // Qloo marks no backfill, so nothing is derived: unknown counts as neither.
    expect(ev.primaryCount).toBe(0);
    expect(ev.backfillCount).toBe(0);
    expect(ev.params["signal.interests.entities"]).toBe("[3 ids]");
    expect(ev.params["filter.exclude.entities"]).toBe("[4 ids]");
    expect(JSON.stringify(ev.params)).not.toContain("00000000-0000");
  });
});

describe("buildPool: seeds", () => {
  it("weights seeds on the axis being explored up and the rest down, and still sends them all", () => {
    const ctx = ctxOf();
    // Tag 1 is carried by music seeds only (fields: music).
    const sig = seedSignals(ctx.seeds, ctx.profile.tags, [tg(1)]);
    expect(sig).toHaveLength(3);
    const w = Object.fromEntries(sig.map((s) => [s.id, s.weight]));
    expect(w[id(1)]).toBeGreaterThan(w[id(3)]!);
    expect(w[id(1)]).toBe(w[id(2)]);
  });

  it("weighs every seed the same with no focus, or when no seed sits on the focus tags", () => {
    const ctx = ctxOf();
    expect(new Set(seedSignals(ctx.seeds, ctx.profile.tags).map((s) => s.weight)).size).toBe(1);
    const lonely = [profileTag(9, 0.5, { fields: ["books"] })];
    expect(new Set(seedSignals(ctx.seeds, lonely, [tg(9)]).map((s) => s.weight)).size).toBe(1);
  });

  it("a seed carrying a focus tag through its own why counts as on the axis", () => {
    const seeds = [seedOf(1, "music", { whyTags: [whyTagOf(5)] }), seedOf(2, "film")];
    const tags = [profileTag(5, 0.4, { fields: [] })];
    const w = Object.fromEntries(seedSignals(seeds, tags, [tg(5)]).map((s) => [s.id, s.weight]));
    expect(w[id(1)]).toBeGreaterThan(w[id(2)]!);
  });

  it("sends only resolved seeds and excludes them, and throws when none is resolved", async () => {
    const seeds = [seedOf(1, "music"), seedOf(2, "film", { qlooId: null, status: "missing" })];
    const fake = fakeInsights([entity({ n: 100, popularity: 0.3, tags: [1] })]);
    await buildPool("film", ctxOf(seeds), { entityIds: [] }, { insights: fake.fn });
    expect((fake.calls[0]!.params["signal.interests.entities"] as { id: string }[]).map((s) => s.id)).toEqual([id(1)]);
    const none = fakeInsights([]);
    await expect(buildPool("film", ctxOf([seedOf(2, "film", { qlooId: null, status: "missing" })]), { entityIds: [] }, { insights: none.fn })).rejects.toBeInstanceOf(FrontierInputError);
    expect(none.calls).toHaveLength(0);
  });

  it("rejects an unknown domain without calling", async () => {
    const fake = fakeInsights([]);
    await expect(buildPool("architecture" as Field, ctxOf(), { entityIds: [] }, { insights: fake.fn })).rejects.toMatchObject({ code: "bad_domain" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("buildPool: normalising results", () => {
  it("maps an insights entity to a Candidate with origin unknown and the literal explainability key", () => {
    const c = toCandidate(entity({ n: 100, popularity: 0.31, tags: [1, 2, 1], affinity: 0.7, explain: [[1, 0.4], [2, 0.1]] }), "film")!;
    expect(c).toMatchObject({ qlooId: id(100), field: "film", entityType: "urn:entity:movie", popularity: 0.31, affinity: 0.7, origin: "unknown" });
    expect(c.tags.map((t) => t.id)).toEqual([tg(1), tg(2)]);
    expect(c.explainability).toEqual([
      { entityId: id(1), score: 0.4 },
      { entityId: id(2), score: 0.1 },
    ]);
  });

  it("treats missing popularity as 0 (unknown) and skips items with no id or name", () => {
    expect(toCandidate(entity({ n: 100, tags: [1] }), "fashion")!.popularity).toBe(0);
    expect(toCandidate({ entity_id: "", name: "x" }, "film")).toBeNull();
    expect(toCandidate({ entity_id: id(1) }, "film")).toBeNull();
  });

  it("collects lineage names from the properties, as names only", () => {
    const c = toCandidate(entity({ n: 100, tags: [1], properties: { influenced_by: ["Invented A", { name: "Invented B" }], similar_brands: "Invented C" } }), "music")!;
    expect(c.lineage).toEqual(["Invented A", "Invented B", "Invented C"]);
  });

  it("drops excluded ids that come back, duplicates and malformed items, and counts them", async () => {
    const fake = fakeInsights([
      entity({ n: 100, popularity: 0.3, tags: [1] }),
      entity({ n: 100, popularity: 0.3, tags: [1] }),
      entity({ n: 1, popularity: 0.3, tags: [1] }),
      entity({ n: 200, popularity: 0.3, tags: [1] }),
      { entity_id: id(150) },
    ]);
    const pool = await buildPool("film", ctxOf(), { entityIds: [id(200)] }, { insights: fake.fn });
    expect(pool.candidates.map((c) => c.qlooId)).toEqual([id(100)]);
    expect(pool.droppedExcluded).toBe(2);
    expect(pool.droppedMalformed).toBe(1);
    expect(pool.returned).toBe(5);
  });

  it("reports an empty result as empty, never as a success", async () => {
    const pool = await buildPool("film", ctxOf(), { entityIds: [] }, { insights: fakeInsights([]).fn });
    expect(pool.outcome).toBe("empty");
    expect(pool.candidates).toEqual([]);
  });

  it("redactForTrace turns id lists into counts and keeps scalars", () => {
    expect(redactForTrace({ "filter.type": "urn:entity:movie", take: 50, "filter.exclude.entities": ["a", "b"] })).toEqual({
      "filter.exclude.entities": "[2 ids]",
      "filter.type": "urn:entity:movie",
      take: 50,
    });
  });
});
