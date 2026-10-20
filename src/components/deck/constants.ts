// Names of the picks screen: the run route and what it keeps in storage. The tunables (chart placement, reveal
// timing, trace and exclude caps, clear delays) live in src/lib/agent/config.ts. No Qloo data here.

/** The run route this screen streams from. */
export const RUN_URL = "/api/run";

/** What the screen keeps between visits in sessionStorage (per tab, works as a guest). Bump the version on a shape change. */
export const PICKS_STORAGE_KEY = "atelier.picks.v1";
export const PICKS_STORAGE_VERSION = 1;
