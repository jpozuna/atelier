import { describe, expect, it } from "vitest";
import { CALIBRATION_PICKS_MAX, EDGE_FIELD_SHARE_MAX, EDGE_PICKS_MAX, MIN_REACH_MARGIN } from "@/lib/agent/config";
import { BANDS, FIELDS, type Band, type Field, type Path } from "@/types";
import { isTraceEvent } from "@/types";
import { capEdgePicks, capTraceEvent, EDGE_BANDS, median } from "./index";
import type { BandSelection, FrontierPick } from "./index";
import { id, tg } from "./fixtures";
import { scoreDialBehavior } from "../../../evals/scorers/dial-behavior";
import { scoreEdgeCap } from "../../../evals/scorers/edge-cap";
import { scoreReachMargin } from "../../../evals/scorers/reach-margin";

const BASE_REACH: Record<Band, number> = { calibration: 0.15, moderate: 0.4, high: 0.65, extreme: 0.9 };
const POPULARITY: Record<Band, number> = { calibration: 0.5, moderate: 0.5, high: 0.2, extreme: 0.1 };

let counter = 0;

const path = (seedId: string): Path => ({
  seedId,
  anchor: { contribution: null, source: "tag_overlap" },
  hops: [
    { kind: "seed", label: "Invented Work 1", provenance: "inferred" },
    { kind: "theme", label: "Fixture Tag 1", tags: [tg(1)], provenance: "inferred" },
    { kind: "pick", label: "Invented Pick", provenance: "inferred" },
  ],
  sharedTags: [tg(1)],
  distinctive: true,
});

interface Spec {
  field: Field;
  band: Band;
  connection?: number;
  reach?: number;
  popularity?: number;
  seedId?: string;
}

function pick(s: Spec): FrontierPick {
  const n = ++counter;
  const reach = s.reach ?? BASE_REACH[s.band] + (n % 5) * 0.004;
  return {
    id: `pick-${id(n)}`,
    qlooId: id(n),
    name: `Invented Pick ${n}`,
    field: s.field,
    popularity: s.popularity ?? POPULARITY[s.band],
    reach: { tagDistance: reach, obscurity: reach, fieldUnfamiliarity: reach, reach },
    connection: s.connection ?? 0.3 + ((n * 37) % 100) / 200,
    band: s.band,
    llmBridged: false,
    origin: "unknown",
    path: path(s.seedId ?? "seed-1"),
  };
}

function selection(field: Field, specs: Spec[]): BandSelection {
  const byBand = { calibration: [], moderate: [], high: [], extreme: [] } as Record<Band, FrontierPick[]>;
  for (const s of specs) byBand[s.band].push(pick({ ...s, field }));
  return {
    domain: field,
    picks: BANDS.flatMap((b) => byBand[b]),
    byBand,
    emptyBands: [],
    thin: false,
    clearedCount: specs.length,
    dial: { matchMedianPopularity: null, stretchMedianPopularity: null },
    events: [],
  };
}

/** `per` picks of every band (calibration too) in each of the given fields. */
const fullField = (field: Field, per = 4): BandSelection => selection(field, BANDS.flatMap((band) => Array.from({ length: per }, () => ({ field, band }))));
const fullRun = (fields: readonly Field[] = FIELDS, per = 4): BandSelection[] => fields.map((f) => fullField(f, per));

const edgeOf = (sels: BandSelection[]): FrontierPick[] => sels.flatMap((s) => s.picks).filter((p) => p.band !== "calibration");
const countBy = <T>(xs: T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
};
const fieldCap = (shown: number): number => Math.floor(EDGE_FIELD_SHARE_MAX * shown);

