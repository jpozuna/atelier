// Contracts of the frontier module. Pure types: no Qloo calls and no server-only imports.

import type { Band, Candidate, Field, Path, PathHop, Pick as AtelierPick, ReachParts, TraceEvent } from "@/types";
import type { InsightsEntity, InsightsParams, InsightsPurpose, QlooResponse } from "@/lib/qloo/types";
import type { Profile, ProfileSeed } from "@/lib/profile/types";

/** The only thing buildPool needs from the Qloo client, so tests inject a fake. `QlooClient.insights` fits. */
export type InsightsFn = (params: InsightsParams, opts: { purpose: InsightsPurpose }) => Promise<QlooResponse<InsightsEntity>>;

export type TraceSink = (event: TraceEvent) => void;

/** What the frontier needs to know about the user: the profile plus the seeds behind it. */
export interface FrontierContext {
  profile: Profile;
  /** Every seed of the profile. Only seeds with a `qlooId` are sent to Qloo. `whyTags` help anchor by tag overlap. */
  seeds: readonly ProfileSeed[];
}

/** Entities that must never come back: shown picks, plus anything else already used. Seeds are excluded automatically. */
export interface Exclusions {
  entityIds: readonly string[];
}

export interface PoolDeps {
  insights: InsightsFn;
  /** Receives each trace event as it happens. Events are also returned on the result. */
  emit?: TraceSink;
  now?: () => Date;
}

export interface PoolOptions {
  /** Ids of the profile tags on the axis being explored. Seeds that carry one are weighted up. */
  focusTagIds?: readonly string[];
  /** Overrides POOL_POPULARITY_MAX (the re-query action "tighten filter.popularity.max"). */
  popularityMax?: number;
}

/** One normalised insights pool for one domain. One call, never one per band. */
export interface Pool {
  domain: Field;
  entityType: string;
  /** Normalised, deduplicated, with excluded ids removed. `origin` is `unknown` for all (Qloo marks no backfill). */
  candidates: Candidate[];
  /** `empty` when Qloo returned no usable entities. The caller decides on a re-query (reason `empty`). */
  outcome: "ok" | "empty";
  /** Ids of the seeds sent, in the order sent. Explainability anchors are chosen among these. */
  sentSeedIds: string[];
  popularityMax: number;
  /** Results Qloo returned, before local clean-up. */
  returned: number;
  /** Returned entities removed locally because they were excluded (should be 0; Qloo honours the exclusion). */
  droppedExcluded: number;
  /** Returned items dropped for a missing id or name. */
  droppedMalformed: number;
  /** Whether any result carried explainability. */
  explainabilityPresent: boolean;
  events: TraceEvent[];
}

export interface ScoreOptions {
  /**
   * Sourced lineage hops that touch a seed, by pick id (T-09: `lineageTouchingSeeds(refs, seedNames)`, one hop).
   * Optional, and only available for finalists. A hop that is not `lineage`, not `sourced` or has no `sourceUrl`
   * is ignored. Lineage never replaces shared tags: a pick still needs at least one to have a path.
   */
  lineage?: ReadonlyMap<string, PathHop>;
  emit?: TraceSink;
  now?: () => Date;
}

export interface ScoredCandidate {
  candidate: Candidate;
  reach: ReachParts;
  /** 0 to 1. Computed from shared profile tags, their rarity in the pool, and lineage when supplied. */
  connection: number;
  /** Pool rank of popularity, 0 (least popular) to 1; null when popularity is unknown (0 or missing). */
  popularityRank: number | null;
  /** Null when the candidate shares no counted tag with the profile (no theme, so no path). */
  path: Path | null;
  /** Path is distinctive and connection is at or above CONNECTION_FLOOR. The only candidates ever shown. */
  clearsFloor: boolean;
}

/** Computed signals for the loop to decide on a re-query. Numbers only. */
export interface PoolSignals {
  scored: number;
  clearedFloor: number;
  /** Candidates with a distinctive path, whether or not they cleared the floor. */
  distinctive: number;
  /** True when fewer than MIN_PICKS_PER_FIELD cleared the floor. */
  thin: boolean;
  /** Median reach of the candidates that cleared the floor; null when none did. */
  clearedMedianReach: number | null;
  /** Median popularity (known values only) of the candidates that cleared the floor; null when none. */
  clearedMedianPopularity: number | null;
}

export interface ScoredPool {
  domain: Field;
  scored: ScoredCandidate[];
  /** Pool rarity per tag id, 0 (every candidate has it) to 1 (one candidate has it). Pool-relative. */
  tagRarity: ReadonlyMap<string, number>;
  signals: PoolSignals;
  events: TraceEvent[];
}

export const DIALS = ["develop", "match", "stretch"] as const;
export type Dial = (typeof DIALS)[number];

/** A shown pick before its card is written: a `Pick` without `card` (T-10 adds the card from the path). */
export type FrontierPick = Omit<AtelierPick, "card">;

export interface SelectOptions {
  /** Bands to fill, in any order. Pass every band shown in the run in ONE call so the reach margin holds across them. */
  bands: readonly Band[];
  /** Picks per band. Defaults to MIN_PICKS_PER_FIELD. */
  perBand?: number;
  emit?: TraceSink;
  now?: () => Date;
}

export interface BandSelection {
  domain: Field;
  /** Lowest band first. */
  picks: FrontierPick[];
  byBand: Record<Band, FrontierPick[]>;
  /** Requested bands that ended with no picks, even after relaxing. */
  emptyBands: Band[];
  /** Fewer than MIN_PICKS_PER_FIELD cleared the floor: say so and offer another seed, never pad. */
  thin: boolean;
  clearedCount: number;
  /** Median popularity (known values only) of the Match bands and the Stretch bands among the picks; null when none. */
  dial: { matchMedianPopularity: number | null; stretchMedianPopularity: number | null };
  events: TraceEvent[];
}

export class FrontierInputError extends Error {
  constructor(
    readonly code: "no_seeds" | "bad_domain",
    message: string,
  ) {
    super(message);
    this.name = "FrontierInputError";
  }
}
