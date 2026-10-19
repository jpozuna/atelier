// Tunable constants for the agent, frontier and evals. Every tunable number lives here and nowhere else.
// Values below are starting points from references/scoring.md, to be tuned against the spike's real data.
// Changing one means re-running the dial-behavior, reach-margin and connection-floor scorers.

import type { Band } from '@/types';

/** Reach = weighted sum of tagDistance, obscurity and fieldUnfamiliarity. Weights sum to 1. */
export const REACH_WEIGHTS = {
  tagDistance: 0.45,
  obscurity: 0.35,
  fieldUnfamiliarity: 0.2,
} as const;

/** Minimum connection (0 to 1) for every shown pick at every dial setting. It never drops. */
export const CONNECTION_FLOOR = 0.3;

/** Normaliser in connection = min(1, sum(profileWeight * rarity)) / norm. */
export const CONNECTION_NORM = 1;

/** A shared tag at or above this pool rarity makes a path distinctive. */
export const DISTINCTIVE_RARITY = 0.6;

/** Top explainability contribution below this marks the anchor as thin. */
export const MIN_ANCHOR_CONTRIBUTION = 0.25;

/** Upper reach-quantile edge of each band within the floor-clearing pool; `extreme` is everything above `high`. */
export const BAND_EDGES: Readonly<Record<Exclude<Band, 'extreme'>, number>> = {
  calibration: 0.25,
  moderate: 0.6,
  high: 0.85,
};

/** Median reach of each band must exceed the band below it by at least this much. */
export const MIN_REACH_MARGIN = 0.05;

/** Fewest primary, floor-clearing picks a field should show before it is reported as thin. */
export const MIN_PICKS_PER_FIELD = 3;

/** Maximum re-queries in one run, across all domains (call budget). */
export const MAX_REQUERIES_PER_RUN = 2;

/** Maximum live Qloo calls for one new profile run; a repeat view makes 0 (call budget). */
export const MAX_LIVE_CALLS_PER_RUN = 12;

/** `take` for each insights pool: one pool per domain, bucketed into bands in code. */
export const POOL_TAKE = 50;

/** `filter.popularity.max` sent on a first insights query, to keep the pool off the popular end. */
export const POOL_POPULARITY_MAX = 0.6;
