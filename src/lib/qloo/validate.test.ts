import { describe, expect, it } from "vitest";
import { QlooParamError } from "./errors";
import { REGISTRY, SEARCH_ENDPOINT, type Registry } from "./registry";
import { prepareEntities, prepareInsights, prepareSearch, prepareTags, prepareTasteAnalysis, encodeQuery } from "./validate";
import { id, tagId } from "./testing";

const MOVIE = "urn:entity:movie";
const BOOK = "urn:entity:book";
const seeds = [{ id: id(1), weight: 2 }, { id: id(2) }];

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof QlooParamError) return e.issues;
    throw e;
  }
  return [];
}

/** A registry copy in which the manager has recorded the POST check. Never mutates the real one. */
const withBody = (...params: string[]): Registry => ({ ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: params } });

describe("prepareInsights", () => {
  it("accepts baseline body params and defaults seed weights to 1", () => {
    const req = prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, take: 20 });
    expect(req.method).toBe("POST");
    expect(req.params["signal.interests.entities"]).toEqual([{ id: id(1), weight: 2 }, { id: id(2), weight: 1 }]);
  });

  it("requires filter.type and refuses other types", () => {
    expect(issuesOf(() => prepareInsights({ take: 5 })).map((i) => i.reason)).toContain("missing_required");
    expect(issuesOf(() => prepareInsights({ "filter.type": "urn:entity:music" }))[0].reason).toBe("bad_value");
    expect(issuesOf(() => prepareInsights({ "filter.type": "urn:tag", "signal.interests.entities": seeds }))[0].detail).toContain("tasteAnalysis");
  });

  it("refuses params that are not in the registry for the type", () => {
    const issues = issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, "filter.invented": 1 }));
    expect(issues).toEqual([expect.objectContaining({ param: "filter.invented", reason: "unknown" })]);
    // movie-only confirmation does not carry to book
    expect(issuesOf(() => prepareInsights({ "filter.type": BOOK, "signal.interests.entities": seeds, "operator.signal.interests.tags": "union" }))[0].reason).toBe("unknown");
  });

  it("refuses ignored and rejected params", () => {
    expect(issuesOf(() => prepareInsights({ "filter.type": BOOK, "signal.interests.entities": seeds, "bias.trends": "off" }))[0].reason).toBe("rejected");
    expect(issuesOf(() => prepareInsights({ "filter.type": BOOK, "signal.interests.entities": seeds, "bias.content_based": 1 }))[0].reason).toBe("ignored");
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, sort_by: "rating" }))[0].reason).toBe("ignored");
    expect(issuesOf(() => prepareInsights({ "filter.type": "urn:entity:place", "signal.interests.entities": seeds, sort_by: "rating" }))[0].reason).toBe("ignored");
  });

  it("restricts filter.exists to properties.image", () => {
    const reg = withBody("filter.exists");
    const ok = (v: string) => issuesOf(() => prepareInsights({ "filter.type": "urn:entity:artist", "signal.interests.entities": seeds, "filter.exists": v }, reg));
    expect(ok("properties.image")).toEqual([]);
    expect(ok("properties.description")[0].reason).toBe("bad_value");
  });

  it("refuses body-borne filters by default (pending the 04-post-check)", () => {
    for (const p of [
      { "filter.popularity.max": 0.6 },
      { "filter.exclude.entities": [id(3)] },
      { "feature.explainability": true },
    ]) {
      const issues = issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, ...p }));
      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toBe("body_unconfirmed");
    }
  });

  it("allows body-borne filters once the manager records them", () => {
    const reg = withBody("filter.popularity.max", "filter.exclude.entities", "feature.explainability");
    const req = prepareInsights(
      { "filter.type": MOVIE, "signal.interests.entities": seeds, "filter.popularity.max": 0.6, "filter.exclude.entities": [id(3)], "feature.explainability": true, take: 50 },
      reg,
    );
    expect(req.params["filter.popularity.max"]).toBe(0.6);
    // a recorded param is still validated against the type registry
    expect(issuesOf(() => prepareInsights({ "filter.type": BOOK, "signal.interests.entities": seeds, "bias.trends": "off" }, withBody("bias.trends")))[0].reason).toBe("rejected");
  });

  it("drops empty arrays so an empty exclude list does not trip the gate", () => {
    const req = prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, "filter.exclude.entities": [] });
    expect(req.params["filter.exclude.entities"]).toBeUndefined();
  });

  it("checks values", () => {
    const reg = withBody("filter.popularity.max", "filter.popularity.min", "signal.interests.tags", "filter.exclude.entities", "offset");
    const base = { "filter.type": MOVIE, "signal.interests.entities": seeds };
    expect(issuesOf(() => prepareInsights({ ...base, take: 51 }))[0].param).toBe("take");
    expect(issuesOf(() => prepareInsights({ ...base, take: 0 }))[0].param).toBe("take");
    expect(issuesOf(() => prepareInsights({ ...base, "filter.popularity.max": 1.2 }, reg))[0].param).toBe("filter.popularity.max");
    expect(issuesOf(() => prepareInsights({ ...base, "filter.popularity.min": 0.9, "filter.popularity.max": 0.2 }, reg)).some((i) => i.detail.includes("min must be"))).toBe(true);
    expect(issuesOf(() => prepareInsights({ ...base, offset: -1 }, reg))[0].param).toBe("offset");
    expect(issuesOf(() => prepareInsights({ ...base, "signal.interests.tags": ["freeform theme"] }, reg))[0].reason).toBe("not_an_id");
    expect(issuesOf(() => prepareInsights({ ...base, "signal.interests.tags": [tagId(1)] }, reg))).toEqual([]);
    expect(issuesOf(() => prepareInsights({ ...base, "filter.exclude.entities": ["not-a-uuid"] }, reg))[0].reason).toBe("not_an_id");
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": [{ id: "Some Title" }] }))[0].reason).toBe("not_an_id");
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": [{ id: id(1), weight: -1 }] }))[0].reason).toBe("bad_value");
  });

  it("requires seeds for destination", () => {
    const issues = issuesOf(() => prepareInsights({ "filter.type": "urn:entity:destination", take: 5 }));
    expect(issues.map((i) => i.reason)).toContain("missing_required");
  });

  it("reports every issue at once", () => {
    const issues = issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, a: 1, b: 2 }));
    expect(issues).toHaveLength(2);
  });
});

