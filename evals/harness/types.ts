// Shared contracts for the eval harness. A scorer is a pure function over a case (trace plus optional result)
// or over the repo. It returns pass or fail and the reasons. Reasons never quote Qloo data or secrets.

import type { TraceEvent } from "@/types";

export interface ScorerResult {
  pass: boolean;
  /** One line per finding. On a pass this may carry a short note, for example what was checked. */
  reasons: string[];
}

/** `new_profile`: a first run for a profile (live calls allowed up to the budget). `repeat_view`: the same profile again (0 live calls). */
export type RunKind = "new_profile" | "repeat_view";

export interface CaseInput {
  id: string;
  run: RunKind;
  trace: TraceEvent[];
  /** The run's result (picks, paths, cards), when a case has one. The first three scorers do not read it. */
  result?: unknown;
  /** True for a recorded live run (see CaseSpec.live). */
  live?: boolean;
}

/** Where a repo scorer reads from. The real source is git; tests pass an in-memory one. */
export interface RepoSource {
  /** Paths (repo-relative, forward slashes) that are tracked, or untracked but not ignored (the next commit would add them). */
  listFiles(): string[];
  /** Text of a file, or null when it is binary, missing or too large to scan. */
  read(path: string): string | null;
  /** Added lines across git history, with the file and short commit they came from. Null when history is unavailable. */
  historyAdded(): { path: string; commit: string; line: string }[] | null;
  /** True when git ignores this path (used to prove `.qloo-private/` is ignored). */
  isIgnored(path: string): boolean;
}

export interface TraceScorer {
  kind: "trace";
  name: string;
  description: string;
  score(input: CaseInput): ScorerResult;
}

export interface RepoScorer {
  kind: "repo";
  name: string;
  description: string;
  score(source: RepoSource): Promise<ScorerResult> | ScorerResult;
}

export type Scorer = TraceScorer | RepoScorer;

/** `pass`, `fail`, or `{ fail: "text" }` when the failure must mention the text (keeps negative cases sharp). */
export type Expectation = "pass" | "fail" | { fail: string };

export interface CaseSpec {
  id: string;
  description: string;
  /** Path of a JSONL trace, relative to evals/fixtures/. */
  trace: string;
  run?: RunKind;
  /** Path of a result JSON, relative to evals/fixtures/. Optional; later scorers read it. */
  result?: string;
  /** Scorer name to expectation. Scorers not listed are expected to pass. */
  expect?: Record<string, Expectation>;
  /** A recorded live run: checks that cannot be verified from its data fail instead of passing with a note. */
  live?: true;
}

export interface LoadedCase extends CaseSpec {
  input: CaseInput;
}

export interface CaseOutcome {
  caseId: string;
  expected: "pass" | "fail";
  actual: ScorerResult;
  /** True when the actual result matches the expectation (a failing scorer on a negative case is a match). */
  ok: boolean;
  /** Why it did not match, when ok is false. */
  problem?: string;
}

export interface ScorerReport {
  scorer: string;
  kind: Scorer["kind"];
  outcomes: CaseOutcome[];
  ok: boolean;
}

export interface EvalReport {
  scorers: ScorerReport[];
  ok: boolean;
  caseCount: number;
}
