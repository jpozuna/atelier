// Tunable constants for the whole app: thresholds, caps, weights, timeouts, TTLs, limits, budgets and sizes.
// Every tunable number lives here and nowhere else (CLAUDE.md). Labels, copy, regexes, storage keys, enum lists and
// route paths stay in their own modules.
//
// Constants only: no imports of server code (client components import this file). Type-only imports are fine.
// Values are starting points from references/scoring.md, to be tuned against the spike's real data. Changing one
// means re-running the dial-behavior, reach-margin and connection-floor scorers. config.test.ts snapshots the key
// ones so a change shows up in review.
//
// Sections: Frontier, Agent run (budgets and loop), Qloo client, Profile, Refs / Wikidata, Seeds, Guard, DB,
// UI onboarding, UI picks, UI reactions, Eval judges.

import type { Band } from '@/types';

// ===== Frontier: reach, connection, bands, pools =====

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

/** Seed weight (insights `signal.interests.entities` weight) for seeds that sit on the axis being explored. */
export const SEED_WEIGHT_ON_AXIS = 1;

/**
 * Seed weight for seeds off the axis being explored. Seeds are still sent (the client requires every sent seed
 * to be excluded, and dropping a seed would hide it from the explainability anchor), only leaned away from.
 * Applies only when at least one seed is on the axis; otherwise every seed weighs SEED_WEIGHT_ON_AXIS.
 */
export const SEED_WEIGHT_OFF_AXIS = 0.3;

/**
 * Added to the connection sum when a sourced lineage hop that touches a seed is supplied. Large enough to clear
 * CONNECTION_FLOOR (0.3) on its own, so lineage counts as real evidence, but a pick still needs a shared tag
 * to have a path at all (the path contract is seed, theme, optional lineage, pick).
 */
export const LINEAGE_CONNECTION_WEIGHT = 0.4;

/** Obscurity given to a candidate whose popularity is unknown (0 or missing): neutral, neither obscure nor popular. */
export const NEUTRAL_OBSCURITY = 0.5;

// ===== Agent run: call budgets, pools, re-queries, model limits, request limits (loop, explain, /api/run) =====

/** Maximum re-queries in one run, across all domains (call budget). */
export const MAX_REQUERIES_PER_RUN = 2;

/** Maximum live Qloo calls for one new profile run; a repeat view makes 0 (call budget). */
export const MAX_LIVE_CALLS_PER_RUN = 12;

/** `take` for each insights pool: one pool per domain, bucketed into bands in code. */
export const POOL_TAKE = 50;

/** `filter.popularity.max` sent on a first insights query, to keep the pool off the popular end. */
export const POOL_POPULARITY_MAX = 0.6;

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
/** Timeout of one Anthropic call in the run, in ms. */
export const LLM_TIMEOUT_MS = 30_000;
/** Output cap of the themes (plan) call. */
export const LLM_PLAN_MAX_TOKENS = 900;
/** Output cap of the re-query review call. */
export const LLM_REVIEW_MAX_TOKENS = 500;
/** Per domain: up to 4 bands x RUN_PICKS_PER_BAND picks, each about 160 tokens of why and different. */
export const LLM_EXPLAIN_MAX_TOKENS = 2400;
/** Explanation calls in flight at once. */
export const LLM_EXPLAIN_CONCURRENCY = 3;
/** Model replies remembered in memory by input hash, so a repeat run makes no model call. */
export const LLM_CACHE_MAX = 300;

/** Longest `reason` (why a theme or re-query was chosen) accepted from the model, checked in code. */
export const REASON_MAX_CHARS = 140;
/** Longest `why` line accepted from the model, checked in code. */
export const WHY_MAX_CHARS = 380;
/** Longest `different` line accepted from the model, checked in code. */
export const DIFFERENT_MAX_CHARS = 260;
/** A `different` or `reason` whose words overlap the main line by at least this share is a restatement. */
export const RESTATE_OVERLAP = 0.7;
/** Tag names listed in one fallback sentence. */
export const FALLBACK_TAGS_SHOWN = 3;

/** POST /api/run: longest body in characters. The body carries the profile and axes, which repeat the tags. */
export const RUN_MAX_BODY_CHARS = 150_000;
/** POST /api/run: most entity ids in `exclude`. Also the most the picks screen sends (the newest win). */
export const RUN_MAX_EXCLUDE = 200;
/** POST /api/run: most tags in the profile. */
export const RUN_MAX_TAGS = 120;
/** POST /api/run: most axes. */
export const RUN_MAX_AXES = 12;
/** Runs in progress at once in one server process. Each costs Qloo calls (live mode) and model calls. */
export const RUN_MAX_CONCURRENT = 3;

