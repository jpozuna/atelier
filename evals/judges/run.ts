// The judge runner and its gate. Real runs spend model calls, so they are gated like the live Qloo evals:
//   - the expected number of model calls is printed first, always;
//   - a real run needs ATELIER_JUDGES_LIVE=1 and a key in ANTHROPIC_API_KEY (never printed), and is refused over
//     MAX_JUDGE_CALLS_PER_RUN;
//   - with no gate the runner uses the fake model (zero calls) and labels its output FAKE.
// One call per calibration item, no retries, so the expected count is exact.

import { createLlm, limitCalls, type Llm, LlmError } from "@/lib/agent/llm";
import { allCalibrationItems } from "./calibration";
import { HIGH_LABEL_MIN, LOW_LABEL_MAX, MAX_JUDGE_CALLS_PER_RUN, MIN_AGREEMENT } from "@/lib/agent/config";
import { ENV_JUDGE_MODEL, ENV_LIVE, ENV_MODEL } from "./config";
import { createFakeLlm } from "./fake";
import { itemAgrees, runJudge, scalar } from "./judge";
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
  /** 1 to 5 judges only: mean verdict score of the items labeled high (4 or 5) and low (1 or 2). The high mean must be above the low mean. */
  ordering?: { high: number | null; low: number | null; ok: boolean };
  /** Agreement at or above the threshold and, where defined, the ordering check. Only meaningful for a real run. */
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

function orderingOf(verdicts: ReadonlyMap<string, Verdict>, items: readonly CalibrationItem[]): { high: number | null; low: number | null; ok: boolean } {
  const mean = (pick: (label: number) => boolean): number | null => {
    const xs: number[] = [];
    for (const it of items) {
      const label = scalar(it.expected);
      if (label === null || !pick(label)) continue;
      const got = scalar(verdicts.get(it.id)?.result ?? null);
      if (got !== null) xs.push(got);
    }
    return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const high = mean((l) => l >= HIGH_LABEL_MIN);
  const low = mean((l) => l <= LOW_LABEL_MAX);
  return { high, low, ok: high !== null && low !== null && high > low };
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
    const mineVerdicts = new Map<string, Verdict>();
    const disagreements: Disagreement[] = [];
    let agreed = 0;
    let errors = 0;
    for (const it of mine) {
      try {
        const v = await runJudge(llm, it.input, opts.signal);
        verdicts.push(v);
        mineVerdicts.set(it.id, v);
        if (itemAgrees(it, v)) agreed += 1;
        else disagreements.push({ id: it.id, expected: it.expected, got: v.result, reason: v.reason, ...(v.adjusted ? { adjusted: v.adjusted } : {}) });
      } catch (err) {
        errors += 1;
        disagreements.push({ id: it.id, expected: it.expected, got: null, reason: err instanceof LlmError ? `${err.kind}: ${err.message}` : "call failed" });
      }
    }
    const agreement = agreed / mine.length;
    const ordering = JUDGE_KIND[judge] === "binary" ? undefined : orderingOf(mineVerdicts, mine);
    reports.push({ judge, total: mine.length, agreed, errors, agreement, summary: summarize(judge, verdicts), ...(ordering ? { ordering } : {}), meetsThreshold: agreement >= min && (ordering?.ok ?? true), disagreements });
  }
  return { mode: opts.mode, model: opts.model, calls: opts.llm.stats().calls, judges: reports, allMeetThreshold: reports.every((r) => r.meetsThreshold) };
}

/**
 * The model client for this gate: the real client for a real run, the oracle for a fake one. A real run uses the
 * judge model (`judgeModel(env)`), the same one the gate prints, not the generator's ATELIER_MODEL.
 */
export function llmFor(gate: JudgesGate, env: Env, items: readonly CalibrationItem[] = allCalibrationItems(), extra: { fetch?: typeof fetch } = {}): Llm {
  return gate.mode === "real" ? createLlm({ ...env, [ENV_MODEL]: judgeModel(env) }, { fetch: extra.fetch }) : createFakeLlm(items);
}

const NA = "n/a (fake)";

export function formatReport(r: JudgesReport): string {
  const fake = r.mode === "fake";
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const num = (x: number | null): string => (x === null ? "-" : x.toFixed(1));
  const rows = r.judges.map((j) => {
    const agree = fake ? NA : `${String(j.agreed).padStart(2)}/${String(j.total).padEnd(2)} ${pct(j.agreement).padStart(4)}`;
    const status = fake ? NA : j.meetsThreshold ? "ok" : "BELOW THRESHOLD";
    const order = j.ordering && !fake ? `  order high ${num(j.ordering.high)} vs low ${num(j.ordering.low)}${j.ordering.ok ? "" : " (WRONG WAY)"}` : "";
    return `${j.judge.padEnd(22)} ${agree.padEnd(12)}  ${j.summary.padEnd(12)} ${status}${order}`;
  });
  const head = fake
    ? "FAKE model (replays labels): plumbing check only. Agreement with the labels is NOT measured."
    : `REAL model ${r.model}: agreement with the calibration labels, ${r.calls} call(s).`;
  const lines = [head, "judge                  agreement     verdicts      status", ...rows];
  if (!fake)
    for (const j of r.judges)
      for (const d of j.disagreements) lines.push(`  ${j.judge} ${d.id}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.got)}${d.adjusted ? ` (${d.adjusted})` : ""}; ${d.reason}`);
  return lines.join("\n");
}
