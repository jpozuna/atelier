// reach-margin: within a domain, the median reach of each band exceeds the median of the nearest band below it that
// has picks by at least MIN_REACH_MARGIN (calibration, moderate, high, extreme, lowest first). Reach is ranked
// within one pool, so each domain is its own comparison. A domain with picks in only one band has nothing to
// compare. The tolerance is the frontier's own REACH_EPSILON (floating-point rounding only).

import { MIN_REACH_MARGIN } from "@/lib/agent/config";
import { REACH_EPSILON } from "@/lib/frontier/constants";
import { median } from "@/lib/frontier/stats";
import { BANDS } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { isNum, isObj, isStr, withResult } from "./_shared";

export function scoreReachMargin(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    let compared = 0;
    for (const d of r.domains) {
      const meds: { band: string; m: number }[] = [];
      for (const band of BANDS) {
        const values: number[] = [];
        for (const p of d.picks) {
          if (p.band !== band) continue;
          const reach = isObj(p.reach) ? p.reach.reach : undefined;
          if (!isNum(reach)) reasons.push(`${d.domain}: a ${band} pick has no stored reach`);
          else values.push(reach);
        }
        const m = median(values);
        if (m !== null) meds.push({ band, m });
      }
      for (let i = 1; i < meds.length; i++) {
        compared++;
        const gap = meds[i]!.m - meds[i - 1]!.m;
        if (gap + REACH_EPSILON < MIN_REACH_MARGIN) {
          reasons.push(`${d.domain}: ${meds[i]!.band} median reach ${meds[i]!.m.toFixed(2)} is not at least ${MIN_REACH_MARGIN} above ${meds[i - 1]!.band} ${meds[i - 1]!.m.toFixed(2)}`);
        }
      }
      for (const p of d.picks) if (!isStr(p.band)) reasons.push(`${d.domain}: a pick has no band`);
    }
    if (compared === 0) reasons.push("no domain has picks in two or more bands, so no band step could be compared and this check would pass on nothing");
    if (reasons.length) return { pass: false, reasons };
    return { pass: true, reasons: [`${compared} band step(s) each at least ${MIN_REACH_MARGIN} apart in median reach`] };
  });
}

export const reachMargin: TraceScorer = {
  kind: "trace",
  name: "reach-margin",
  description: `Median reach of each band exceeds the band below by at least ${MIN_REACH_MARGIN}.`,
  score: scoreReachMargin,
};
