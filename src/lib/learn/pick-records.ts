// What the private log keeps about each shown pick so a later run can learn from the person's signals on it: the pick's
// theme tags, field, band, the axis that led its field and the re-query reason behind its pool. Ids and words only.
// SERVER SIDE ONLY: it goes into `run_log.trace.audit.picks`, like the rest of the audit block (hard rule 7 allows
// stored server-side traces to keep what the browser never sees), and `toPublicResult` drops the audit.

import type { Band, Field, RequeryReason } from "@/types";
import type { RunResult } from "@/lib/agent/types";
import type { Adjustment } from "./types";

export interface PickRecord {
  pickId: string;
  qlooId: string;
  domain: Field;
  band: Band;
  /** Tag ids of the pick's theme hops (its path's shared tags and the tags on its theme hop). */
  themeTags: string[];
  /** The axis that led this field's query (after a lean-axis re-query that replaced the first pool), or null. */
  axisId: string | null;
  /** Why this field's pool was queried again, when it was. */
  requeryReason: RequeryReason | null;
}

/** What the run learned before it started, for the log. Entity and tag ids and counts. */
export interface LearnedRecord {
  excluded: string[];
  awayTags: string[];
  towardTags: string[];
}

/** One record per shown pick, in field then pick order. */
export function pickRecordsOf(result: Pick<RunResult, "domains" | "plan">): PickRecord[] {
  const out: PickRecord[] = [];
  for (const d of result.domains) {
    let axisId = result.plan.themes.find((t) => t.domain === d.domain)?.axisId ?? null;
    if (d.requeried && d.requeryResult === "improved") {
      const lean = result.plan.requeries.find((r) => r.domain === d.domain && r.action.kind === "lean_axis");
      if (lean && lean.action.kind === "lean_axis") axisId = lean.action.axisId;
    }
    for (const p of d.picks) {
      const tags = new Set<string>(p.path.sharedTags);
      for (const hop of p.path.hops) if (hop.kind === "theme") for (const t of hop.tags ?? []) tags.add(t);
      out.push({ pickId: p.id, qlooId: p.qlooId, domain: d.domain, band: p.band, themeTags: [...tags].sort(), axisId, requeryReason: d.requeried ?? null });
    }
  }
  return out;
}

/**
 * The result as the log stores it: the same result with `audit.picks` (and `audit.learned` when the run learned).
 * A new object; the result sent to the browser is built from the original.
 */
export function withPickRecords<R extends Pick<RunResult, "domains" | "plan" | "audit">>(result: R, adjustment?: Adjustment | null): R {
  const learned: LearnedRecord | undefined =
    adjustment && (adjustment.exclude.length > 0 || adjustment.awayTags.length > 0 || adjustment.towardTags.length > 0)
      ? { excluded: adjustment.exclude, awayTags: adjustment.awayTags, towardTags: adjustment.towardTags }
      : undefined;
  return { ...result, audit: { ...result.audit, picks: pickRecordsOf(result), ...(learned ? { learned } : {}) } };
}
