// The dial-behavior, reach-margin and connection-floor scorers (T-19 owns the real ones), encoded from their
// definitions in .claude/skills/atelier-evals/references/scorers.md and run on a synthetic pool through the whole
// path: buildPool (one fake insights call), scorePool, selectBands. The one-call-per-pool rule is tested in
// pool.test.ts; scorePool and selectBands take no client, so they cannot call.

import { describe, expect, it } from "vitest";
import { CONNECTION_FLOOR, MIN_REACH_MARGIN } from "@/lib/agent/config";
import type { Band } from "@/types";
import { bandsForDial, buildPool, EDGE_BANDS, median, scorePool, selectBands } from "./index";
import type { BandSelection, FrontierPick } from "./index";
import { disagreeingPool, fakeInsights, id, tieredPool } from "./fixtures";
import type { FakeInsights } from "./fixtures";

const BANDS_ASC: Band[] = ["calibration", "moderate", "high", "extreme"];

interface Run {
  fake: FakeInsights;
  shown: string[];
  seedIds: string[];
  match: BandSelection;
  stretch: BandSelection;
  edges: BandSelection;
  all: BandSelection;
}

async function run(shown: string[] = [id(900), id(901)], source: typeof tieredPool = tieredPool): Promise<Run> {
  const { ctx, items } = source();
  const fake = fakeInsights(items);
  const pool = await buildPool("film", ctx, { entityIds: shown }, { insights: fake.fn });
  const scored = scorePool(pool, ctx);
  return {
    fake,
    shown,
    seedIds: ctx.seeds.map((s) => s.qlooId!),
    match: selectBands(scored, { bands: bandsForDial("match") }),
    stretch: selectBands(scored, { bands: bandsForDial("stretch") }),
    edges: selectBands(scored, { bands: [...EDGE_BANDS] }),
    all: selectBands(scored, { bands: BANDS_ASC }),
  };
}

// dial-behavior: median popularity of Stretch picks is lower than Match picks for the same profile; every insights
// call excludes all seeds and all picks already shown; no seed or shown pick appears in the results.
function dialBehavior(r: Run): string[] {
  const out: string[] = [];
  const m = median(r.match.picks.filter((p) => p.popularity > 0).map((p) => p.popularity));
  const s = median(r.stretch.picks.filter((p) => p.popularity > 0).map((p) => p.popularity));
  if (m === null || s === null) out.push("no Match or no Stretch picks to compare");
  else if (!(s < m)) out.push(`Stretch median popularity ${s} is not below Match ${m}`);
  for (const call of r.fake.calls) {
    const excluded = new Set(call.params["filter.exclude.entities"] as string[]);
    for (const e of [...r.seedIds, ...r.shown]) if (!excluded.has(e)) out.push("a call does not exclude a seed or a shown pick");
  }
  const forbidden = new Set([...r.seedIds, ...r.shown]);
  for (const p of [...r.match.picks, ...r.stretch.picks, ...r.edges.picks, ...r.all.picks]) if (forbidden.has(p.qlooId)) out.push("a seed or shown pick appears in the results");
  return out;
}

// reach-margin: the median reach of each band exceeds the band below by at least MIN_REACH_MARGIN.
function reachMargin(picks: FrontierPick[]): string[] {
  const out: string[] = [];
  const meds = BANDS_ASC.map((b) => ({ b, m: median(picks.filter((p) => p.band === b).map((p) => p.reach.reach)) })).filter((x) => x.m !== null) as { b: Band; m: number }[];
  for (let i = 1; i < meds.length; i++) {
    if (meds[i]!.m - meds[i - 1]!.m < MIN_REACH_MARGIN) out.push(`${meds[i]!.b} median ${meds[i]!.m} is not ${MIN_REACH_MARGIN} above ${meds[i - 1]!.b} ${meds[i - 1]!.m}`);
  }
  return out;
}

// connection-floor: every shown pick has connection >= CONNECTION_FLOOR at every dial setting.
function connectionFloor(picks: FrontierPick[]): string[] {
  return picks.filter((p) => !(p.connection >= CONNECTION_FLOOR)).map((p) => `${p.id} connection ${p.connection} is under the floor`);
}

