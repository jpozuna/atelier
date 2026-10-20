import { describe, expect, it } from "vitest";
import {
  buildProfileRequest,
  buildResolveRequest,
  buildWhyRequest,
  errorCode,
  readProfile,
  readResolve,
  readWhy,
} from "./api";
import { COPY, isCalmError } from "./copy";
import { chip, uid } from "./fixtures";

describe("request builders", () => {
  it("posts JSON to the three routes with exactly the documented fields", () => {
    const r = buildResolveRequest("film", "invented");
    expect(r.url).toBe("/api/seeds/resolve");
    expect(r.init.method).toBe("POST");
    expect(JSON.parse(r.init.body)).toEqual({ field: "film", query: "invented" });
    expect(JSON.parse(buildWhyRequest("music", "quiet", "s1").init.body)).toEqual({ field: "music", why: "quiet", seedId: "s1" });
    expect(buildWhyRequest("music", "quiet", "s1").url).toBe("/api/profile/why");
    const p = buildProfileRequest([]);
    expect(p.url).toBe("/api/profile");
    expect(JSON.parse(p.init.body)).toEqual({ seeds: [] });
  });
});

describe("readResolve", () => {
  it("reads clean, ambiguous and missing", () => {
    const clean = readResolve(200, { status: "clean", entity: chip(1), candidates: [] });
    expect(clean).toMatchObject({ kind: "clean", chip: { qlooId: uid(1) } });
    const amb = readResolve(200, { status: "ambiguous", candidates: [chip(1), chip(2)] });
    expect(amb).toMatchObject({ kind: "ambiguous", chosenId: null });
    expect(readResolve(200, { status: "missing", candidates: [] })).toEqual({ kind: "missing" });
  });

  it("shows at most 5 chips and drops unusable ones", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map(chip);
    const r = readResolve(200, { status: "ambiguous", candidates: [{ nope: true }, ...many] });
    expect(r.kind === "ambiguous" && r.chips.length).toBe(5);
    expect(readResolve(200, { status: "ambiguous", candidates: [{ nope: true }] })).toEqual({ kind: "missing" });
  });

  it("only keeps https images", () => {
    const r = readResolve(200, {
      status: "clean",
      entity: { ...chip(1), imageUrl: "http://example.invalid/a.png" },
      candidates: [],
    });
    expect(r.kind === "clean" && r.chip.imageUrl).toBeUndefined();
  });

  it("maps lookups_off to the resting message and never shows the server text", () => {
    const r = readResolve(503, { error: { code: "lookups_off", message: "server text QLOO_MODE=replay" } });
    expect(r).toMatchObject({ kind: "error", code: "lookups_off", message: COPY.resting });
    expect(JSON.stringify(r)).not.toContain("QLOO_MODE");
    expect(COPY.resting).not.toContain("!");
  });

  it("maps demo_resting and budget to one fixed resting message, with the code kept for the screen", () => {
    for (const code of ["demo_resting", "budget"]) {
      const r = readResolve(503, { error: { code, message: "server text with a secret", retryAfterSeconds: 90 } });
      expect(r).toMatchObject({ kind: "error", code, message: COPY.resting });
      expect(JSON.stringify(r)).not.toContain("secret");
    }
    expect(COPY.resting).toBe("The demo is resting for now. Your list and chart are kept here; try again later.");
  });

  it("maps too_many_requests, and a bare 429, to a gentle wait message", () => {
    expect(readResolve(429, { error: { code: "too_many_requests", message: "server text" } })).toMatchObject({ kind: "error", code: "too_many_requests", message: COPY.tooMany });
    expect(readResolve(429, null)).toMatchObject({ kind: "error", message: COPY.tooMany });
    expect(COPY.tooMany).toBe("A lot of searches just now. Try again in a minute.");
  });

  it("turns other failures into a retry message", () => {
    expect(readResolve(502, { error: { code: "upstream", message: "x" } })).toMatchObject({ kind: "error", message: COPY.lookupFailed });
    expect(readResolve(0, null)).toMatchObject({ kind: "error", message: COPY.lookupFailed });
    expect(readResolve(503, { error: { code: "rate_limited", message: "x" } })).toMatchObject({ message: COPY.lookupBusy });
    expect(readResolve(503, null)).toMatchObject({ message: COPY.lookupBusy });
    expect(readResolve(200, { status: "weird" }).kind).toBe("error");
  });
});

