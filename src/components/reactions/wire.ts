// What the browser and the reactions routes say to each other. Type-only imports, so client code never pulls in
// server code. No scores, no popularity: a saved pick is its identity, its stored path and its card.

import type { ReactionState } from "@/types";
import type { Axis } from "@/types";
import type { ReactionHow } from "@/lib/db/constants";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import type { PublicPick, RunPlan } from "@/lib/agent/types";

export interface ReactionWire {
  state: ReactionState;
  /** The person's own words (the "why"). Omitted when blank. */
  words?: string;
}

export interface SaveItemWire {
  pick: PublicPick;
  reaction: ReactionWire;
}

/** The profile, axes and run plan a run came from, kept so a follow-up can look again on any device. */
export interface SnapshotWire {
  profile: Profile;
  axes: Axis[];
  plan: RunPlan | null;
}

/** POST /api/reactions: save the seeds a run came from, then each pick with its reaction. Idempotent. */
export interface SaveBody {
  seeds: ProfileSeed[];
  items: SaveItemWire[];
  /** Sent with a save so the account keeps the profile the picks came from. Optional. */
  snapshot?: SnapshotWire;
}

/** PUT /api/reactions/<pickId>: change the reaction on a pick already saved. */
export interface UpdateBody {
  state: ReactionWire["state"];
  /**
   * The person's words. Absent keeps what is stored, so a plain state change never wipes a follow-up answer; a string
   * (even "") replaces it.
   */
  words?: string;
  /**
   * The follow-up, sent ONLY when the person answered it: did they try it, and how it went. Never sent with a plain
   * state or words change (the database merges, so leaving them out keeps the stored answer).
   */
  tried?: boolean;
  how?: ReactionHow | null;
  /** A pick the person tried and liked becomes a seed, so their profile moves. One clean, matched seed. */
  addSeed?: ProfileSeed;
}

export type SaveErrorCode = "sign_in_required" | "not_ready" | "bad_request" | "seed_missing" | "too_many_seeds" | "not_found" | "save_failed";
