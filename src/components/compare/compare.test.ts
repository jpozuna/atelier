import { describe, expect, it } from "vitest";
import { FIELDS } from "@/types";
import { makeFixtureResult, FIXTURE_INPUTS } from "@/components/deck/fixture";
import { COPY, canRetry, failedFor, isCalm } from "./copy";
import { buildCompareBody, readCompareReply } from "./request";
import { compareKey, parseStoredCompare, serializeStoredCompare } from "./storage";
import { atelierByField, buildRows } from "./view";
import type { PlainPick } from "./types";

const plain: PlainPick[] = [
  { name: "Fixture Song", field: "music", why: "Quiet." },
  { name: "Fixture Film", field: "film", why: "Spare." },
];

describe("buildCompareBody", () => {
  it("sends the user's words and the fields in order, and nothing from the profile", () => {
    const seeds = FIXTURE_INPUTS.seeds.map((s) => ({ ...s }));
    const body = buildCompareBody(seeds, ["film", "music"]);
    expect(body.fields).toEqual(["music", "film"]);
    expect(Object.keys(body.seeds[0]!).sort()).toEqual(["field", "typed", "why"]);
    expect(JSON.stringify(body)).not.toMatch(/00000000-0000-4000|urn:tag|qlooId/);
  });
});

describe("readCompareReply", () => {
  it("reads picks, turns a bad success into unusable, and reads an error code", () => {
    expect(readCompareReply(200, { picks: plain })).toEqual({ ok: true, picks: plain });
    expect(readCompareReply(200, { picks: [{ name: "x" }] })).toEqual({ ok: false, code: "unusable" });
    expect(readCompareReply(503, { error: { code: "model_off", message: "x" } })).toEqual({ ok: false, code: "model_off" });
    expect(readCompareReply(500, null)).toEqual({ ok: false, code: "http_500" });
  });
});

describe("stored compare", () => {
  const key = compareKey("abcd1234", ["music", "film"]);
  it("round-trips for the same ask and not for another", () => {
    const raw = serializeStoredCompare({ version: 1, key, picks: plain });
    expect(parseStoredCompare(raw, key)).toEqual(plain);
    expect(parseStoredCompare(raw, compareKey("abcd1234", ["music"]))).toBeNull();
    expect(parseStoredCompare(raw, compareKey("other000", ["music", "film"]))).toBeNull();
  });
  it("never trusts what it reads", () => {
    for (const raw of [null, "", "{", "[]", "null", JSON.stringify({ version: 2, key, picks: plain }), JSON.stringify({ version: 1, key, picks: [{ name: "x" }] })]) {
      expect(parseStoredCompare(raw, key)).toBeNull();
    }
  });
});

describe("view", () => {
  const result = makeFixtureResult();
  const opts = { hidden: [], notMe: [], seeds: FIXTURE_INPUTS.seeds };

  it("holds edge picks only, by field in field order, skipping fields with none", () => {
    const by = atelierByField(result, opts);
    expect([...by.keys()]).toEqual(FIELDS.filter((f) => by.has(f)));
    for (const picks of by.values()) for (const p of picks) expect(p.band).not.toBe("calibration");
  });

  it("leaves off hidden fields and set-aside picks", () => {
    const all = atelierByField(result, opts);
    const first = [...all.keys()][0]!;
    const aside = all.get(first)![0]!;
    const by = atelierByField(result, { ...opts, hidden: [first] });
    expect(by.has(first)).toBe(false);
    const by2 = atelierByField(result, { ...opts, notMe: [aside.qlooId] });
    expect(by2.get(first)?.some((p) => p.id === aside.id) ?? false).toBe(false);
  });

  it("rows carry the plain list per field, or null before it is asked", () => {
    const by = atelierByField(result, opts);
    expect(buildRows(by, null).every((r) => r.plain === null)).toBe(true);
    const rows = buildRows(by, plain);
    expect(rows.find((r) => r.field === "music")?.plain).toEqual([plain[0]]);
    expect(rows.find((r) => r.field === "books")?.plain).toEqual([]);
  });
});

describe("wording", () => {
  const text = [
    ...Object.values(COPY).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : typeof v === "function" ? [v("music")] : [])),
    ...["model_off", "too_many_requests", "demo_resting", "unusable", "bad_request", "network", "upstream", "http_500", null].map(failedFor),
  ];
  it("is reserved: no exclamation marks, scores, ranks or quality claims", () => {
    for (const t of text) {
      expect(t, t).not.toMatch(/!/);
      expect(t, t).not.toMatch(/\b(score|scores|scored|rank|ranked|ranking|percent|percentage|stars?|better than|worse than|best|worst|more accurate)\b|%/i);
    }
  });
  it("labels ungrounded in words", () => {
    expect(COPY.ungrounded).toBe("Ungrounded: no Qloo link, no source");
  });
  it("treats resting and limits as calm and real failures as alerts", () => {
    for (const c of ["model_off", "too_many_requests", "demo_resting"]) expect(isCalm(c)).toBe(true);
    for (const c of ["upstream", "unusable", "network", "bad_request", null]) expect(isCalm(c)).toBe(false);
  });
  it("does not offer a retry where it cannot help", () => {
    expect(canRetry("model_off")).toBe(false);
    expect(canRetry("upstream")).toBe(true);
  });
});
