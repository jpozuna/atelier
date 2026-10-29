import { describe, expect, it } from "vitest";
import type { Field } from "@/types";
import { invalidDecisionDomains, parseCards, parseDecisions, parseThemes, type AxisOption, type RequeryOptions } from "./tools";

const offered = {
  music: [{ id: "axis-a", label: "A", tagNames: ["x"] }, { id: "axis-b", label: "B", tagNames: ["y"] }],
  film: [{ id: "axis-a", label: "A", tagNames: ["x"] }],
  tv: [],
  books: [],
  food_places: [],
  fashion: [],
} as Record<Field, AxisOption[]>;

describe("parseThemes", () => {
  it("keeps only an axis that was offered for that domain, one per domain", () => {
    const out = parseThemes(
      {
        themes: [
          { domain: "music", axisId: "axis-b", reason: "r1" },
          { domain: "music", axisId: "axis-a", reason: "dup" },
          { domain: "film", axisId: "axis-b", reason: "not offered for film" },
          { domain: "tv", axisId: "axis-a", reason: "no options for tv" },
          { domain: "cars", axisId: "axis-a", reason: "no such domain" },
          { domain: "film", axisId: "axis-a" },
        ],
      },
      offered,
    );
    expect(out).toEqual([
      { domain: "music", axisId: "axis-b", reason: "r1" },
      { domain: "film", axisId: "axis-a", reason: "" },
    ]);
  });
  it("returns nothing for the wrong shape", () => {
    for (const bad of [null, "x", {}, { themes: "x" }, { themes: [1, null] }]) expect(parseThemes(bad, offered)).toEqual([]);
  });
});

describe("parseDecisions", () => {
  const options = new Map<Field, RequeryOptions>([
    ["film", { reason: "too_obvious", tightenTo: 0.45, axisIds: ["axis-b"] }],
    ["books", { reason: "empty", tightenTo: null, axisIds: ["axis-c"] }],
    ["tv", { reason: "too_weak", tightenTo: 0.45, axisIds: [] }],
  ]);
  it("names the flagged domains whose action was not offered, and not skips, valid ones or unflagged domains", () => {
    const raw = {
      decisions: [
        { domain: "film", action: "tighten_popularity" },
        { domain: "books", action: "tighten_popularity" },
        { domain: "tv", action: "lean_axis", axisId: "axis-z" },
        { domain: "tv", action: "skip" },
        { domain: "music", action: "lean_axis", axisId: "axis-a" },
        { domain: "books", action: "invent_action" },
      ],
    };
    expect(invalidDecisionDomains(raw, options).sort()).toEqual(["books", "tv"]);
    expect(invalidDecisionDomains({ decisions: [{ domain: "film", action: "skip" }] }, options)).toEqual([]);
    expect(invalidDecisionDomains(null, options)).toEqual([]);
  });

  it("accepts only actions code offered, with the value code computed", () => {
    const out = parseDecisions(
      {
        decisions: [
          { domain: "film", action: "tighten_popularity" },
          { domain: "books", action: "tighten_popularity" },
          { domain: "books", action: "lean_axis", axisId: "axis-c" },
          { domain: "tv", action: "lean_axis", axisId: "axis-z" },
          { domain: "music", action: "lean_axis", axisId: "axis-a" },
        ],
      },
      options,
      5,
    );
    expect(out).toEqual([
      { domain: "film", action: { kind: "tighten_popularity", popularityMax: 0.45 } },
      { domain: "books", action: { kind: "lean_axis", axisId: "axis-c" } },
    ]);
  });
  it("never returns more than the limit, and a skip uses up the domain", () => {
    const out = parseDecisions(
      { decisions: [{ domain: "film", action: "skip" }, { domain: "film", action: "tighten_popularity" }, { domain: "books", action: "lean_axis", axisId: "axis-c" }, { domain: "tv", action: "tighten_popularity" }] },
      options,
      1,
    );
    expect(out).toEqual([{ domain: "books", action: { kind: "lean_axis", axisId: "axis-c" } }]);
  });
});

describe("parseCards", () => {
  it("keeps cards for refs that were sent, first one wins, and needs both lines", () => {
    const out = parseCards(
      { cards: [{ ref: "p1", why: "a", different: "b" }, { ref: "p1", why: "dup", different: "dup" }, { ref: "p9", why: "x", different: "y" }, { ref: "p2", why: "only why" }, { ref: "p3", why: 1, different: 2 }] },
      new Set(["p1", "p2", "p3"]),
    );
    expect([...out]).toEqual([["p1", { why: "a", different: "b" }]]);
  });
});
