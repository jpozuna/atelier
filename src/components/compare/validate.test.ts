import { describe, expect, it } from "vitest";
import { FIELDS } from "@/types";
import { COMPARE_PICKS_PER_FIELD } from "@/lib/agent/config";
import { cleanPlainPicks, parseCompareRequest, readPlainPicks } from "./validate";

const seed = (n: number, extra: Record<string, unknown> = {}) => ({ field: "music", typed: `Invented Work ${n}`, why: "It leaves room.", ...extra });
const ask = (fields = ["music", "film"] as const) => ({ seeds: [{ field: "music" as const, typed: "Invented Work 1", why: "It leaves room." }], fields: [...fields] });

describe("parseCompareRequest", () => {
  it("keeps field, typed and why only, and puts fields in product order", () => {
    const r = parseCompareRequest({
      seeds: [seed(1, { id: "x", qlooId: "00000000-0000-4000-8000-000000000001", candidates: [{ label: "L" }], whyTags: [{ tag: "urn:tag:fixture:a" }] })],
      fields: ["film", "music", "film"],
    });
    expect(r).toEqual({ ok: true, value: { seeds: [{ field: "music", typed: "Invented Work 1", why: "It leaves room." }], fields: ["music", "film"] } });
  });

  it("collapses whitespace and strips control characters", () => {
    const r = parseCompareRequest({ seeds: [seed(1, { typed: "  A\n\n  B\u0000C ", why: "x\ty" })], fields: ["music"] });
    expect(r.ok && r.value.seeds[0]).toEqual({ field: "music", typed: "A B C", why: "x y" });
  });

  it.each([
    ["no seeds", { seeds: [], fields: ["music"] }],
    ["no fields", { seeds: [seed(1)], fields: [] }],
    ["unknown field", { seeds: [seed(1)], fields: ["pottery"] }],
    ["unknown seed field", { seeds: [seed(1, { field: "pottery" })], fields: ["music"] }],
    ["empty typed", { seeds: [seed(1, { typed: "  " })], fields: ["music"] }],
    ["long why", { seeds: [seed(1, { why: "w".repeat(121) })], fields: ["music"] }],
    ["too many seeds", { seeds: Array.from({ length: 11 }, (_, i) => seed(i)), fields: ["music"] }],
    ["not an object", "hello"],
    ["seeds not a list", { seeds: "x", fields: ["music"] }],
  ])("refuses %s", (_name, body) => {
    expect(parseCompareRequest(body).ok).toBe(false);
  });

  it("allows an empty why", () => {
    expect(parseCompareRequest({ seeds: [seed(1, { why: "" })], fields: ["music"] }).ok).toBe(true);
  });
});

describe("cleanPlainPicks", () => {
  const pick = (name: string, why = "A quiet piece in the same register.", field = "music") => ({ name, field, why });

  it("keeps names with a plain line, in field order", () => {
    const out = cleanPlainPicks({ picks: [pick("Fixture Film", "Slow and spare.", "film"), pick("Fixture Song")] }, ask());
    expect(out.map((p) => p.name)).toEqual(["Fixture Song", "Fixture Film"]);
  });

  it("drops ids, links and sources", () => {
    const out = cleanPlainPicks(
      {
        picks: [
          pick("Fixture One", "See https://example.test/x for more."),
          pick("urn:entity:fixture"),
          pick("00000000-0000-4000-8000-000000000042"),
          pick("Fixture Two", "From www.example.test."),
          pick("Fixture Three"),
        ],
      },
      ask(),
    );
    expect(out.map((p) => p.name)).toEqual(["Fixture Three"]);
  });

  it("drops anything that reads as a score, a rank or a percentage", () => {
    const why = ["Rated highly by many.", "A 92% fit.", "Scores well on warmth.", "Ranked first for you.", "Four stars.", "Seven out of ten.", "It is a 9/10.", "Written in 1974."];
    const out = cleanPlainPicks({ picks: [...why.map((w, i) => pick(`Fixture ${i}x`, w)), pick("Fixture Good")] }, ask());
    expect(out.map((p) => p.name)).toEqual(["Fixture Good"]);
  });

  it("checks score wording and bare domains in reasons only; a name may say rated or hold a dot", () => {
    const out = cleanPlainPicks(
      { picks: [pick("Fixture Rated Ranking Stars", "Quiet."), pick("Fixture Dot.fm", "Quiet."), pick("Fixture Domain", "Read more at example.com/x."), pick("Fixture Bare", "Try example.org for it.")] },
      ask(),
    );
    expect(out.map((p) => p.name)).toEqual(["Fixture Rated Ranking Stars", "Fixture Dot.fm"]);
  });

  it("allows digits in a name but not in a reason", () => {
    const out = cleanPlainPicks({ picks: [pick("Fixture Vol Two 2", "Quiet."), pick("Fixture Other", "Quiet in 2 ways.")] }, ask());
    expect(out.map((p) => p.name)).toEqual(["Fixture Vol Two 2"]);
  });

  it("drops fields that were not asked, the user's own seeds, repeats, and over-long text", () => {
    const out = cleanPlainPicks(
      {
        picks: [
          pick("Fixture A", "Quiet.", "books"),
          pick("invented work 1"),
          pick("Fixture B"),
          pick("FIXTURE B"),
          pick("N".repeat(101)),
          pick("Fixture C", "w".repeat(241)),
          { name: "No field", why: "x" },
          { name: 5, field: "music", why: "x" },
          null,
        ],
      },
      ask(),
    );
    expect(out.map((p) => p.name)).toEqual(["Fixture B"]);
  });

  it("caps each field and never pads", () => {
    const many = Array.from({ length: 12 }, (_, i) => pick(`Fixture Piece ${String.fromCharCode(65 + i)}`));
    const out = cleanPlainPicks({ picks: many }, ask());
    expect(out).toHaveLength(COMPARE_PICKS_PER_FIELD);
    expect(cleanPlainPicks({ picks: [] }, ask())).toEqual([]);
    expect(cleanPlainPicks("nonsense", ask())).toEqual([]);
  });

  it("returns only the keys name, field and why", () => {
    const out = cleanPlainPicks({ picks: [{ ...pick("Fixture Song"), id: "x", score: 5, url: "https://a.test" }] }, ask());
    expect(Object.keys(out[0]!).sort()).toEqual(["field", "name", "why"]);
  });
});

describe("readPlainPicks", () => {
  it("reads a good list and refuses a malformed or numeric one", () => {
    expect(readPlainPicks({ picks: [{ name: "Fixture", field: "film", why: "Quiet." }] })).toEqual([{ name: "Fixture", field: "film", why: "Quiet." }]);
    expect(readPlainPicks({ picks: [] })).toBeNull();
    expect(readPlainPicks({ picks: [{ name: "Fixture", field: "film", why: "Quiet.", extra: 1 }, { name: "x", field: "nope", why: "y" }] })).toBeNull();
    expect(readPlainPicks({ picks: [{ name: "Fixture", field: "film", why: "A 90% fit." }] })).toBeNull();
    expect(readPlainPicks(null)).toBeNull();
    expect(FIELDS.length).toBe(6);
  });
});