describe("prepareTasteAnalysis", () => {
  it("defaults to GET with ids only and forces filter.type=urn:tag", () => {
    const req = prepareTasteAnalysis({ "signal.interests.entities": [id(1), { id: id(2) }], "filter.parents.types": [MOVIE], take: 50 });
    expect(req.method).toBe("GET");
    expect(req.params["filter.type"]).toBe("urn:tag");
    expect(req.params["signal.interests.entities"]).toEqual([id(1), id(2)]);
  });

  it("needs entity seeds", () => {
    expect(issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [] }))[0].reason).toBe("missing_required");
  });

  it("refuses params outside the tag registry and non-entity parent types", () => {
    expect(issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [id(1)], "signal.interests.tags": [tagId(1)] }))[0].reason).toBe("unknown");
    expect(issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [id(1)], "filter.parents.types": ["movie"] }))[0].reason).toBe("bad_value");
  });

  it("refuses per-seed weights on GET and gates POST", () => {
    expect(issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [{ id: id(1), weight: 3 }] }))[0].detail).toContain("POST");
    const post = issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [id(1)], "filter.tag.types": ["urn:tag:genre:media"] }, "POST"));
    expect(post.map((i) => i.reason)).toEqual(["body_unconfirmed"]);
  });
});

describe("prepareSearch, prepareTags, prepareEntities", () => {
  it("validates search", () => {
    expect(prepareSearch({ query: "an invented title", types: ["urn:entity:movie"], take: 5 }).method).toBe("GET");
    expect(issuesOf(() => prepareSearch({ query: "  " }))[0].reason).toBe("missing_required");
    expect(issuesOf(() => prepareSearch({ query: "x", take: 101 }))[0].param).toBe("take");
    expect(issuesOf(() => prepareSearch({ query: "x", types: ["urn:entity:destination"] }))[0].param).toBe("types");
    expect(issuesOf(() => prepareSearch({ query: "x", bogus: 1 }))[0].reason).toBe("unknown");
    expect(issuesOf(() => prepareSearch({ query: "x", "filter.radius": 500 }))[0].param).toBe("filter.radius");
  });

  it("validates tags", () => {
    expect(prepareTags({ "filter.query": "quiet dread", "feature.semantic_search": true, take: 20 }).method).toBe("GET");
    expect(issuesOf(() => prepareTags({ "feature.semantic_search": true }))[0].reason).toBe("missing_required");
    expect(issuesOf(() => prepareTags({ "filter.query": "x", take: 51 }))[0].param).toBe("take");
    expect(issuesOf(() => prepareTags({ "filter.query": "x", "filter.type": MOVIE }))[0].reason).toBe("unknown");
  });

  it("validates entities", () => {
    expect(prepareEntities({ entity_ids: [id(1), id(2)] }).params.entity_ids).toEqual([id(1), id(2)]);
    expect(issuesOf(() => prepareEntities({}))[0].reason).toBe("missing_required");
    expect(issuesOf(() => prepareEntities({ entity_ids: ["x"] }))[0].reason).toBe("not_an_id");
  });
});

