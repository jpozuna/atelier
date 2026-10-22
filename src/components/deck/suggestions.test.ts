import { describe, expect, it } from "vitest";
import { FIELDS } from "@/types";
import { FIXTURE_SEEDS, makeFixtureResult } from "./fixture";
import { EDGE_BANDS, buildView, toggleHidden } from "./grouping";
import { STRETCH_WORD, SUGGESTION_SORTS, chartSelection, edgeSuggestions, fieldsWithSuggestions, groupSuggestions, stretchWord, toggleChecked } from "./suggestions";

const result = makeFixtureResult();
const view = (hidden: Parameters<typeof toggleHidden>[0] = []) => buildView(result, { hidden, notMe: [], seeds: FIXTURE_SEEDS });
const bandRank = (b: string) => EDGE_BANDS.indexOf(b as (typeof EDGE_BANDS)[number]);

describe("stretch words", () => {
  it("map moderate, high and extreme to low, medium and high, and a calibration pick to none", () => {
    expect(STRETCH_WORD).toEqual({ moderate: "low", high: "medium", extreme: "high" });
    expect(stretchWord("moderate")).toBe("low");
    expect(stretchWord("high")).toBe("medium");
    expect(stretchWord("extreme")).toBe("high");
    expect(stretchWord("calibration")).toBeNull();
  });
});

describe("the edge list", () => {
  it("offers sorting by field or by stretch, and nothing that reads as a score or rank (hard rule 7)", () => {
    expect([...SUGGESTION_SORTS]).toEqual(["field", "stretch"]);
  });

  it("holds every visible edge pick once, and no calibration pick", () => {
    const list = edgeSuggestions(view().decks, "field");
    expect(list).toHaveLength(20);
    expect(new Set(list.map((p) => p.id)).size).toBe(20);
    expect(list.every((p) => p.band !== "calibration")).toBe(true);
  });

  it("sorts by field in field order, low to high stretch within a field", () => {
    const list = edgeSuggestions(view().decks, "field");
    const keys = list.map((p) => [FIELDS.indexOf(p.field), bandRank(p.band)]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it("sorts by stretch from low to high, field order within a degree", () => {
    const list = edgeSuggestions(view().decks, "stretch");
    const keys = list.map((p) => [bandRank(p.band), FIELDS.indexOf(p.field)]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(list.slice(0, 7).every((p) => p.band === "moderate")).toBe(true);
    expect(list.slice(-6).every((p) => p.band === "extreme")).toBe(true);
  });

  it("is the same list for the same input, and the sort never touches the result", () => {
    const before = JSON.stringify(result);
    expect(edgeSuggestions(view().decks, "stretch")).toEqual(edgeSuggestions(view().decks, "stretch"));
    expect(JSON.stringify(result)).toBe(before);
  });

  it("does not order by connection strength: strength words are not a sort key", () => {
    const list = edgeSuggestions(view().decks, "field");
    const music = list.filter((p) => p.field === "music");
    // Inside one field and one degree the run's own order is kept, whatever the strengths are.
    const high = music.filter((p) => p.band === "high").map((p) => p.strength);
    expect(high).toEqual(result.domains[0].byBand.high.map((p) => p.strength));
  });

  it("drops a hidden field with 0 new calls: same result, fewer rows, and showing it again brings the same list back", () => {
    const hidden = edgeSuggestions(view(["music"]).decks, "field");
    expect(hidden.some((p) => p.field === "music")).toBe(false);
    expect(hidden).toHaveLength(20 - 7);
    expect(edgeSuggestions(view(toggleHidden(toggleHidden([], "music"), "music")).decks, "field")).toEqual(edgeSuggestions(view().decks, "field"));
  });

  it("lists the fields that have suggestions, in field order", () => {
    expect(fieldsWithSuggestions(edgeSuggestions(view().decks, "field"))).toEqual(["music", "film", "tv", "books", "food_places"]);
  });
});

describe("selection", () => {
  it("toggles an id in and out, keeping the order they were ticked", () => {
    expect(toggleChecked([], "a")).toEqual(["a"]);
    expect(toggleChecked(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleChecked(["a", "b"], "a")).toEqual(["b"]);
  });

  it("shows the ticked picks that are still on screen, and the one being read", () => {
    const visible = new Set(["a", "b", "c"]);
    expect(chartSelection([], null, visible)).toEqual([]);
    expect(chartSelection(["a", "b"], null, visible)).toEqual(["a", "b"]);
    expect(chartSelection(["a"], "c", visible)).toEqual(["a", "c"]);
    expect(chartSelection(["a"], "a", visible)).toEqual(["a"]);
    // Hidden or set aside: simply not found.
    expect(chartSelection(["a", "gone"], "gone", visible)).toEqual(["a"]);
  });

  it("adds the row being previewed, only while it lasts and only when it is on screen", () => {
    const visible = new Set(["a", "b", "c"]);
    expect(chartSelection([], null, visible, "b")).toEqual(["b"]);
    expect(chartSelection(["a"], "c", visible, "b")).toEqual(["a", "c", "b"]);
    expect(chartSelection(["a"], null, visible, "a")).toEqual(["a"]);
    expect(chartSelection(["a"], null, visible, "gone")).toEqual(["a"]);
    expect(chartSelection(["a"], null, visible, null)).toEqual(["a"]);
  });

  it("ticking and reading are separate: the ticked set never depends on which pick is read", () => {
    const visible = new Set(["a", "b"]);
    const ticked = toggleChecked([], "a");
    expect(chartSelection(ticked, null, visible)).toEqual(["a"]);
    expect(chartSelection(ticked, "b", visible)).toEqual(["a", "b"]);
    expect(ticked).toEqual(["a"]);
  });
});

describe("groups", () => {
  it("groups a field-sorted list by field, in field order, nothing dropped", () => {
    const list = edgeSuggestions(view().decks, "field");
    const groups = groupSuggestions(list, "field");
    expect(groups.map((g) => g.key)).toEqual(["music", "film", "tv", "books", "food_places"]);
    expect(groups.flatMap((g) => g.picks)).toEqual(list);
    expect(groups.map((g) => g.picks.length)).toEqual([7, 4, 3, 4, 2]);
  });

  it("groups a stretch-sorted list by low, medium and high", () => {
    const groups = groupSuggestions(edgeSuggestions(view().decks, "stretch"), "stretch");
    expect(groups.map((g) => g.key)).toEqual(["low", "medium", "high"]);
    expect(groups.map((g) => g.picks.length)).toEqual([7, 7, 6]);
  });

  it("is empty for an empty list", () => {
    expect(groupSuggestions([], "field")).toEqual([]);
  });
});
