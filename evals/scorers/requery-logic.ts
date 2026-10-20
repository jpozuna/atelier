// requery-logic: a `requery` event exists exactly when the score signals that precede it match a reason code, and
// not otherwise. The trace's score event carries `scored`, `clearedFloor` (the candidates that clear the connection
// floor with a distinctive path) and, on server-side traces, `obviousShare`. Qloo marks no backfill, so `too_weak` is
// judged on candidates clearing the floor. The reason codes, in the loop's own priority order (signals.ts):
//   empty            scored is 0
//   weak_connection  candidates were scored but none cleared the floor with a distinctive path
//   too_weak         fewer than MIN_PICKS_PER_FIELD cleared the floor
//   too_obvious      enough cleared the floor and `obviousShare` is at least OBVIOUS_SHARE. A score event with no
//                    obviousShare cannot prove or refute it: that is "not verifiable" (a failure on a live case, a
//                    note on a synthetic legacy one). It is still refused when too few cleared the floor.
// Also checked: at most MAX_REQUERIES_PER_RUN re-queries in the run, each changes at least one param (and the next
// insights call for that domain sends the new value), the floor is never lowered (a re-query never touches a
// connection or floor param, and `relax` events relax the reach band only), and a flagged domain that was not
// re-queried is explained: the budget was spent, or `result.meta.notRequeried` lists the domain WITH a reason that is
// one of the codes its signals call for. An entry with no reason, or the wrong one, does not excuse it.

import { MAX_REQUERIES_PER_RUN, MIN_PICKS_PER_FIELD, OBVIOUS_SHARE } from "@/lib/agent/config";
import type { RequeryReason, TraceEvent } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, isObj, list } from "./_shared";

type Score = Extract<TraceEvent, { kind: "score" }>;
type Requery = Extract<TraceEvent, { kind: "requery" }>;
type Query = Extract<TraceEvent, { kind: "query_insights" }>;

/** Why a re-query reason does not fit the score signals before it. Null when it fits. */
function mismatch(reason: RequeryReason, score: Score): string | null {
  const cleared = score.clearedFloor;
  switch (reason) {
    case "empty":
      return score.scored === 0 ? null : `reason empty, but ${score.scored} candidates were scored`;
    case "weak_connection":
      if (score.scored === 0) return "reason weak_connection, but nothing was scored (that is empty)";
      return cleared === 0 ? null : `reason weak_connection, but ${cleared} candidates cleared the connection floor`;
    case "too_weak":
      if (score.scored === 0) return "reason too_weak, but nothing was scored (that is empty)";
      return cleared < MIN_PICKS_PER_FIELD ? null : `reason too_weak, but ${cleared} candidates cleared the connection floor (the minimum is ${MIN_PICKS_PER_FIELD})`;
    case "too_obvious":
      if (score.scored === 0) return "reason too_obvious, but nothing was scored (that is empty)";
      if (cleared < MIN_PICKS_PER_FIELD) return `reason too_obvious, but only ${cleared} candidates cleared the connection floor, so too_weak or weak_connection applies first`;
      if (score.obviousShare !== undefined && score.obviousShare < OBVIOUS_SHARE) return `reason too_obvious, but the obvious share is ${score.obviousShare.toFixed(2)}, under ${OBVIOUS_SHARE}`;
      return null;
  }
}