describe("encodeQuery", () => {
  it("sorts keys, joins arrays and keeps the key out", () => {
    const q = encodeQuery({ take: 5, "filter.type": MOVIE, entity_ids: [id(1), id(2)], flag: true });
    expect(q).toBe(new URLSearchParams([["entity_ids", `${id(1)},${id(2)}`], ["filter.type", MOVIE], ["flag", "true"], ["take", "5"]]).toString());
  });
});

describe("Atelier allowlist on entity insights", () => {
  const reg = withBody("operator.exclude.tags", "operator.filter.exclude.tags", "filter.parents.types", "filter.external.exists", "operator.filter.external.exists", "filter.results.entities.query", "bias.trends", "signal.demographics.age", "signal.demographics.audiences", "signal.demographics.audiences.weight", "signal.demographics.gender");
  const refused: [string, string | number][] = [
    ["operator.exclude.tags", "union"],
    ["operator.filter.exclude.tags", "union"],
    ["filter.parents.types", "urn:entity:movie"],
    ["filter.external.exists", "imdb"],
    ["operator.filter.external.exists", "union"],
    ["filter.results.entities.query", "something"],
    ["signal.demographics.age", "25_to_29"],
    ["signal.demographics.audiences", "x"],
    ["signal.demographics.audiences.weight", 1],
    ["signal.demographics.gender", "female"],
  ];
  for (const type of ["urn:entity:movie", "urn:entity:artist", "urn:entity:place", "urn:entity:brand"]) {
    it(`refuses the listed params on ${type}, even with the body gate open`, () => {
      for (const [k, val] of refused) {
        const issues = issuesOf(() => prepareInsights({ "filter.type": type, "signal.interests.entities": seeds, [k]: val }, reg));
        expect(issues.length, k).toBeGreaterThan(0);
        expect(issues.every((i) => i.param === k && ["atelier_refused", "unknown", "ignored"].includes(i.reason)), k).toBe(true);
      }
    });
    it(`refuses bias.trends on ${type}`, () => {
      expect(issuesOf(() => prepareInsights({ "filter.type": type, "signal.interests.entities": seeds, "bias.trends": "off" }, reg))[0]).toMatchObject({ param: "bias.trends" });
    });
  }

  it("names the Atelier reason for params the registry lists", () => {
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, "bias.trends": "off" }, reg))[0].reason).toBe("atelier_refused");
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": seeds, "filter.parents.types": "urn:entity:movie" }, reg))[0].reason).toBe("atelier_refused");
  });

  it("keeps filter.parents.types for urn:tag and /v2/tags", () => {
    expect(prepareTasteAnalysis({ "signal.interests.entities": [id(1)], "filter.parents.types": [MOVIE] }).params["filter.parents.types"]).toEqual([MOVIE]);
    expect(prepareTags({ "filter.query": "x", "filter.parents.types": [MOVIE] }).params["filter.parents.types"]).toEqual([MOVIE]);
  });
});

