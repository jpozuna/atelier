import { describe, expect, it } from "vitest";
import {
  addEntry,
  buildEntry,
  draftReducer,
  initialDraft,
  profileSeeds,
  readiness,
  removeEntry,
  sameSeeds,
  selectedChip,
  validateQuery,
  validateWhy,
} from "./flow";
import type { Draft, Entry } from "./flow";
import { chip, resolvedDraft, uid } from "./fixtures";
import { MAX_SEEDS, MAX_WHY_CHARS } from "./constants";
import { MAX_BODY_CHARS } from "@/lib/profile/constants";
import { isSeed } from "@/types";
import type { Field } from "./types";

const entry = (n: number, field: Field = "film"): Entry => {
  const e = buildEntry(resolvedDraft(field, n), `seed-${n}`, []);
  if (!e) throw new Error("fixture entry failed");
  return e;
};

describe("validation", () => {
  it("requires a query of at least 2 characters and collapses whitespace", () => {
    expect(validateQuery(" ").ok).toBe(false);
    expect(validateQuery("a").ok).toBe(false);
    expect(validateQuery("  Up  ")).toEqual({ ok: true, value: "Up" });
    expect(validateQuery("x".repeat(101)).ok).toBe(false);
  });
  it("requires a one-line why and keeps it to one line", () => {
    const empty = validateWhy("   ");
    expect(empty.ok).toBe(false);
    expect(validateWhy("ab").ok).toBe(false);
    expect(validateWhy("quiet\n  and   exact")).toEqual({ ok: true, value: "quiet and exact" });
    expect(validateWhy("y".repeat(MAX_WHY_CHARS + 1)).ok).toBe(false);
    expect(validateWhy("y".repeat(MAX_WHY_CHARS)).ok).toBe(true);
  });
  it("never uses exclamation marks in messages", () => {
    for (const r of [validateQuery(""), validateWhy("")]) {
      if (!r.ok) expect(r.message).not.toContain("!");
    }
  });
});

describe("draft reducer", () => {
  const typed = (): Draft => ({ ...initialDraft("film"), query: "x" });
  const loading = (d: Draft, token = 1): Draft => draftReducer(d, { type: "searchStart", token, query: "x" });

  it("stores a clean result and selects it", () => {
    const d = draftReducer(loading(typed()), {
      type: "searchDone",
      token: 1,
      query: "x",
      result: { kind: "clean", chip: chip(1) },
    });
    expect(selectedChip(d)?.qlooId).toBe(uid(1));
  });

  it("selects an ambiguous chip only when the user chooses one", () => {
    let d = draftReducer(loading(typed()), {
      type: "searchDone",
      token: 1,
      query: "x",
      result: { kind: "ambiguous", chips: [chip(1), chip(2)], chosenId: null },
    });
    expect(selectedChip(d)).toBeNull();
    d = draftReducer(d, { type: "choose", qlooId: uid(2) });
    expect(selectedChip(d)?.qlooId).toBe(uid(2));
    d = draftReducer(d, { type: "choose", qlooId: uid(9) });
    expect(selectedChip(d)?.qlooId).toBe(uid(2));
  });

  it("drops a result from a superseded search", () => {
    const d = loading(typed(), 2);
    const same = draftReducer(d, { type: "searchDone", token: 1, query: "x", result: { kind: "missing" } });
    expect(same).toBe(d);
  });

  it("clears the match when the field or the typed text changes, but keeps the text on a field change", () => {
    const d = { ...resolvedDraft("film", 1) };
    const field = draftReducer(d, { type: "setField", field: "music" });
    expect(field.search.kind).toBe("idle");
    expect(field.query).toBe(d.query);
    const same = draftReducer(d, { type: "setField", field: "film" });
    expect(same).toBe(d);
    const edited = draftReducer(d, { type: "setQuery", query: "something else" });
    expect(edited.search.kind).toBe("idle");
    const unchanged = draftReducer(d, { type: "setQuery", query: d.query + " " });
    expect(unchanged.search.kind).toBe("clean");
  });

  it("cancels a search in flight when the text changes, and ignores its late result", () => {
    const d = loading(typed());
    const edited = draftReducer(d, { type: "setQuery", query: "xy" });
    expect(edited.search.kind).toBe("idle");
    const late = draftReducer(edited, { type: "searchDone", token: 1, query: "x", result: { kind: "clean", chip: chip(1) } });
    expect(late.search.kind).toBe("idle");
  });

  it("keeps a search in flight when only spacing changes", () => {
    const d = loading(typed());
    expect(draftReducer(d, { type: "setQuery", query: "x " }).search.kind).toBe("loading");
  });

  it("drops a result whose query is no longer the one in the box", () => {
    const d = loading(typed());
    const moved: Draft = { ...d, query: "other" };
    const r = draftReducer(moved, { type: "searchDone", token: 1, query: "x", result: { kind: "missing" } });
    expect(r.search.kind).toBe("idle");
  });

  it("changeMatch returns to idle and reset keeps only the field", () => {
    const d = resolvedDraft("tv", 1);
    expect(draftReducer(d, { type: "changeMatch" }).search.kind).toBe("idle");
    const r = draftReducer(d, { type: "reset" });
    expect(r).toEqual(initialDraft("tv"));
  });
});