describe("readWhy", () => {
  const tag = { tag: "urn:tag:fixture:media:quiet", name: "Quiet", tagType: "urn:tag:theme:media" };
  const event = { kind: "map_why", t: "2026-01-01T00:00:00Z", say: "x", seedId: "s1", tagIds: [tag.tag], semanticSearch: true };

  it("reads tags and the map_why event, and accepts an empty match", () => {
    expect(readWhy(200, { tags: [tag], trace: [event] })).toEqual({ ok: true, tags: [tag], event });
    expect(readWhy(200, { tags: [] })).toEqual({ ok: true, tags: [] });
  });

  it("fails soft: a failed lookup keeps the event and no tags", () => {
    const failed = { ...event, failed: "unavailable", tagIds: [] };
    expect(readWhy(503, { error: { code: "lookups_off", message: "x" }, trace: [failed] })).toEqual({ ok: false, event: failed });
    expect(readWhy(500, null)).toEqual({ ok: false });
  });

  it("rejects malformed tags rather than passing them on", () => {
    expect(readWhy(200, { tags: [{ tag: "freeform words", name: "x", tagType: "urn:tag:a:b" }] }).ok).toBe(false);
    expect(readWhy(200, { tags: [{ tag: "urn:tag:fixture:b:c", name: "x", tagType: "theme" }] }).ok).toBe(false);
    // Same rules as the server: no whitespace in a tag type, at most 5 tags, a name that is not blank.
    expect(readWhy(200, { tags: [{ tag: tag.tag, name: "x", tagType: "urn:tag:the me:media" }] }).ok).toBe(false);
    expect(readWhy(200, { tags: [{ ...tag, name: "   " }] }).ok).toBe(false);
    expect(readWhy(200, { tags: Array.from({ length: 6 }, () => tag) }).ok).toBe(false);
  });
});

describe("readProfile", () => {
  const axis = {
    id: "axis-a",
    label: "Quiet",
    labelJustification: "From the quiet tag",
    weight: 1,
    tagType: "urn:tag:theme:media",
    tags: [
      { tag: "urn:tag:fixture:media:a", name: "A", tagType: "urn:tag:theme:media", affinity: 0.5, types: ["urn:entity:movie"], weight: 0.5, fields: ["film"], source: "taste_analysis" },
      { tag: "urn:tag:fixture:media:b", name: "B", tagType: "urn:tag:theme:media", affinity: 0.4, types: ["urn:entity:movie"], weight: 0.4, fields: ["film"], source: "taste_analysis" },
    ],
  };
  const profile = { seedIds: ["s1"], skippedSeeds: [], fields: ["film"], tags: [], bridgeTagIds: [], droppedGenericCount: 0, droppedAxisTagTypes: [], naming: {} };
  const noProfileArrays = { seedIds: ["s1"], fields: ["film"] };

  it("reads profile, axes and valid trace events", () => {
    const r = readProfile(200, { profile, axes: [axis], trace: [{ nope: 1 }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.axes).toHaveLength(1);
      expect(r.result.trace).toEqual([]);
    }
  });

  it("maps error codes to calm messages", () => {
    expect(readProfile(422, { error: { code: "empty_profile", message: "x" } })).toMatchObject({ ok: false, message: COPY.profileEmpty });
    expect(readProfile(503, { error: { code: "lookups_off", message: "x" } })).toMatchObject({ ok: false, message: COPY.resting });
    expect(readProfile(503, { error: { code: "demo_resting", message: "server text" } })).toEqual({ ok: false, code: "demo_resting", message: COPY.resting });
    expect(readProfile(429, { error: { code: "too_many_requests", message: "server text" } })).toEqual({ ok: false, code: "too_many_requests", message: COPY.tooMany });
    expect(readProfile(500, null)).toMatchObject({ ok: false, message: COPY.profileFailed });
    expect(readProfile(200, { profile, axes: [{ bad: 1 }] }).ok).toBe(false);
    expect(readProfile(200, { profile: noProfileArrays, axes: [axis] }).ok).toBe(false);
  });

  it("isCalmError is true for resting and too many, false for real failures", () => {
    for (const code of ["demo_resting", "budget", "lookups_off", "too_many_requests"]) expect(isCalmError(code)).toBe(true);
    for (const code of [undefined, "upstream", "empty_profile", "payload_too_large"]) expect(isCalmError(code)).toBe(false);
  });

  it("errorCode reads only a string code", () => {
    expect(errorCode({ error: { code: 3 } })).toBeUndefined();
    expect(errorCode({ error: { code: "budget" } })).toBe("budget");
  });
});