describe("purpose: picks", () => {
  const base = { "filter.type": MOVIE, "signal.interests.entities": [{ id: id(1) }, { id: id(2) }] };
  const open = withBody("filter.exclude.entities");

  it("requires every seed in filter.exclude.entities", () => {
    expect(issuesOf(() => prepareInsights(base, open, { purpose: "picks" }))[0]).toMatchObject({ param: "filter.exclude.entities", reason: "missing_required" });
    expect(issuesOf(() => prepareInsights({ ...base, "filter.exclude.entities": [id(1)] }, open, { purpose: "picks" }))[0].reason).toBe("missing_required");
    expect(issuesOf(() => prepareInsights({ ...base, "filter.exclude.entities": [id(1), id(2), id(3)] }, open, { purpose: "picks" }))).toEqual([]);
  });

  it("does not apply to other purposes", () => {
    expect(issuesOf(() => prepareInsights(base, open))).toEqual([]);
    expect(issuesOf(() => prepareInsights(base, open, { purpose: "other" }))).toEqual([]);
  });

  it("is checked while the body param is still gated", () => {
    // gate closed, exclude missing: the purpose check still fires
    expect(issuesOf(() => prepareInsights(base, REGISTRY, { purpose: "picks" })).map((i) => i.reason)).toEqual(["missing_required"]);
    // gate closed, exclude present: refused by the gate, not by the purpose check
    expect(issuesOf(() => prepareInsights({ ...base, "filter.exclude.entities": [id(1), id(2)] }, REGISTRY, { purpose: "picks" })).map((i) => i.reason)).toEqual(["body_unconfirmed"]);
  });

  it("accepts seeds given as plain ids", () => {
    expect(issuesOf(() => prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": [id(1)] as unknown as [], "filter.exclude.entities": [id(1)] }, open, { purpose: "picks" }))).toEqual([]);
  });
});

describe("seed dedupe", () => {
  it("sends a repeated seed once, with its largest weight", () => {
    const req = prepareInsights({ "filter.type": MOVIE, "signal.interests.entities": [{ id: id(1), weight: 2 }, { id: id(2) }, { id: id(1), weight: 5 }, { id: id(1), weight: 1 }] });
    expect(req.params["signal.interests.entities"]).toEqual([{ id: id(1), weight: 5 }, { id: id(2), weight: 1 }]);
  });
  it("dedupes ids in id lists and for taste analysis on GET", () => {
    expect(prepareTasteAnalysis({ "signal.interests.entities": [id(1), id(1), { id: id(2) }] }).params["signal.interests.entities"]).toEqual([id(1), id(2)]);
    expect(prepareEntities({ entity_ids: [id(1), id(1)] }).params.entity_ids).toEqual([id(1)]);
  });
});

describe("/search and /v2/tags extra checks", () => {
  it("restricts types to the six Atelier types", () => {
    for (const t of ["urn:entity:artist", "urn:entity:movie", "urn:entity:tv_show", "urn:entity:book", "urn:entity:place", "urn:entity:brand"]) {
      expect(prepareSearch({ query: "x", types: [t] }).params.types).toEqual([t]);
    }
    for (const t of ["urn:entity:person", "urn:entity:podcast", "urn:entity:videogame", "urn:entity:locality", "urn:entity:destination", "urn:entity:actor"]) {
      expect(issuesOf(() => prepareSearch({ query: "x", types: [t] }))[0].param, t).toBe("types");
    }
  });

  it("range-checks filter.popularity and filter.rating", () => {
    expect(prepareSearch({ query: "x", "filter.popularity": 0.5, "filter.rating": 0 }).params["filter.rating"]).toBe(0);
    expect(issuesOf(() => prepareSearch({ query: "x", "filter.popularity": 1.5 }))[0].param).toBe("filter.popularity");
    expect(issuesOf(() => prepareSearch({ query: "x", "filter.popularity": -0.1 }))[0].param).toBe("filter.popularity");
    expect(issuesOf(() => prepareSearch({ query: "x", "filter.rating": 5 }))[0].param).toBe("filter.rating");
    expect(issuesOf(() => prepareSearch({ query: "x", "filter.rating": "high" as unknown as number }))[0].param).toBe("filter.rating");
  });

  it("has no duplicate search params", () => {
    expect(new Set(SEARCH_ENDPOINT.params).size).toBe(SEARCH_ENDPOINT.params.length);
  });

  it("requires a non-empty trimmed filter.query for semantic search", () => {
    for (const q of [undefined, "", "   "]) {
      expect(issuesOf(() => prepareTags({ "feature.semantic_search": true, "filter.query": q }))[0].reason).toBe("missing_required");
    }
    expect(prepareTags({ "feature.semantic_search": true, "filter.query": " quiet dread " }).method).toBe("GET");
  });

  it("validates filter.tag.types as urn:tag:<kind>:<ns>", () => {
    expect(prepareTags({ "filter.query": "x", "filter.tag.types": ["urn:tag:genre:media", "urn:tag:keyword:media"] }).method).toBe("GET");
    for (const bad of ["genre", "urn:tag:genre", "urn:tag:fixture:media:extra", "urn:entity:movie", "urn:tag:genre: media"]) {
      expect(issuesOf(() => prepareTags({ "filter.query": "x", "filter.tag.types": [bad] }))[0], bad).toMatchObject({ param: "filter.tag.types", reason: "bad_value" });
      expect(issuesOf(() => prepareTasteAnalysis({ "signal.interests.entities": [id(1)], "filter.tag.types": [bad] }))[0].param, bad).toBe("filter.tag.types");
    }
  });
});
