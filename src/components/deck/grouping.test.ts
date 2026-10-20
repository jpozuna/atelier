import { describe, expect, it } from "vitest";
import { BANDS, FIELDS } from "@/types";
import {
  CONNECTION_FLOOR,
  BAND_CHART_REACH,
  CHART_NEUTRAL_CONNECTION,
  REVEAL_MAX_DELAY_MS,
  REVEAL_STAGGER_MS,
} from "@/lib/agent/config";
import { FIXTURE_SEEDS, fixtureName, makeFixtureResult } from "./fixture";
import { affectedFields, buildView, mergeRerun, pathHint, pickNameMap, revealDelays, seedNameMap, toChartPick, toggleHidden } from "./grouping";

const result = makeFixtureResult();
const view = (hidden: Parameters<typeof toggleHidden>[0] = [], notMe: string[] = []) => buildView(result, { hidden, notMe, seeds: FIXTURE_SEEDS });

describe("fixture", () => {
  it("is synthetic: invented names, ids in the synthetic shape", () => {
    const all = result.domains.flatMap((d) => d.picks);
    for (const p of all) expect(p.qlooId).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    expect(fixtureName(71)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});

describe("calibration first", () => {
  it("lists same-field picks before other-field picks, each marked", () => {
    const v = view();
    const scopes = v.calibration.map((c) => c.scope);
    expect(scopes.length).toBeGreaterThan(2);
    const firstOther = scopes.indexOf("other_field");
    expect(firstOther).toBeGreaterThan(0);
    expect(scopes.slice(0, firstOther).every((s) => s === "same_field")).toBe(true);
    expect(scopes.slice(firstOther).every((s) => s === "other_field")).toBe(true);
  });

  it("names the seed from the path", () => {
    const item = view().calibration[0];
    expect(item.seedLabel).toBe(item.pick.path.hops[0].label);
  });

  it("has only calibration picks, and edges hold none of them", () => {
    const v = view();
    expect(v.calibration.every((c) => c.pick.band === "calibration")).toBe(true);
    expect(v.decks.flatMap((d) => d.picks).every((p) => p.band !== "calibration")).toBe(true);
  });

  it("scope is unknown when the seed is not in the list", () => {
    const v = buildView(result, { hidden: [], notMe: [], seeds: [] });
    expect(v.calibration.every((c) => c.scope === null)).toBe(true);
  });
});

describe("edge decks by field", () => {
  it("shows moderate, high and extreme together, in that order, per field", () => {
    const music = view().decks.find((d) => d.field === "music");
    expect(music?.picks.map((p) => p.band)).toEqual(["moderate", "high", "high", "extreme"]);
  });

  it("keeps one deck per field in field order, including thin and unavailable ones with their note", () => {
    const decks = view().decks;
    expect(decks.map((d) => d.field)).toEqual(["music", "film", "tv", "books", "food_places", "fashion"]);
    expect(decks.find((d) => d.field === "tv")?.emptyBands).toEqual(["extreme"]);
    expect(decks.find((d) => d.field === "fashion")?.note).toBeTruthy();
  });
});

describe("hiding a field", () => {
  it("empties its deck, calibration and marks, and touches nothing else", () => {
    const all = view();
    const hidden = view(["music"]);
    expect(hidden.decks.find((d) => d.field === "music")).toMatchObject({ hidden: true, picks: [] });
    expect(hidden.calibration.some((c) => c.pick.field === "music")).toBe(false);
    expect(hidden.picks.some((p) => p.field === "music")).toBe(false);
    const other = (v: typeof all) => v.decks.filter((d) => d.field !== "music");
    expect(other(hidden)).toEqual(other(all));
  });

  it("does not change the result, so showing it again needs no call", () => {
    const before = JSON.stringify(result);
    view(["music", "film"]);
    expect(JSON.stringify(result)).toBe(before);
    // Hide then show again: the same view comes back, built from the same result.
    expect(view(toggleHidden(toggleHidden([], "music"), "music"))).toEqual(view());
  });

  it("toggles in field order", () => {
    expect(toggleHidden([], "film")).toEqual(["film"]);
    expect(toggleHidden(["film"], "music")).toEqual(["music", "film"]);
    expect(toggleHidden(["music", "film"], "music")).toEqual(["film"]);
  });
});

describe("not me", () => {
  it("takes the pick off every list", () => {
    const aside = view().calibration[0].pick;
    const v = view([], [aside.qlooId]);
    expect(v.picks.some((p) => p.id === aside.id)).toBe(false);
    expect(v.calibration.some((c) => c.pick.id === aside.id)).toBe(false);
  });

  it("affects only the pick's own field", () => {
    expect(affectedFields({ field: "books" })).toEqual(["books"]);
  });

  it("a re-run refreshes calibration for the affected fields only", () => {
    const aside = result.domains[0].byBand.calibration[0].qlooId;
    const merged = mergeRerun(result, makeFixtureResult("again"), ["music"], [aside]);
    const music = merged.domains[0];
    expect(music.byBand.calibration.map((p) => p.qlooId)).not.toContain(aside);
    expect(music.byBand.calibration.length).toBe(result.domains[0].byBand.calibration.length);
    expect(music.byBand.moderate).toEqual(result.domains[0].byBand.moderate);
    expect(music.picks.map((p) => p.band)).toEqual([...music.picks.map((p) => p.band)].sort((a, b) => BANDS.indexOf(a) - BANDS.indexOf(b)));
    for (const d of merged.domains.slice(1)) expect(d).toBe(result.domains.find((x) => x.domain === d.domain));
  });

  it("merges the plan and the meta per field, so a partial plan is never stored", () => {
    const again = makeFixtureResult("again");
    // What a server that returned only the re-run field (and a plan of only that field) would send.
    const partial = {
      ...again,
      domains: again.domains.filter((d) => d.domain === "music"),
      plan: { themes: [{ domain: "music" as const, axisId: "axis-new", reason: "Changed." }], requeries: [{ domain: "music" as const, action: { kind: "lean_axis" as const, axisId: "axis-new" } }] },
      meta: { requeries: [{ domain: "music" as const, reason: "too_weak" as const }], notRequeried: [] },
    };
    const prev = { ...result, meta: { requeries: [{ domain: "film" as const, reason: "empty" as const }], notRequeried: [] } };
    const merged = mergeRerun(prev, partial, ["music"], []);
    expect(merged.plan.themes.map((t) => t.domain).sort()).toEqual([...FIELDS].sort());
    expect(merged.plan.themes.find((t) => t.domain === "music")?.axisId).toBe("axis-new");
    expect(merged.plan.themes.find((t) => t.domain === "film")).toEqual(result.plan.themes.find((t) => t.domain === "film"));
    expect(merged.plan.requeries).toEqual(partial.plan.requeries);
    expect(merged.meta.requeries.map((r) => r.domain).sort()).toEqual(["film", "music"]);
  });

  it("keeps the plan entries of a field the re-run could not fetch", () => {
    const again = makeFixtureResult("again");
    again.domains[0] = { ...again.domains[0], status: "unavailable" };
    again.plan = { themes: [{ domain: "music", axisId: "axis-new", reason: "x" }], requeries: [] };
    const merged = mergeRerun(result, again, ["music"], []);
    expect(merged.plan.themes.find((t) => t.domain === "music")).toEqual(result.plan.themes.find((t) => t.domain === "music"));
  });

  it("keeps the field's picks when the re-run could not fetch it", () => {
    const again = makeFixtureResult("again");
    again.domains[0] = { ...again.domains[0], status: "unavailable", picks: [], byBand: { calibration: [], moderate: [], high: [], extreme: [] } };
    expect(mergeRerun(result, again, ["music"], []).domains[0]).toBe(result.domains[0]);
  });
});

describe("chart picks", () => {
  it("places a pick by its band: calibration nearest the profile, extreme farthest, all finite", () => {
    const picks = result.domains.flatMap((d) => d.picks).map(toChartPick);
    for (const p of picks) {
      expect(Number.isFinite(p.reach.reach)).toBe(true);
      expect(p.reach.reach).toBe(BAND_CHART_REACH[p.band]);
    }
    expect(BAND_CHART_REACH.calibration).toBeLessThan(BAND_CHART_REACH.moderate);
    expect(BAND_CHART_REACH.moderate).toBeLessThan(BAND_CHART_REACH.high);
    expect(BAND_CHART_REACH.high).toBeLessThan(BAND_CHART_REACH.extreme);
  });

  it("gives every pick the same neutral line weight, above the floor", () => {
    const weights = new Set(result.domains.flatMap((d) => d.picks).map((p) => toChartPick(p).connection));
    expect(weights.size).toBe(1);
    expect([...weights][0]).toBe(CHART_NEUTRAL_CONNECTION);
    expect(CHART_NEUTRAL_CONNECTION).toBeGreaterThan(CONNECTION_FLOOR);
  });

  it("keeps the id, so a chart selection maps back to the same pick", () => {
    const p = result.domains[0].picks[0];
    expect(toChartPick(p).id).toBe(p.id);
    expect(view().byId.get(p.id)).toBe(p);
  });
});

describe("reveal", () => {
  it("turns tiles one at a time, calibration first, and never waits longer than the cap", () => {
    const v = view();
    const delays = revealDelays(v);
    const order = [...v.calibration.map((c) => c.pick), ...v.decks.flatMap((d) => d.picks)];
    expect(delays.get(order[0].id)).toBe(0);
    expect(delays.get(order[1].id)).toBe(REVEAL_STAGGER_MS);
    const values = order.map((p) => delays.get(p.id) ?? -1);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.max(...values)).toBeLessThanOrEqual(REVEAL_MAX_DELAY_MS);
    const lastCalibration = v.calibration[v.calibration.length - 1].pick;
    const firstEdge = v.decks.flatMap((d) => d.picks)[0];
    expect(delays.get(firstEdge.id) ?? 0).toBeGreaterThan(delays.get(lastCalibration.id) ?? 0);
  });
});

describe("reveal of new tiles only", () => {
  it("gives a delay to the picks in `only` and none to tiles already on screen, counting from the first new one", () => {
    const v = view();
    const all = [...v.calibration.map((c) => c.pick), ...v.decks.flatMap((d) => d.picks)];
    const only = new Set([all[3].id, all[7].id]);
    const delays = revealDelays(v, only);
    expect([...delays.keys()].sort()).toEqual([...only].sort());
    expect(delays.get(all[3].id)).toBe(0);
    expect(delays.get(all[7].id)).toBe(REVEAL_STAGGER_MS);
  });

  it("never makes a tile wait longer than the cap, which is short", () => {
    expect(REVEAL_MAX_DELAY_MS).toBeLessThanOrEqual(2500);
  });
});

describe("names and hints", () => {
  it("maps pick ids and seed ids to display names", () => {
    const names = pickNameMap(result);
    const p = result.domains[0].picks[0];
    expect(names[p.id]).toBe(p.name);
    expect(seedNameMap(FIXTURE_SEEDS)[FIXTURE_SEEDS[0].id]).toBe(FIXTURE_SEEDS[0].typed);
    expect(pickNameMap(null)).toEqual({});
  });

  it("reads the seed and theme from the path", () => {
    const p = result.domains[0].picks[0];
    expect(pathHint(p.path)).toEqual({ seed: p.path.hops[0].label, theme: p.path.hops[1].label });
  });
});
