// call-budget: a new profile run makes at most MAX_LIVE_CALLS_PER_RUN live Qloo calls, a repeat view makes none
// (all served from cache), a run has at most MAX_REQUERIES_PER_RUN re-queries, and there is one insights pool per
// domain (a re-query may add one more for its domain, nothing else). Counted from the trace's qloo_call events and
// their `cached` flag. Limits are read from config.ts, never copied.

import { MAX_LIVE_CALLS_PER_RUN, MAX_REQUERIES_PER_RUN } from "@/lib/agent/config";
import { isLiveCall, isQlooCall } from "../harness/trace";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";

export function scoreCallBudget(input: CaseInput): ScorerResult {
  const { trace, run } = input;
  const reasons: string[] = [];

  const calls = trace.filter(isQlooCall);
  // Count every live attempt, successful or not. The client's own running count (runLiveCalls) catches attempts
  // that failed before any status came back (network errors), so live is the larger of the two.
  const reported = Math.max(0, ...calls.map((c) => (c as { runLiveCalls?: number }).runLiveCalls ?? 0));
  const live = Math.max(calls.filter(isLiveCall).length, reported);
  if (run === "repeat_view") {
    if (live > 0) reasons.push(`repeat view made ${live} live call(s), counting failed attempts; it must make 0 (serve everything from the cache)`);
  } else if (live > MAX_LIVE_CALLS_PER_RUN) {
    reasons.push(`new profile run made ${live} live calls (failed attempts count); the limit is ${MAX_LIVE_CALLS_PER_RUN}`);
  }

  const requeries = trace.filter((e) => e.kind === "requery");
  if (requeries.length > MAX_REQUERIES_PER_RUN) reasons.push(`${requeries.length} re-queries in one run; the limit is ${MAX_REQUERIES_PER_RUN}`);

  const pools = new Map<string, number>();
  for (const e of trace) if (e.kind === "query_insights") pools.set(e.domain, (pools.get(e.domain) ?? 0) + 1);
  for (const [domain, n] of pools) {
    const allowed = 1 + requeries.filter((r) => r.kind === "requery" && r.domain === domain).length;
    if (n > allowed) reasons.push(`domain ${domain} has ${n} insights pools; allowed is 1 plus one per re-query for that domain (${allowed}). One pool per domain, not one call per degree`);
  }

  if (reasons.length) return { pass: false, reasons };
  return {
    pass: true,
    reasons: [`${live} live call(s) of ${run === "repeat_view" ? 0 : MAX_LIVE_CALLS_PER_RUN} allowed, ${requeries.length} re-queries of ${MAX_REQUERIES_PER_RUN}`],
  };
}

export const callBudget: TraceScorer = {
  kind: "trace",
  name: "call-budget",
  description: `At most ${MAX_LIVE_CALLS_PER_RUN} live calls per new profile run, 0 on a repeat view, at most ${MAX_REQUERIES_PER_RUN} re-queries, one pool per domain.`,
  score: scoreCallBudget,
};