/** Model-written lines: schema `maxLength` of `reason` (the character limits above are what code enforces). */
export const SCHEMA_REASON_MAX = 200;
/** Model-written lines: schema `maxLength` of `why`. */
export const SCHEMA_WHY_MAX = 500;
/** Model-written lines: schema `maxLength` of `different`. */
export const SCHEMA_DIFFERENT_MAX = 400;

/** Longest id string (domain or tag id) accepted in a plan. */
export const RUN_MAX_PLAN_ID_CHARS = 200;

/** Tags listed per option in the model's option lists. */
export const MAX_TAGS_PER_OPTION = 6;
/** Tags of a theme shown to the model as input. */
export const MAX_THEME_TAGS_IN_INPUT = 5;
/** Pick-only tags (the pick has them, the profile lacks them) shown per pick. */
export const MAX_PICK_ONLY_TAGS = 3;
/** Characters of the user's why quoted in a prompt. */
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

/**
 * A follow-up looks at one field again: one pool plus at most the loop's own re-query cap, so at most 3 live
 * Qloo calls. The cap itself is enforced by the loop (MAX_REQUERIES_PER_RUN).
 */
export const FOLLOW_UP_MAX_LIVE_CALLS = 1 + MAX_REQUERIES_PER_RUN;

// ===== Qloo client (src/lib/qloo/client.ts). The per-run call cap is MAX_LIVE_CALLS_PER_RUN, above. =====

/** Qloo requests in flight at once, process-wide. */
export const QLOO_MAX_IN_FLIGHT = 4;
/** Retries after a 429, so up to this many + 1 HTTP attempts for one logical call. */
export const QLOO_MAX_429_RETRIES = 3;
/** First backoff wait after a 429, in ms. */
export const QLOO_BACKOFF_BASE_MS = 1000;
/** Longest backoff wait, in ms. */
export const QLOO_BACKOFF_CAP_MS = 8000;
/** Minimum spacing between Qloo request starts, in ms. The key allows 5 per second. */
export const QLOO_MIN_REQUEST_INTERVAL_MS = 220;
/** Timeout of one Qloo request, in ms. */
export const QLOO_REQUEST_TIMEOUT_MS = 30000;
/** Remaining monthly calls below which live calls are refused (unless ATELIER_DEMO=1). */
export const QLOO_DEFAULT_RESERVE = 6000;
/** Strings longer than this are truncated before storing in the cache. */
export const QLOO_STRIP_MAX_STRING = 500;

// ===== Profile and axes (src/lib/profile) =====

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

/** "Why" mapping: `take` of the one semantic /v2/tags call per submitted why (POST /api/profile/why). */
export const WHY_TAKE = 8;
/** "Why" mapping: tags kept per seed. */
export const WHY_TAGS_PER_SEED = 5;
/** Longest "why" the user may write, in characters (the form and the server share it). */
export const MAX_WHY_CHARS = 120;

/**
 * Profile weight of a tag matched from the user's own words. It is a documented constant for "the user said so",
 * not a Qloo score. These tags carry `affinity: 0` (no Qloo affinity) and are left out of axis weight sums.
 */
export const WHY_TAG_WEIGHT = 0.1;

/**
 * Most seeds one account may have: onboarding, POST /api/profile, POST /api/run and saved seeds all use this one
 * number, so the form, the routes and the database never disagree (CLAUDE.md rule 10).
 */
export const MAX_SEEDS_PER_USER = 10;
/** POST /api/profile: longest body in characters. */
export const PROFILE_MAX_BODY_CHARS = 20000;
/** POST /api/profile/why: longest body in characters. */
export const MAX_WHY_BODY_CHARS = 2000;
/** Longest tag name accepted in profile and run requests (and kept by the browser). */
export const MAX_TAG_NAME_CHARS = 120;
/** Longest tag id accepted, here and in the browser's checks. */
export const MAX_TAG_ID_CHARS = 300;

/** Axis naming: most words in a label. */
export const MAX_LABEL_WORDS = 4;
/** Axis naming: most characters in a label. */
export const MAX_LABEL_CHARS = 40;
/** Axis naming: most characters in a justification. */
export const MAX_JUSTIFICATION_CHARS = 300;
/** Tag names shorter than this are not counted as citations in a justification. */
export const MIN_CITED_NAME_CHARS = 3;
/** Output cap of one axis-naming call. */
export const NAMER_MAX_TOKENS = 300;
/** Timeout of one axis-naming call, in ms. */
export const NAMER_TIMEOUT_MS = 15000;
/** At most this many axis-naming calls in flight at once. */
export const NAMER_CONCURRENCY = 3;
/** Model-named axes remembered in memory by tag-id set, so a repeat build makes no model call. */
export const NAME_CACHE_MAX = 200;

