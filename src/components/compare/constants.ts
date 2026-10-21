// Local, non-numeric constants of the Qloo vs plain-LLM comparison (T-22): routes, storage keys and the label. Every
// tunable number lives in src/lib/agent/config.ts ("Compare" section). No Qloo data here.

/** The route the screen posts to. */
export const COMPARE_URL = "/api/compare";
export const COMPARE_PATH = "/compare";

/** What the screen keeps in sessionStorage so a revisit makes no model call. Bump the version on a shape change. */
export const COMPARE_STORAGE_KEY = "atelier.compare.v1";
export const COMPARE_STORAGE_VERSION = 1;

/** The exact label on every item of the plain-model list. */
export const UNGROUNDED_LABEL = "Ungrounded: no Qloo link, no source";
