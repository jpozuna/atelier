import { describe, expect, it } from "vitest";
import { BAND_EDGES, CONNECTION_FLOOR, MIN_PICKS_PER_FIELD, MIN_REACH_MARGIN } from "@/lib/agent/config";
import type { Band, Candidate, Path, TraceEvent } from "@/types";
import { bandsForDial, bucket, EDGE_BANDS, median, selectBands } from "./index";
import type { ScoredCandidate, ScoredPool } from "./index";
import { id, tg } from "./fixtures";

interface Spec {
  n: number;
  reach: number;
  clears?: boolean;
  affinity?: number;
  popularity?: number;
  connection?: number;
}

const path = (n: number): Path => ({
  seedId: "seed-1",
  anchor: { contribution: null, source: "tag_overlap" },
  hops: [
    { kind: "seed", label: "Invented Work 1", provenance: "inferred" },
    { kind: "theme", label: "Fixture Tag 1", tags: [tg(1)], provenance: "inferred" },
    { kind: "pick", label: `Invented Pick ${n}`, provenance: "inferred" },
  ],
  sharedTags: [tg(1)],
  distinctive: true,
});

function sc(s: Spec): ScoredCandidate {
  const clears = s.clears ?? true;
  const candidate: Candidate = { qlooId: id(s.n), name: `Invented Pick ${s.n}`, field: "film", entityType: "urn:entity:movie", popularity: s.popularity ?? 0.3, tags: [], affinity: s.affinity ?? 0.8, origin: "unknown" };
  return {
    candidate,
    reach: { tagDistance: s.reach, obscurity: s.reach, fieldUnfamiliarity: s.reach, reach: s.reach },
    connection: s.connection ?? 0.6,
    popularityRank: 0.5,
    path: clears ? path(s.n) : null,
    clearsFloor: clears,
  };
}

const poolOf = (specs: Spec[]): ScoredPool => ({
  domain: "film",
  scored: specs.map(sc),
  tagRarity: new Map(),
  signals: { scored: specs.length, clearedFloor: specs.filter((s) => s.clears !== false).length, distinctive: 0, thin: false, clearedMedianReach: null, clearedMedianPopularity: null },
  events: [],
});

/** Reach values spread evenly from 0.2 to 0.9. */
const knownPop = (ps: { popularity: number }[]) => ps.filter((p) => p.popularity > 0).map((p) => p.popularity);

const spread = (count: number): Spec[] => Array.from({ length: count }, (_, i) => ({ n: 100 + i, reach: 0.2 + (0.7 * i) / Math.max(1, count - 1), affinity: 0.9 - i * 0.01, popularity: 0.5 - (0.7 * i) / Math.max(1, count - 1) * 0.4 }));

