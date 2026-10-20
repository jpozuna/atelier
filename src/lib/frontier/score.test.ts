import { describe, expect, it } from "vitest";
import { CONNECTION_FLOOR, DISTINCTIVE_RARITY, MIN_ANCHOR_CONTRIBUTION, MIN_PICKS_PER_FIELD, REACH_WEIGHTS } from "@/lib/agent/config";
import { isPath } from "@/types";
import type { PathHop, ProfileTag } from "@/types";
import { buildPool, scorePool, tagRarity, withPoolRarity } from "./index";
import type { FrontierContext, ScoredPool } from "./index";
import { entity, fakeInsights, id, profileOf, profileTag, seedOf, tg, threeSeeds, tieredPool, whyTagOf } from "./fixtures";
import type { EntitySpec } from "./fixtures";
import { LINEAGE_CONNECTION_WEIGHT } from "./constants";

async function scoreOf(specs: EntitySpec[], ctx: FrontierContext, domain: "film" | "music" | "fashion" = "film", lineage?: Map<string, PathHop>): Promise<ScoredPool> {
  const fake = fakeInsights(specs.map(entity));
  const pool = await buildPool(domain, ctx, { entityIds: [] }, { insights: fake.fn });
  return scorePool(pool, ctx, { lineage });
}

const ctxWith = (tags: ProfileTag[], seeds = threeSeeds()): FrontierContext => ({ profile: profileOf(tags, seeds.map((s) => s.id)), seeds });
const byN = (s: ScoredPool, n: number) => s.scored.find((x) => x.candidate.qlooId === id(n))!;

describe("rarity", () => {
  it("is 1 minus the share of the pool that carries the tag", () => {
    const { items } = tieredPool();
    const pool = items.map((i) => ({ qlooId: i.entity_id, name: "", field: "film" as const, entityType: "", popularity: 0, origin: "unknown" as const, tags: (i.tags ?? []).map((t) => ({ id: t.id!, name: "", type: "" })) }));
    const r = tagRarity(pool);
    expect(r.get(tg(3))).toBeCloseTo(0.5, 10); // tiers 0 and 1
    expect(r.get(tg(1))).toBeCloseTo(0.75, 10);
    expect(r.get(tg(6))).toBeCloseTo(0.75, 10);
  });

  it("withPoolRarity fills ProfileTag.rarity without mutating the profile", async () => {
    const { ctx, items } = tieredPool();
    const pool = await buildPool("film", ctx, { entityIds: [] }, { insights: fakeInsights(items).fn });
    const scored = scorePool(pool, ctx);
    const out = withPoolRarity(ctx.profile.tags, scored.tagRarity);
    expect(out.find((t) => t.tag === tg(3))!.rarity).toBeCloseTo(0.5, 10);
    expect(ctx.profile.tags.every((t) => t.rarity === undefined)).toBe(true);
  });
});

