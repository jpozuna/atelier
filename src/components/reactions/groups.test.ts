import { describe, expect, it } from "vitest";
import type { ReactionState } from "@/types";
import { makeFixtureResult } from "@/components/deck/fixture";
import { groupSaved, outcomeWord, pathLine, savedHref } from "./groups";
import type { SavedItem } from "./groups";
import { COPY } from "./copy";
import { AT } from "./testing";

const picks = makeFixtureResult().domains.flatMap((d) => d.picks);

function item(i: number, state: ReactionState | null, at = AT, extra: Partial<SavedItem> = {}): SavedItem {
  const p = picks[i];
  return {
    id: p.id,
    name: p.name,
    field: p.field,
    card: { ...p.card, ...(state ? { reaction: { state, at, words: `words ${i}` } } : {}) },
    savedAt: AT,
    tried: state === "tried",
    how: null,
    ...extra,
  };
}

describe("groupSaved", () => {
  it("groups by state in the fixed order and leaves empty groups out", () => {
    const groups = groupSaved([item(0, "not_interested"), item(1, "later"), item(2, "explore"), item(3, "tried"), item(4, "will_try"), item(5, "explore")]);
    expect(groups.map((g) => g.key)).toEqual(["later", "will_try", "explore", "not_interested", "tried"]);
    expect(groups[2].items).toHaveLength(2);
    expect(groupSaved([item(0, "later")]).map((g) => g.key)).toEqual(["later"]);
  });

  it("puts the newest reaction first inside a group", () => {
    const groups = groupSaved([item(0, "later", "2026-10-18T00:00:00.000Z"), item(1, "later", "2026-10-20T00:00:00.000Z"), item(2, "later", "2026-10-19T00:00:00.000Z")]);
    expect(groups[0].items.map((i) => i.id)).toEqual([picks[1].id, picks[2].id, picks[0].id]);
  });

  it("puts a pick with no reaction last, in its own group, never dropped", () => {
    const groups = groupSaved([item(0, null), item(1, "explore")]);
    expect(groups.map((g) => g.key)).toEqual(["explore", "unsorted"]);
    expect(groups[1].items[0].id).toBe(picks[0].id);
  });

  it("is empty for nothing saved", () => {
    expect(groupSaved([])).toEqual([]);
  });

  it("carries no score, count of taste or rank on a group", () => {
    const [g] = groupSaved([item(0, "explore")]);
    expect(Object.keys(g).sort()).toEqual(["gloss", "items", "key", "title"]);
  });
});

describe("saved item text", () => {
  it("says how a tried pick went only when the person recorded it", () => {
    expect(outcomeWord(item(0, "tried", AT, { how: "liked" }))).toBe(COPY.likedWord);
    expect(outcomeWord(item(0, "tried", AT, { how: "mixed" }))).toBe(COPY.mixedWord);
    expect(outcomeWord(item(0, "tried", AT, { how: "not_liked" }))).toBe(COPY.notForMeWord);
    // Tried but never said how: nothing is said for them.
    expect(outcomeWord(item(0, "tried", AT, { how: null }))).toBeNull();
    expect(outcomeWord(item(0, "later"))).toBeNull();
  });

  it("states the path's own seed and theme", () => {
    const line = pathLine(item(0, "later").card);
    expect(line).toMatch(/^From .+, through .+/);
  });

  it("builds a link that survives odd ids", () => {
    expect(savedHref("pick-00000000-0000-4000-8000-000000000071")).toBe("/saved/pick-00000000-0000-4000-8000-000000000071");
    expect(savedHref("a/b c")).toBe("/saved/a%2Fb%20c");
  });
});
