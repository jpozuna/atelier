// One judge call and its checks. A judge is a rubric prompt plus a forced tool call; the reply is validated in code.
// Code, not the model, decides what a verdict means: a "pass" whose quoted evidence is not in the input is downgraded,
// and a reply that does not fit the schema is an error, never a guess.

import { LlmError, type Llm } from "@/lib/agent/llm";
import { SCORE_TOLERANCE, JUDGE_MAX_TOKENS } from "./config";
import { JUDGE_TOOL_NAME, judgeSystem, judgeTool } from "./rubrics";
import { JUDGE_KIND, type CalibrationItem, type FitScores, type JudgeId, type JudgeInput, type JudgeResult, type Verdict } from "./types";

/** The user message: the input as JSON data and nothing else. */
export function judgeUserMessage(input: JudgeInput): string {
  return JSON.stringify(input, null, 1);
}

/** Every string in the input, for checking that quoted evidence is real. */
function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Quotes (after folding case, quote marks and whitespace) that do not appear in any string of the input. */
export function missingQuotes(input: JudgeInput, quotes: readonly string[]): string[] {
  const haystack = collectStrings(input).map(fold).join(" \n ");
  return quotes.filter((q) => {
    const f = fold(q).replace(/^["'….]+|["'….]+$/g, "").trim();
    return f.length === 0 || !haystack.includes(f);
  });
}

/** Judges that may pass with no evidence, because the card can have nothing to check. */
const VACUOUS_PASS_OK: ReadonlySet<JudgeId> = new Set(["lineage-groundedness", "reading-restraint"]);

const isInt15 = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Validates a tool input into a Verdict. Throws `LlmError("shape")` when it does not fit the schema. */
export function parseVerdict(judge: JudgeId, id: string, input: JudgeInput, raw: Record<string, unknown>): Verdict {
  const bad = (why: string): never => {
    throw new LlmError("shape", `${judge} reply ${why}`);
  };
  if (raw.scorer !== judge) bad("named the wrong scorer");
  if (raw.card_id !== id) bad("named the wrong card");
  if (typeof raw.judgeable !== "boolean") bad("had no judgeable flag");
  if (!strArr(raw.evidence)) bad("had no evidence list");
  if (!strArr(raw.unsupported_claims)) bad("had no unsupported_claims list");
  if (typeof raw.reason !== "string") bad("had no reason");
  const evidence = raw.evidence as string[];
  const verdict: Verdict = {
    judge,
    id,
    judgeable: raw.judgeable as boolean,
    result: null,
    evidence,
    evidenceMissing: missingQuotes(input, evidence),
    unsupportedClaims: raw.unsupported_claims as string[],
    reason: raw.reason as string,
  };
  if (!verdict.judgeable) return verdict;

  const kind = JUDGE_KIND[judge];
  const r = raw.result;
  if (kind === "binary") {
    if (r !== "pass" && r !== "fail") bad("had a result that is not pass or fail");
    verdict.result = r as "pass" | "fail";
    if (r === "pass") {
      if (verdict.evidenceMissing.length > 0) {
        verdict.result = "fail";
        verdict.adjusted = "pass downgraded: a quoted piece of evidence is not in the input";
      } else if (evidence.length === 0 && !VACUOUS_PASS_OK.has(judge)) {
        verdict.result = "fail";
        verdict.adjusted = "pass downgraded: no evidence quoted";
      }
    }
  } else if (kind === "score") {
    if (!isInt15(r)) bad("had a result that is not an integer from 1 to 5");
    verdict.result = r as number;
  } else {
    const o = r as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isInt15(o.discernment) || !isInt15(o.pattern) || !isInt15(o.idiosyncrasy)) bad("had scores that are not integers from 1 to 5");
    const s = o as Record<string, number>;
    verdict.result = { discernment: s.discernment, pattern: s.pattern, idiosyncrasy: s.idiosyncrasy };
    if (typeof raw.slop !== "boolean") bad("had no slop flag");
    verdict.slop = raw.slop as boolean;
  }
  return verdict;
}

/** One model call. Throws `LlmError` when the call or the reply fails. */
export async function runJudge(llm: Llm, input: JudgeInput, signal?: AbortSignal): Promise<Verdict> {
  const raw = await llm.call({
    tool: judgeTool(input.judge),
    system: judgeSystem(input.judge),
    user: judgeUserMessage(input),
    maxTokens: JUDGE_MAX_TOKENS,
    signal,
  });
  return parseVerdict(input.judge, input.id, input, raw);
}

const within = (a: number, b: number): boolean => Math.abs(a - b) <= SCORE_TOLERANCE;

/** Whether a verdict agrees with a calibration label. A verdict that was not judgeable never agrees. */
export function agrees(expected: JudgeResult, verdict: Verdict): boolean {
  if (!verdict.judgeable || verdict.result === null) return false;
  const got = verdict.result;
  if (typeof expected === "string") return got === expected;
  if (typeof expected === "number") return typeof got === "number" && within(got, expected);
  const e = expected as FitScores;
  if (typeof got !== "object") return false;
  return within(got.discernment, e.discernment) && within(got.pattern, e.pattern) && within(got.idiosyncrasy, e.idiosyncrasy);
}

export const itemAgrees = (item: CalibrationItem, verdict: Verdict): boolean => agrees(item.expected, verdict);

export { JUDGE_TOOL_NAME };
