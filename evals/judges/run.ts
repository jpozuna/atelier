// The judge runner and its gate. Real runs spend model calls, so they are gated like the live Qloo evals:
//   - the expected number of model calls is printed first, always;
//   - a real run needs ATELIER_JUDGES_LIVE=1 and a key in ANTHROPIC_API_KEY (never printed), and is refused over
//     MAX_JUDGE_CALLS_PER_RUN;
//   - with no gate the runner uses the fake model (zero calls) and labels its output FAKE.
// One call per calibration item, no retries, so the expected count is exact.

import { createLlm, limitCalls, type Llm, LlmError } from "@/lib/agent/llm";
import { allCalibrationItems } from "./calibration";
import { ENV_JUDGE_MODEL, ENV_LIVE, ENV_MODEL, MAX_JUDGE_CALLS_PER_RUN, MIN_AGREEMENT } from "./config";
import { createFakeLlm } from "./fake";
import { itemAgrees, runJudge } from "./judge";
import { JUDGE_IDS, JUDGE_KIND, type CalibrationItem, type JudgeId, type JudgeResult, type Verdict } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

export type RunMode = "fake" | "real";

export interface JudgesGate {
  /** `fake` runs offline. `real` calls the model. */
  mode: RunMode;
  /** False only when a real run was asked for and refused. */
  allowed: boolean;
  expectedCalls: number;
  /** What to print, in order. The expected-call line is always first. */
  lines: string[];
}

/** The model a real run uses: ATELIER_JUDGE_MODEL, else ATELIER_MODEL, else the app default. Prefer one that is not the generator's. */
export function judgeModel(env: Env): string {
  return env[ENV_JUDGE_MODEL]?.trim() || env[ENV_MODEL]?.trim() || "claude-sonnet-5-5";
}

export function expectedCalls(items: readonly CalibrationItem[]): number {
  return items.length;
}

export function judgesGate(env: Env, items: readonly CalibrationItem[] = allCalibrationItems()): JudgesGate {
  const n = expectedCalls(items);
  const perJudge = JUDGE_IDS.map((j) => `${j} ${items.filter((i) => i.judge === j).length}`).join(", ");
  const lines = [`Expected model calls for a real run: ${n} (${perJudge}); the fake model makes 0.`];
  if (env[ENV_LIVE] !== "1") {
    lines.push(`Using the FAKE model (replays the calibration labels, 0 calls). It checks the plumbing only; it does not measure agreement. For a real run set ${ENV_LIVE}=1 after approval.`);
    return { mode: "fake", allowed: true, expectedCalls: n, lines };
  }
  if (n > MAX_JUDGE_CALLS_PER_RUN) {
    lines.push(`Refusing: ${n} model calls is over the ${MAX_JUDGE_CALLS_PER_RUN} per-run limit.`);
    return { mode: "real", allowed: false, expectedCalls: n, lines };
  }
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    lines.push("Refusing: ANTHROPIC_API_KEY is not set, so a real run cannot start.");
    return { mode: "real", allowed: false, expectedCalls: n, lines };
  }
  lines.push(`REAL run: ${n} model call(s) to ${judgeModel(env)}. Agreement with the labels (at least ${Math.round(MIN_AGREEMENT * 100)}% per judge) is measured now.`);
  return { mode: "real", allowed: true, expectedCalls: n, lines };
}

export interface Disagreement {
  id: string;
  expected: JudgeResult;
  got: JudgeResult | null;
  reason: string;
  adjusted?: string;
}

export interface JudgeReport {
  judge: JudgeId;
  total: number;
  /** Items where the verdict matched the label. */
  agreed: number;
  /** Calls that failed or returned a reply that did not fit the schema. They count as disagreements. */
  errors: number;
  agreement: number;
  /** Verdicts that were pass (binary judges), or the mean score (1 to 5 judges, mean of the three for rubric-fit). */
  summary: string;
  meetsThreshold: boolean;
  disagreements: Disagreement[];
}

