// seed-resolution: every seed ends clean, ambiguous or missing, and none is silently guessed.
//   trace   each `resolve_seed` event has a valid status and a candidate count that fits it (clean needs one or more,
//           ambiguous two or more, missing none). A /search is empty when its outcome is "empty" or its resultCount is
//           0, whatever its status (cache hits carry none); an errored search (outcome "error") found nothing and is
//           not counted as a search that found something. When any /search was empty, no more seeds may resolve clean
//           or ambiguous than there were searches that found something (a seed can use two searches, so this is a
//           bound, not a pairing). A 429 from /search is retried with backoff: a later /search for the SAME seed (same
//           query) that is not another 429 or an error must follow it, so a rate limit never becomes a missing seed.
//   result  when the case result lists `seeds`: clean seeds have a Qloo id; ambiguous seeds keep their candidates
//           (two or more) and no id (the agent did not pick one for the user); missing seeds have no id and no
//           candidates; the status matches the trace's resolve_seed event for the same seed id.
//   audit   when the result has `audit.seedIds` (the Qloo ids sent as signals): every id must belong to a seed that
//           resolved clean (an ambiguous or missing seed's id must never be sent), and there can be no more ids than
//           clean seeds in the trace.
// A result with neither `seeds` nor an audit seed list has no seed evidence to check: "not verifiable" (a failure on a
// live case, a note on a synthetic legacy one). A trace-only case (no result) is checked on the trace alone.

import { isQlooCall } from "../harness/trace";
import { SEED_STATUSES } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, isObj, isStr, list, nonEmpty, readResult } from "./_shared";

export function scoreSeedResolution(input: CaseInput): ScorerResult {
  const reasons: string[] = [];
  const { trace } = input;

  const resolved = trace.filter((e) => e.kind === "resolve_seed");
  const byId = new Map<string, string>();
  for (const e of resolved) {
    if (e.kind !== "resolve_seed") continue;
    byId.set(e.seedId, e.status);
    const at = `seed ${e.seedId}`;
    if (!(SEED_STATUSES as readonly string[]).includes(e.status)) {
      reasons.push(`${at}: ended ${String(e.status)}, not clean, ambiguous or missing`);
      continue;
    }
    if (e.status === "clean" && e.candidateCount < 1) reasons.push(`${at}: clean, but resolved from ${e.candidateCount} candidates`);
    if (e.status === "ambiguous" && e.candidateCount < 2) reasons.push(`${at}: ambiguous, but only ${e.candidateCount} candidate(s) were found`);
    if (e.status === "missing" && e.candidateCount !== 0) reasons.push(`${at}: missing, but ${e.candidateCount} candidate(s) were found`);
  }

  const asObj = (e: unknown) => e as { status?: unknown; resultCount?: unknown; outcome?: unknown; params?: unknown };
  const queryOf = (e: unknown): string | null => {
    const p = asObj(e).params;
    return isObj(p) && nonEmpty(p.query) ? p.query : null;
  };
  const isEmpty = (e: unknown): boolean => asObj(e).outcome === "empty" || asObj(e).resultCount === 0;
  const isError = (e: unknown): boolean => asObj(e).outcome === "error" || (typeof asObj(e).status === "number" && (asObj(e).status as number) >= 400);

  const searches = trace.map((e, i) => ({ e, i })).filter((x) => isQlooCall(x.e) && x.e.endpoint === "/search");
  for (const { e, i } of searches) {
    if (!isQlooCall(e) || e.status !== 429) continue;
    const q = queryOf(e);
    const retried = trace.slice(i + 1).some((x) => isQlooCall(x) && x.endpoint === "/search" && !isError(x) && x.status !== 429 && (q === null || queryOf(x) === q));
    if (!retried) reasons.push("a /search call hit a 429 and was not retried with backoff for the same seed; a rate limit is not a missing seed");
  }

  const emptySearches = searches.filter(({ e }) => isEmpty(e)).length;
  const foundSearches = searches.filter(({ e }) => !isEmpty(e) && !isError(e)).length;
  const found = [...byId.values()].filter((v) => v === "clean" || v === "ambiguous").length;
  if (emptySearches > 0 && found > foundSearches) {
    reasons.push(`${emptySearches} /search call(s) came back with no results, and ${found} seed(s) resolved clean or ambiguous from only ${foundSearches} search(es) that found anything; an empty search must leave its seed missing, never a guess`);
  }

  const seeds = isObj(input.result) && Array.isArray(input.result.seeds) ? input.result.seeds.filter(isObj) : null;

  for (const s of seeds ?? []) {
    const at = `seed ${nonEmpty(s.id) ? s.id : "(no id)"}`;
    const status = s.status;
    if (!(SEED_STATUSES as readonly string[]).includes(String(status))) {
      reasons.push(`${at}: ended ${String(status)}, not clean, ambiguous or missing`);
      continue;
    }
    const candidates = list(s.candidates);
    if (status === "clean" && !nonEmpty(s.qlooId)) reasons.push(`${at}: clean, but it has no Qloo id`);
    if (status === "ambiguous") {
      if (nonEmpty(s.qlooId)) reasons.push(`${at}: ambiguous, but a candidate was silently picked (it has a Qloo id)`);
      if (candidates.length < 2) reasons.push(`${at}: ambiguous, but it keeps ${candidates.length} candidate(s) for the user to choose from`);
    }
    if (status === "missing") {
      if (nonEmpty(s.qlooId)) reasons.push(`${at}: missing, but it has a Qloo id (a guess)`);
      if (candidates.length > 0) reasons.push(`${at}: missing, but it lists candidates`);
    }
    if (isStr(s.id) && byId.has(s.id) && byId.get(s.id) !== status) {
      reasons.push(`${at}: the result says ${String(status)} but the trace resolved it ${byId.get(s.id)}`);
    }
  }

  // Audit: the Qloo ids sent as signals belong to clean seeds only.
  const unverified: string[] = [];
  if (input.result !== undefined) {
    const view = readResult(input.result);
    const auditIds = typeof view === "string" ? null : view.audit?.seedIds ?? null;
    if (auditIds !== null) {
      const cleanIds = new Set((seeds ?? []).filter((s) => s.status === "clean").map((s) => s.qlooId).filter(nonEmpty));
      if (seeds !== null) {
        const notClean = auditIds.filter((id) => !cleanIds.has(id)).length;
        if (notClean > 0) reasons.push(`audit.seedIds lists ${notClean} id(s) that do not belong to a clean seed; an ambiguous or missing seed must never be sent as a signal`);
      }
      const cleanCount = [...byId.values()].filter((v) => v === "clean").length;
      if (byId.size > 0 && auditIds.length > cleanCount) reasons.push(`audit.seedIds lists ${auditIds.length} id(s) but only ${cleanCount} seed(s) resolved clean in the trace`);
    } else if (seeds === null) {
      unverified.push("the result lists no seeds and its audit has no seedIds, so the seeds' outcomes cannot be checked against the result");
    }
  }

  const counts = SEED_STATUSES.map((st) => `${[...byId.values()].filter((v) => v === st).length} ${st}`).join(", ");
  return finish(input, reasons, unverified, `${byId.size} seed(s) resolved in the trace (${counts}); ${seeds ? `${seeds.length} in the result are consistent` : "no seeds in the result"}`);
}

export const seedResolution: TraceScorer = {
  kind: "trace",
  name: "seed-resolution",
  description: "Every seed ends clean, ambiguous or missing; an empty /search is missing; a 429 is retried; ambiguous and missing seeds are flagged, never guessed.",
  score: scoreSeedResolution,
};
