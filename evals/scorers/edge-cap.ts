// edge-cap: a run shows at most EDGE_PICKS_MAX edge picks (moderate, high, extreme) and at most CALIBRATION_PICKS_MAX
// calibration picks; no field holds more than its limit; every edge band the pool has is present; and every edge pick
// carries a `strength` word, split in thirds of the shown edge picks and following the connection order.
//
// Field limit (the same rule the cap uses): the strict limit is floor(EDGE_FIELD_SHARE_MAX x edge picks shown). The fixed
// limit, floor(EDGE_FIELD_SHARE_MAX x EDGE_PICKS_MAX), applies instead when the cap says so (its `cap` trace event has
// `fieldLimit: "fixed"`), and, when the trace has no cap event, when fewer than EDGE_SHARE_MIN_FIELDS fields show edge
// picks or the result is a follow-up (it holds fewer domains than there are fields).
//
// Evidence:
//   result.domains    picks with `band` and (server-side) `connection`, `strength`. The field of a pick is its domain.
//   trace             the `cap` event, when present.
//   result.poolBands  optional extra a fixture may carry: how many floor-clearing picks each edge band had before the
//                     cap, as { moderate, high, extreme }. A live RunResult has none, so "every band present" is then
//                     only noted, not failed. When edge picks are shown, a band with a pool count above 0 must have at
//                     least one pick shown.
//
// Counts above the two maximums fail on any non-live result, legacy or not. A result from before the cap (no edge pick
// carries `strength`) is otherwise legacy: the field limit and strength are not checked and the pass says so. On a case
// marked `live` that is a failure, because a live run that never capped is a broken run.

import { CALIBRATION_PICKS_MAX, EDGE_FIELD_SHARE_MAX, EDGE_PICKS_MAX, EDGE_SHARE_MIN_FIELDS } from "@/lib/agent/config";
import { EDGE_BANDS } from "@/lib/frontier/bands";
import { CONNECTION_STRENGTHS, FIELDS } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { isLive, isNum, isObj, isStr, readResult } from "./_shared";

/**
 * The most edge picks one field may hold. `fixed` is the fixed per-field limit; otherwise the strict share of what is
 * shown. Shared with domain-coverage.
 */
export function edgeFieldLimit(shown: number, fixed: boolean): number {
  return Math.floor(EDGE_FIELD_SHARE_MAX * (fixed ? EDGE_PICKS_MAX : shown));
}

/** True when the fixed per-field limit applies without a cap event: too few fields show edge picks, or a follow-up result. */
export function fixedWithoutEvent(fieldsShowing: number, domainCount: number): boolean {
  return fieldsShowing < EDGE_SHARE_MIN_FIELDS || domainCount < FIELDS.length;
}

/** The cap event of a trace, when it has one. */
export function capEventOf(trace: CaseInput["trace"]): { fieldLimit?: unknown; trimmed?: unknown } | null {
  return (trace.find((e) => e.kind === "cap") as { fieldLimit?: unknown; trimmed?: unknown } | undefined) ?? null;
}

const EDGE = new Set<string>(EDGE_BANDS);
const WORD_ORDER = new Map<string, number>(CONNECTION_STRENGTHS.map((w, i) => [w, i]));

/** Expected count of each strength word for n edge picks: thirds by position, strongest first. */
function thirds(n: number): number[] {
  const out = CONNECTION_STRENGTHS.map(() => 0);
  for (let i = 0; i < n; i++) out[Math.floor((i * CONNECTION_STRENGTHS.length) / n)]!++;
  return out;
}