describe("capEdgePicks: a full run", () => {
  it("shows at most EDGE_PICKS_MAX edge picks, split 7, 7, 6 across moderate, high and extreme", () => {
    const { selections, summary } = capEdgePicks(fullRun());
    const edge = edgeOf(selections);
    expect(edge).toHaveLength(EDGE_PICKS_MAX);
    expect(countBy(edge, (p) => p.band)).toEqual({ moderate: 7, high: 7, extreme: 6 });
    expect(summary.edgeShown).toBe(20);
    expect(summary.byBand).toMatchObject({ moderate: 7, high: 7, extreme: 6 });
  });

  it("holds every field to floor(share x shown)", () => {
    const { selections } = capEdgePicks(fullRun());
    const edge = edgeOf(selections);
    for (const n of Object.values(countBy(edge, (p) => p.field))) expect(n).toBeLessThanOrEqual(fieldCap(edge.length));
  });

  it("keeps the strongest connection in each band", () => {
    // One field (film) has the strongest connections in every band; the cap must still trim it, but to its best.
    const sels = FIELDS.map((f) =>
      selection(
        f,
        BANDS.flatMap((band) => Array.from({ length: 4 }, (_, i) => ({ field: f, band, connection: f === "film" ? 0.9 - i * 0.01 : 0.5 - i * 0.01 }))),
      ),
    );
    const { selections } = capEdgePicks(sels);
    const edge = edgeOf(selections);
    const film = edge.filter((p) => p.field === "film");
    expect(film.length).toBe(fieldCap(edge.length));
    const dropped = sels.find((s) => s.domain === "film")!.picks.filter((p) => p.band !== "calibration" && !film.includes(p) && !film.some((k) => k.qlooId === p.qlooId));
    for (const d of dropped) {
      const kept = film.filter((k) => k.band === d.band);
      for (const k of kept) expect(k.connection).toBeGreaterThanOrEqual(d.connection);
    }
  });

  it("is deterministic and does not depend on the order of the edge picks or of the fields", () => {
    const sels = fullRun();
    const edgeIds = (r: BandSelection[]) => edgeOf(capEdgePicks(r).selections).map((p) => p.qlooId).sort();
    // The order of calibration picks within a field means closest first, so only the edge bands are reversed.
    const reversed = [...sels].reverse().map((s) => {
      const byBand = { ...s.byBand, moderate: [...s.byBand.moderate].reverse(), high: [...s.byBand.high].reverse(), extreme: [...s.byBand.extreme].reverse() };
      return { ...s, byBand, picks: BANDS.flatMap((b) => byBand[b]) };
    });
    expect(edgeIds(reversed)).toEqual(edgeIds(sels));
  });

  it("does not change its input", () => {
    const sels = fullRun();
    const before = JSON.stringify(sels);
    capEdgePicks(sels);
    expect(JSON.stringify(sels)).toBe(before);
  });

  it("returns the same selections (domain and order) with only the kept picks", () => {
    const sels = fullRun();
    const { selections } = capEdgePicks(sels);
    expect(selections.map((s) => s.domain)).toEqual(sels.map((s) => s.domain));
    for (const s of selections) {
      expect(s.picks).toEqual(BANDS.flatMap((b) => s.byBand[b]));
      for (const b of BANDS) for (const p of s.byBand[b]) expect(p.band).toBe(b);
    }
  });
});

