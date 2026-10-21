// Live suite "post-check": the 7-call check of whether POST /v2/insights honors the body-borne params
// (filter.popularity.max, filter.exclude.entities, feature.explainability) on every Atelier type, plus taste analysis
// by POST. The logic lives in scripts/spike/04-post-check.mjs and stays there. This suite makes NO call: it only tells
// the user how to run the script (dry run first, then live with its own budget). It is registered so the expected
// count (6 pools + 1 taste analysis = 7) is printed with the other live suites.

import type { LiveSuite } from "../harness/live";

export const POST_CHECK_SCRIPT = "scripts/spike/04-post-check.mjs";
export const POST_CHECK_CALLS = 7;

export const POST_CHECK_DRY_RUN = `node ${POST_CHECK_SCRIPT} --dry-run`;
export const POST_CHECK_LIVE = `QLOO_LIVE=1 QLOO_BUDGET=${POST_CHECK_CALLS} node ${POST_CHECK_SCRIPT}`;

export function postCheckInstructions(): string[] {
  return [
    `post-check: this runner makes no calls for it. The check is a separate script; run it yourself, in this order:`,
    `  1. ${POST_CHECK_DRY_RUN}   (counts cache misses, makes no call)`,
    `  2. ${POST_CHECK_LIVE}   (at most ${POST_CHECK_CALLS} live calls; needs your OK)`,
    `  Then record what it confirmed in src/lib/qloo/registry.ts (POST_BODY.confirmedBodyParams). The smoke-run suite cannot send picks queries until you do.`,
  ];
}

export const postCheck: LiveSuite = {
  id: "post-check",
  description: "Does a POST body honor popularity.max, exclude.entities and explainability on every type? Run by script, not by this runner.",
  expectedCalls: POST_CHECK_CALLS,
  viaScript: POST_CHECK_SCRIPT,
  async run() {
    for (const line of postCheckInstructions()) console.log(line);
  },
};
