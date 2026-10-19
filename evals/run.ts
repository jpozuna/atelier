// The eval runner. `runEvals` replays every case through every registered trace scorer, runs the repo scorers once,
// and checks each result against the case's expectation (a failing scorer on a negative case is a match).
// It runs through Vitest (see evals/harness/evals.cli.test.ts and the Handoff in tickets/T-04-eval-harness.md) so it
// can import src/ with the same aliases the app uses. Zero Qloo calls: synthetic fixtures only.

import { loadCases } from "./harness/cases";
import { gitRepoSource } from "./harness/repo";
import type { CaseOutcome, EvalReport, Expectation, LoadedCase, RepoSource, Scorer, ScorerReport, ScorerResult } from "./harness/types";
import { assertUniqueNames, SCORERS } from "./scorers";

export interface RunOptions {
  scorers?: readonly Scorer[];
  cases?: LoadedCase[];
  repo?: RepoSource;
}

function expectedOf(e: Expectation | undefined): { want: "pass" | "fail"; text?: string } {
  if (e === undefined || e === "pass") return { want: "pass" };
  if (e === "fail") return { want: "fail" };
  return { want: "fail", text: e.fail };
}

export function judge(caseId: string, actual: ScorerResult, e: Expectation | undefined): CaseOutcome {
  const { want, text } = expectedOf(e);
  let problem: string | undefined;
  if (want === "pass" && !actual.pass) problem = `expected pass, failed: ${actual.reasons.join("; ")}`;
  else if (want === "fail" && actual.pass) problem = "expected fail, but the scorer passed (a negative case that no longer fails means the scorer got weaker)";
  else if (want === "fail" && text && !actual.reasons.some((r) => r.includes(text))) {
    problem = `failed, but not for the expected reason (wanted "${text}"): ${actual.reasons.join("; ")}`;
  }
  return { caseId, expected: want, actual, ok: problem === undefined, problem };
}

export async function runEvals(opts: RunOptions = {}): Promise<EvalReport> {
  const scorers = opts.scorers ?? SCORERS;
  assertUniqueNames(scorers);
  const cases = opts.cases ?? loadCases();
  const reports: ScorerReport[] = [];

  for (const scorer of scorers) {
    const outcomes: CaseOutcome[] = [];
    if (scorer.kind === "trace") {
      for (const c of cases) outcomes.push(judge(c.id, scorer.score(c.input), c.expect?.[scorer.name]));
    } else {
      const repo = opts.repo ?? gitRepoSource();
      outcomes.push(judge("repo", await scorer.score(repo), undefined));
    }
    reports.push({ scorer: scorer.name, kind: scorer.kind, outcomes, ok: outcomes.every((o) => o.ok) });
  }

  const known = new Set(scorers.map((s) => s.name));
  const unknown = cases.flatMap((c) => Object.keys(c.expect ?? {}).filter((n) => !known.has(n)).map((n) => `${c.id}: ${n}`));
  if (unknown.length) throw new Error(`cases expect scorers that are not registered: ${unknown.join(", ")}`);

  return { scorers: reports, ok: reports.every((r) => r.ok), caseCount: cases.length };
}

/** A plain-text table: one line per scorer, mismatches listed under it, one total line. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  const width = Math.max(...report.scorers.map((s) => s.scorer.length), 8);
  for (const s of report.scorers) {
    const negatives = s.outcomes.filter((o) => o.expected === "fail" && o.ok).length;
    const detail =
      s.kind === "repo"
        ? s.outcomes[0].ok ? s.outcomes[0].actual.reasons[0] ?? "" : "repo check failed"
        : `${s.outcomes.filter((o) => o.ok).length}/${s.outcomes.length} cases as expected${negatives ? ` (${negatives} negative case(s) failed as they should)` : ""}`;
    lines.push(`${s.ok ? "PASS" : "FAIL"}  ${s.scorer.padEnd(width)}  ${detail}`);
    // Notes after the first reason on a passing repo scorer are warnings (files that could not be scanned).
    if (s.kind === "repo" && s.outcomes[0].ok) for (const note of s.outcomes[0].actual.reasons.slice(1)) lines.push(`      ${note}`);
    for (const o of s.outcomes) {
      if (o.ok) continue;
      lines.push(`      - ${o.caseId}: ${o.problem}`);
    }
  }
  const passed = report.scorers.filter((s) => s.ok).length;
  lines.push(`${passed}/${report.scorers.length} scorers pass over ${report.caseCount} case(s).${report.ok ? "" : " FAILED"}`);
  return lines.join("\n");
}