describe("capEdgePicks: few fields and a dominant field", () => {
  it("with 3 fields keeps the share limit; with 1 or 2 it uses the fixed per-field limit", () => {
    const three = capEdgePicks(fullRun(["film", "music", "books"]));
    const edge3 = edgeOf(three.selections);
    expect(edge3.length).toBeLessThanOrEqual(EDGE_PICKS_MAX);
    for (const n of Object.values(countBy(edge3, (p) => p.field))) expect(n).toBeLessThanOrEqual(fieldCap(edge3.length));

    // Fewer than 3 fields: the fixed per-field limit of floor(share x max) = 8 applies instead.
    const two = edgeOf(capEdgePicks(fullRun(["film", "music"])).selections);
    expect(two).toHaveLength(2 * fieldCap(EDGE_PICKS_MAX));
    expect(countBy(two, (p) => p.band)).toEqual({ moderate: 6, high: 5, extreme: 5 });
    for (const n of Object.values(countBy(two, (p) => p.field))) expect(n).toBeLessThanOrEqual(fieldCap(EDGE_PICKS_MAX));
    const one = edgeOf(capEdgePicks(fullRun(["film"])).selections);
    expect(one).toHaveLength(fieldCap(EDGE_PICKS_MAX));
  });

  it("fewer fields never pads: a two-field pool smaller than the limit shows all of it", () => {
    const edge = edgeOf(capEdgePicks(fullRun(["film", "music"], 1)).selections);
    expect(edge).toHaveLength(6);
  });

  it("a thin pool shows fewer than 20 and never pads", () => {
    // Film is deep; five small fields have two edge picks each. Strict would show 16 (film 6 of 16); fixed shows 18 (film 8), so fixed wins.
    const small = FIELDS.filter((f) => f !== "film").map((f) =>
      selection(f, [
        { field: f, band: "moderate" },
        { field: f, band: "high" },
      ]),
    );
    const { selections, summary } = capEdgePicks([fullField("film", 8), ...small]);
    const edge = edgeOf(selections);
    expect(edge).toHaveLength(18);
    expect(edge.filter((p) => p.field === "film")).toHaveLength(fieldCap(EDGE_PICKS_MAX));
    expect(summary.fieldLimit).toBe("fixed");
  });

  it("the cliff: two full fields plus a third with one pick show 17 (fixed), not 5 (strict)", () => {
    const { selections, summary } = capEdgePicks([fullField("film", 4), fullField("music", 4), selection("tv", [{ field: "tv", band: "high" }])]);
    const edge = edgeOf(selections);
    expect(edge).toHaveLength(2 * fieldCap(EDGE_PICKS_MAX) + 1);
    expect(countBy(edge, (p) => p.field)).toEqual({ film: 8, music: 8, tv: 1 });
    expect(summary.fieldLimit).toBe("fixed");
  });

  it("with 3 fields deep enough, the strict share holds and wins", () => {
    const { selections, summary } = capEdgePicks(fullRun(["film", "music", "books"], 4));
    const edge = edgeOf(selections);
    expect(edge).toHaveLength(EDGE_PICKS_MAX);
    expect(summary.fieldLimit).toBe("share");
    for (const n of Object.values(countBy(edge, (p) => p.field))) expect(n).toBeLessThanOrEqual(fieldCap(edge.length));
  });

  it("strict wins when it shows as many as fixed: 3 fields with 4 picks each show all 12 under 40% (4 of 12 is one third)", () => {
    const { selections, summary } = capEdgePicks([selection("film", Array.from({ length: 4 }, (_, i) => ({ field: "film" as const, band: EDGE_BANDS[i % 3]! }))), selection("music", Array.from({ length: 4 }, (_, i) => ({ field: "music" as const, band: EDGE_BANDS[i % 3]! }))), selection("books", Array.from({ length: 4 }, (_, i) => ({ field: "books" as const, band: EDGE_BANDS[i % 3]! })))]);
    expect(edgeOf(selections)).toHaveLength(12);
    expect(summary.fieldLimit).toBe("share");
  });

  it("a run limited to some fields takes the limit from EDGE_PICKS_MAX", () => {
    const { selections } = capEdgePicks([fullField("film", 8)], { fieldShareOf: "max" });
    const edge = edgeOf(selections);
    expect(edge).toHaveLength(fieldCap(EDGE_PICKS_MAX));
    expect(countBy(edge, (p) => p.band)).toEqual({ moderate: 3, high: 3, extreme: 2 });
  });
});

describe("capEdgePicks: every field with an eligible pick shows at least one", () => {
  it("gives a weakly connected field its strongest pick even when other fields crowd it out", () => {
    const strongFields = ["film", "music", "tv"] as const;
    const weakFields = ["books", "food_places", "fashion"] as const;
    const sels = [
      ...strongFields.map((f) => selection(f, BANDS.flatMap((band) => Array.from({ length: 4 }, (_, i) => ({ field: f, band, connection: 0.9 - i * 0.01 }))))),
      ...weakFields.map((f) => selection(f, [{ field: f, band: "high", connection: 0.35 }, { field: f, band: "extreme", connection: 0.32 }])),
    ];
    const { selections } = capEdgePicks(sels);
    const edge = edgeOf(selections);
    for (const f of FIELDS) expect(edge.filter((p) => p.field === f).length, f).toBeGreaterThanOrEqual(1);
    // The one a weak field shows is its strongest.
    for (const f of weakFields) expect(edge.find((p) => p.field === f)!.connection).toBe(0.35);
  });

  it("a field trimmed by the cap still keeps one edge pick, so it is never shown empty", () => {
    const sels = FIELDS.map((f) => selection(f, BANDS.flatMap((band) => Array.from({ length: 4 }, (_, i) => ({ field: f, band, connection: f === "fashion" ? 0.4 - i * 0.01 : 0.9 - i * 0.01 })))));
    const { selections } = capEdgePicks(sels);
    expect(edgeOf(selections).filter((p) => p.field === "fashion").length).toBeGreaterThanOrEqual(1);
  });
});

describe("capEdgePicks: a band that runs short", () => {
  it("hands its slots to the other bands, as long as no field goes over", () => {
    const sels = FIELDS.map((f) =>
      selection(
        f,
        BANDS.filter((b) => b !== "extreme").flatMap((band) => Array.from({ length: 4 }, () => ({ field: f, band }))),
      ),
    );
    const edge = edgeOf(capEdgePicks(sels).selections);
    expect(edge).toHaveLength(EDGE_PICKS_MAX);
    expect(countBy(edge, (p) => p.band)).toEqual({ moderate: 10, high: 10 });
    for (const n of Object.values(countBy(edge, (p) => p.field))) expect(n).toBeLessThanOrEqual(fieldCap(edge.length));
  });

  it("shows fewer than 20 when the pool holds fewer than 20 and keeps every one", () => {
    const sels = fullRun(FIELDS, 1);
    const edge = edgeOf(capEdgePicks(sels).selections);
    expect(edge).toHaveLength(18);
    expect(countBy(edge, (p) => p.band)).toEqual({ moderate: 6, high: 6, extreme: 6 });
  });
});

