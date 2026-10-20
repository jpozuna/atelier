// Tunables of the agent loop (T-10). They belong in src/lib/agent/config.ts (CLAUDE.md: tunable numbers live only
// there), which this ticket cannot edit; the manager moves them using the proposed names in the T-10 Handoff.
// No Qloo data here.

/** Picks shown per band and domain. Four bands (calibration, moderate, high, extreme) so at most 4 x this per domain. */
export const RUN_PICKS_PER_BAND = 2;

/** Pools built at the same time. The Qloo client also spaces request starts, this only bounds our own fan-out. */
export const RUN_POOL_CONCURRENCY = 3;

/** A re-query that tightens `filter.popularity.max` lowers it by this much... */
export const REQUERY_POPULARITY_STEP = 0.15;
/** ...and never goes below this. Below it a pool is mostly long tail with no tags to connect on. */
export const REQUERY_POPULARITY_MIN = 0.2;

/**
 * `too_obvious` is computed from the candidates that cleared the connection floor. A candidate is obvious when it
 * sits high in the pool's popularity order, has very high tag overlap with the profile, or its lineage touches a
 * seed by name (same creator or franchise). The pool is obvious when at least OBVIOUS_SHARE of them are.
 */
export const OBVIOUS_POPULARITY_RANK = 0.75;
export const OBVIOUS_TAG_DISTANCE_MAX = 0.3;
export const OBVIOUS_SHARE = 0.6;

/** Anthropic calls: at most 1 (themes) + 1 (re-query review) + 1 per domain (explanations) = 8 per run. Enforced at runtime by the loop. */
export const LLM_MAX_CALLS_PER_RUN = 8;
export const LLM_TIMEOUT_MS = 30_000;
export const LLM_PLAN_MAX_TOKENS = 900;
export const LLM_REVIEW_MAX_TOKENS = 500;
/** Per domain: up to 4 bands x RUN_PICKS_PER_BAND picks, each about 160 tokens of why and different. */
export const LLM_EXPLAIN_MAX_TOKENS = 2400;
/** Explanation calls in flight at once. */
export const LLM_EXPLAIN_CONCURRENCY = 3;
/** Model replies remembered in memory by input hash, so a repeat run makes no model call. */
export const LLM_CACHE_MAX = 300;

/** Limits on model-written text, checked in code. */
export const REASON_MAX_CHARS = 140;
export const WHY_MAX_CHARS = 380;
export const DIFFERENT_MAX_CHARS = 260;
/** A `different` or `reason` whose words overlap the main line by at least this share is a restatement. */
export const RESTATE_OVERLAP = 0.7;
/** Tag names listed in one fallback sentence. */
export const FALLBACK_TAGS_SHOWN = 3;

/** Request limits for POST /api/run. The body carries the profile and axes, which repeat the tags. */
export const RUN_MAX_BODY_CHARS = 150_000;
export const RUN_MAX_EXCLUDE = 200;
export const RUN_MAX_TAGS = 120;
export const RUN_MAX_AXES = 12;
/** Runs in progress at once in one server process. Each costs Qloo calls (live mode) and model calls. */
export const RUN_MAX_CONCURRENT = 3;

/** Model-written lines: schema `maxLength`s (the character limits above are what code enforces). */
export const SCHEMA_REASON_MAX = 200;
export const SCHEMA_WHY_MAX = 500;
export const SCHEMA_DIFFERENT_MAX = 400;

/** Request limits for seeds and the plan. */
export const RUN_MAX_SEEDS = 10;
export const RUN_MAX_PLAN_REQUERIES = 2;
export const RUN_MAX_PLAN_ID_CHARS = 200;

/** Option lists and prompt inputs. */
export const MAX_TAGS_PER_OPTION = 6;
export const MAX_THEME_TAGS_IN_INPUT = 5;
export const MAX_PICK_ONLY_TAGS = 3;
export const MAX_WHY_CHARS_IN_PROMPT = 160;

/**
 * Path.pickOnlyTags: tags the pick carries that the profile lacks, kept only when they are not generic in the pool
 * (pool rarity at or above this), rarest first.
 */
export const PICK_ONLY_MIN_RARITY = 0.5;

/**
 * Path.distance hints, computed in code from the reach parts and never shown as numbers: farther_from_tags when
 * tagDistance is at or above the first, less_familiar when obscurity is at or above the second.
 */
export const DISTANCE_TAG_DISTANCE_MIN = 0.6;
export const DISTANCE_OBSCURITY_MIN = 0.6;

/** Words in a model line that are not in the path, the user's why, or the neutral vocabulary, tolerated before the line is refused. */
export const MAX_UNKNOWN_WORDS = 2;
/** Words shorter than this are never checked for being unknown. */
export const MIN_CHECKED_WORD_CHARS = 4;
/** Allowed names shorter than this are never used to mask text. */
export const MIN_MASKED_NAME_CHARS = 3;

/** SSE: a comment line is sent this often so proxies keep the stream open. */
export const SSE_HEARTBEAT_MS = 12_000;