/** The reason codes a first score calls for, as far as the trace shows. Empty when nothing is called for. */
function flagged(score: Score): string[] {
  if (score.scored === 0) return ["empty"];
  if (score.clearedFloor === 0) return ["weak_connection", "too_weak"];
  if (score.clearedFloor < MIN_PICKS_PER_FIELD) return ["too_weak"];
  if (score.obviousShare !== undefined && score.obviousShare >= OBVIOUS_SHARE) return ["too_obvious"];
  return [];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function scoreRequeryLogic(input: CaseInput): ScorerResult {
  const { trace } = input;
  const reasons: string[] = [];
  const requeries = trace.filter((e): e is Requery => e.kind === "requery");
  if (requeries.length > MAX_REQUERIES_PER_RUN) reasons.push(`${requeries.length} re-queries in one run; the limit is ${MAX_REQUERIES_PER_RUN}`);

  const notRequeried = new Map<string, string[]>();
  if (isObj(input.result) && isObj(input.result.meta)) {
    for (const n of list(input.result.meta.notRequeried)) {
      if (!isObj(n) || typeof n.domain !== "string") continue;
      notRequeried.set(n.domain, [...(notRequeried.get(n.domain) ?? []), typeof n.reason === "string" ? n.reason : ""]);
    }
  }

  trace.forEach((e, i) => {
    if (e.kind === "relax" && (e.relaxed as string) !== "reach_band") reasons.push(`a relax event relaxed ${String(e.relaxed)}; only the reach band may relax, never connection`);
    if (e.kind !== "requery") return;
    const before = trace.slice(0, i);
    const score = [...before].reverse().find((x): x is Score => x.kind === "score" && x.domain === e.domain);
    if (!score) {
      reasons.push(`${e.domain}: a re-query (${e.reason}) has no score event before it, so no signal called for it`);
    } else {
      const why = mismatch(e.reason, score);
      if (why) reasons.push(`${e.domain}: the re-query does not match the score signals before it (${why})`);
    }

    const changes = e.paramChanges;
    const keys = Object.keys(changes);
    if (keys.length === 0) reasons.push(`${e.domain}: the re-query changes no param`);
    for (const k of keys) if (/connection|floor/i.test(k)) reasons.push(`${e.domain}: the re-query changes ${k}; the connection floor is never lowered`);

    const prev = [...before].reverse().find((x): x is Query => x.kind === "query_insights" && x.domain === e.domain);
    if (prev) {
      const unchanged = keys.filter((k) => same(prev.params[k], changes[k]));
      if (keys.length > 0 && unchanged.length === keys.length) reasons.push(`${e.domain}: the re-query changes no param (every listed value equals the call before it)`);
    }
    const nextEvent = trace.slice(i + 1).find((x): x is Query => x.kind === "query_insights" && x.domain === e.domain);
    if (nextEvent) {
      for (const k of keys) {
        // Seed weights are not a visible param (ids are counted, not listed), so only the others are matched.
        if (k === "signal.interests.entities") continue;
        if (!same(nextEvent.params[k], changes[k])) reasons.push(`${e.domain}: the re-query says it changed ${k}, but the next insights call for the domain does not send that value`);
      }
    }
  });

  // The other direction: a flagged first pool must be re-queried, unless the budget is spent or the result says why not.
  const unverified: string[] = [];
  const requeried = new Set(requeries.map((r) => r.domain as string));
  const firstScores = new Map<string, Score>();
  for (const e of trace) if (e.kind === "score" && !firstScores.has(e.domain)) firstScores.set(e.domain, e);
  for (const [domain, score] of firstScores) {
    if (score.obviousShare === undefined && score.scored > 0 && score.clearedFloor >= MIN_PICKS_PER_FIELD && !requeried.has(domain)) {
      unverified.push(`${domain}: the first score has no obviousShare, so a too_obvious re-query cannot be ruled in or out`);
    }
    const codes = flagged(score);
    if (codes.length === 0 || requeried.has(domain)) continue;
    if (requeries.length >= MAX_REQUERIES_PER_RUN) continue;
    const given = notRequeried.get(domain);
    if (given) {
      if (!given.some((g) => codes.includes(g))) {
        reasons.push(`${domain}: listed under notRequeried with ${given.some(Boolean) ? "a reason that does not match the signals" : "no reason"} (the signals call for ${codes.join(" or ")}), so it is not excused`);
      }
      continue;
    }
    reasons.push(`${domain}: the first pool's signals call for a re-query (${codes.join(" or ")}: ${score.scored} scored, ${score.clearedFloor} cleared the floor) but none ran, and the budget was not spent`);
  }

  return finish(input, reasons, unverified, `${requeries.length} re-queries of ${MAX_REQUERIES_PER_RUN}, each matching the score signals before it; ${firstScores.size} first pool(s) checked`);
}

export const requeryLogic: TraceScorer = {
  kind: "trace",
  name: "requery-logic",
  description: `A re-query exists exactly when the score signals match a reason code, at most ${MAX_REQUERIES_PER_RUN} per run, each changes a param, the floor never drops.`,
  score: scoreRequeryLogic,
};
