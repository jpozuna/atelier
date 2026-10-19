import type { Axis, Field, ProfileTag, Seed } from "@/types";

/** Why a submitted seed did not feed the taste-analysis call. */
export type SkipReason = "no_entity" | "duplicate_entity";

export interface SkippedSeed {
  id: string;
  reason: SkipReason;
}

/** How an axis label was produced: by the model, or by the deterministic fallback namer. */
export type NamingSource = "model" | "fallback";

/** A tag matched from a "why" by POST /api/profile/why. The id and type come from Qloo's /v2/tags. */
export interface WhyTag {
  /** Qloo tag id (`urn:tag:...`). */
  tag: string;
  name: string;
  /** Qloo tag type, `urn:tag:<kind>:<namespace>`. */
  tagType: string;
}

/** A seed as POST /api/profile receives it: the shared Seed plus the tags its why was mapped to at onboarding. */
export type ProfileSeed = Seed & {
  /** Absent when the why was never mapped (the lookup did not complete); empty when nothing matched. */
  whyTags?: WhyTag[];
};

/** The profile T-08 and T-10 read. Axes are returned next to it, not inside it. */
export interface Profile {
  /** Ids of the seeds that fed the one taste-analysis call. */
  seedIds: string[];
  skippedSeeds: SkippedSeed[];
  /** Fields of the seeds that fed the profile. */
  fields: Field[];
  /**
   * Every kept profile tag, weight descending. Tag ids all come from Qloo. Taste-analysis tags weigh their
   * `query.affinity`; why tags have `affinity: 0` (none from Qloo) and weigh WHY_TAG_WEIGHT.
   */
  tags: ProfileTag[];
  /** Ids of the kept tags flagged `bridge`, for T-08 (theme carry) and T-10. */
  bridgeTagIds: string[];
  /** How many taste-analysis tags were dropped as generic (rank-based). */
  droppedGenericCount: number;
  /** Tag types dropped because they kept fewer than the minimum taste-analysis tags. */
  droppedAxisTagTypes: string[];
  /** Set when fewer axes than MIN_AXES survived. Never padded. */
  axisShortfall?: { wanted: number; got: number };
  /** Axis id to how its label was produced. */
  naming: Record<string, NamingSource>;
}

export type { Axis, ProfileTag, Seed };
