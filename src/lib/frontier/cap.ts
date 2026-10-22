// The cross-field cap: at most EDGE_PICKS_MAX edge picks (moderate, high, extreme) and CALIBRATION_PICKS_MAX
// calibration picks in one run. Pure and deterministic, no Qloo calls. The loop runs it after the bands and before
// references and explanations, so trimmed picks cost no lookups and no model tokens.
//
// Edge picks:
//  - The band shares are as even as the pool allows (20 gives 7, 7, 6: moderate, high, extreme). A band that runs short
//    hands its slots to the others.
//  - No field holds more than floor(EDGE_FIELD_SHARE_MAX x shown). The count shown is the largest one (up to the max)
//    that the fields can fill under that cap, so too few fields means fewer picks, never padding. The connection floor
//    is untouched: only picks that already cleared it are here.
//  - Every field with an eligible edge pick shows at least one: its strongest, taken before the rest are filled.
//  - Within a band the strongest connection wins (ties by entity id, so the result never depends on input order).
//  - Every kept edge pick gets `strength` (strong, steady, light) by thirds of the kept edge picks ordered by
//    connection. The word is public; the number behind it is not.
//  - Trimming must not break what the frontier already guaranteed within a field: the reach margin between bands and
//    Stretch being less popular than Match. If it would, the offending pick is set aside and the selection redone.
//
// Calibration picks are capped separately and never count toward the edge total: same-field picks first, then
// other-field, spread across fields.
//
// Strict or fixed field limit: the strict limit (floor(EDGE_FIELD_SHARE_MAX x shown)) needs at least
// EDGE_SHARE_MIN_FIELDS fields holding edge picks. The cap computes the strict result and the fixed one (the same limit
// for every field, floor(EDGE_FIELD_SHARE_MAX x EDGE_PICKS_MAX) = 8). If strict shows fewer picks than fixed, fixed
// wins, so a thin extra field never collapses the run; otherwise strict wins and the 40% holds. With fewer fields than
// EDGE_SHARE_MIN_FIELDS only fixed applies (2 fields show at most 16, 1 field at most 8). Never padded either way.
// `fieldShareOf: "max"` forces the fixed limit for a run limited to some fields (a "not me" follow-up), because the
// shown total of those fields says nothing about the whole screen they merge into.

import type { Band, Field } from "@/types";
import { BANDS, CONNECTION_STRENGTHS, FIELDS } from "@/types";
import type { CapTraceEvent, ConnectionStrength } from "@/types";
import { CALIBRATION_PICKS_MAX, EDGE_FIELD_SHARE_MAX, EDGE_PICKS_MAX, EDGE_SHARE_MIN_FIELDS, MIN_REACH_MARGIN } from "@/lib/agent/config";
import { EDGE_BANDS } from "./bands";
import { REACH_EPSILON } from "./constants";
import { median } from "./stats";
import type { BandSelection, FrontierPick } from "./types";

export interface CapOptions {
  /** Seed id to the field of that seed. A calibration pick is "same-field" when its field is its seed's field. */
  seedFields?: ReadonlyMap<string, Field>;
  /** What the field limit is a share of: the edge picks shown in this run (default), or EDGE_PICKS_MAX. */
  fieldShareOf?: "shown" | "max";
}

export interface CapSummary {
  edgeShown: number;
  calibrationShown: number;
  /** Kept picks per band (calibration included). Counts only. */
  byBand: Record<Band, number>;
  /** Kept picks per field. Counts only. */
  byField: Partial<Record<Field, { edge: number; calibration: number }>>;
  /** The most edge picks any one field holds. */
  largestField: number;
  /** Which field limit applied: a share of what is shown, or the fixed per-field limit. */
  fieldLimit: "share" | "fixed";
  /** Picks the cap did not keep (edge and calibration). */
  trimmed: number;
}

export interface CapResult {
  /** The input selections (same order and domains) with `picks` and `byBand` cut down. Edge picks carry `strength`. */
  selections: BandSelection[];
  summary: CapSummary;
}