describe("capEdgePicks: strength", () => {
  it("gives every kept edge pick a word, by thirds of the kept picks ordered by connection", () => {
    const { selections } = capEdgePicks(fullRun());
    const edge = edgeOf(selections);
    expect(edge.every((p) => p.strength !== undefined)).toBe(true);
    expect(countBy(edge, (p) => p.strength!)).toEqual({ strong: 7, steady: 7, light: 6 });
    const order = { strong: 0, steady: 1, light: 2 } as const;
    const sorted = [...edge].sort((a, b) => b.connection - a.connection);
    for (let i = 1; i < sorted.length; i++) expect(order[sorted[i]!.strength!]).toBeGreaterThanOrEqual(order[sorted[i - 1]!.strength!]);
  });

  it("is deterministic when connections tie", () => {
    const sels = FIELDS.map((f) => selection(f, EDGE_BANDS.flatMap((band) => [{ field: f, band, connection: 0.5 }, { field: f, band, connection: 0.5 }])));
    const a = capEdgePicks(sels).selections.flatMap((s) => s.picks).map((p) => `${p.qlooId}:${p.strength}`).sort();
    const b = capEdgePicks([...sels].reverse()).selections.flatMap((s) => s.picks).map((p) => `${p.qlooId}:${p.strength}`).sort();
    expect(b).toEqual(a);
  });

  it("a single kept pick is strong; calibration picks carry no strength", () => {
    const one = capEdgePicks([selection("film", [{ field: "film", band: "moderate" }])], { fieldShareOf: "max" });
    expect(one.selections[0]!.picks.map((p) => p.strength)).toEqual(["strong"]);
    const { selections } = capEdgePicks(fullRun());
    for (const p of selections.flatMap((s) => s.picks).filter((p) => p.band === "calibration")) expect(p.strength).toBeUndefined();
  });
});

describe("capEdgePicks: calibration", () => {
  it("keeps at most CALIBRATION_PICKS_MAX across fields and never counts them toward the edge total", () => {
    const { selections, summary } = capEdgePicks(fullRun());
    const cal = selections.flatMap((s) => s.picks).filter((p) => p.band === "calibration");
    expect(cal).toHaveLength(CALIBRATION_PICKS_MAX);
    expect(summary.calibrationShown).toBe(CALIBRATION_PICKS_MAX);
    expect(edgeOf(selections)).toHaveLength(EDGE_PICKS_MAX);
    // Spread over fields: one field does not take all of them.
    expect(new Set(cal.map((p) => p.field)).size).toBe(CALIBRATION_PICKS_MAX);
  });

  it("takes same-field picks before other-field picks", () => {
    // Seed 1 is a film seed, seed 2 a music seed. Film and music calibration picks anchored on a same-field seed come first.
    const seedFields = new Map<string, Field>([
      ["seed-1", "film"],
      ["seed-2", "music"],
    ]);
    const sels = FIELDS.map((f) =>
      selection(
        f,
        Array.from({ length: 4 }, (_, i) => ({ field: f, band: "calibration" as const, seedId: f === "film" || f === "music" ? (f === "film" ? "seed-1" : "seed-2") : i === 0 ? "seed-1" : "seed-2" })),
      ),
    );
    const cal = capEdgePicks(sels, { seedFields }).selections.flatMap((s) => s.picks);
    expect(cal).toHaveLength(CALIBRATION_PICKS_MAX);
    // film and music have 4 same-field picks each (8 in all, round-robin over fields, 3 each), so no other-field pick is shown.
    expect(cal.every((p) => seedFields.get(p.path.seedId) === p.field)).toBe(true);
    expect(countBy(cal, (p) => p.field)).toEqual({ film: 3, music: 3 });
  });

  it("falls back to other-field picks when same-field ones run out", () => {
    const seedFields = new Map<string, Field>([["seed-1", "film"]]);
    const sels = [selection("film", [{ field: "film", band: "calibration" }]), selection("music", [{ field: "music", band: "calibration" }, { field: "music", band: "calibration" }])];
    const cal = capEdgePicks(sels, { seedFields }).selections.flatMap((s) => s.picks);
    expect(cal).toHaveLength(3);
    expect(cal[0]!.field).toBe("film");
  });
});

