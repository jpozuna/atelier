import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatReport, judge, runEvals } from "../run";
import { SCORERS } from "../scorers";
import { expectedLiveCalls, liveGate, LIVE_OUT_DIR, writeRecording, type LiveSuite } from "./live";
import { loadCases, parseCaseSpecs } from "./cases";
import type { LoadedCase, RepoSource, Scorer, TraceScorer } from "./types";

const cleanRepo: RepoSource = { listFiles: () => [], read: () => null, historyAdded: () => [], isIgnored: () => true };
const always = (name: string, pass: boolean): TraceScorer => ({ kind: "trace", name, description: "", score: () => ({ pass, reasons: pass ? [] : [`${name} reason`] }) });
const fakeCase = (id: string, expect?: LoadedCase["expect"]): LoadedCase => ({ id, description: "", trace: "", expect, input: { id, run: "new_profile", trace: [] } });

describe("judge", () => {
  it("a pass is expected by default", () => {
    expect(judge("c", { pass: true, reasons: [] }, undefined).ok).toBe(true);
    expect(judge("c", { pass: false, reasons: ["r"] }, undefined).ok).toBe(false);
  });

  it("a negative case matches only when the scorer fails", () => {
    expect(judge("c", { pass: false, reasons: ["r"] }, "fail").ok).toBe(true);
    const o = judge("c", { pass: true, reasons: [] }, "fail");
    expect(o.ok).toBe(false);
    expect(o.problem).toContain("scorer got weaker");
  });

  it("a negative case can name the reason it must fail for", () => {
    expect(judge("c", { pass: false, reasons: ["13 live calls"] }, { fail: "live calls" }).ok).toBe(true);
    expect(judge("c", { pass: false, reasons: ["other"] }, { fail: "live calls" }).ok).toBe(false);
  });
});

describe("runEvals", () => {
  it("runs every registered scorer on every case and reports each", async () => {
    const report = await runEvals({ scorers: [always("a", true), always("b", true)], cases: [fakeCase("x"), fakeCase("y")], repo: cleanRepo });
    expect(report.ok).toBe(true);
    expect(report.scorers.map((s) => s.scorer)).toEqual(["a", "b"]);
    expect(report.scorers[0].outcomes).toHaveLength(2);
  });

  it("is not ok when any scorer misses an expectation", async () => {
    const report = await runEvals({ scorers: [always("a", true), always("b", false)], cases: [fakeCase("x")], repo: cleanRepo });
    expect(report.ok).toBe(false);
    expect(report.scorers.map((s) => s.ok)).toEqual([true, false]);
    expect(formatReport(report)).toContain("FAIL  b");
  });

  it("a negative case turns a failing scorer into a match", async () => {
    const report = await runEvals({ scorers: [always("b", false)], cases: [fakeCase("x", { b: "fail" })], repo: cleanRepo });
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toContain("1 negative case(s) failed as they should");
  });

  it("refuses duplicate scorer names and expectations for scorers that do not exist", async () => {
    await expect(runEvals({ scorers: [always("a", true), always("a", true)], cases: [], repo: cleanRepo })).rejects.toThrow(/duplicate/);
    await expect(runEvals({ scorers: [always("a", true)], cases: [fakeCase("x", { nope: "fail" })], repo: cleanRepo })).rejects.toThrow(/not registered/);
  });

  it("runs repo scorers once, not per case", async () => {
    let n = 0;
    const repo: Scorer = { kind: "repo", name: "r", description: "", score: () => (n++, { pass: true, reasons: ["ok"] }) };
    await runEvals({ scorers: [repo], cases: [fakeCase("x"), fakeCase("y")], repo: cleanRepo });
    expect(n).toBe(1);
  });
});

describe("registered scorers on the synthetic fixtures", () => {
  it("registers every scorer, in order", () => {
    expect(SCORERS.map((s) => s.name)).toEqual([
      "repo-hygiene", "param-validity", "call-budget", "dial-behavior", "requery-logic", "domain-coverage", "edge-cap",
      "path-presence", "distinctive-hop", "reach-margin", "connection-floor", "provenance", "card-completeness",
      "seed-resolution",
    ]);
  });

  it("every trace scorer behaves as each case expects (negative cases fail for the stated reason)", async () => {
    const report = await runEvals({ repo: cleanRepo });
    const problems = report.scorers.flatMap((s) => s.outcomes.filter((o) => !o.ok).map((o) => `${s.scorer}/${o.caseId}: ${o.problem}`));
    expect(problems).toEqual([]);
  });

  it("each trace scorer has at least one negative case and one positive case", () => {
    const cases = loadCases();
    for (const name of ["param-validity", "call-budget"]) {
      expect(cases.some((c) => c.expect?.[name] !== undefined && c.expect[name] !== "pass"), `${name} negative`).toBe(true);
      expect(cases.some((c) => c.expect?.[name] === undefined || c.expect[name] === "pass"), `${name} positive`).toBe(true);
    }
  });

  it("the positive cases include a cached repeat view and the 12-call boundary", () => {
    const ids = loadCases().map((c) => c.id);
    expect(ids).toContain("repeat-view-cached");
    expect(ids).toContain("at-limits-12-calls-2-requeries");
  });
});

describe("parseCaseSpecs", () => {
  it("rejects malformed manifests", () => {
    expect(() => parseCaseSpecs({})).toThrow();
    expect(() => parseCaseSpecs({ cases: [{ id: "a", description: "", trace: "t", run: "later" }] })).toThrow(/run must be/);
    expect(() => parseCaseSpecs({ cases: [{ id: "a", description: "", trace: "t", expect: { x: "maybe" } }] })).toThrow(/expectation/);
    expect(() => parseCaseSpecs({ cases: [{ id: "a", description: "", trace: "t" }, { id: "a", description: "", trace: "t" }] })).toThrow(/duplicate/);
  });
});

describe("live gate", () => {
  const suite = (calls: number): LiveSuite => ({ id: "s", description: "", expectedCalls: calls, run: async () => {} });

  it("prints the expected call count first and refuses without QLOO_LIVE=1", () => {
    for (const env of [{}, { QLOO_LIVE: "0" }, { QLOO_LIVE: "true" }, { QLOO_LIVE: "" }]) {
      const g = liveGate(env, [suite(5), suite(4)]);
      expect(g.allowed).toBe(false);
      expect(g.lines[0]).toContain("Expected live Qloo calls: 9");
      expect(g.lines.at(-1)).toContain("QLOO_LIVE=1");
    }
  });

  it("allows only QLOO_LIVE=1, and says when there are no suites yet", () => {
    const g = liveGate({ QLOO_LIVE: "1" }, []);
    expect(g.allowed).toBe(true);
    expect(g.lines[0]).toContain("Expected live Qloo calls: 0");
    expect(g.lines.at(-1)).toContain("No live suites yet");
  });

  it("refuses a suite that expects more than the per-run limit", () => {
    expect(liveGate({ QLOO_LIVE: "1" }, [suite(13)]).allowed).toBe(false);
  });

  it("sums expected calls", () => {
    expect(expectedLiveCalls([suite(2), suite(3)])).toBe(5);
  });

  it("writes recordings under .qloo-private/evals/ and refuses path tricks", () => {
    const root = mkdtempSync(join(tmpdir(), "atelier-evals-"));
    try {
      const file = writeRecording(root, "run-1.json", { n: 1 });
      expect(file).toBe(join(root, LIVE_OUT_DIR, "run-1.json"));
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ n: 1 });
      for (const bad of ["../x.json", "a/b.json", ".hidden", ""]) expect(() => writeRecording(root, bad, {}), bad).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
