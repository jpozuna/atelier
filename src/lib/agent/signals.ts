// Re-query signals, computed in code. The model never decides whether results are poor, it only decides what to do
// about results that code has already flagged with a reason code.
//
// Reason codes, checked in this order for one domain's pool (the first that holds wins):
//   empty            no usable entity came back
//   weak_connection  candidates exist but none has a distinctive path (no rare shared tag, no sourced lineage)
//   too_weak         fewer than MIN_PICKS_PER_FIELD candidates clear the connection floor
//   too_obvious      at least OBVIOUS_SHARE of the floor-clearing candidates are obvious (see run-constants.ts)
// Nothing else triggers a re-query, and a pool that passes all four is left alone. The floor is never lowered.

import type { RequeryReason } from "@/types";
import type { Pool, ScoredPool } from "@/lib/frontier";
import { foldName } from "./names";
import { OBVIOUS_POPULARITY_RANK, OBVIOUS_SHARE, OBVIOUS_TAG_DISTANCE_MAX } from "./run-constants";

export interface PoolReading {
  reason: RequeryReason | null;
  scored: number;
  clearedFloor: number;
  distinctive: number;
  /** Share (0 to 1) of floor-clearing candidates that are obvious; null when none cleared. For code and the model's input. */
  obviousShare: number | null;
}

/** Share of floor-clearing candidates that are obvious: popular for the pool, very close in tags, or tied to a seed by name. */
export function obviousShare(scored: ScoredPool, seedNames: readonly string[]): number | null {
  const cleared = scored.scored.filter((s) => s.clearsFloor);
  if (cleared.length === 0) return null;
  const seeds = new Set(seedNames.map(foldName).filter(Boolean));
  const obvious = cleared.filter((s) => {
    const popular = s.popularityRank !== null && s.popularityRank >= OBVIOUS_POPULARITY_RANK;
    const close = s.reach.tagDistance <= OBVIOUS_TAG_DISTANCE_MAX;
    const sameFranchise = (s.candidate.lineage ?? []).some((n) => seeds.has(foldName(n)));
    return popular || close || sameFranchise;
  });
  return obvious.length / cleared.length;
}

export function readPool(pool: Pool, scored: ScoredPool, seedNames: readonly string[]): PoolReading {
  const share = obviousShare(scored, seedNames);
  const { signals } = scored;
  let reason: RequeryReason | null = null;
  if (pool.outcome === "empty" || signals.scored === 0) reason = "empty";
  else if (signals.distinctive === 0) reason = "weak_connection";
  else if (signals.thin) reason = "too_weak";
  else if (share !== null && share >= OBVIOUS_SHARE) reason = "too_obvious";
  return { reason, scored: signals.scored, clearedFloor: signals.clearedFloor, distinctive: signals.distinctive, obviousShare: share };
}

/** Plain-language cause for the trace line. No internal terms. */
export const REASON_PHRASE: Readonly<Record<RequeryReason, string>> = {
  too_obvious: "the first results sat too close to what is already familiar",
  too_weak: "too few results connected closely enough",
  empty: "nothing came back",
  weak_connection: "the results had no distinctive link to the chosen seeds",
};

/** Severity order used when the re-query budget cannot cover every flagged domain. Most broken first. */
export const REASON_PRIORITY: readonly RequeryReason[] = ["empty", "weak_connection", "too_weak", "too_obvious"];
