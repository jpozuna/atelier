// distinctive-hop: every pick's path is distinctive: at least one shared tag with pool rarity >= DISTINCTIVE_RARITY,
// or a sourced lineage hop (with the source link it was retrieved from). `path.distinctive` must be true, and the flag
// is recomputed from `result.audit.tagRarity[domain]` (pool rarity per tag id, from the pool the shown picks came
// from) and must agree. A pick that is not distinctive through a sourced lineage hop and has no rarity map for its
// domain cannot be recomputed: that is "not verifiable", a failure on a live case and a note on a synthetic legacy
// one. The flag alone is never taken as proof. The older `result.tagRarity` extra is read as a fallback.

import { DISTINCTIVE_RARITY } from "@/lib/agent/config";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, isNum, isObj, list, nonEmpty, pickLabel, withResult } from "./_shared";

export function scoreDistinctiveHop(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    const unverifiedDomains = new Set<string>();
    let checked = 0;
    for (const d of r.domains) {
      const fromAudit = r.audit?.tagRarity[d.domain];
      const legacy = isObj(r.legacyTagRarity[d.domain]) ? (r.legacyTagRarity[d.domain] as Record<string, unknown>) : null;
      const rarity: Record<string, unknown> | null = fromAudit ?? legacy;
      for (const pick of d.picks) {
        checked++;
        const who = pickLabel(d.domain, pick);
        const path = isObj(pick.path) ? pick.path : null;
        if (!path) {
          reasons.push(`${who}: no stored path`);
          continue;
        }
        const sourcedLineage = list(path.hops).filter(isObj).some((h) => h.kind === "lineage" && h.provenance === "sourced" && nonEmpty(h.sourceUrl));
        if (path.distinctive !== true) {
          reasons.push(`${who}: the path is not marked distinctive`);
          continue;
        }
        if (sourcedLineage) continue;
        if (!rarity) {
          unverifiedDomains.add(d.domain);
          continue;
        }
        const rare = list(path.sharedTags).filter(nonEmpty).some((t) => isNum(rarity[t]) && (rarity[t] as number) >= DISTINCTIVE_RARITY);
        if (!rare) reasons.push(`${who}: marked distinctive, but no shared tag has rarity of at least ${DISTINCTIVE_RARITY} and there is no sourced lineage hop`);
      }
    }
    const unverified = unverifiedDomains.size ? [`no tag rarity in the result's audit for ${[...unverifiedDomains].join(", ")}, so the distinctive flag cannot be recomputed`] : [];
    return finish(input, reasons, unverified, `${checked} pick(s) distinctive`);
  });
}

export const distinctiveHop: TraceScorer = {
  kind: "trace",
  name: "distinctive-hop",
  description: `Every pick's path has a shared tag with rarity of at least ${DISTINCTIVE_RARITY} or a sourced lineage hop.`,
  score: scoreDistinctiveHop,
};