describe("reach", () => {
  const ctx = ctxWith([profileTag(1, 0.9), profileTag(2, 0.1)]);

  it("is the weighted sum of tag distance, pool-ranked obscurity and field unfamiliarity", async () => {
    const s = await scoreOf(
      [
        { n: 100, popularity: 0.5, tags: [1] },
        { n: 101, popularity: 0.3, tags: [2] },
        { n: 102, popularity: 0.1, tags: [] },
      ],
      ctx,
    );
    const a = byN(s, 100);
    expect(a.reach.tagDistance).toBeCloseTo(1 - 0.9, 10);
    // Most popular of three: percentile (2 + .5) / 3.
    expect(a.reach.obscurity).toBeCloseTo(1 - 2.5 / 3, 10);
    expect(a.reach.fieldUnfamiliarity).toBeCloseTo(1 - 1 / 3, 10);
    expect(a.reach.reach).toBeCloseTo(REACH_WEIGHTS.tagDistance * a.reach.tagDistance + REACH_WEIGHTS.obscurity * a.reach.obscurity + REACH_WEIGHTS.fieldUnfamiliarity * a.reach.fieldUnfamiliarity, 10);
  });

  it("ranks popularity within the pool: bunched values do not spread, and only the order matters", async () => {
    const bunched = await scoreOf([100, 101, 102].map((n) => ({ n, popularity: 0.99, tags: [1] })), ctx);
    expect(new Set(bunched.scored.map((x) => x.reach.obscurity)).size).toBe(1);
    const a = await scoreOf([{ n: 100, popularity: 0.5, tags: [1] }, { n: 101, popularity: 0.4, tags: [1] }], ctx);
    const b = await scoreOf([{ n: 100, popularity: 0.99, tags: [1] }, { n: 101, popularity: 0.01, tags: [1] }], ctx);
    expect(byN(a, 100).reach.obscurity).toBeCloseTo(byN(b, 100).reach.obscurity, 10);
  });

  it("treats popularity 0 as unknown: neutral obscurity, and it does not shift the ranking of the rest", async () => {
    const withUnknown = await scoreOf([{ n: 100, popularity: 0.5, tags: [1] }, { n: 101, popularity: 0.1, tags: [1] }, { n: 102, tags: [1] }, { n: 103, popularity: 0, tags: [1] }], ctx, "fashion");
    const without = await scoreOf([{ n: 100, popularity: 0.5, tags: [1] }, { n: 101, popularity: 0.1, tags: [1] }], ctx, "fashion");
    expect(byN(withUnknown, 102).reach.obscurity).toBe(0.5);
    expect(byN(withUnknown, 103).reach.obscurity).toBe(0.5);
    expect(byN(withUnknown, 102).popularityRank).toBeNull();
    expect(byN(withUnknown, 100).reach.obscurity).toBeCloseTo(byN(without, 100).reach.obscurity, 10);
  });

  it("a field the user has no seed in is fully unfamiliar, and a field full of seeds is familiar", async () => {
    const books = await scoreOf([{ n: 100, popularity: 0.3, tags: [1], subtype: "urn:entity:book" }], ctx, "film");
    expect(byN(books, 100).reach.fieldUnfamiliarity).toBeCloseTo(2 / 3, 10);
    const none = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }], ctx, "fashion");
    expect(byN(none, 100).reach.fieldUnfamiliarity).toBe(1);
  });

  it("tag distance ignores profile tags that cannot apply to the candidate's type", async () => {
    const tags = [profileTag(1, 0.5, { types: ["urn:entity:movie"] }), profileTag(2, 0.5, { types: ["urn:entity:book"] })];
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }], ctxWith(tags));
    // Only tag 1 can apply to a movie, and the candidate has it.
    expect(byN(s, 100).reach.tagDistance).toBe(0);
  });
});