describe("buildEntry", () => {
  it("builds a valid clean Seed carrying its why tags", () => {
    const tags = [{ tag: "urn:tag:fixture:media:quiet", name: "Quiet", tagType: "urn:tag:theme:media" }];
    const e = buildEntry(resolvedDraft("film", 1), "id-1", tags);
    expect(e).not.toBeNull();
    const seed = e!.seed;
    expect(isSeed(seed)).toBe(true);
    expect(seed).toMatchObject({ field: "film", status: "clean", qlooId: uid(1), why: "It feels unhurried and exact", whyTags: tags });
    expect(e!.whyMapped).toBe(true);
    expect(e!.matchedLabel).toBe("Invented 1 (2001)");
  });

  it("marks a seed with no mapped tags as unmapped and leaves whyTags absent", () => {
    const e = buildEntry(resolvedDraft("film", 1), "id-1", undefined)!;
    expect("whyTags" in e.seed).toBe(false);
    expect(e.whyMapped).toBe(false);
    const none = buildEntry(resolvedDraft("film", 1), "id-1", [])!;
    expect(none.seed.whyTags).toEqual([]);
    expect(none.whyMapped).toBe(true);
  });

  it("keeps the offered candidates for an ambiguous seed, with the chosen id", () => {
    const d: Draft = {
      ...resolvedDraft("books", 1),
      search: { kind: "ambiguous", chips: [chip(1), chip(2), chip(3)], chosenId: uid(2) },
    };
    const e = buildEntry(d, "id", [])!;
    expect(isSeed(e.seed)).toBe(true);
    expect(e.seed.status).toBe("ambiguous");
    expect(e.seed.qlooId).toBe(uid(2));
    expect(e.seed.candidates).toHaveLength(3);
  });

  it("treats a single confirmed candidate as clean, so the Seed contract holds", () => {
    const d: Draft = { ...resolvedDraft("books", 1), search: { kind: "ambiguous", chips: [chip(1)], chosenId: uid(1) } };
    const e = buildEntry(d, "id", [])!;
    expect(e.seed.status).toBe("clean");
    expect(isSeed(e.seed)).toBe(true);
  });

  it("stores the searched text as typed, not the box's current text", () => {
    const d: Draft = { ...resolvedDraft("film", 1), query: "edited afterwards", searchedQuery: "invented 1" };
    expect(buildEntry(d, "id", [])!.seed.typed).toBe("invented 1");
  });

  it("refuses without a chosen match or a valid why", () => {
    expect(buildEntry(initialDraft("film"), "id", [])).toBeNull();
    expect(buildEntry({ ...resolvedDraft("film", 1), why: "" }, "id", [])).toBeNull();
    const unchosen: Draft = { ...resolvedDraft("film", 1), search: { kind: "ambiguous", chips: [chip(1), chip(2)], chosenId: null } };
    expect(buildEntry(unchosen, "id", [])).toBeNull();
  });
});

