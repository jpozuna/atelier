// Tunable numbers for the LLM judges. Nothing here is a product setting; these are eval settings.

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

/** Env vars. The key is read only by the Anthropic client and is never printed. */
export const ENV_LIVE = "ATELIER_JUDGES_LIVE";
export const ENV_JUDGE_MODEL = "ATELIER_JUDGE_MODEL";
export const ENV_MODEL = "ATELIER_MODEL";
