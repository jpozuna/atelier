import { describe, expect, it } from "vitest";
import { RUN_MAX_EXCLUDE } from "@/lib/agent/config";
import { id, input, tg } from "@/lib/agent/testing";
import { adjustFromSignals, applyAdjustment, isEmptyAdjustment, planAdjustment } from "./adjust";
import { LEARN_LEAN_STEP, LEARN_MAX_EXCLUDED } from "@/lib/agent/config";
import type { LearnSignal } from "./types";

let n = 0;
function sig(over: Partial<LearnSignal> & Pick<LearnSignal, "signal">): LearnSignal {
  n += 1;
  return { entityId: id(100 + n), pickKey: `run:pick-${n}`, source: "reaction", themeTags: [], at: `2026-10-22T10:00:${String(n % 60).padStart(2, "0")}.000Z`, ...over };
}
const weightOf = (r: ReturnType<typeof input>, t: string) => r.profile.tags.find((x) => x.tag === t)!.weight;

describe("adjustFromSignals", () => {
  it("returns the very same input when there are no signals", () => {
    const base = input();
    expect(adjustFromSignals(base, [])).toBe(base);
    expect(JSON.stringify(adjustFromSignals(base, []))).toBe(JSON.stringify(input()));
  });

  it("adds every exact not_me and not_interested entity to exclude, and keeps the request's own ids first", () => {
    const base = input({ exclude: [id(90)] });
    const out = adjustFromSignals(base, [
      sig({ signal: "not_me", entityId: id(1001), source: "not_me_list" }),
      sig({ signal: "not_interested", entityId: id(1003) }),
      sig({ signal: "saved_later", entityId: id(1004) }),
    ]);
    expect(out.exclude?.[0]).toBe(id(90));
    expect(new Set(out.exclude)).toEqual(new Set([id(90), id(1001), id(1003)]));
    expect(out.exclude).not.toContain(id(1004));
  });

  it("ignores inferred (source exclude) rows entirely: no exclusion, no lean", () => {
    const base = input();
    expect(adjustFromSignals(base, [sig({ signal: "not_me", entityId: id(1002), source: "exclude", themeTags: [tg(1)] })])).toBe(base);
    expect(planAdjustment(base, [sig({ signal: "not_me", entityId: id(1002), source: "exclude", themeTags: [tg(1)] })])).toMatchObject({ exclude: [], awayTags: [], towardTags: [] });
  });

  it("an inferred not_me after an exact save leaves the save intact", () => {
    const e = id(1030);
    const plan = planAdjustment(input(), [
      sig({ signal: "saved_later", entityId: e, themeTags: [tg(1)], at: "2026-10-22T10:00:00.000Z" }),
      sig({ signal: "not_me", entityId: e, source: "exclude", themeTags: [tg(1)], at: "2026-10-22T12:00:00.000Z" }),
    ]);
    expect(plan).toMatchObject({ exclude: [], awayTags: [], towardTags: [tg(1)] });
  });

  it("a reaction with no entity id and a not_me with one on the same pick are one pick", () => {
    const e = id(1040);
    const plan = planAdjustment(input(), [
      sig({ signal: "saved_later", entityId: null, pickKey: "run-1:pick-x", themeTags: [tg(1)], at: "2026-10-22T10:00:00.000Z" }),
      sig({ signal: "not_me", entityId: e, source: "not_me_list", pickKey: "run-1:pick-x", themeTags: [tg(1)], at: "2026-10-22T12:00:00.000Z" }),
    ]);
    expect(plan).toMatchObject({ exclude: [e], awayTags: [tg(1)], towardTags: [] });
    // In the other order the later save wins, over the same single pick.
    const back = planAdjustment(input(), [
      sig({ signal: "not_me", entityId: e, source: "not_me_list", pickKey: "run-1:pick-x", themeTags: [tg(1)], at: "2026-10-22T10:00:00.000Z" }),
      sig({ signal: "saved_later", entityId: null, pickKey: "run-1:pick-x", themeTags: [tg(1)], at: "2026-10-22T12:00:00.000Z" }),
    ]);
    expect(back).toMatchObject({ exclude: [], towardTags: [tg(1)] });
  });

  it("orders mixed time formats by the instant they name (Z against +00:00)", () => {
    const e = id(1050);
    // 11:00 at +00:00 is later than 10:30Z, though the strings sort the other way: the save is the latest.
    const plan = planAdjustment(input(), [
      sig({ signal: "not_interested", entityId: e, at: "2026-10-22T10:30:00.000Z" }),
      sig({ signal: "saved_try", entityId: e, at: "2026-10-22T11:00:00.000+00:00" }),
    ]);
    expect(plan.exclude).toEqual([]);
  });

  it("does not repeat an id, and never adds a seed (the loop excludes seeds itself)", () => {
    const base = input({ exclude: [id(1001)] });
    const seed = base.seeds[0]!.qlooId!;
    const out = adjustFromSignals(base, [sig({ signal: "not_me", entityId: id(1001) }), sig({ signal: "not_me", entityId: seed }), sig({ signal: "not_me", entityId: id(1001) })]);
    expect(out).toBe(base);
  });

  it("ignores an entity id that is not an id", () => {
    const base = input();
    expect(adjustFromSignals(base, [sig({ signal: "not_me", entityId: "Invented Work" })])).toBe(base);
  });

  it("adds the newest signals first and at most LEARN_MAX_EXCLUDED, within RUN_MAX_EXCLUDE", () => {
    const many = Array.from({ length: LEARN_MAX_EXCLUDED + 20 }, (_, i) => sig({ signal: "not_me", entityId: id(2000 + i), at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));
    const out = adjustFromSignals(input(), many);
    expect(out.exclude).toHaveLength(LEARN_MAX_EXCLUDED);
    expect(out.exclude).toContain(id(2000 + LEARN_MAX_EXCLUDED + 19));
    expect(out.exclude).not.toContain(id(2000));

    const near = input({ exclude: Array.from({ length: RUN_MAX_EXCLUDE - 3 }, (_, i) => id(3000 + i)) });
    expect(adjustFromSignals(near, many).exclude).toHaveLength(RUN_MAX_EXCLUDE);
    const full = input({ exclude: Array.from({ length: RUN_MAX_EXCLUDE }, (_, i) => id(3000 + i)) });
    expect(adjustFromSignals(full, many)).toBe(full);
  });

  it("lowers tags that appear only in turned-down picks, and raises tags in saved picks, by the step", () => {
    const base = input();
    const out = adjustFromSignals(base, [
      sig({ signal: "not_me", source: "not_me_list", themeTags: [tg(1), tg(3)] }),
      sig({ signal: "saved_try", themeTags: [tg(3), tg(5)] }),
    ]);
    expect(weightOf(out, tg(1))).toBeCloseTo(weightOf(base, tg(1)) * (1 - LEARN_LEAN_STEP), 4);
    expect(weightOf(out, tg(3))).toBeCloseTo(Math.min(1, weightOf(base, tg(3)) * (1 + LEARN_LEAN_STEP)), 4);
    expect(weightOf(out, tg(5))).toBeCloseTo(Math.min(1, weightOf(base, tg(5)) * (1 + LEARN_LEAN_STEP)), 4);
    expect(weightOf(out, tg(2))).toBe(weightOf(base, tg(2)));
    // The same tags carry the new weights on the axes, and the request's input is untouched.
    const axisTag = out.axes.flatMap((a) => a.tags).find((t) => t.tag === tg(1))!;
    expect(axisTag.weight).toBe(weightOf(out, tg(1)));
    expect(weightOf(base, tg(1))).toBe(0.9);
  });

  it("never raises a weight above 1, and one run leans by one step however many signals repeat", () => {
    const base = input();
    const heavy = Array.from({ length: 6 }, () => sig({ signal: "saved_explore", themeTags: [tg(1)] }));
    const out = adjustFromSignals(base, heavy);
    expect(weightOf(out, tg(1))).toBeLessThanOrEqual(1);
    expect(weightOf(out, tg(1))).toBeCloseTo(Math.min(1, 0.9 * (1 + LEARN_LEAN_STEP)), 4);
    const down = adjustFromSignals(base, Array.from({ length: 6 }, () => sig({ signal: "not_interested", themeTags: [tg(2)] })));
    expect(weightOf(down, tg(2))).toBeCloseTo(0.8 * (1 - LEARN_LEAN_STEP), 4);
  });

  it("ignores a theme tag the profile does not have", () => {
    const base = input();
    const plan = planAdjustment(base, [sig({ signal: "not_me", entityId: "x", themeTags: ["urn:tag:fixture:theme:not-in-profile"] })]);
    expect(plan.awayTags).toEqual([]);
  });

  it("the latest stance on a pick wins: saved then turned down is turned down, and the reverse", () => {
    const e = id(1020);
    const savedThenDown = planAdjustment(input(), [
      sig({ signal: "saved_later", entityId: e, themeTags: [tg(1)], at: "2026-10-22T10:00:00.000Z" }),
      sig({ signal: "not_interested", entityId: e, themeTags: [tg(1)], at: "2026-10-22T11:00:00.000Z" }),
    ]);
    expect(savedThenDown).toMatchObject({ exclude: [e], awayTags: [tg(1)], towardTags: [] });
    const downThenSaved = planAdjustment(input(), [
      sig({ signal: "not_me", entityId: e, themeTags: [tg(1)], at: "2026-10-22T10:00:00.000Z" }),
      sig({ signal: "saved_try", entityId: e, themeTags: [tg(1)], at: "2026-10-22T11:00:00.000Z" }),
    ]);
    expect(downThenSaved).toMatchObject({ exclude: [], awayTags: [], towardTags: [tg(1)] });
  });

  it("treats tried as neutral", () => {
    const base = input();
    expect(adjustFromSignals(base, [sig({ signal: "tried", themeTags: [tg(1)] })])).toBe(base);
  });

  it("a tag in both a turned-down and a saved pick is raised, not lowered", () => {
    const plan = planAdjustment(input(), [sig({ signal: "not_me", themeTags: [tg(1)] }), sig({ signal: "saved_later", themeTags: [tg(1)] })]);
    expect(plan.awayTags).toEqual([]);
    expect(plan.towardTags).toEqual([tg(1)]);
  });

  it("touches nothing but exclude, tag weights and axis tag weights", () => {
    const base = input({ domains: ["film"], plan: { themes: [], requeries: [] } });
    const out = adjustFromSignals(base, [sig({ signal: "not_me", themeTags: [tg(1)] }), sig({ signal: "saved_later", themeTags: [tg(4)] })]);
    expect(out.seeds).toBe(base.seeds);
    expect(out.plan).toBe(base.plan);
    expect(out.domains).toBe(base.domains);
    expect(out.profile.tags.map((t) => t.tag)).toEqual(base.profile.tags.map((t) => t.tag));
    expect(out.axes.map((a) => a.id)).toEqual(base.axes.map((a) => a.id));
    const strip = (r: ReturnType<typeof input>) => JSON.stringify({ ...r, exclude: undefined, profile: { ...r.profile, tags: r.profile.tags.map((t) => ({ ...t, weight: 0 })) }, axes: r.axes.map((a) => ({ ...a, tags: a.tags.map((t) => ({ ...t, weight: 0 })) })) });
    expect(strip(out)).toBe(strip(base));
  });

  it("is deterministic and independent of signal order when times differ", () => {
    const list = [sig({ signal: "not_me", themeTags: [tg(1)] }), sig({ signal: "saved_try", themeTags: [tg(3)] }), sig({ signal: "not_interested", themeTags: [tg(2)] })];
    const a = adjustFromSignals(input(), list);
    const b = adjustFromSignals(input(), [...list].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("isEmptyAdjustment and applyAdjustment agree", () => {
    const base = input();
    const empty = planAdjustment(base, []);
    expect(isEmptyAdjustment(empty)).toBe(true);
    expect(applyAdjustment(base, empty)).toBe(base);
  });
});