export interface JudgesReport {
  mode: RunMode;
  model: string;
  calls: number;
  judges: JudgeReport[];
  /** Every judge at or above the threshold. Only meaningful for a real run. */
  allMeetThreshold: boolean;
}

function summarize(judge: JudgeId, verdicts: readonly Verdict[]): string {
  const judged = verdicts.filter((v) => v.judgeable && v.result !== null);
  if (judged.length === 0) return "no verdicts";
  const kind = JUDGE_KIND[judge];
  if (kind === "binary") return `${judged.filter((v) => v.result === "pass").length}/${judged.length} pass`;
  const score = (v: Verdict): number => {
    const r = v.result;
    if (typeof r === "number") return r;
    if (r && typeof r === "object") return (r.discernment + r.pattern + r.idiosyncrasy) / 3;
    return 0;
  };
  const mean = judged.reduce((s, v) => s + score(v), 0) / judged.length;
  return `mean ${mean.toFixed(1)}`;
}

export interface RunOptions {
  llm: Llm;
  mode: RunMode;
  model: string;
  items?: readonly CalibrationItem[];
  minAgreement?: number;
  signal?: AbortSignal;
}

/** Runs every item once, in order, one call each. A failed call is a disagreement, never retried. */
export async function runJudges(opts: RunOptions): Promise<JudgesReport> {
  const items = opts.items ?? allCalibrationItems();
  const min = opts.minAgreement ?? MIN_AGREEMENT;
  const llm = limitCalls(opts.llm, items.length);
  const reports: JudgeReport[] = [];
  for (const judge of JUDGE_IDS) {
    const mine = items.filter((i) => i.judge === judge);
    if (mine.length === 0) continue;
    const verdicts: Verdict[] = [];
    const disagreements: Disagreement[] = [];
    let agreed = 0;
    let errors = 0;
    for (const it of mine) {
      try {
        const v = await runJudge(llm, it.input, opts.signal);
        verdicts.push(v);
        if (itemAgrees(it, v)) agreed += 1;
        else disagreements.push({ id: it.id, expected: it.expected, got: v.result, reason: v.reason, ...(v.adjusted ? { adjusted: v.adjusted } : {}) });
      } catch (err) {
        errors += 1;
        disagreements.push({ id: it.id, expected: it.expected, got: null, reason: err instanceof LlmError ? `${err.kind}: ${err.message}` : "call failed" });
      }
    }
    const agreement = agreed / mine.length;
    reports.push({ judge, total: mine.length, agreed, errors, agreement, summary: summarize(judge, verdicts), meetsThreshold: agreement >= min, disagreements });
  }
  return { mode: opts.mode, model: opts.model, calls: opts.llm.stats().calls, judges: reports, allMeetThreshold: reports.every((r) => r.meetsThreshold) };
}

/** The model to run with for this gate: the real client for a real run, the oracle for a fake one. */
export function llmFor(gate: JudgesGate, env: Env, items: readonly CalibrationItem[] = allCalibrationItems()): Llm {
  return gate.mode === "real" ? createLlm(env) : createFakeLlm(items);
}

export function formatReport(r: JudgesReport): string {
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const rows = r.judges.map((j) => `${j.judge.padEnd(22)} ${String(j.agreed).padStart(2)}/${String(j.total).padEnd(2)} agree ${pct(j.agreement).padStart(4)}  ${j.summary.padEnd(12)} ${j.meetsThreshold ? "ok" : "BELOW THRESHOLD"}`);
  const head =
    r.mode === "fake"
      ? "FAKE model (replays labels): plumbing check only. Agreement with the labels is NOT measured."
      : `REAL model ${r.model}: agreement with the calibration labels, ${r.calls} call(s).`;
  const lines = [head, "judge                  agreement          verdicts", ...rows];
  for (const j of r.judges)
    for (const d of j.disagreements) lines.push(`  ${j.judge} ${d.id}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.got)}${d.adjusted ? ` (${d.adjusted})` : ""}; ${d.reason}`);
  return lines.join("\n");
}
