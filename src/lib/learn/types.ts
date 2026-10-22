// Contracts of the learning step. Pure types and word lists, no tunable numbers (those are in src/lib/agent/config.ts).

import type { Field } from "@/types";

/**
 * What a person did with a pick, as the run log records it (the same words as RUN_SIGNALS in src/lib/runlog/types.ts;
 * restated here so the pure logic imports nothing server side).
 */
export type LearnSignalName = "not_me" | "saved_explore" | "saved_later" | "saved_try" | "not_interested" | "tried";
export type LearnSource = "reaction" | "not_me_list" | "exclude";

/** Milliseconds of an ISO time (any offset: `Z` and `+00:00` agree). An unreadable time is 0, so it sorts oldest. */
export const timeOf = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Turned down: the pick leaves future runs and the themes behind it are leaned away from. */
export const TURNED_DOWN: readonly LearnSignalName[] = ["not_me", "not_interested"];
/** Saved: the themes behind the pick are leaned toward. `tried` says nothing about liking, so it leans neither way. */
export const SAVED: readonly LearnSignalName[] = ["saved_explore", "saved_later", "saved_try"];

/** One past signal, with the themes behind the pick it was given on. Ids and words only. */
export interface LearnSignal {
  signal: LearnSignalName;
  /** The Qloo entity id of the pick, when the log knows it. */
  entityId: string | null;
  /** `<run id>:<pick id>`: names the pick when the entity id is unknown. */
  pickKey: string;
  /** `exclude` is inferred (the request's list also holds picks that were only shown), so it never moves a theme. */
  source: LearnSource;
  /** Tag ids of the pick's theme hops (its path's shared tags), from the stored run. Empty for a run logged before T-28. */
  themeTags: string[];
  /** The field of the pick, when the stored run says. */
  field?: Field;
  /** ISO time the signal was recorded. */
  at: string;
}

/** What the learning step decided for one run. Ids and counts only. */
export interface Adjustment {
  /** Entity ids added to `exclude`, newest signal first. */
  exclude: string[];
  /** Profile tag ids whose weight is lowered (they appear only in turned-down picks' theme hops). */
  awayTags: string[];
  /** Profile tag ids whose weight is raised (they appear in saved picks' theme hops). */
  towardTags: string[];
  /** The step used, 0 to 1. */
  step: number;
}