describe("connection and the floor", () => {
  it("a shared rare tag clears the floor and gets a path", async () => {
    const ctx = ctxWith([profileTag(1, 0.8)]);
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }, { n: 101, popularity: 0.3, tags: [] }, { n: 102, popularity: 0.3, tags: [] }, { n: 103, popularity: 0.3, tags: [] }], ctx);
    const c = byN(s, 100);
    expect(c.connection).toBeCloseTo(0.8 * 0.75, 10);
    expect(c.path!.distinctive).toBe(true);
    expect(c.clearsFloor).toBe(true);
    expect(c.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
  });

  it("cross-domain presence alone is never connection: no shared tag, no path, never cleared", async () => {
    const ctx = ctxWith([profileTag(1, 0.9)]);
    const s = await scoreOf([{ n: 100, popularity: 0.1, tags: [], affinity: 0.99 }, { n: 101, popularity: 0.3, tags: [1] }], ctx, "fashion");
    const c = byN(s, 100);
    expect(c.connection).toBe(0);
    expect(c.path).toBeNull();
    expect(c.clearsFloor).toBe(false);
  });

  it("a shared tag every candidate carries has rarity 0 and adds nothing", async () => {
    const ctx = ctxWith([profileTag(1, 0.9)]);
    const s = await scoreOf([100, 101, 102].map((n) => ({ n, popularity: 0.3, tags: [1] })), ctx);
    for (const c of s.scored) {
      expect(c.connection).toBe(0);
      expect(c.path).toBeNull();
      expect(c.clearsFloor).toBe(false);
    }
  });

  it("strong overlap with only generic tags cannot clear the floor: no distinctive path", async () => {
    const ctx = ctxWith([profileTag(1, 0.9), profileTag(2, 0.9), profileTag(3, 0.9)]);
    // Half the pool carries tags 1 to 3: rarity .5, below DISTINCTIVE_RARITY.
    expect(0.5).toBeLessThan(DISTINCTIVE_RARITY);
    const s = await scoreOf(
      [
        { n: 100, popularity: 0.3, tags: [1, 2, 3] },
        { n: 101, popularity: 0.3, tags: [1, 2, 3] },
        { n: 102, popularity: 0.3, tags: [] },
        { n: 103, popularity: 0.3, tags: [] },
      ],
      ctx,
    );
    const c = byN(s, 100);
    expect(c.connection).toBe(1);
    expect(c.path!.distinctive).toBe(false);
    expect(c.clearsFloor).toBe(false);
  });

  it("a distinctive tag with too little weight stays under the floor, and the floor is never lowered to fit it", async () => {
    const ctx = ctxWith([profileTag(1, 0.2)]);
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }, ...[101, 102, 103].map((n) => ({ n, popularity: 0.3, tags: [] }))], ctx);
    const c = byN(s, 100);
    expect(c.path!.distinctive).toBe(true);
    expect(c.connection).toBeLessThan(CONNECTION_FLOOR);
    expect(c.clearsFloor).toBe(false);
  });

  it("in a field with no seed, a shared tag counts only when it is a bridge tag or its types include the candidate's", async () => {
    const plain = profileTag(1, 0.9, { types: ["urn:entity:movie"], fields: ["film"] });
    const bridge = profileTag(2, 0.9, { types: ["urn:entity:movie"], fields: ["film"], bridge: true });
    const typed = profileTag(3, 0.9, { types: ["urn:entity:brand"], fields: [] });
    const ctx = ctxWith([plain, bridge, typed]);
    const pad = [104, 105, 106].map((n) => ({ n, popularity: 0.3, tags: [] as number[], subtype: "urn:entity:brand" }));
    const s = await scoreOf(
      [
        { n: 100, popularity: 0.3, tags: [1], subtype: "urn:entity:brand" },
        { n: 101, popularity: 0.3, tags: [2], subtype: "urn:entity:brand" },
        { n: 102, popularity: 0.3, tags: [3], subtype: "urn:entity:brand" },
        ...pad,
      ],
      ctx,
      "fashion",
    );
    expect(byN(s, 100).path).toBeNull();
    expect(byN(s, 100).clearsFloor).toBe(false);
    expect(byN(s, 101).clearsFloor).toBe(true);
    expect(byN(s, 102).clearsFloor).toBe(true);
  });

  it("builds a path that satisfies the shared contract, naming only shared tags", async () => {
    const { ctx, items } = tieredPool();
    const fake = fakeInsights(items);
    const pool = await buildPool("film", ctx, { entityIds: [] }, { insights: fake.fn });
    const s = scorePool(pool, ctx);
    for (const c of s.scored.filter((x) => x.clearsFloor)) {
      expect(isPath(c.path)).toBe(true);
      expect(c.path!.hops.map((h) => h.kind)).toEqual(["seed", "theme", "pick"]);
      const theme = c.path!.hops[1]!;
      expect(theme.tags).toEqual(c.path!.sharedTags);
      const candidateTags = new Set(c.candidate.tags.map((t) => t.id));
      for (const t of c.path!.sharedTags) expect(candidateTags.has(t)).toBe(true);
    }
  });

  it("emits one score event for the pool", async () => {
    const { ctx, items } = tieredPool();
    const fake = fakeInsights(items);
    const pool = await buildPool("film", ctx, { entityIds: [] }, { insights: fake.fn });
    const seen: string[] = [];
    const s = scorePool(pool, ctx, { emit: (e) => seen.push(e.kind) });
    expect(seen).toEqual(["score"]);
    const ev = s.events[0]!;
    if (ev.kind !== "score") throw new Error("kind");
    expect(ev.scored).toBe(40);
    expect(ev.clearedFloor).toBe(s.signals.clearedFloor);
    expect(ev.popularity!.min).toBeLessThanOrEqual(ev.popularity!.median);
    expect(ev.popularity!.median).toBeLessThanOrEqual(ev.popularity!.max);
  });
});

