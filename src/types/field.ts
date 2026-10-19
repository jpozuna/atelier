/** The six locked fields (docs/DECISIONS.md, 2026-10-19). */
export const FIELDS = ['music', 'film', 'tv', 'books', 'food_places', 'fashion'] as const;
export type Field = (typeof FIELDS)[number];

/** Reach bands, computed in code as quantiles of reach within the floor-clearing pool. */
export const BANDS = ['calibration', 'moderate', 'high', 'extreme'] as const;
export type Band = (typeof BANDS)[number];

export const PROVENANCES = ['sourced', 'inferred'] as const;
/** `sourced` comes from retrieved text with a link. `inferred` is computed or model-bridged. Never merged. */
export type Provenance = (typeof PROVENANCES)[number];

/**
 * Primary vs backfill origin of a result. Qloo returns no backfill marker (spike), so `unknown` is the default.
 * Only the frontier code (T-08) may derive `primary` or `backfill`, from computed signals; nothing else sets it.
 */
export const ORIGINS = ['primary', 'backfill', 'unknown'] as const;
export type Origin = (typeof ORIGINS)[number];
