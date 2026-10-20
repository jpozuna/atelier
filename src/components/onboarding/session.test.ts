import { describe, expect, it } from "vitest";
import { assembleTrace, parseFlowSession, parseTasteSession, SESSION_VERSION } from "./session";
import { buildEntry } from "./flow";
import type { Entry } from "./flow";
import { resolvedDraft } from "./fixtures";
import type { ProfileSeed, TraceEvent } from "./types";

const tags = [{ tag: "urn:tag:fixture:media:quiet", name: "Quiet", tagType: "urn:tag:theme:media" }];
const entry = (n: number, whyTags = tags, event?: TraceEvent): Entry => buildEntry(resolvedDraft("film", n), `seed-${n}`, whyTags, event)!;

describe("flow session", () => {
  it("round-trips entries with their why tags", () => {
    const entries = [entry(1), entry(2, [])];
    const raw = JSON.stringify({ version: SESSION_VERSION, field: "music", entries });
    const parsed = parseFlowSession(raw)!;
    expect(parsed.field).toBe("music");
    expect(parsed.entries).toEqual(entries);
  });

  it("returns null for junk, wrong version or unknown field", () => {
    expect(parseFlowSession(null)).toBeNull();
    expect(parseFlowSession("{")).toBeNull();
    expect(parseFlowSession(JSON.stringify({ version: 99, field: "film", entries: [] }))).toBeNull();
    expect(parseFlowSession(JSON.stringify({ version: 1, field: "cars", entries: [] }))).toBeNull();
  });

  it("drops malformed, duplicate and freeform-tag entries", () => {
    const good = entry(1);
    const dupe = { ...entry(2), seed: { ...entry(2).seed, qlooId: good.seed.qlooId } };
    const freeform = { ...entry(3), seed: { ...entry(3).seed, whyTags: [{ tag: "words", name: "x", tagType: "t" }] } };
    const raw = JSON.stringify({ version: 1, field: "film", entries: [good, dupe, freeform, { seed: 1 }] });
    expect(parseFlowSession(raw)!.entries).toEqual([good]);
  });
});

describe("taste session", () => {
  const seeds: ProfileSeed[] = [entry(1).seed];
  const profile = {
    seedIds: ["seed-1"],
    skippedSeeds: [],
    fields: ["film"],
    tags: [],
    bridgeTagIds: [],
    droppedGenericCount: 0,
    droppedAxisTagTypes: [],
    naming: {},
  };
  const base = { version: SESSION_VERSION, seeds, profile, axes: [], trace: [] };

  it("reads a stored result", () => {
    const parsed = parseTasteSession(JSON.stringify(base))!;
    expect(parsed.seeds).toEqual(seeds);
    expect(parsed.axes).toEqual([]);
  });

  it("is null when a profile array is missing or malformed, so /taste cannot crash on it", () => {
    for (const bad of [
      { ...profile, skippedSeeds: undefined },
      { ...profile, fields: ["cars"] },
      { ...profile, seedIds: [1] },
      { ...profile, tags: [{ nope: 1 }] },
      { ...profile, bridgeTagIds: "x" },
      { ...profile, naming: { a: "other" } },
      { ...profile, axisShortfall: { wanted: "6" } },
    ]) {
      expect(parseTasteSession(JSON.stringify({ ...base, profile: bad }))).toBeNull();
    }
    expect(parseTasteSession(JSON.stringify({ ...base, profile: { ...profile, axisShortfall: { wanted: 6, got: 4 } } }))).not.toBeNull();
  });

  it("is null with more than the most seeds", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...seeds[0], id: `s${i}` }));
    expect(parseTasteSession(JSON.stringify({ ...base, seeds: many }))).toBeNull();
  });

  it("is null without seeds or with bad axes", () => {
    expect(parseTasteSession(JSON.stringify({ ...base, seeds: [] }))).toBeNull();
    expect(parseTasteSession(JSON.stringify({ ...base, axes: [{ bad: 1 }] }))).toBeNull();
    expect(parseTasteSession(null)).toBeNull();
  });
});

describe("assembleTrace", () => {
  const when = new Date("2026-10-19T12:00:00Z");
  const why = (id: string): TraceEvent => ({ kind: "map_why", t: "x", say: "x", seedId: id, tagIds: [], semanticSearch: true });
  const built: TraceEvent = { kind: "build_axes", t: "x", say: "x", axisIds: [], tagCounts: {} };

  it("lists each seed as resolved, then its reason, then the profile build, in order", () => {
    const entries = [entry(1, tags, why("seed-1")), entry(2, tags, why("other"))];
    const out = assembleTrace(entries, [built], when);
    expect(out.map((e) => e.kind)).toEqual(["resolve_seed", "map_why", "resolve_seed", "build_axes"]);
    expect(out[0]).toMatchObject({ seedId: "seed-1", status: "clean", candidateCount: 1 });
  });
});
