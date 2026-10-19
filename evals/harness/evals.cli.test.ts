// Entry point for `npm run evals`. Runs every registered scorer over the synthetic cases, prints the table, and
// fails (so the process exits non-zero) for any scorer that does not match its expectations. It runs only when
// ATELIER_EVALS_RUN=1 (set by the npm script), so a plain `npm test` stays free of the repo-wide git scan.
//
// It must never pass by doing nothing. If it is reached through `npm run evals` without the env var, it fails
// instead of skipping. When it runs, it asserts that cases and scorers were actually exercised, and that every
// trace scorer has at least one positive and one negative case.

import { describe, expect, it } from "vitest";
import { loadCases } from "./cases";
import { formatReport, runEvals } from "../run";
import { SCORERS } from "../scorers";

const enabled = process.env.ATELIER_EVALS_RUN === "1";
const viaScript = process.env.npm_lifecycle_event === "evals";

describe.skipIf(!enabled && !viaScript)("evals (synthetic fixtures, zero Qloo calls)", async () => {
  if (!enabled) {
    it("is run with ATELIER_EVALS_RUN=1", () => {
      expect.fail('`npm run evals` must set ATELIER_EVALS_RUN=1 (see the "evals" script); otherwise nothing is scored');
    });
    return;
  }

  const cases = loadCases();
  const report = await runEvals({ cases });
  console.log(`\n${formatReport(report)}\n`);

  it("exercised cases and every registered scorer", () => {
    expect(report.caseCount).toBeGreaterThan(0);
    expect(SCORERS.length).toBeGreaterThan(0);
    expect(report.scorers.map((s) => s.scorer)).toEqual(SCORERS.map((s) => s.name));
    for (const s of report.scorers) {
      expect(s.outcomes.length, `${s.scorer} outcomes`).toBe(s.kind === "trace" ? report.caseCount : 1);
    }
  });

  it("every trace scorer has at least one positive and one negative case", () => {
    const missing: string[] = [];
    for (const s of SCORERS) {
      if (s.kind !== "trace") continue;
      const expects = cases.map((c) => c.expect?.[s.name] ?? "pass");
      if (!expects.includes("pass")) missing.push(`${s.name}: no positive case`);
      if (!expects.some((e) => e !== "pass")) missing.push(`${s.name}: no negative case`);
    }
    expect(missing).toEqual([]);
  });

  for (const s of report.scorers) {
    it(`${s.scorer}: ${s.outcomes.length} check(s) as expected`, () => {
      const problems = s.outcomes.filter((o) => !o.ok).map((o) => `${o.caseId}: ${o.problem}`);
      expect(problems).toEqual([]);
    });
  }
});
