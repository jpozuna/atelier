import { describe, expect, it } from "vitest";
import { BANDS, FIELDS } from "@/types";
import {
  CONNECTION_FLOOR,
  BAND_CHART_REACH,
  CHART_NEUTRAL_CONNECTION,
  CHART_STRENGTH_CONNECTION,
  EDGE_FIELD_SHARE_MAX,
  EDGE_PICKS_MAX,
} from "@/lib/agent/config";
import { FIXTURE_SEEDS, fixtureName, makeFixtureResult } from "./fixture";
import { EDGE_BANDS, affectedFields, buildView, mergeRerun, pathHint, toChartPick, toggleHidden } from "./grouping";
import type { PublicDomain, PublicPick } from "./types";

const result = makeFixtureResult();
const view = (hidden: Parameters<typeof toggleHidden>[0] = [], notMe: string[] = []) => buildView(result, { hidden, notMe, seeds: FIXTURE_SEEDS });

describe("fixture", () => {
  it("is synthetic: invented names, ids in the synthetic shape", () => {
    const all = result.domains.flatMap((d) => d.picks);
    for (const p of all) expect(p.qlooId).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    expect(fixtureName(71)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("is a capped run: 20 edge picks, no field above its share, mixed strengths and degrees, 6 calibration picks", () => {
    const edge = result.domains.flatMap((d) => EDGE_BANDS.flatMap((b) => d.byBand[b]));
    expect(edge).toHaveLength(EDGE_PICKS_MAX);
    for (const d of result.domains) {
      const n = EDGE_BANDS.reduce((sum, b) => sum + d.byBand[b].length, 0);
      expect(n).toBeLessThanOrEqual(Math.floor(EDGE_FIELD_SHARE_MAX * edge.length));
    }
    expect(new Set(edge.filter((p) => p.strength).map((p) => p.strength))).toEqual(new Set(["strong", "steady", "light"]));
    expect(edge.every((p) => p.strength)).toBe(true);
    expect(EDGE_BANDS.map((b) => edge.filter((p) => p.band === b).length)).toEqual([7, 7, 6]);
    expect(result.domains.filter((d) => EDGE_BANDS.some((b) => d.byBand[b].length > 0)).length).toBeGreaterThanOrEqual(5);
    const calibration = result.domains.flatMap((d) => d.byBand.calibration);
    expect(calibration).toHaveLength(6);
    expect(calibration.every((p) => p.strength === undefined)).toBe(true);
  });

  it("replacement calibration picks in the follow-up have their own ids", () => {
    const again = makeFixtureResult("again").domains.flatMap((d) => d.byBand.calibration).map((p) => p.id);
    expect(new Set(again).size).toBe(again.length);
    const first = new Set(result.domains.flatMap((d) => d.byBand.calibration).map((p) => p.id));
    expect(again.some((id) => first.has(id))).toBe(false);
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
    expect(music?.picks.map((p) => p.band)).toEqual(["moderate", "moderate", "high", "high", "high", "extreme", "extreme"]);
  });

  it("keeps one deck per field in field order, including thin and unavailable ones with their note", () => {
    const decks = view().decks;
    expect(decks.map((d) => d.field)).toEqual(["music", "film", "tv", "books", "food_places", "fashion"]);
    expect(decks.find((d) => d.field === "tv")?.emptyBands).toEqual([]);
    expect(decks.find((d) => d.field === "tv")?.note).toBeTruthy();
    expect(decks.find((d) => d.field === "food_places")?.emptyBands).toEqual(["high"]);
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

  it("keeps every field at no more edge picks than it had, and the edge total within the cap, even when the response holds more", () => {
    const edgeCount = (d: PublicDomain) => EDGE_BANDS.reduce((n, b) => n + d.byBand[b].length, 0);
    // A response whose affected field carries a full 8 edge picks of its own, and new ones at that.
    const again = makeFixtureResult("again");
    const music = again.domains[0];
    const extra = result.domains.flatMap((d) => d.byBand.moderate).slice(0, 8).map((p, i) => ({ ...p, id: `pick-extra-${i}`, qlooId: `00000000-0000-4000-8000-00000000009${i}` }));
    again.domains[0] = { ...music, byBand: { ...music.byBand, moderate: extra }, picks: [...music.byBand.calibration, ...extra] };
    const aside = result.domains[0].byBand.calibration[0].qlooId;
    const merged = mergeRerun(result, again, ["music"], [aside]);
    result.domains.forEach((before, i) => expect(edgeCount(merged.domains[i])).toBeLessThanOrEqual(edgeCount(before)));
    const total = merged.domains.reduce((n, d) => n + edgeCount(d), 0);
    expect(total).toBeLessThanOrEqual(EDGE_PICKS_MAX);
    for (const d of merged.domains) expect(edgeCount(d)).toBeLessThanOrEqual(Math.floor(EDGE_FIELD_SHARE_MAX * total));
    expect(merged.domains[0].byBand.moderate).toEqual(result.domains[0].byBand.moderate);
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

  it("maps a pick's strength word to its fixed line weight, all above the floor", () => {
    for (const p of result.domains.flatMap((d) => d.picks)) {
      const expected = p.strength ? CHART_STRENGTH_CONNECTION[p.strength] : CHART_NEUTRAL_CONNECTION;
      expect(toChartPick(p).connection).toBe(expected);
    }
    const weights = new Set(result.domains.flatMap((d) => d.picks).filter((p) => p.strength).map((p) => toChartPick(p).connection));
    expect([...weights].sort()).toEqual([CHART_STRENGTH_CONNECTION.light, CHART_STRENGTH_CONNECTION.steady, CHART_STRENGTH_CONNECTION.strong].sort());
    for (const w of Object.values(CHART_STRENGTH_CONNECTION)) expect(w).toBeGreaterThan(CONNECTION_FLOOR);
  });

  it("falls back to the neutral weight for a pick with no strength, or one the screen does not know", () => {
    const calibration = result.domains[0].byBand.calibration[0];
    expect(calibration.strength).toBeUndefined();
    expect(toChartPick(calibration).connection).toBe(CHART_NEUTRAL_CONNECTION);
    const odd = { ...result.domains[0].byBand.moderate[0], strength: "heavy" } as unknown as PublicPick;
    expect(toChartPick(odd).connection).toBe(CHART_NEUTRAL_CONNECTION);
  });

  it("keeps the id, so a chart selection maps back to the same pick", () => {
    const p = result.domains[0].picks[0];
    expect(toChartPick(p).id).toBe(p.id);
    expect(view().byId.get(p.id)).toBe(p);
  });
});

describe("hints", () => {
  it("reads the seed and theme from the path", () => {
    const p = result.domains[0].picks[0];
    expect(pathHint(p.path)).toEqual({ seed: p.path.hops[0].label, theme: p.path.hops[1].label });
  });
});
