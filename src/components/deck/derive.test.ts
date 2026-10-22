import { describe, expect, it } from "vitest";
import { createPicksDerivation, showsConnectionWeight } from "./derive";
import type { DeriveInput } from "./derive";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "./fixture";
import { chartSelection, edgeSuggestions, toggleChecked } from "./suggestions";
import type { PublicRunResult } from "./types";

const result = makeFixtureResult();
const input = (over: Partial<DeriveInput> = {}): DeriveInput => ({ result, hidden: [], notMe: [], seeds: FIXTURE_SEEDS, axes: FIXTURE_INPUTS.axes, ...over });
const stripStrength = (r: PublicRunResult): PublicRunResult => {
  const clean = <T extends { strength?: unknown }>(p: T): T => {
    const { strength: _strength, ...rest } = p;
    void _strength;
    return rest as T;
  };
  return { ...r, domains: r.domains.map((d) => ({ ...d, picks: d.picks.map(clean), byBand: Object.fromEntries(Object.entries(d.byBand).map(([b, ps]) => [b, ps.map(clean)])) as typeof d.byBand })) };
};

describe("chartPicks identity", () => {
  it("is the same array while only ticking, reading, previewing and sorting change", () => {
    const derive = createPicksDerivation();
    // The screen's state arrays keep their identity until `setHidden` or `setNotMe` is called.
    const stable = input();
    const first = derive(stable);
    // What the screen does on each of those actions: it derives again from the same result, hidden, notMe, seeds and axes.
    const visible = first.visibleIds;
    let checked: string[] = [];
    const ids = [...visible];
    for (const step of [0, 1, 2]) {
      checked = toggleChecked(checked, ids[step]);
      chartSelection(checked, ids[3], visible, ids[4]);
      edgeSuggestions(first.view.decks, step % 2 ? "stretch" : "field");
      const again = derive({ ...stable });
      expect(again).toBe(first);
      expect(again.chartPicks).toBe(first.chartPicks);
    }
  });

  it("changes when the visible picks do: a hidden field, a set-aside pick, a new result", () => {
    const derive = createPicksDerivation();
    const base = derive(input());
    const hidden = derive(input({ hidden: ["music"] }));
    expect(hidden.chartPicks).not.toBe(base.chartPicks);
    expect(hidden.chartPicks.some((p) => p.field === "music")).toBe(false);
    const aside = derive(input({ hidden: ["music"], notMe: [result.domains[1].byBand.calibration[0].qlooId] }));
    expect(aside.chartPicks.length).toBe(hidden.chartPicks.length - 1);
    expect(derive(input({ result: makeFixtureResult("again") })).chartPicks).not.toBe(base.chartPicks);
  });
});

describe("connection weight", () => {
  it("is on once any pick carries a strength", () => {
    expect(createPicksDerivation()(input()).showConnectionWeight).toBe(true);
  });

  it("is off for a stored result with no strengths, and then every line has the same neutral weight", () => {
    const old = stripStrength(result);
    expect(old.domains.flatMap((d) => d.picks).some((p) => p.strength)).toBe(false);
    const d = createPicksDerivation()(input({ result: old }));
    expect(d.showConnectionWeight).toBe(false);
    expect(new Set(d.chartPicks.map((p) => p.connection)).size).toBe(1);
    expect(showsConnectionWeight([])).toBe(false);
  });
});

describe("placements", () => {
  it("names an axis for every visible pick, in words", () => {
    const d = createPicksDerivation()(input());
    expect(d.placements.size).toBe(d.view.picks.length);
    for (const p of d.placements.values()) expect(typeof p.axis).toBe("string");
  });

  it("agrees with the pick's own theme: the theme hop's tag belongs to the axis named", () => {
    const d = createPicksDerivation()(input());
    for (const p of d.view.picks) {
      const theme = p.path.hops.find((h) => h.kind === "theme");
      const axis = FIXTURE_INPUTS.axes.find((a) => a.label === d.placements.get(p.id)?.axis);
      expect(axis?.tags.some((t) => (theme?.tags ?? []).includes(t.tag))).toBe(true);
      expect(axis?.tags.some((t) => t.name === theme?.label)).toBe(true);
    }
  });
});