interface Cand {
  pick: FrontierPick;
  domain: Field;
}

const idCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byConnection = (a: Cand, b: Cand): number => b.pick.connection - a.pick.connection || idCmp(a.pick.qlooId, b.pick.qlooId) || idCmp(a.domain, b.domain);

const NB = EDGE_BANDS.length;

/**
 * Can `need[b]` picks be taken from each edge band, with at most `avail[b][f]` from band b in field f and at most
 * `caps[f]` in field f in all? A transportation problem, checked by its min cut over every subset of bands.
 */
function feasible(need: readonly number[], avail: readonly (readonly number[])[], caps: readonly number[]): boolean {
  const total = need.reduce((a, b) => a + b, 0);
  if (total === 0) return true;
  for (let mask = 0; mask < 1 << NB; mask++) {
    let cut = 0;
    for (let b = 0; b < NB; b++) if (!((mask >> b) & 1)) cut += need[b]!;
    for (let f = 0; f < FIELDS.length; f++) {
      let s = 0;
      for (let b = 0; b < NB; b++) if ((mask >> b) & 1) s += avail[b]![f]!;
      cut += Math.min(caps[f]!, s);
    }
    if (cut < total) return false;
  }
  return true;
}

/** Band quotas for `n` more picks (`base` are the picks already taken per band, counted for evenness): one slot at a time to the band with the fewest so far (lower band first), skipping a band that cannot take one. Null when `n` cannot be reached. */
function quotasFor(n: number, avail: readonly (readonly number[])[], caps: readonly number[], base: readonly number[]): number[] | null {
  const need = new Array<number>(NB).fill(0);
  for (let i = 0; i < n; i++) {
    const order = [...need.keys()].sort((a, b) => base[a]! + need[a]! - (base[b]! + need[b]!) || a - b);
    let placed = false;
    for (const b of order) {
      need[b]!++;
      if (feasible(need, avail, caps)) {
        placed = true;
        break;
      }
      need[b]!--;
    }
    if (!placed) return null;
  }
  return need;
}

interface Once {
  edge: Cand[];
  calibration: Cand[];
  fieldLimit: "share" | "fixed";
}

/**
 * The edge picks under one kind of field limit. Each field with a pick first gets its strongest one; then the largest
 * count (up to EDGE_PICKS_MAX) the fields can fill is found, and the rest is taken band by band, strongest first.
 * `fixed`: every field may hold floor(share x EDGE_PICKS_MAX); otherwise floor(share x count shown).
 */
function fillEdge(live: readonly (readonly Cand[])[], avail: readonly (readonly number[])[], fixed: boolean): Cand[] {
  const fieldIndex = (d: Field) => FIELDS.indexOf(d);
  const all = live.flat().sort(byConnection);
  const forced: Cand[] = [];
  const seenField = new Set<Field>();
  for (const c of all) {
    if (seenField.has(c.domain)) continue;
    seenField.add(c.domain);
    forced.push(c);
  }
  const forcedSet = new Set(forced);
  const room = avail.map((row) => [...row]);
  const base = new Array<number>(NB).fill(0);
  for (const c of forced) {
    const b = EDGE_BANDS.indexOf(c.pick.band);
    room[b]![fieldIndex(c.domain)]!--;
    base[b]!++;
  }

  let quotas: number[] | null = null;
  let caps: number[] = [];
  for (let n = EDGE_PICKS_MAX; n >= Math.max(1, forced.length) && quotas === null; n--) {
    const perField = Math.floor(EDGE_FIELD_SHARE_MAX * (fixed ? EDGE_PICKS_MAX : n));
    if (perField < 1) continue;
    caps = FIELDS.map((f) => perField - (seenField.has(f) ? 1 : 0));
    quotas = quotasFor(n - forced.length, room, caps, base);
  }
  if (!quotas) return forced;

  const edge: Cand[] = [...forced];
  const need = [...quotas];
  const left = [...caps];
  for (let b = 0; b < NB; b++) {
    for (const c of live[b]!) {
      if (need[b]! === 0) break;
      if (forcedSet.has(c)) continue;
      const f = fieldIndex(c.domain);
      room[b]![f]!--;
      if (left[f]! < 1) continue;
      need[b]!--;
      left[f]!--;
      if (feasible(need, room, left)) edge.push(c);
      else {
        need[b]!++;
        left[f]!++;
      }
    }
  }
  return edge;
}