export function scoreEdgeCap(input: CaseInput): ScorerResult {
  if (input.result === undefined) return { pass: true, reasons: ["no result in this case; nothing to check"] };
  const r = readResult(input.result);
  if (typeof r === "string") return { pass: false, reasons: [r] };

  const edge = r.domains.flatMap((d) => d.picks.filter((p) => isStr(p.band) && EDGE.has(p.band)).map((p) => ({ domain: d.domain, pick: p })));
  const calibration = r.domains.flatMap((d) => d.picks.filter((p) => p.band === "calibration"));

  const over: string[] = [];
  if (edge.length > EDGE_PICKS_MAX) over.push(`${edge.length} edge picks are shown, over the limit of ${EDGE_PICKS_MAX}`);
  if (calibration.length > CALIBRATION_PICKS_MAX) over.push(`${calibration.length} calibration picks are shown, over the limit of ${CALIBRATION_PICKS_MAX}`);

  if (edge.length > 0 && edge.every((e) => e.pick.strength === undefined)) {
    if (over.length) return { pass: false, reasons: over };
    if (isLive(input)) return { pass: false, reasons: ["not verifiable: no edge pick carries a strength, so the cap did not run on this live result"] };
    return { pass: true, reasons: ["legacy result from before the edge cap (no edge pick has a strength); limits not checked"] };
  }

  const reasons: string[] = [...over];
  const shown = edge.length;

  const perField = new Map<string, number>();
  for (const e of edge) perField.set(e.domain, (perField.get(e.domain) ?? 0) + 1);
  const cap = capEventOf(input.trace);
  const fixed = cap && (cap.fieldLimit === "fixed" || cap.fieldLimit === "share") ? cap.fieldLimit === "fixed" : fixedWithoutEvent(perField.size, r.domains.length);
  const fieldMax = edgeFieldLimit(shown, fixed);
  for (const [field, n] of perField) {
    if (n > fieldMax) reasons.push(`${field}: ${n} of ${shown} edge picks, over the field limit of ${fieldMax} (${fixed ? "the fixed per-field limit" : `${Math.round(EDGE_FIELD_SHARE_MAX * 100)}% of what is shown`})`);
  }

  const extra = (input.result as { poolBands?: unknown }).poolBands;
  const pool = isObj(extra) ? extra : null;
  if (pool && shown > 0) {
    for (const band of EDGE_BANDS) {
      const had = pool[band];
      if (isNum(had) && had > 0 && !edge.some((e) => e.pick.band === band)) reasons.push(`the pool had ${band} picks but none is shown while ${shown} edge picks are`);
    }
  }

  // Strength: every edge pick has a word, and the words follow the connection order.
  for (const e of edge) {
    if (!isStr(e.pick.strength) || !WORD_ORDER.has(e.pick.strength)) reasons.push(`${e.domain}/${String(e.pick.id)}: an edge pick has no valid strength (strong, steady or light)`);
  }
  const ranked = edge
    .filter((e) => isStr(e.pick.strength) && WORD_ORDER.has(e.pick.strength) && isNum(e.pick.connection))
    .sort((a, b) => (b.pick.connection as number) - (a.pick.connection as number));
  for (let i = 1; i < ranked.length; i++) {
    const prev = WORD_ORDER.get(ranked[i - 1]!.pick.strength as string)!;
    const here = WORD_ORDER.get(ranked[i]!.pick.strength as string)!;
    const tied = ranked[i]!.pick.connection === ranked[i - 1]!.pick.connection;
    if (here < prev && !tied) {
      reasons.push("a more weakly connected edge pick is called stronger than a more strongly connected one");
      break;
    }
  }

  // Thirds: the split of the words follows the number of edge picks shown (never all "strong").
  if (edge.every((e) => isStr(e.pick.strength) && WORD_ORDER.has(e.pick.strength))) {
    const expected = thirds(shown);
    const got = CONNECTION_STRENGTHS.map((w) => edge.filter((e) => e.pick.strength === w).length);
    if (got.some((n, i) => n !== expected[i])) reasons.push(`the strength words are not split in thirds: ${CONNECTION_STRENGTHS.map((w, i) => `${got[i]} ${w}`).join(", ")}, expected ${expected.join(", ")}`);
  }

  if (reasons.length) return { pass: false, reasons };
  const bands = EDGE_BANDS.map((b) => `${edge.filter((e) => e.pick.band === b).length} ${b}`).join(", ");
  const note = pool ? "" : "; the result lists no pool counts, so band presence is not checked";
  return { pass: true, reasons: [`${shown} edge picks (${bands}), largest field ${Math.max(0, ...perField.values())} of limit ${fieldMax}, ${calibration.length} calibration${note}`] };
}

export const edgeCap: TraceScorer = {
  kind: "trace",
  name: "edge-cap",
  description: `At most ${EDGE_PICKS_MAX} edge picks, no field above ${Math.round(EDGE_FIELD_SHARE_MAX * 100)}% of them (a fixed limit where the cap used it), at most ${CALIBRATION_PICKS_MAX} calibration picks, every band the pool has, strength words in connection order.`,
  score: scoreEdgeCap,
};
