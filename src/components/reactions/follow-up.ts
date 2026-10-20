// The follow-up on a saved pick: "tried it? how was it? why?" and what it asks of the next run. Pure.
//
// Where the profile comes from: the account's own stored seeds and profile snapshot (profile, axes, run plan), read on
// the server by the page and passed in, so the look works on any device. The snapshot is replaced with the new plan
// after the look.
//
// What moves the profile's edges, and how:
//  - A pick the person tried and liked becomes one of their seeds (their own words as its reason), so the field is
//    looked at again with it in mind. It needs a matched entity and room among the seeds.
//  - The saved picks of that field and the tried pick itself are excluded from the new look, so what comes back is new.
//  - Only the pick's own field is looked at again, with the stored plan: one pool plus at most the loop's own re-query
//    cap, so at most 3 live Qloo calls (FOLLOW_UP_MAX_LIVE_CALLS).
// Nothing numeric about taste is read or written.

import type { Axis, Field } from "@/types";
import type { ReactionHow } from "@/lib/db/constants";
import { buildRunBody, cleanExclude } from "@/components/deck/request";
import type { RunBody } from "@/components/deck/request";
import type { RunPlan } from "@/components/deck/types";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import { MAX_SAVE_SEEDS } from "./constants";
import { trimWords } from "./request";
import type { SnapshotWire } from "./wire";

export interface TriedPick {
  id: string;
  qlooId: string | null;
  field: Field;
  name: string;
  llmBridged: boolean;
}

/** What the person said after trying it. `how` is always an answer here (the form requires one). */
export interface Outcome {
  how: ReactionHow;
  words?: string;
}

/** What the page reads for the follow-up: the account's seeds and snapshot, and the ids already saved in the field. */
export interface FollowUpSource {
  seeds: ProfileSeed[];
  profile: Profile;
  axes: Axis[];
  plan: RunPlan | null;
  /** Entity ids of the person's saved picks in this field, kept out of the new look. */
  shownIds: string[];
}

export const seedIdForPick = (pickId: string): string => `tried-${pickId}`;

/** The picked entity as a seed, or null when it cannot be one (no matched entity, bridged, already a seed, or no room). */
export function seedFromTried(pick: TriedPick, words: string | undefined, existing: readonly ProfileSeed[]): ProfileSeed | null {
  if (!pick.qlooId || pick.llmBridged) return null;
  const id = seedIdForPick(pick.id);
  if (existing.some((s) => s.id === id || s.qlooId === pick.qlooId)) return null;
  if (existing.length >= MAX_SAVE_SEEDS) return null;
  return { id, field: pick.field, typed: pick.name, why: trimWords(words) ?? "", qlooId: pick.qlooId, status: "clean" };
}

export interface FollowUpPlan {
  /** The body for POST /api/run: this pick's field only. */
  body: RunBody;
  /** The new seed, when the pick was liked and could become one. It is saved with the answer, before the run. */
  addSeed: ProfileSeed | null;
}

/** What to ask of the run after a tried pick. Null when the account has no stored profile to look again with. */
export function planFollowUp(source: FollowUpSource | null, pick: TriedPick, outcome: Outcome): FollowUpPlan | null {
  if (!source) return null;
  const addSeed = outcome.how === "liked" ? seedFromTried(pick, outcome.words, source.seeds) : null;
  const seeds = addSeed ? [...source.seeds, addSeed] : source.seeds;
  const exclude = cleanExclude([...source.shownIds, ...(pick.qlooId ? [pick.qlooId] : [])]);
  const body = buildRunBody({ seeds, profile: source.profile, axes: source.axes }, { exclude, plan: source.plan ?? undefined, domains: [pick.field] });
  return { body, addSeed };
}

/** The snapshot to keep after a look: the same profile and axes, with the plan the run returned. */
export function snapshotAfter(source: FollowUpSource, plan: RunPlan): SnapshotWire {
  return { profile: source.profile, axes: source.axes, plan };
}

/**
 * Whether a submit changes the answer. The first save always counts; after that, a look again is made only when how it
 * went changed (words alone are saved but do not trigger a run), so a repeat press spends nothing.
 */
export function answerChanged(last: { how: ReactionHow; words: string } | null, next: { how: ReactionHow; words: string }): { changed: boolean; howChanged: boolean } {
  if (!last) return { changed: true, howChanged: true };
  return { changed: last.how !== next.how || last.words !== next.words, howChanged: last.how !== next.how };
}
