// Tunables of the picks screen. Tunable numbers belong in src/lib/agent/config.ts, which this ticket cannot edit;
// the manager moves these there (see the T-14 Handoff). No Qloo data here.

import type { Band } from "@/types";

/** The run route this screen streams from. */
export const RUN_URL = "/api/run";

/** What the screen keeps between visits in sessionStorage (per tab, works as a guest). Bump the version on a shape change. */
export const PICKS_STORAGE_KEY = "atelier.picks.v1";
export const PICKS_STORAGE_VERSION = 1;

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

/** Entity ids to exclude on a re-run: the route allows 200 (RUN_MAX_EXCLUDE). The newest ids win. */
export const MAX_EXCLUDE = 200;

/** Trace events kept in memory and in storage. The reasoning stays readable; a runaway stream cannot grow without bound. */
export const MAX_TRACE_EVENTS = 400;

/** How many "not me" re-runs one visit may start before the screen asks the person to carry on with what they have. */
export const MAX_NOT_ME_RERUNS = 3;

/** Longest fixed sentence from the server that is kept (`note` on a field), and the longest reaction text kept in storage. */
export const MAX_NOTE_CHARS = 400;
export const MAX_REACTION_WORDS = 2000;

/** How long a spoken or shown message stays before it is cleared (ms). */
export const ANNOUNCE_CLEAR_MS = 5000;
export const NOTE_CLEAR_MS = 8000;

/** Panel scroll: within this many px of the end counts as "following along". */
export const FOLLOW_THRESHOLD_PX = 48;