function selectOnce(edgeCands: readonly (readonly Cand[])[], calibrationCands: readonly Cand[], banned: ReadonlySet<FrontierPick>, options: CapOptions): Once {
  const fieldIndex = (d: Field) => FIELDS.indexOf(d);
  const live = edgeCands.map((band) => band.filter((c) => !banned.has(c.pick)).sort(byConnection));
  const avail = live.map((band) => {
    const row = new Array<number>(FIELDS.length).fill(0);
    for (const c of band) row[fieldIndex(c.domain)]!++;
    return row;
  });

  const fieldsWithEdge = new Set(live.flat().map((c) => c.domain)).size;
  const fixedOnly = options.fieldShareOf === "max" || fieldsWithEdge < EDGE_SHARE_MIN_FIELDS;
  const fixed = fillEdge(live, avail, true);
  const strict = fixedOnly ? null : fillEdge(live, avail, false);
  const useStrict = strict !== null && strict.length >= fixed.length;
  const edge = useStrict ? strict : fixed;
  const fieldLimit: "share" | "fixed" = useStrict ? "share" : "fixed";

  // Calibration: same-field first, then other-field; within a group by the order each field already gave (closest
  // first), taking one field after another so no field fills the cap alone.
  const usable = calibrationCands.filter((c) => !banned.has(c.pick));
  const isSame = (c: Cand) => options.seedFields?.get(c.pick.path.seedId) === c.pick.field;
  const rank = new Map<Cand, number>();
  const seen = new Map<Field, number>();
  for (const c of usable) {
    const i = seen.get(c.domain) ?? 0;
    rank.set(c, i);
    seen.set(c.domain, i + 1);
  }
  const ordered = [...usable].sort((a, b) => Number(isSame(b)) - Number(isSame(a)) || rank.get(a)! - rank.get(b)! || fieldIndex(a.domain) - fieldIndex(b.domain));
  return { edge, calibration: ordered.slice(0, CALIBRATION_PICKS_MAX), fieldLimit };
}

/** The first thing in a field's kept picks that breaks the reach margin or the Match/Stretch popularity order, as the pick to set aside. */
function offender(kept: ReadonlyMap<Field, readonly FrontierPick[]>): FrontierPick | null {
  for (const d of FIELDS) {
    const picks = kept.get(d) ?? [];
    const inBand = (b: Band) => picks.filter((p) => p.band === b);
    const meds: { band: Band; m: number }[] = [];
    for (const b of BANDS) {
      const m = median(inBand(b).map((p) => p.reach.reach));
      if (m !== null) meds.push({ band: b, m });
    }
    for (let i = 1; i < meds.length; i++) {
      if (meds[i]!.m - meds[i - 1]!.m + REACH_EPSILON >= MIN_REACH_MARGIN) continue;
      const lower = meds[i - 1]!.band;
      const upper = meds[i]!.band;
      const pool = lower === "calibration" ? inBand("calibration") : inBand(upper);
      // Raise the band above, or (for calibration) lower the band below, by removing its outlier.
      const sorted = [...pool].sort((a, b) => (lower === "calibration" ? b.reach.reach - a.reach.reach : a.reach.reach - b.reach.reach) || idCmp(a.qlooId, b.qlooId));
      return sorted[0]!;
    }
    const known = (bs: readonly Band[]) => picks.filter((p) => bs.includes(p.band) && p.popularity > 0);
    const match = median(known(["calibration", "moderate"]).map((p) => p.popularity));
    const stretch = known(["high", "extreme"]);
    const stretchMedian = median(stretch.map((p) => p.popularity));
    if (match !== null && stretchMedian !== null && !(stretchMedian < match)) {
      return [...stretch].sort((a, b) => b.popularity - a.popularity || idCmp(a.qlooId, b.qlooId))[0]!;
    }
  }
  return null;
}

