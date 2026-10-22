import { describe, expect, it } from "vitest";
import type { Pick as AtelierPick } from "@/types";
import { toPublicResult } from "./public";
import type { RunResult } from "./types";

const path: AtelierPick["path"] = {
  seedId: "seed-1",
  anchor: { contribution: 0.7, source: "qloo_explainability" },
  hops: [
    { kind: "seed", label: "Invented Work 1", provenance: "inferred" },
    { kind: "theme", label: "Fixture Tag 1", tags: ["urn:tag:fixture:theme:t1"], provenance: "inferred" },
    { kind: "pick", label: "Invented Pick 1", provenance: "inferred" },
  ],
  sharedTags: ["urn:tag:fixture:theme:t1"],
  distinctive: true,
};

function pick(over: Partial<AtelierPick> = {}): AtelierPick {
  return {
    id: "pick-1",
    qlooId: "00000000-0000-4000-8000-000000000001",
    name: "Invented Pick 1",
    field: "film",
    popularity: 0.31,
    reach: { tagDistance: 0.61, obscurity: 0.72, fieldUnfamiliarity: 0.4, reach: 0.63 },
    connection: 0.55,
    band: "high",
    llmBridged: false,
    origin: "unknown",
    path,
    card: { path, why: "A line.", different: "Another line.", provenance: { sourced: 0, inferred: 3 } },
    ...over,
  };
}

const result = (picks: AtelierPick[]): RunResult => ({
  domains: [{ domain: "film", status: "ok", picks, byBand: { calibration: [], moderate: [], high: picks, extreme: [] }, emptyBands: [], thin: false }],
  plan: { themes: [], requeries: [] },
  meta: { qloo: null, requeries: [], notRequeried: [], anthropic: { calls: 0, cacheHits: 0, failures: 0 }, fallbacks: [] },
  audit: { seedIds: [], exclude: {}, tagRarity: {}, seeds: [] },
});

describe("toPublicResult and strength", () => {
  it("keeps strength as a word while stripping every number about taste", () => {
    const pub = toPublicResult(result([pick({ strength: "strong" }), pick({ id: "pick-2", strength: "light" })]));
    const [a, b] = pub.domains[0]!.picks;
    expect(a!.strength).toBe("strong");
    expect(b!.strength).toBe("light");
    for (const p of [a!, b!]) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["reach"]));
      expect("reach" in p || "connection" in p || "popularity" in p).toBe(false);
    }
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/"(reach|connection|popularity|tagDistance|obscurity|fieldUnfamiliarity)"/);
    expect(text).not.toMatch(/"contribution":\s*[0-9]/);
    // The only values about connection that remain are the three words.
    expect(JSON.stringify(pub.domains[0]!.byBand.high.map((p) => p.strength))).toBe('["strong","light"]');
  });

  it("leaves strength off a pick that has none (calibration)", () => {
    const pub = toPublicResult(result([pick({ band: "calibration" })]));
    expect("strength" in pub.domains[0]!.picks[0]!).toBe(false);
  });
});
