// Bands from ONE pool, in code. No band ever triggers its own Qloo call.
//
// Only candidates that clear the connection floor are banded, by the quantile of their reach among themselves
// (BAND_EDGES): calibration is the closest quarter, then moderate, high, extreme. The floor is never lowered, at any
// band or dial setting.
//
// selectBands then fills each requested band, lowest first:
//  - A band's picks must reach at least MIN_REACH_MARGIN above the median reach of the picks shown in the nearest
//    band below, which is what the reach-margin scorer measures. Extras added by relaxation are re-checked against
//    the bands above them and trimmed or refused if they would break the margin (see `valid`); a randomized test
//    (bands.test.ts) checks the result over many pools.
//  - Stretch picks (high, extreme) with a known popularity must be below the median popularity of the Match picks
//    (calibration, moderate) chosen in the same call, or that this pool would give for Match when the call has none,
//    so Stretch is less popular than Match even when tag distance and popularity disagree. Unknown popularity (0)
//    cannot be compared and is exempt.
//  - Calibration shows the closest picks: highest Qloo affinity, then highest popularity. Other bands show the
//    most defensibly connected first. This order only chooses which picks to show; it is never displayed or
//    stored as a score.
//  - An empty band relaxes its degree one step at a time down the full order (extreme, high, moderate, calibration),
//    one `relax` event per step. The first step that has unused picks fills the slot; each pick keeps its true band.
//    If nothing is left to show, a `relax` event with from equal to to says the band stayed empty. Connection is
//    never relaxed.

import type { Band, TraceEvent } from "@/types";
import { BANDS } from "@/types";
import { BAND_EDGES, MIN_PICKS_PER_FIELD, MIN_REACH_MARGIN } from "@/lib/agent/config";
import { REACH_EPSILON } from "./constants";
import { median, percentiles } from "./stats";
import type { BandSelection, Dial, FrontierPick, ScoredCandidate, ScoredPool, SelectOptions } from "./types";

const ORDER: readonly Band[] = BANDS;

/** Develop shows no picks (the profile is forming), Match the close bands, Stretch the far bands. */
export function bandsForDial(dial: Dial): Band[] {
  if (dial === "match") return ["calibration", "moderate"];
  if (dial === "stretch") return ["high", "extreme"];
  return [];
}

/** The three degrees of the edge-pick screen, shown together. */
export const EDGE_BANDS: readonly Band[] = ["moderate", "high", "extreme"];

function bandOfQuantile(q: number): Band {
  if (q <= BAND_EDGES.calibration) return "calibration";
  if (q <= BAND_EDGES.moderate) return "moderate";
  if (q <= BAND_EDGES.high) return "high";
  return "extreme";
}

/** Band of every floor-clearing candidate, by reach quantile (mid-rank, so equal reach gets one band). */
export function bucket(scored: readonly ScoredCandidate[]): Map<string, Band> {
  const cleared = scored.filter((s) => s.clearsFloor);
  const q = percentiles(cleared.map((s) => s.reach.reach));
  return new Map(cleared.map((s, i) => [s.candidate.qlooId, bandOfQuantile(q[i]!)]));
}

const cmp = (a: number | undefined, b: number | undefined): number => (b ?? -1) - (a ?? -1);

function orderFor(band: Band, items: ScoredCandidate[]): ScoredCandidate[] {
  const tie = (a: ScoredCandidate, b: ScoredCandidate) => (a.candidate.qlooId < b.candidate.qlooId ? -1 : 1);
  return [...items].sort((a, b) =>
    band === "calibration"
      ? cmp(a.candidate.affinity, b.candidate.affinity) || cmp(a.candidate.popularity, b.candidate.popularity) || tie(a, b)
      : cmp(a.connection, b.connection) || cmp(a.candidate.affinity, b.candidate.affinity) || tie(a, b),
  );
}

function toPick(s: ScoredCandidate, band: Band): FrontierPick {
  const c = s.candidate;
  return {
    id: `pick-${c.qlooId}`,
    qlooId: c.qlooId,
    name: c.name,
    field: c.field,
    popularity: c.popularity,
    reach: s.reach,
    connection: s.connection,
    band,
    llmBridged: false,
    origin: c.origin,
    path: s.path!,
  };
}

const knownPopularity = (picks: readonly FrontierPick[]): number[] => picks.filter((p) => p.popularity > 0).map((p) => p.popularity);

const STRETCH: readonly Band[] = ["high", "extreme"];
const MATCH: readonly Band[] = ["calibration", "moderate"];

/** Degree words for the user. Calibration is the closest degree. */
const WORD: Record<Band, string> = { calibration: "close", moderate: "moderate", high: "high", extreme: "extreme" };

