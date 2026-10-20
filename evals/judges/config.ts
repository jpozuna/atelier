// Names for the LLM judges: env vars. The tunable numbers (agreement, tolerance, token and call caps) live in
// src/lib/agent/config.ts under "Eval judges". Nothing here is a product setting.

/** Env vars. The key is read only by the Anthropic client and is never printed. */
export const ENV_LIVE = "ATELIER_JUDGES_LIVE";
export const ENV_JUDGE_MODEL = "ATELIER_JUDGE_MODEL";
export const ENV_MODEL = "ATELIER_MODEL";