describe("lineage", () => {
  const hop: PathHop = { kind: "lineage", label: "influenced by Invented Work 1", provenance: "sourced", sourceUrl: "https://example.test/source", sourceLabel: "Qloo" };

  it("a sourced lineage hop adds to connection, makes the path distinctive and sits between theme and pick", async () => {
    const ctx = ctxWith([profileTag(1, 0.2)]);
    const specs = [{ n: 100, popularity: 0.3, tags: [1] }, ...[101, 102, 103].map((n) => ({ n, popularity: 0.3, tags: [] as number[] }))];
    const without = byN(await scoreOf(specs, ctx), 100);
    expect(without.clearsFloor).toBe(false);
    const withHop = byN(await scoreOf(specs, ctx, "film", new Map([[id(100), hop]])), 100);
    expect(withHop.connection).toBeCloseTo(without.connection + LINEAGE_CONNECTION_WEIGHT, 10);
    expect(withHop.path!.distinctive).toBe(true);
    expect(withHop.path!.hops.map((h) => h.kind)).toEqual(["seed", "theme", "lineage", "pick"]);
    expect(withHop.clearsFloor).toBe(true);
    expect(isPath(withHop.path)).toBe(true);
  });

  it("ignores a hop that is not sourced, has no link, or is not lineage", async () => {
    const ctx = ctxWith([profileTag(1, 0.2)]);
    const specs = [{ n: 100, popularity: 0.3, tags: [1] }, ...[101, 102, 103].map((n) => ({ n, popularity: 0.3, tags: [] as number[] }))];
    const bad: PathHop[] = [
      { ...hop, provenance: "inferred" },
      { ...hop, sourceUrl: "" },
      { ...hop, kind: "theme" },
    ];
    for (const b of bad) {
      const c = byN(await scoreOf(specs, ctx, "film", new Map([[id(100), b]])), 100);
      expect(c.clearsFloor).toBe(false);
      expect(c.path!.hops.some((h) => h.kind === "lineage")).toBe(false);
    }
  });

  it("lineage never stands in for a shared tag: with none there is no path", async () => {
    const ctx = ctxWith([profileTag(1, 0.9)]);
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [] }, { n: 101, popularity: 0.3, tags: [1] }], ctx, "film", new Map([[id(100), hop]]));
    expect(byN(s, 100).path).toBeNull();
    expect(byN(s, 100).clearsFloor).toBe(false);
  });
});

describe("anchor", () => {
  const ctx = ctxWith([profileTag(1, 0.9, { fields: ["music"] }), profileTag(2, 0.5, { fields: ["film"] })]);
  const pad = [110, 111, 112].map((n) => ({ n, popularity: 0.3, tags: [] as number[] }));

  it("is the top explainability contributor, with its score", async () => {
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1], explain: [[1, 0.2], [3, 0.6], [2, 0.1]] }, ...pad], ctx);
    const p = byN(s, 100).path!;
    expect(p.seedId).toBe("seed-3");
    expect(p.anchor).toEqual({ contribution: 0.6, source: "qloo_explainability" });
    expect(p.hops[0]!.label).toBe("Invented Work 3");
  });

  it("flags a thin anchor when the top contribution is below MIN_ANCHOR_CONTRIBUTION", async () => {
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1], explain: [[1, MIN_ANCHOR_CONTRIBUTION - 0.05], [2, 0.1]] }, ...pad], ctx);
    expect(byN(s, 100).path!.anchor).toEqual({ contribution: MIN_ANCHOR_CONTRIBUTION - 0.05, source: "qloo_explainability", thin: true });
  });

  it("ignores contributors that were not sent as seeds, falling back to tag overlap", async () => {
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1], explain: [[9, 0.9]] }, ...pad], ctx);
    expect(byN(s, 100).path!.anchor).toEqual({ contribution: null, source: "tag_overlap" });
  });

  it("without explainability, picks the seed that carries the shared tags and labels it tag_overlap", async () => {
    const music = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }, ...pad], ctx);
    expect(byN(music, 100).path!.seedId).toBe("seed-1");
    expect(byN(music, 100).path!.anchor).toEqual({ contribution: null, source: "tag_overlap" });
    const film = await scoreOf([{ n: 100, popularity: 0.3, tags: [2] }, ...pad], ctx);
    expect(byN(film, 100).path!.seedId).toBe("seed-3");
  });

  it("a seed whose own why matched the tag wins a tie on overlap", async () => {
    const seeds = [seedOf(1, "film"), seedOf(2, "film", { whyTags: [whyTagOf(2)] })];
    const c = ctxWith([profileTag(2, 0.5, { fields: ["film"] })], seeds);
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [2] }, ...pad], c);
    expect(byN(s, 100).path!.seedId).toBe("seed-2");
  });
});

describe("signals for the loop", () => {
  it("reports a thin pool when fewer than MIN_PICKS_PER_FIELD clear the floor", async () => {
    const ctx = ctxWith([profileTag(1, 0.8)]);
    const s = await scoreOf([{ n: 100, popularity: 0.3, tags: [1] }, ...[101, 102, 103].map((n) => ({ n, popularity: 0.3, tags: [] as number[] }))], ctx);
    expect(s.signals.clearedFloor).toBe(1);
    expect(s.signals.thin).toBe(true);
    expect(MIN_PICKS_PER_FIELD).toBeGreaterThan(1);
    expect(s.signals.clearedMedianReach).not.toBeNull();
  });

  it("an empty pool scores to nothing, with no medians", async () => {
    const ctx = ctxWith([profileTag(1, 0.8)]);
    const s = await scoreOf([], ctx);
    expect(s.signals).toMatchObject({ scored: 0, clearedFloor: 0, thin: true, clearedMedianReach: null, clearedMedianPopularity: null });
  });
});
