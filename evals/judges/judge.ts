// One judge call and its checks. A judge is a rubric prompt plus a forced tool call; the reply is validated in code.
// Code, not the model, decides what a verdict means: a "pass" whose quoted evidence is not in the input is downgraded,
// and a reply that does not fit the schema is an error, never a guess.

import { LlmError, type Llm } from "@/lib/agent/llm";
import { EXACT_AT_ENDS, JUDGE_MAX_TOKENS, MIN_QUOTE_CHARS, SCORE_TOLERANCE } from "@/lib/agent/config";
import { JUDGE_TOOL_NAME, judgeSystem, judgeTool } from "./rubrics";
import { JUDGE_KIND, type CalibrationItem, type FitScores, type JudgeId, type JudgeInput, type JudgeResult, type Verdict } from "./types";

/** The user message: the input as JSON data and nothing else. */
export function judgeUserMessage(input: JudgeInput): string {
  return JSON.stringify(input, null, 1);
}

/** Every string in a value, for checking that quoted evidence is real. */
function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/**
 * The strings a judge may quote from, by judge. Groundedness quotes come from the explanation (why and different), not
 * from the seed's own words: the claim being judged must be quoted. Stretch quotes come from the Stretch card. Every
 * other judge may quote anywhere on the card.
 */
export function quotableStrings(input: JudgeInput): string[] {
  if (input.judge === "stretch-defensibility") return collectStrings(input.stretch);
  if (input.judge === "bridge-groundedness") return [input.card.why, input.card.different];
  return collectStrings(input.card);
}

/** Quotes that are too short (after folding), or that do not appear in the strings the judge may quote from. */
export function missingQuotes(input: JudgeInput, quotes: readonly string[]): string[] {
  const haystack = quotableStrings(input).map(fold).join(" \n ");
  return quotes.filter((q) => {
    const f = fold(q).replace(/^["'\u2026.]+|["'\u2026.]+$/g, "").trim();
    return f.length < MIN_QUOTE_CHARS || !haystack.includes(f);
  });
}

/**
 * Whether a lineage or reading judge may pass with no evidence. Decided from the card, not the model: the card must
 * have nothing for the judge to check (no lineage hop, reading or retrieved source as the judge needs).
 */
export function nothingToCheck(input: JudgeInput): boolean {
  if (input.judge === "stretch-defensibility") return false;
  const c = input.card;
  if (input.judge === "lineage-groundedness") return !c.hops.some((h) => h.kind === "lineage") && c.sources.length === 0;
  if (input.judge === "reading-restraint") return !c.reading && c.sources.length === 0;
  return false;
}

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
      } else if (evidence.length === 0 && !nothingToCheck(input)) {
        verdict.result = "fail";
        verdict.adjusted = "pass downgraded: no evidence quoted";
      }
    }
  } else if (kind === "score") {
    if (!isInt15(r)) bad("had a result that is not an integer from 1 to 5");
    verdict.result = r as number;
    unverify(verdict);
  } else {
    const o = r as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isInt15(o.discernment) || !isInt15(o.pattern) || !isInt15(o.idiosyncrasy)) bad("had scores that are not integers from 1 to 5");
    const s = o as Record<string, number>;
    verdict.result = { discernment: s.discernment, pattern: s.pattern, idiosyncrasy: s.idiosyncrasy };
    if (typeof raw.slop !== "boolean") bad("had no slop flag");
    verdict.slop = raw.slop as boolean;
    unverify(verdict);
  }
  return verdict;
}

/** Scored and fit verdicts must cite at least one real quote and no invented ones ("no quote, no credit"); otherwise the verdict is withdrawn. */
function unverify(v: Verdict): void {
  if (v.evidence.length === 0 || v.evidenceMissing.length > 0) {
    v.judgeable = false;
    v.result = null;
    v.adjusted = v.evidence.length === 0 ? "score withdrawn: no evidence quoted" : "score withdrawn: a quoted piece of evidence is too short or not on the card";
  }
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
const isEnd = (n: number): boolean => n === 1 || n === 5;

/**
 * Whether a verdict agrees with a calibration label. A verdict that was not judgeable never agrees. A 1 to 5 label at
 * either end (1 or 5) needs an exact match; the tolerance applies only to the labels in between.
 */
export function agrees(expected: JudgeResult, verdict: Verdict): boolean {
  if (!verdict.judgeable || verdict.result === null) return false;
  const got = verdict.result;
  if (typeof expected === "string") return got === expected;
  if (typeof expected === "number") {
    if (typeof got !== "number") return false;
    return EXACT_AT_ENDS && isEnd(expected) ? got === expected : within(got, expected);
  }
  const e = expected as FitScores;
  if (typeof got !== "object") return false;
  return within(got.discernment, e.discernment) && within(got.pattern, e.pattern) && within(got.idiosyncrasy, e.idiosyncrasy);
}

/** The label and, for rubric-fit, the slop flag. */
export function itemAgrees(item: CalibrationItem, verdict: Verdict): boolean {
  if (!agrees(item.expected, verdict)) return false;
  return item.expectedSlop === undefined || verdict.slop === item.expectedSlop;
}

/** One number for a 1 to 5 result: the score, or the mean of the three rubric-fit scores. Null for pass or fail. */
export function scalar(r: JudgeResult | null): number | null {
  if (typeof r === "number") return r;
  if (r && typeof r === "object") return (r.discernment + r.pattern + r.idiosyncrasy) / 3;
  return null;
}

export { JUDGE_TOOL_NAME };