// ===== Refs / Wikidata (src/lib/refs) =====

/** Wikidata entities looked up in one run (finalists only). Cache hits do not count. From the ticket: at most 6. */
export const WIKIDATA_MAX_LOOKUPS_PER_RUN = 6;
/** Related items kept per Wikidata property (all are matchable against seeds; only MAX_NAMES_PER_HOP are shown). */
export const WIKIDATA_MAX_TARGETS_PER_PROPERTY = 10;
/** Ids per labels request. wbgetentities allows 50 for anonymous clients. */
export const WIKIDATA_MAX_LABEL_IDS = 50;
/** Timeout of one Wikidata request, in ms. */
export const WIKIDATA_TIMEOUT_MS = 8000;
/** All Wikidata work in one run, counted from its first request, in ms. Past it, no more requests. */
export const WIKIDATA_RUN_DEADLINE_MS = 12000;
/** `maxlag` sent with every request (seconds). Wikimedia asks for 5 on automated clients. */
export const WIKIDATA_MAXLAG_SECONDS = 5;
/** Pause after a 429, 503 or maxlag error that carries no Retry-After, in ms. */
export const WIKIDATA_DEFAULT_RETRY_MS = 60 * 1000;
/** Longest pause a Retry-After can impose on this process, in ms. */
export const WIKIDATA_MAX_RETRY_MS = 10 * 60 * 1000;
/** In-memory cache lifetime for a Wikidata response, in ms. Wikidata is CC0, so caching it is allowed. */
export const WIKIDATA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Related names shown in one lineage hop label: seed matches first, then source order (never popularity or taste). */
export const MAX_NAMES_PER_HOP = 3;
/** A reading excerpt is cut at a sentence end at or before this length, else at a word with an ellipsis. */
export const READING_MAX_CHARS = 280;
/** Retrieved text shorter than this is not offered as a reading. */
export const READING_MIN_CHARS = 40;

// ===== Seeds (src/lib/seeds) =====

/** `take` for the one /search call per seed. The ticket caps it at 10. */
export const SEARCH_TAKE = 10;

/** Most candidates returned to the chooser (and shown as chips). */
export const MAX_CANDIDATES = 5;

/** Query length accepted by the route, after trimming. Short titles ("Up") are real, so the floor is 2. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Longest request body the seed route reads, in characters. */
export const SEEDS_MAX_BODY_CHARS = 2000;

/** Longest disambiguation string passed to a chip. */
export const MAX_DISAMBIGUATION_CHARS = 120;

/** Places default city (New York) and search radius in miles, used when the env vars are unset. */
export const DEFAULT_PLACES_LOCATION = "40.7128,-74.0060";
export const DEFAULT_PLACES_RADIUS = 20;

// ===== Guard: per-visitor limits and the daily allowance (src/lib/guard) =====

/** POST /api/run: largest body the guard accepts, in bytes. The handlers still check their own, tighter, limits. */
export const GUARD_RUN_MAX_BODY_BYTES = 1_000_000;
/** POST /api/run: runs per visitor (IP) per hour. ATELIER_RUNS_PER_HOUR overrides it. */
export const RUNS_PER_HOUR_PER_IP = 3;
/** POST /api/run: runs per visitor (IP) per day. */
export const RUNS_PER_DAY_PER_IP = 8;
/** POST /api/profile: largest body the guard accepts, in bytes. */
export const GUARD_PROFILE_MAX_BODY_BYTES = 256_000;
/** POST /api/profile: requests per visitor (IP) per hour. */
export const GUARD_PROFILE_PER_HOUR = 12;
/** POST /api/profile/why: largest body the guard accepts, in bytes. */
export const GUARD_WHY_MAX_BODY_BYTES = 32_000;
/** POST /api/profile/why: requests per visitor (IP) per hour. */
export const GUARD_WHY_PER_HOUR = 60;
/** POST /api/seeds/resolve: largest body the guard accepts, in bytes. */
export const GUARD_RESOLVE_MAX_BODY_BYTES = 32_000;
/** POST /api/seeds/resolve: requests per visitor (IP) per minute. */
export const GUARD_RESOLVE_PER_MINUTE = 20;
/** POST /api/seeds/resolve: requests per visitor (IP) per hour. */
export const GUARD_RESOLVE_PER_HOUR = 90;

