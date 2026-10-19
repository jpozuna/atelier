// Profile and axis tunables. They belong in src/lib/agent/config.ts (CLAUDE.md), which this ticket cannot edit;
// the manager moves them there using the proposed names in the T-07 Handoff. No Qloo data here.

/** `take` for the one taste-analysis call per profile (call budget). */
export const TASTE_TAKE = 50;

/** Axis count: keep at most MAX_AXES; fewer than MIN_AXES is reported as a shortfall, never padded. */
export const MIN_AXES = 6;
export const MAX_AXES = 8;

/** An axis with fewer taste-analysis tags than this is dropped (docs/DECISIONS.md). */
export const MIN_TAGS_PER_AXIS = 2;

/**
 * Generic tags are dropped by rank, not by an absolute cutoff (tag popularity bunches at 0.99 to 1.0): among
 * taste-analysis tags with a known popularity (above 0; 0 means unknown), the top share is dropped. Skipped when
 * fewer than GENERIC_MIN_POOL tags have a known popularity. Why tags are never ranked or dropped.
 */
export const GENERIC_DROP_TOP_SHARE = 0.2;
export const GENERIC_MIN_POOL = 10;

/** "Why" mapping: one semantic /v2/tags call per submitted why (POST /api/profile/why). */
export const WHY_TAKE = 8;
export const WHY_TAGS_PER_SEED = 5;
export const MAX_WHY_CHARS = 120;

/**
 * Profile weight of a tag matched from the user's own words. It is a documented constant for "the user said so",
 * not a Qloo score. These tags carry `affinity: 0` (no Qloo affinity) and are left out of axis weight sums.
 */
export const WHY_TAG_WEIGHT = 0.1;

/** Request limits. Onboarding allows at most 10 seeds (CLAUDE.md rule 10). */
export const MAX_SEEDS = 10;
export const MAX_BODY_CHARS = 20000;
export const MAX_WHY_BODY_CHARS = 2000;
export const MAX_TAG_NAME_CHARS = 120;

/** Axis naming. */
export const MAX_LABEL_WORDS = 4;
export const MAX_LABEL_CHARS = 40;
export const MAX_JUSTIFICATION_CHARS = 300;
/** Tag names shorter than this are not counted as citations in a justification. */
export const MIN_CITED_NAME_CHARS = 3;
export const NAMER_MAX_TOKENS = 300;
export const NAMER_TIMEOUT_MS = 15000;
/** At most this many axis-naming calls in flight at once. */
export const NAMER_CONCURRENCY = 3;
/** Model-named axes remembered in memory by tag-id set, so a repeat build makes no model call. */
export const NAME_CACHE_MAX = 200;
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