describe("capEdgePicks: what the frontier guaranteed still holds after trimming", () => {
  const margin = (picks: FrontierPick[]): boolean => {
    let prev: number | null = null;
    for (const b of BANDS) {
      const m = median(picks.filter((p) => p.band === b).map((p) => p.reach.reach));
      if (m === null) continue;
      if (prev !== null && m - prev + 1e-9 < MIN_REACH_MARGIN) return false;
      prev = m;
    }
    return true;
  };

  it("keeps the reach margin between bands in every field when strong connections would trim it away", () => {
    // In each field the strongly connected picks sit close in reach across bands. Keeping only them would break the margin.
    const sels = FIELDS.map((f) =>
      selection(f, [
        { field: f, band: "moderate", reach: 0.4, connection: 0.4 },
        { field: f, band: "moderate", reach: 0.5, connection: 0.9 },
        { field: f, band: "high", reach: 0.52, connection: 0.9 },
        { field: f, band: "high", reach: 0.7, connection: 0.4 },
        { field: f, band: "high", reach: 0.72, connection: 0.35 },
        { field: f, band: "extreme", reach: 0.9, connection: 0.5 },
        { field: f, band: "extreme", reach: 0.92, connection: 0.45 },
      ]),
    );
    for (const s of sels) expect(margin(s.picks)).toBe(true);
    const { selections } = capEdgePicks(sels);
    for (const s of selections) expect(margin(s.picks)).toBe(true);
    expect(edgeOf(selections).length).toBeGreaterThan(0);
  });

  it("keeps Stretch less popular than Match in every field", () => {
    const sels = FIELDS.map((f) =>
      selection(
        f,
        BANDS.flatMap((band) =>
          Array.from({ length: 4 }, (_, i) => ({ field: f, band, popularity: band === "calibration" || band === "moderate" ? 0.5 : i === 0 ? 0.55 : 0.2, connection: band === "high" && i === 0 ? 0.95 : undefined })),
        ),
      ),
    );
    const { selections } = capEdgePicks(sels);
    for (const s of selections) {
      const m = median(s.picks.filter((p) => p.band === "calibration" || p.band === "moderate").map((p) => p.popularity));
      const st = median(s.picks.filter((p) => p.band === "high" || p.band === "extreme").map((p) => p.popularity));
      if (m !== null && st !== null) expect(st).toBeLessThan(m);
    }
  });
});

describe("capEdgePicks output through the scorers", () => {
  it("passes edge-cap, reach-margin and dial-behavior", () => {
    for (const fields of [FIELDS, ["film", "music", "books"] as const, ["film", "music"] as const]) {
      const { selections, summary } = capEdgePicks(fullRun(fields, 4));
      const trace = [capTraceEvent(summary, new Date("2026-10-22T00:00:00Z"))];
      const result = { domains: FIELDS.map((f) => ({ domain: f, status: "ok", thin: false, picks: selections.find((s) => s.domain === f)?.picks ?? [] })) };
      const input = { id: `cap-${fields.length}`, run: "new_profile" as const, trace, result };
      expect(scoreEdgeCap(input), `${fields.length} fields`).toMatchObject({ pass: true });
      expect(scoreReachMargin(input), `${fields.length} fields`).toMatchObject({ pass: true });
      expect(scoreDialBehavior(input), `${fields.length} fields`).toMatchObject({ pass: true });
    }
  });
});

describe("capTraceEvent", () => {
  it("says what was kept in words and counts, with no scores", () => {
    const { summary } = capEdgePicks(fullRun());
    const e = capTraceEvent(summary, new Date("2026-10-22T00:00:00Z"));
    expect(e).toMatchObject({ kind: "cap", edgeShown: 20, calibrationShown: 6, byBand: { calibration: 6, moderate: 7, high: 7, extreme: 6 } });
    expect(e.say).toMatch(/20 edge picks/);
    expect(Object.keys(e).sort()).toEqual(["byBand", "byField", "calibrationShown", "edgeShown", "fieldLimit", "kind", "say", "t", "trimmed"]);
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/connection|reach|popularity|score|urn:|0000-4000/i);
    expect(isTraceEvent(e)).toBe(true);
  });

  it("says so when nothing is shown", () => {
    const { summary } = capEdgePicks([]);
    expect(capTraceEvent(summary).say).toMatch(/No edge picks/);
  });
});
