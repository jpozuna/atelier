import { describe, expect, it } from "vitest";
import { layoutChart } from "@/components/chart/geometry";
import { FIXTURE_INPUTS, makeFixtureResult } from "./fixture";
import { toChartPick } from "./grouping";
import { placement, sourcesOf } from "./reasoning";
import type { PublicPick } from "./types";

const picks = makeFixtureResult().domains.flatMap((d) => d.picks);
const axes = FIXTURE_INPUTS.axes;

describe("placement", () => {
  it("names the axis the chart puts the pick beside, for every pick", () => {
    const layout = layoutChart({ axes, picks: picks.map(toChartPick), width: 640 });
    expect(layout.picks).toHaveLength(picks.length);
    for (const g of layout.picks) {
      const pick = picks.find((p) => p.id === g.id) as PublicPick;
      expect(placement(pick, axes).axis).toBe(axes[g.axisIndex].label);
    }
  });

  it("says the stretch in words for an edge pick and none for a calibration pick", () => {
    const edge = picks.find((p) => p.band === "extreme") as PublicPick;
    const close = picks.find((p) => p.band === "calibration") as PublicPick;
    expect(placement(edge, axes).stretch).toBe("high");
    expect(placement(close, axes).stretch).toBeNull();
  });

  it("falls back to the heaviest axis when the path touches none, and to no axis when there are none", () => {
    const loose = { ...picks[6], path: { ...picks[6].path, sharedTags: [], hops: picks[6].path.hops.map((h) => ({ ...h, tags: [] })) } } as PublicPick;
    const heaviest = axes.reduce((best, a) => (a.weight > best.weight ? a : best), axes[0]);
    expect(placement(loose, axes).axis).toBe(heaviest.label);
    expect(placement(loose, []).axis).toBeNull();
  });

  it("returns words only", () => {
    for (const p of picks) {
      const w = placement(p, axes);
      expect(typeof w.axis === "string" || w.axis === null).toBe(true);
      expect(w.stretch === null || ["low", "medium", "high"].includes(w.stretch)).toBe(true);
    }
  });
});

describe("sources", () => {
  const withLineage = () => picks.find((p) => p.path.hops.some((h) => h.kind === "lineage")) as PublicPick;

  it("lists a sourced step with its kind label, its label and its source, and nothing inferred", () => {
    const s = sourcesOf(withLineage());
    expect(s.sourced).toHaveLength(1);
    expect(s.sourced[0].provenance).toBe("Sourced");
    expect(s.sourced[0].kindLabel).toBe("Lineage, a reading");
    expect(s.sourced[0].href ?? s.sourced[0].sourceLabel).toBeTruthy();
    expect(s.sourced.map((x) => x.label)).not.toContain(withLineage().path.hops.find((h) => h.kind === "theme")?.label);
    expect(s).not.toHaveProperty("inferredCount");
  });

  it("has nothing sourced for a path that is all inferred", () => {
    const plain = picks.find((p) => !p.path.hops.some((h) => h.kind === "lineage")) as PublicPick;
    const s = sourcesOf(plain);
    expect(s.sourced).toEqual([]);
    expect(s.reading).toBeNull();
  });

  it("never turns an unsafe link into a link", () => {
    const base = withLineage();
    const hops = base.path.hops.map((h) => (h.kind === "lineage" ? { ...h, sourceUrl: "javascript:alert(1)", sourceLabel: undefined } : h));
    const s = sourcesOf({ ...base, path: { ...base.path, hops } } as PublicPick);
    expect(s.sourced[0].href).toBeUndefined();
    expect(s.sourced[0].linkMissing).toBe(true);
  });

  it("includes a reading only when one was retrieved, with its label and its link", () => {
    const base = picks[6];
    expect(sourcesOf(base).reading).toBeNull();
    const reading = (r: object) => ({ ...base, card: { ...base.card, reading: { text: "A reading.", ...r } } }) as PublicPick;
    expect(sourcesOf(reading({ sourceUrl: "https://example.org/mock", sourceLabel: "Mock source" })).reading).toEqual({ sourceLabel: "Mock source", href: "https://example.org/mock" });
    expect(sourcesOf(reading({ sourceUrl: "https://example.org/mock" })).reading).toEqual({ href: "https://example.org/mock" });
    expect(sourcesOf(reading({ sourceUrl: "javascript:alert(1)", sourceLabel: "Mock source" })).reading).toEqual({ sourceLabel: "Mock source" });
  });
});