/** Daily allowance for the whole demo (rolling 24 hours, per server instance). Both are estimates charged at admission. */
export const DAILY_MODEL_CALLS = 480;
export const DAILY_QLOO_CALLS = 480;

/** Most visitor counters kept in memory at once; the oldest are dropped first. The global meters are never dropped. */
export const MAX_TRACKED_KEYS = 5000;

/** Longest IP string accepted from a header. */
export const MAX_IP_CHARS = 64;

// ===== UI onboarding (src/components/onboarding) =====

/** "See my taste" needs at least this many seeds, across at least MIN_FIELDS fields. */
export const MIN_SEEDS = 3;
export const MIN_FIELDS = 2;

/** Shortest "why" worth mapping to tags. A single character is not a reason. */
export const MIN_WHY_CHARS = 3;

// ===== UI picks (src/components/deck) =====

/**
 * `/api/run` returns no reach or connection (hard rule 7), but the chart needs a position. The band is the one
 * coarse, public statement of reach, so a pick sits at the middle of its band's stretch of the chart. Nothing here
 * is shown as a number; it only places a mark. Calibration sits nearest the profile.
 */
export const BAND_CHART_REACH: Readonly<Record<Band, number>> = {
  calibration: 0.12,
  moderate: 0.4,
  high: 0.65,
  extreme: 0.9,
};

/**
 * The line weight on the chart has no public number behind it, so every pick gets the same one: the middle of the
 * chart's scale (halfway between its floor and its ceiling). Uniform on purpose in v1. Never displayed.
 */
export const CHART_NEUTRAL_CONNECTION = 0.65;

/** Quiet card-pack reveal: one new tile every this many ms. The cap keeps a tile from waiting long, hidden and out of tab order. */
export const REVEAL_STAGGER_MS = 240;
export const REVEAL_MAX_DELAY_MS = 2000;
/** After this long the reveal is over: later tiles (a field shown again) appear without a turn. */
export const REVEAL_TOTAL_MS = REVEAL_MAX_DELAY_MS + 1500;

/** Trace events kept in memory and in storage. The reasoning stays readable; a runaway stream cannot grow without bound. */
export const MAX_TRACE_EVENTS = 400;

/** How many "not me" re-runs one visit may start before the screen asks the person to carry on with what they have. */
export const MAX_NOT_ME_RERUNS = 3;

/** Longest fixed sentence from the server that is kept (`note` on a field). */
export const MAX_NOTE_CHARS = 400;

/** How long a spoken message stays before it is cleared (ms). */
export const ANNOUNCE_CLEAR_MS = 5000;
/** How long a shown note stays before it is cleared (ms). */
export const NOTE_CLEAR_MS = 8000;

/** Panel scroll: within this many px of the end counts as "following along". */
export const FOLLOW_THRESHOLD_PX = 48;

// ===== UI reactions: saving, revisiting, follow-up (src/components/reactions, POST /api/reactions) =====

/** A guest's waiting work is forgotten after this long if they never finish signing in, in ms. */
export const CARRY_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** POST /api/reactions: picks per request. */
export const MAX_SAVE_ITEMS = 60;
/** POST /api/reactions: longest body in characters (a pick carries its whole card). */
export const MAX_SAVE_BODY_CHARS = 400_000;
/** Longest reaction text kept, in characters despite the name, in the browser (storage and requests) and on the server. */
export const MAX_REACTION_WORDS = 2000;
/** Longest id string accepted in a reactions request. */
export const MAX_ID_CHARS = 200;

// ===== Eval judges (evals/judges). Eval settings, not product settings. =====

/** A judge has to agree with its calibration labels at least this often (ticket T-18 done-when). */
export const MIN_AGREEMENT = 0.8;

/** A 1 to 5 judge agrees with a label when its score is within this many points of the label's score. */
export const SCORE_TOLERANCE = 1;

/** An evidence quote shorter than this (after folding case and spacing) is too short to count. */
export const MIN_QUOTE_CHARS = 12;

/** Scores at the ends of the 1 to 5 scale (labels 1 and 5) need an exact match; tolerance applies only in between. */
export const EXACT_AT_ENDS = true;

/** Label scores at or above this are the high group, at or below LOW_LABEL_MAX the low group, for the ordering check. */
export const HIGH_LABEL_MIN = 4;
export const LOW_LABEL_MAX = 2;

/** Output cap for one judge reply. A verdict is a short JSON object. */
export const JUDGE_MAX_TOKENS = 1200;

/** A real run refuses to start when it would make more model calls than this. One call per calibration item, no retries. */
export const MAX_JUDGE_CALLS_PER_RUN = 80;