describe("bucket", () => {
  it("bands only floor-clearing candidates, by reach quantile within them", () => {
    const specs = [...spread(20), { n: 500, reach: 0.99, clears: false }];
    const bands = bucket(poolOf(specs).scored);
    expect(bands.has(id(500))).toBe(false);
    expect(bands.size).toBe(20);
    const counts = { calibration: 0, moderate: 0, high: 0, extreme: 0 } as Record<Band, number>;
    for (const b of bands.values()) counts[b]++;
    // 20 candidates: quantiles .025 ... .975 against edges .25, .6, .85.
    expect(counts).toEqual({ calibration: 5, moderate: 7, high: 5, extreme: 3 });
    expect(BAND_EDGES.calibration).toBe(0.25);
  });

  it("puts lower reach in a lower band, never the other way round", () => {
    const pool = poolOf(spread(30));
    const bands = bucket(pool.scored);
    const order: Band[] = ["calibration", "moderate", "high", "extreme"];
    const sorted = [...pool.scored].sort((a, b) => a.reach.reach - b.reach.reach);
    let last = 0;
    for (const s of sorted) {
      const i = order.indexOf(bands.get(s.candidate.qlooId)!);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
  });

  it("gives equal reach one band", () => {
    const bands = bucket(poolOf([1, 2, 3, 4].map((n) => ({ n, reach: 0.5 }))).scored);
    expect(new Set(bands.values()).size).toBe(1);
  });
});

describe("selectBands", () => {
  it("fills each requested band with picks of that band, lowest band first, none from outside the floor", () => {
    const sel = selectBands(poolOf([...spread(40), { n: 900, reach: 0.95, clears: false, affinity: 0.99 }]), { bands: ["calibration", ...EDGE_BANDS] });
    expect(sel.picks.map((p) => p.band)).toEqual([...sel.picks.map((p) => p.band)].sort((a, b) => ["calibration", "moderate", "high", "extreme"].indexOf(a) - ["calibration", "moderate", "high", "extreme"].indexOf(b)));
    expect(sel.picks.some((p) => p.qlooId === id(900))).toBe(false);
    for (const b of ["calibration", "moderate", "high", "extreme"] as Band[]) expect(sel.byBand[b].every((p) => p.band === b)).toBe(true);
    expect(sel.byBand.calibration.length).toBe(MIN_PICKS_PER_FIELD);
    expect(sel.emptyBands).toEqual([]);
    for (const p of sel.picks) expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
  });

  it("calibration shows the closest: highest affinity first, then popularity", () => {
    const specs: Spec[] = [
      { n: 1, reach: 0.2, affinity: 0.5, popularity: 0.5 },
      { n: 2, reach: 0.21, affinity: 0.9, popularity: 0.1 },
      { n: 3, reach: 0.22, affinity: 0.9, popularity: 0.4 },
      { n: 4, reach: 0.23, affinity: 0.7, popularity: 0.9 },
      ...spread(16).map((s) => ({ ...s, n: s.n + 100, affinity: 0.3 })),
    ];
    const sel = selectBands(poolOf(specs), { bands: ["calibration"], perBand: 3 });
    expect(sel.byBand.calibration.map((p) => p.qlooId)).toEqual([id(3), id(2), id(4)]);
  });

  it("only requested bands appear; bandsForDial maps the dial", () => {
    expect(bandsForDial("develop")).toEqual([]);
    expect(bandsForDial("match")).toEqual(["calibration", "moderate"]);
    expect(bandsForDial("stretch")).toEqual(["high", "extreme"]);
    const sel = selectBands(poolOf(spread(40)), { bands: bandsForDial("stretch") });
    expect(new Set(sel.picks.map((p) => p.band))).toEqual(new Set(["high", "extreme"]));
    expect(selectBands(poolOf(spread(40)), { bands: [] }).picks).toEqual([]);
  });

  it("a pick keeps its path, reach parts and an id of its own", () => {
    const [p] = selectBands(poolOf(spread(40)), { bands: ["moderate"], perBand: 1 }).picks;
    expect(p!.id).toBe(`pick-${p!.qlooId}`);
    expect(p!.path.sharedTags).toEqual([tg(1)]);
    expect(p!.llmBridged).toBe(false);
    expect(p!.origin).toBe("unknown");
    expect("card" in p!).toBe(false);
  });

  it("holds the reach margin: the median reach of each band exceeds the band below by MIN_REACH_MARGIN", () => {
    // A tight pool (reach 0.30 to 0.39) cannot give four distinct degrees. The bands that cannot clear the margin
    // are left out or relaxed, never shown too close together.
    const tight: Spec[] = Array.from({ length: 10 }, (_, i) => ({ n: 100 + i, reach: 0.3 + i * 0.01, affinity: 0.9 - i * 0.01 }));
    const sel = selectBands(poolOf(tight), { bands: ["calibration", "moderate", "high", "extreme"], perBand: 2 });
    const meds = (["calibration", "moderate", "high", "extreme"] as Band[]).map((b) => median(sel.byBand[b].map((p) => p.reach.reach))).filter((m): m is number => m !== null);
    for (let i = 1; i < meds.length; i++) expect(meds[i]! - meds[i - 1]!).toBeGreaterThanOrEqual(MIN_REACH_MARGIN);
    expect(sel.picks.length).toBeGreaterThan(0);
    for (const p of sel.picks) expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
  });

  const TIGHT: Spec[] = Array.from({ length: 10 }, (_, i) => ({ n: 100 + i, reach: 0.3 + i * 0.01, affinity: 0.9 - i * 0.01 }));
  const ALL: Band[] = ["calibration", "moderate", "high", "extreme"];
  const relaxOf = (events: TraceEvent[]) => events.flatMap((e) => (e.kind === "relax" ? [e] : []));

  it("an empty band relaxes down the full order one step at a time, one event per step, and says so", () => {
    const seen: TraceEvent[] = [];
    const sel = selectBands(poolOf(TIGHT), { bands: ALL, perBand: 2, emit: (e) => seen.push(e) });
    const relaxes = relaxOf(sel.events);
    expect(relaxes.length).toBeGreaterThan(0);
    expect(seen).toEqual(sel.events);
    for (const e of relaxes) {
      expect(e.relaxed).toBe("reach_band");
      if (e.from !== e.to) expect(ALL.indexOf(e.to)).toBe(ALL.indexOf(e.from) - 1);
    }
    // The empty bands are reported even though their slots were filled from a lower band.
    expect(sel.emptyBands.length).toBeGreaterThan(0);
    for (const b of sel.emptyBands) expect(sel.byBand[b]).toEqual([]);
    // Every relaxed pick still sits in its own true band.
    for (const b of ALL) expect(sel.byBand[b].every((p) => p.band === b)).toBe(true);
  });

  it("the lowest requested band relaxes into a band that was not requested (Stretch: high into moderate)", () => {
    // One cleared candidate sits at quantile .5: the moderate band. Stretch asks for high and extreme.
    const sel = selectBands(poolOf([{ n: 1, reach: 0.5, popularity: 0 }]), { bands: ["high", "extreme"], perBand: 2 });
    expect(sel.byBand.moderate.map((p) => p.qlooId)).toEqual([id(1)]);
    expect(sel.byBand.moderate[0]!.band).toBe("moderate");
    expect(sel.emptyBands).toEqual(["high", "extreme"]);
    const steps = relaxOf(sel.events).map((e) => `${e.from}>${e.to}`);
    // high relaxes into moderate and is filled. extreme steps through high (nothing left) and moderate (used), then stays empty.
    expect(steps[0]).toBe("high>moderate");
    expect(steps).toContain("extreme>high");
    expect(steps).toContain("extreme>extreme");
  });

  it("when there is truly nothing to relax into, a relax event says the band stayed empty", () => {
    const sel = selectBands(poolOf(spread(2)), { bands: ["moderate", "high", "extreme"], perBand: 3 });
    expect(sel.emptyBands.length).toBeGreaterThan(0);
    const stayed = relaxOf(sel.events).filter((e) => e.from === e.to);
    expect(stayed.length).toBeGreaterThan(0);
    for (const e of stayed) {
      expect(sel.emptyBands).toContain(e.from);
      expect(sel.byBand[e.from]).toEqual([]);
    }
    expect(sel.thin).toBe(true);
    const none = selectBands(poolOf([]), { bands: ["calibration"] });
    expect(relaxOf(none.events).map((e) => [e.from, e.to])).toEqual([["calibration", "calibration"]]);
  });

  it("relax text uses the degree words and no internal terms", () => {
    const sel = selectBands(poolOf(TIGHT), { bands: ALL, perBand: 2 });
    const first = relaxOf(sel.events).find((e) => e.from !== e.to)!;
    expect(first.say).toBe(`Nothing connected strongly enough at the ${first.from} band, so showing ${first.to === "calibration" ? "close" : first.to}.`);
    for (const e of relaxOf(sel.events)) {
      for (const text of [e.say, e.reason]) expect(text).not.toMatch(/reach|calibration|floor|quantile|edge|margin|score/i);
    }
    const stayed = relaxOf(selectBands(poolOf([]), { bands: ["extreme"] }).events).find((e) => e.from === e.to)!;
    expect(stayed.say).toBe("Nothing connected strongly enough at the extreme band, and nothing nearer to show instead.");
  });

  it("extras added by relaxation never break the reach margin for the bands above them (many pools)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const bandSets: Band[][] = [ALL, ["moderate", "high", "extreme"], ["high", "extreme"], ["calibration", "high"], ["extreme"]];
    let relaxed = 0;
    let checked = 0;
    for (let trial = 0; trial < 300; trial++) {
      const count = 3 + Math.floor(rnd() * 30);
      const lo = 0.2 + rnd() * 0.3;
      const width = rnd() * 0.5;
      const specs: Spec[] = Array.from({ length: count }, (_, i) => ({ n: 100 + i, reach: lo + rnd() * width, affinity: rnd(), popularity: rnd() < 0.2 ? 0 : 0.05 + rnd() * 0.5 }));
      const bands = bandSets[trial % bandSets.length]!;
      const perBand = 1 + Math.floor(rnd() * 3);
      const sel = selectBands(poolOf(specs), { bands, perBand });
      relaxed += relaxOf(sel.events).filter((e) => e.from !== e.to).length > 0 ? 1 : 0;
      const meds = ALL.map((b) => median(sel.byBand[b].map((p) => p.reach.reach))).filter((m): m is number => m !== null);
      for (let i = 1; i < meds.length; i++) {
        expect(meds[i]! - meds[i - 1]!).toBeGreaterThanOrEqual(MIN_REACH_MARGIN);
        checked++;
      }
      const ids = sel.picks.map((p) => p.qlooId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of sel.picks) expect(p.connection).toBeGreaterThanOrEqual(CONNECTION_FLOOR);
      const m = median(knownPop([...sel.byBand.calibration, ...sel.byBand.moderate]));
      if (m !== null) for (const p of [...sel.byBand.high, ...sel.byBand.extreme]) if (p.popularity > 0) expect(p.popularity).toBeLessThan(m);
    }
    // The property is only meaningful if relaxation and the margin were actually exercised.
    expect(relaxed).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(100);
  });

  it("reports a thin field and never pads it", () => {
    const sel = selectBands(poolOf([...spread(2), ...Array.from({ length: 30 }, (_, i) => ({ n: 300 + i, reach: 0.5, clears: false }))]), { bands: ["calibration", ...EDGE_BANDS] });
    expect(sel.clearedCount).toBe(2);
    expect(sel.thin).toBe(true);
    expect(sel.picks.length).toBeLessThanOrEqual(2);
    expect(sel.picks.every((p) => p.connection >= CONNECTION_FLOOR)).toBe(true);
  });

  it("an empty pool yields no picks and every requested band empty", () => {
    const sel = selectBands(poolOf([]), { bands: [...EDGE_BANDS] });
    expect(sel.picks).toEqual([]);
    expect(sel.emptyBands).toEqual([...EDGE_BANDS]);
    expect(sel.dial).toEqual({ matchMedianPopularity: null, stretchMedianPopularity: null });
  });

  it("is deterministic", () => {
    const a = selectBands(poolOf(spread(40)), { bands: ["calibration", ...EDGE_BANDS] });
    const b = selectBands(poolOf([...spread(40)].reverse()), { bands: ["calibration", ...EDGE_BANDS] });
    expect(a.picks.map((p) => p.qlooId)).toEqual(b.picks.map((p) => p.qlooId));
  });
});