export function selectBands(pool: ScoredPool, options: SelectOptions): BandSelection {
  const perBand = Math.max(0, options.perBand ?? MIN_PICKS_PER_FIELD);
  const now = options.now ?? (() => new Date());
  const requested = ORDER.filter((b) => options.bands.includes(b));
  const bandOf = bucket(pool.scored);
  const cleared = pool.scored.filter((s) => s.clearsFloor);
  const members = (b: Band) => cleared.filter((s) => bandOf.get(s.candidate.qlooId) === b);

  const chosen = new Map<Band, ScoredCandidate[]>(ORDER.map((b) => [b, []]));
  const used = new Set<string>();
  const events: TraceEvent[] = [];
  /** Requested bands that had no pick of their own, whether or not relaxation then filled the slot. */
  const emptied: Band[] = [];

  const reachMedian = (b: Band): number | null => median(chosen.get(b)!.map((s) => s.reach.reach));
  // Stretch asked for without Match in the same call (the dial shows one setting at a time): compare with the Match
  // picks this pool would give, so Stretch is less popular than Match across calls too.
  const needsReference = requested.some((b) => STRETCH.includes(b)) && !requested.some((b) => MATCH.includes(b));
  const reference: number | null = needsReference
    ? median(knownPopularity(selectBands(pool, { bands: MATCH, perBand }).picks))
    : null;
  /** Bands whose picks must be less popular than Match: the Stretch bands, and every band in a Stretch-only call. */
  const guarded = (b: Band): boolean => STRETCH.includes(b) || needsReference;
  const matchMedianPopularity = (): number | null =>
    median(MATCH.flatMap((b) => chosen.get(b)!).filter((s) => s.candidate.popularity > 0).map((s) => s.candidate.popularity)) ?? reference;

  /** Median reach of the nearest lower band that has picks. */
  const lowerMedian = (b: Band): number | null => {
    for (let i = ORDER.indexOf(b) - 1; i >= 0; i--) {
      const m = reachMedian(ORDER[i]!);
      if (m !== null) return m;
    }
    return null;
  };

  const eligible = (b: Band): ScoredCandidate[] => {
    const lower = lowerMedian(b);
    const floor = lower === null ? null : lower + MIN_REACH_MARGIN + REACH_EPSILON;
    const matchPop = guarded(b) ? matchMedianPopularity() : null;
    return members(b).filter((s) => {
      if (used.has(s.candidate.qlooId)) return false;
      if (floor !== null && s.reach.reach < floor) return false;
      const pop = s.candidate.popularity;
      return !(matchPop !== null && pop > 0 && pop >= matchPop);
    });
  };

  /** The whole selection still holds the reach margin between neighbouring bands and the dial's popularity order. */
  const valid = (): boolean => {
    let prev: number | null = null;
    for (const b of ORDER) {
      const m = reachMedian(b);
      if (m === null) continue;
      if (prev !== null && m - prev < MIN_REACH_MARGIN) return false;
      prev = m;
    }
    const matchPop = matchMedianPopularity();
    if (matchPop !== null) {
      for (const b of ORDER.filter(guarded)) for (const s of chosen.get(b)!) if (s.candidate.popularity > 0 && s.candidate.popularity >= matchPop) return false;
    }
    return true;
  };

  const emit = (event: TraceEvent) => {
    events.push(event);
    options.emit?.(event);
  };

  /** Add up to `perBand` unused picks to band `b`, as many as keep the whole selection valid. Returns how many. */
  const addExtras = (b: Band): number => {
    const ordered = orderFor(b, eligible(b));
    for (let k = Math.min(perBand, ordered.length); k >= 1; k--) {
      const extra = ordered.slice(0, k);
      chosen.get(b)!.push(...extra);
      if (valid()) {
        extra.forEach((s) => used.add(s.candidate.qlooId));
        return k;
      }
      chosen.get(b)!.splice(chosen.get(b)!.length - k, k);
    }
    return 0;
  };

  for (const band of requested) {
    const got = orderFor(band, eligible(band)).slice(0, perBand);
    if (got.length > 0 || perBand === 0) {
      got.forEach((s) => used.add(s.candidate.qlooId));
      chosen.get(band)!.push(...got);
      continue;
    }
    emptied.push(band);
    let filled = false;
    let from: Band = band;
    for (let i = ORDER.indexOf(band) - 1; i >= 0 && !filled; i--) {
      const to = ORDER[i]!;
      emit({
        kind: "relax",
        t: now().toISOString(),
        say: `Nothing connected strongly enough at the ${WORD[from]} band, so showing ${WORD[to]}.`,
        relaxed: "reach_band",
        from,
        to,
        reason: `Nothing connected strongly enough at the ${WORD[from]} band, so showing ${WORD[to]}.`,
      });
      filled = addExtras(to) > 0;
      from = to;
    }
    if (!filled) {
      emit({
        kind: "relax",
        t: now().toISOString(),
        say: `Nothing connected strongly enough at the ${WORD[band]} band, and nothing nearer to show instead.`,
        relaxed: "reach_band",
        from: band,
        to: band,
        reason: `Nothing connected strongly enough at the ${WORD[band]} band, and nothing nearer to show instead.`,
      });
    }
  }

  const byBand = { calibration: [], moderate: [], high: [], extreme: [] } as Record<Band, FrontierPick[]>;
  for (const b of ORDER) byBand[b] = chosen.get(b)!.map((s) => toPick(s, b));
  const picks = ORDER.flatMap((b) => byBand[b]);

  return {
    domain: pool.domain,
    picks,
    byBand,
    emptyBands: requested.filter((b) => emptied.includes(b) || byBand[b].length === 0),
    thin: cleared.length < MIN_PICKS_PER_FIELD,
    clearedCount: cleared.length,
    dial: {
      matchMedianPopularity: median(knownPopularity([...byBand.calibration, ...byBand.moderate])),
      stretchMedianPopularity: median(knownPopularity([...byBand.high, ...byBand.extreme])),
    },
    events,
  };
}
