// The `learning` eval scorer, on edited copies of its synthetic fixture.

import { describe, expect, it } from "vitest";
import { loadCases } from "../../../evals/harness/cases";
import { scoreLearning } from "../../../evals/scorers/learning";

const learned = () => structuredClone(loadCases().find((c) => c.id === "t28-learned-run")!.input);

describe("learning scorer", () => {
  it("passes the learned fixture and says what held", () => {
    const r = scoreLearning(learned());
    expect(r.pass, r.reasons.join("; ")).toBe(true);
    expect(r.reasons[0]).toContain("set-aside");
  });

  it("passes a run with nothing learned (no signals), and a case with no result", () => {
    const a = learned();
    delete (a.result as { learning?: unknown }).learning;
    expect(scoreLearning(a).pass).toBe(true);
    expect(scoreLearning({ ...learned(), result: undefined }).pass).toBe(true);
  });

  it("cannot verify exclusion lists without an audit block: a note on a synthetic case, a failure on a live one", () => {
    const a = learned();
    delete (a.result as { audit?: unknown }).audit;
    expect(scoreLearning(a).pass).toBe(true);
    const r = scoreLearning({ ...a, live: true });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toContain("not verifiable");
  });

  it("fails when the earlier run held none of the leaned-away theme", () => {
    const a = learned();
    (a.result as { learning: { leanedAway: string[] } }).learning.leanedAway = ["urn:tag:fixture:genre:never-seen"];
    const r = scoreLearning(a);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toContain("no share to drop");
  });

  it("fails a result with no picks, which would pass on nothing", () => {
    const a = learned();
    for (const d of (a.result as { domains: { picks: unknown[]; byBand?: unknown }[] }).domains) {
      d.picks = [];
      delete d.byBand;
    }
    expect(scoreLearning(a).pass).toBe(false);
  });
});
