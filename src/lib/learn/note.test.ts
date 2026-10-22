import { describe, expect, it } from "vitest";
import { id } from "@/lib/agent/testing";
import { pastSignalsNote } from "./note";
import type { LearnSignal } from "./types";

const names = new Map([["t1", "quiet menace"], ["t2", "slow burn"], ["t3", "found family"], ["t4", "dry wit"]]);
let k = 0;
const s = (signal: LearnSignal["signal"], themeTags: string[], over: Partial<LearnSignal> = {}): LearnSignal => ({ signal, entityId: id(++k), pickKey: `r:${k}`, source: "reaction", themeTags, at: "2026-10-22T10:00:00.000Z", ...over });

describe("pastSignalsNote", () => {
  it("is empty without signals", () => expect(pastSignalsNote([], names)).toEqual([]));

  it("says what was set aside and saved, in words with no digits", () => {
    const lines = pastSignalsNote([s("not_me", ["t1"]), s("not_interested", ["t1", "t2"]), s("saved_later", ["t3"])], names);
    expect(lines).toEqual(["set aside: two picks themed quiet menace", "set aside: one pick themed slow burn", "saved: one pick themed found family"]);
    expect(lines.join(" ")).not.toMatch(/\d/);
  });

  it("says several for many, counts a pick once, and skips inferred signals and unknown tags", () => {
    const many = Array.from({ length: 5 }, () => s("not_me", ["t1"]));
    const dup = s("not_me", ["t2"]);
    const lines = pastSignalsNote([...many, dup, { ...dup }, s("not_me", ["t4"], { source: "exclude" }), s("not_me", ["unknown"])], names);
    expect(lines).toEqual(["set aside: several picks themed quiet menace", "set aside: one pick themed slow burn"]);
  });

  it("names at most a few themes per kind", () => {
    const lines = pastSignalsNote([s("saved_try", ["t1", "t2", "t3", "t4"])], names);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});