describe("request seeds", () => {
  const amb: Draft = {
    ...resolvedDraft("books", 1),
    search: { kind: "ambiguous", chips: [chip(1), chip(2), chip(3), chip(4), chip(5)], chosenId: uid(2) },
  };

  it("sends an ambiguous seed as clean with its chosen id and no candidate list", () => {
    const e = buildEntry(amb, "id", [])!;
    expect(e.seed.candidates).toHaveLength(5);
    const [sent] = profileSeeds([e]);
    expect(sent).toMatchObject({ status: "clean", qlooId: uid(2) });
    expect(sent).not.toHaveProperty("candidates");
    expect(isSeed(sent)).toBe(true);
  });

  it("keeps ten seeds with full why tags clear of the server body cap", () => {
    const whyTags = [1, 2, 3, 4, 5].map((i) => ({
      tag: `urn:tag:fixture:media:${"t".repeat(60)}${i}`,
      name: "n".repeat(40),
      tagType: "urn:tag:theme:media",
    }));
    const entries = Array.from({ length: 10 }, (_, i) => buildEntry({ ...amb, why: "w".repeat(100) }, `s${i}`, whyTags)!);
    const body = JSON.stringify({ seeds: profileSeeds(entries) });
    // Long invented tag ids on every seed, and still clear of the cap with room to spare.
    expect(body.length).toBeLessThan(MAX_BODY_CHARS * 0.6);
  });

  it("tells a changed list from an unchanged one regardless of key order", () => {
    const a = profileSeeds([entry(1), entry(2)]);
    const b = JSON.parse(JSON.stringify(a)).map((s: Record<string, unknown>) => Object.fromEntries(Object.entries(s).reverse()));
    expect(sameSeeds(a, b)).toBe(true);
    expect(sameSeeds(a, a.slice(0, 1))).toBe(false);
    expect(sameSeeds(a, [{ ...a[0], why: "different" }, a[1]])).toBe(false);
  });
});

describe("list rules", () => {
  it("allows at most MAX_SEEDS and no repeated entity", () => {
    let list: Entry[] = [];
    for (let i = 1; i <= MAX_SEEDS; i++) {
      const r = addEntry(list, entry(i));
      expect(r.ok).toBe(true);
      if (r.ok) list = r.entries;
    }
    expect(addEntry(list, entry(50)).ok).toBe(false);
    expect(addEntry(list.slice(0, 3), entry(2)).ok).toBe(false);
  });

  it("removes by id and sends seeds only", () => {
    const list = [entry(1), entry(2)];
    const left = removeEntry(list, "seed-1");
    expect(left.map((e) => e.seed.id)).toEqual(["seed-2"]);
    const sent = profileSeeds(list);
    expect(sent[0]).not.toHaveProperty("matchedLabel");
  });
});

describe("readiness", () => {
  it("needs 3 seeds across 2 fields", () => {
    expect(readiness([]).ready).toBe(false);
    expect(readiness([entry(1), entry(2), entry(3)]).ready).toBe(false); // one field
    expect(readiness([entry(1), entry(2), entry(3, "music")]).ready).toBe(true);
    expect(readiness([entry(1, "film"), entry(2, "music")]).ready).toBe(false); // two seeds
  });

  it("says what is left in plain words, without numbers as scores or exclamations", () => {
    expect(readiness([]).text).toBe("Add 3 things across at least 2 fields to see your taste.");
    expect(readiness([entry(1), entry(2)]).text).toBe("Add 1 more thing, in a different field, to see your taste.");
    expect(readiness([entry(1), entry(2), entry(3)]).text).toBe("Add 1 more thing, in a different field, to see your taste.");
    expect(readiness([entry(1)]).text).toBe("Add 2 more things, one of them in a different field, to see your taste.");
    expect(readiness([entry(1, "film"), entry(2, "music")]).text).toBe("Add 1 more thing to see your taste.");
    expect(readiness([entry(1), entry(2), entry(3, "music")]).text).not.toContain("!");
  });

  it("when full but in one field, says to swap one rather than add one", () => {
    const full = Array.from({ length: MAX_SEEDS }, (_, i) => entry(i + 1));
    const r = readiness(full);
    expect(r.ready).toBe(false);
    expect(r.text).toBe("Your list is full at 10. Remove one and add one from another field to see your taste.");
    expect(r.text).not.toContain("Add 1 more");
  });

  it("reports progress from 0 to 1", () => {
    expect(readiness([]).progress).toBe(0);
    expect(readiness([entry(1), entry(2), entry(3, "music")]).progress).toBe(1);
    const half = readiness([entry(1)]).progress;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
  });
});
