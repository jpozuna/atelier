// The fake model. It makes no network call and spends nothing. It replays the calibration labels (an oracle), so a
// run with it checks the plumbing (prompt build, tool schema, parsing, agreement math, report) and says NOTHING about
// how well the real judges agree with the labels. That is measured only on an approved real run.

import { LlmError, type Llm, type LlmRequest, type LlmStats } from "@/lib/agent/llm";
import { JUDGE_TOOL_NAME } from "./rubrics";
import { JUDGE_KIND, type CalibrationItem, type FitScores, type JudgeId, type JudgeInput, type JudgeResult } from "./types";

export interface FakeOptions {
  /** Answer the opposite of every label (pass becomes fail, n becomes 6 - n). For testing that disagreement is caught. */
  flip?: boolean;
  /** Called with every request, before it is answered. */
  onRequest?: (req: LlmRequest) => void;
}

const flipResult = (r: JudgeResult): JudgeResult => {
  if (r === "pass") return "fail";
  if (r === "fail") return "pass";
  if (typeof r === "number") return 6 - r;
  const f = r as FitScores;
  return { discernment: 6 - f.discernment, pattern: 6 - f.pattern, idiosyncrasy: 6 - f.idiosyncrasy };
};

const quotable = (input: JudgeInput): string => (input.judge === "stretch-defensibility" ? input.stretch.why : input.card.why);

export function createFakeLlm(items: readonly CalibrationItem[], opts: FakeOptions = {}): Llm & { requests: LlmRequest[] } {
  const byKey = new Map(items.map((i) => [`${i.judge}:${i.id}`, i]));
  const stats: LlmStats = { calls: 0, cacheHits: 0, failures: 0 };
  const requests: LlmRequest[] = [];
  return {
    enabled: true,
    requests,
    stats: () => ({ ...stats }),
    async call(req) {
      requests.push(req);
      opts.onRequest?.(req);
      stats.calls += 1;
      let parsed: { judge?: JudgeId; id?: string };
      try {
        parsed = JSON.parse(req.user) as typeof parsed;
      } catch {
        stats.failures += 1;
        throw new LlmError("shape", "fake model got a message that is not JSON");
      }
      const item = byKey.get(`${parsed.judge}:${parsed.id}`);
      if (!item || req.tool.name !== JUDGE_TOOL_NAME) {
        stats.failures += 1;
        throw new LlmError("shape", `fake model has no label for ${parsed.judge}:${parsed.id}`);
      }
      const result = opts.flip ? flipResult(item.expected) : item.expected;
      const out: Record<string, unknown> = {
        scorer: item.judge,
        card_id: item.id,
        judgeable: true,
        result,
        evidence: [quotable(item.input)],
        unsupported_claims: result === "fail" ? ["(fake) unsupported claim"] : [],
        reason: "Fake model: replays the calibration label.",
      };
      if (JUDGE_KIND[item.judge] === "fit") out.slop = opts.flip ? !(item.expectedSlop ?? false) : (item.expectedSlop ?? false);
      return out;
    },
  };
}