export function capEdgePicks(selections: readonly BandSelection[], options: CapOptions = {}): CapResult {
  const edgeCands: Cand[][] = EDGE_BANDS.map((band) => selections.flatMap((s) => s.picks.filter((p) => p.band === band).map((pick) => ({ pick, domain: s.domain }))));
  const calibrationCands: Cand[] = selections.flatMap((s) => s.picks.filter((p) => p.band === "calibration").map((pick) => ({ pick, domain: s.domain })));

  const banned = new Set<FrontierPick>();
  let chosen: Once;
  for (;;) {
    chosen = selectOnce(edgeCands, calibrationCands, banned, options);
    const kept = new Map<Field, FrontierPick[]>();
    for (const c of [...chosen.edge, ...chosen.calibration]) kept.set(c.domain, [...(kept.get(c.domain) ?? []), c.pick]);
    const bad = offender(kept);
    if (!bad) break;
    banned.add(bad);
  }

  // Strength: thirds of the kept edge picks, strongest connection first.
  const strengths = new Map<FrontierPick, ConnectionStrength>();
  const rankedEdge = [...chosen.edge].sort(byConnection);
  const words: readonly ConnectionStrength[] = CONNECTION_STRENGTHS;
  rankedEdge.forEach((c, i) => strengths.set(c.pick, words[Math.floor((i * words.length) / rankedEdge.length)]!));

  const keep = new Set<FrontierPick>([...chosen.edge, ...chosen.calibration].map((c) => c.pick));
  const summary: CapSummary = {
    edgeShown: chosen.edge.length,
    calibrationShown: chosen.calibration.length,
    byBand: { calibration: chosen.calibration.length, moderate: 0, high: 0, extreme: 0 },
    byField: {},
    largestField: 0,
    fieldLimit: chosen.fieldLimit,
    trimmed: edgeCands.reduce((n, band) => n + band.length, 0) + calibrationCands.length - chosen.edge.length - chosen.calibration.length,
  };
  for (const c of chosen.edge) summary.byBand[c.pick.band]++;
  for (const c of [...chosen.edge, ...chosen.calibration]) {
    const row = summary.byField[c.domain] ?? { edge: 0, calibration: 0 };
    row[c.pick.band === "calibration" ? "calibration" : "edge"]++;
    summary.byField[c.domain] = row;
  }
  summary.largestField = Math.max(0, ...Object.values(summary.byField).map((r) => r.edge));

  const out = selections.map((s): BandSelection => {
    const byBand = { calibration: [], moderate: [], high: [], extreme: [] } as Record<Band, FrontierPick[]>;
    for (const b of BANDS) {
      byBand[b] = s.byBand[b].filter((p) => keep.has(p)).map((p) => (strengths.has(p) ? { ...p, strength: strengths.get(p)! } : p));
    }
    return { ...s, byBand, picks: BANDS.flatMap((b) => byBand[b]) };
  });
  return { selections: out, summary };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The cap's trace event, for the reasoning panel. Counts and words only. */
export function capTraceEvent(summary: CapSummary, now: Date = new Date()): CapTraceEvent {
  const { byBand } = summary;
  const edge =
    summary.edgeShown === 0
      ? "No edge picks to show"
      : `Showing ${plural(summary.edgeShown, "edge pick", "edge picks")} (${byBand.moderate} moderate, ${byBand.high} high, ${byBand.extreme} extreme), no field more than ${summary.largestField}`;
  const close = summary.calibrationShown > 0 ? ` and ${plural(summary.calibrationShown, "close pick", "close picks")} to check the profile` : "";
  return {
    kind: "cap",
    t: now.toISOString(),
    say: `${edge}${close}. The rest were set aside before anything was looked up.`,
    edgeShown: summary.edgeShown,
    calibrationShown: summary.calibrationShown,
    byBand: summary.byBand,
    byField: summary.byField,
    fieldLimit: summary.fieldLimit,
    trimmed: summary.trimmed,
  };
}