describe("dial-behavior", () => {
  it("passes: Stretch picks are less popular than Match picks, and seeds and shown picks are excluded and absent", async () => {
    const r = await run();
    expect(dialBehavior(r)).toEqual([]);
    expect(r.match.picks.length).toBeGreaterThan(0);
    expect(r.stretch.picks.length).toBeGreaterThan(0);
  });

  it("passes when tag distance and obscurity disagree about which candidates are far out", async () => {
    const { ctx, items } = disagreeingPool();
    const scored = scorePool(await buildPool("film", ctx, { entityIds: [] }, { insights: fakeInsights(items).fn }), ctx);
    const avg = (n0: number, key: "tagDistance" | "obscurity") => {
      const group = scored.scored.filter((x) => x.candidate.qlooId >= id(n0) && x.candidate.qlooId < id(n0 + 10));
      return group.reduce((n, x) => n + x.reach[key], 0) / group.length;
    };
    // The fixture does disagree: A is closer than B by tags but further out than B by obscurity.
    expect(avg(100, "tagDistance")).toBeLessThan(avg(200, "tagDistance"));
    expect(avg(100, "obscurity")).toBeGreaterThan(avg(200, "obscurity"));
    const r = await run([], disagreeingPool);
    expect(dialBehavior(r)).toEqual([]);
    expect(r.match.picks.length).toBeGreaterThan(0);
    expect(r.stretch.picks.length).toBeGreaterThan(0);
    // One call over all four bands: the guard compares Stretch with the Match picks of the same call.
    const { stretchMedianPopularity: st, matchMedianPopularity: ma } = r.all.dial;
    if (st !== null && ma !== null) expect(st).toBeLessThan(ma);
    // The guard costs picks here (Stretch is thin because the far-by-tags candidates are the popular ones); it never
    // lowers the connection floor to make up for it.
    expect(connectionFloor(r.all.picks)).toEqual([]);
  });

  it("the scorer fails on a seed that comes back (negative case)", async () => {
    const r = await run();
    r.match.picks[0] = { ...r.match.picks[0]!, qlooId: r.seedIds[0]! };
    expect(dialBehavior(r).join()).toContain("seed or shown pick appears");
  });

  it("the scorer fails when Stretch is not less popular (negative case)", async () => {
    const r = await run();
    r.stretch.picks = r.stretch.picks.map((p) => ({ ...p, popularity: 0.99 }));
    expect(dialBehavior(r).join()).toContain("not below Match");
  });

  it("a shown pick is excluded from the next pool's call and never comes back", async () => {
    const first = await run();
    const next = await run(first.edges.picks.map((p) => p.qlooId));
    expect(dialBehavior(next)).toEqual([]);
    const excluded = next.fake.calls[0]!.params["filter.exclude.entities"] as string[];
    for (const p of first.edges.picks) expect(excluded).toContain(p.qlooId);
  });
});

describe("reach-margin", () => {
  it("passes for the edge screen, the full set, and every dial setting", async () => {
    const r = await run();
    for (const sel of [r.edges, r.all, r.match, r.stretch]) {
      expect(reachMargin(sel.picks)).toEqual([]);
    }
    expect(new Set(r.edges.picks.map((p) => p.band))).toEqual(new Set(EDGE_BANDS));
  });

  it("the scorer fails when two bands sit too close (negative case)", async () => {
    const r = await run();
    const flat = r.all.picks.map((p) => ({ ...p, reach: { ...p.reach, reach: 0.5 } }));
    expect(reachMargin(flat).length).toBeGreaterThan(0);
  });
});

describe("connection-floor", () => {
  it("passes at every dial setting, and no candidate under the floor is ever shown", async () => {
    const r = await run();
    for (const sel of [r.match, r.stretch, r.edges, r.all]) expect(connectionFloor(sel.picks)).toEqual([]);
    expect(CONNECTION_FLOOR).toBe(0.3);
  });

  it("holds when bands are relaxed", async () => {
    // Four candidates clear the floor and the rest do not: bands are thin and relax, and the floor stays.
    const { ctx, items } = tieredPool();
    const thin = items.filter((_, i) => i % 10 === 0 || i >= 36);
    const fake = fakeInsights(thin);
    const scored = scorePool(await buildPool("film", ctx, { entityIds: [] }, { insights: fake.fn }), ctx);
    const sel = selectBands(scored, { bands: BANDS_ASC, perBand: 3 });
    expect(sel.events.some((e) => e.kind === "relax")).toBe(true);
    expect(sel.picks.length).toBeGreaterThan(0);
    expect(connectionFloor(sel.picks)).toEqual([]);
    expect(reachMargin(sel.picks)).toEqual([]);
  });

  it("the scorer fails a pick under the floor (negative case)", async () => {
    const r = await run();
    expect(connectionFloor([{ ...r.all.picks[0]!, connection: CONNECTION_FLOOR - 0.01 }]).length).toBe(1);
  });
});
