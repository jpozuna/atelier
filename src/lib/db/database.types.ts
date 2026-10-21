// Hand-written types for the public schema in supabase/migrations/. Keep in step with the migrations
// (migrations.test.ts checks the value lists). Plain `type` aliases, not interfaces, so they satisfy supabase-js's
// `Record<string, unknown>` table constraint. Not generated: `supabase gen types` needs a running database.

import type { Axis, Band, Field, Origin, ReactionState, SeedStatus } from "@/types";
import type { RunPlan } from "@/lib/agent/types";
import type { Profile } from "@/lib/profile/types";
import type { ReactionHow } from "./constants";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRow = {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SeedRow = {
  user_id: string;
  id: string;
  field: Field;
  typed: string;
  reason: string;
  qloo_id: string | null;
  status: SeedStatus;
  why_tag_ids: string[];
  created_at: string;
};

export type PickRow = {
  user_id: string;
  id: string;
  seed_id: string | null;
  field: Field;
  band: Band;
  name: string;
  /** Null only when `llm_bridged` (no Qloo coverage for the field). */
  qloo_id: string | null;
  llm_bridged: boolean;
  origin: Origin;
  path: Json;
  card: Json;
  created_at: string;
};

export type ReactionRow = {
  user_id: string;
  pick_id: string;
  state: ReactionState;
  why: string | null;
  tried: boolean;
  /** How a tried pick went. Null = not answered (not the same as mixed). Only set when `tried`. */
  how: ReactionHow | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileSnapshotRow = {
  user_id: string;
  /** Derived profile (tags, weights, why tags). Not a raw Qloo response. */
  profile: Json;
  /** Derived axes. */
  axes: Json;
  /** The last run's plan (words and ids), null until a run has produced one. */
  plan: Json | null;
  updated_at: string;
};

/** What a snapshot holds, in the contract types. Stored as JSON; `getProfileSnapshot` validates the outer shape. */
export interface ProfileSnapshotData {
  profile: Profile;
  axes: Axis[];
  plan: RunPlan | null;
}

export type QlooCacheRow = {
  key: string;
  endpoint: string;
  method: string;
  status: number;
  body: Json | null;
  version: number;
  created_at: string;
};

/** One admitted hit of the deploy guard. `key` is a hashed visitor key or a named global meter, never an address. */
export type GuardCounterRow = {
  key: string;
  at_ms: number;
  cost: number;
};

/** Arguments of guard_consume: `hits` is the CounterStore Hit list, as JSON. */
export type GuardConsumeArgs = {
  hits: Json;
  now_ms: number;
  do_commit: boolean;
};

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ProfileInsert = Pick<ProfileRow, "id"> & Partial<Pick<ProfileRow, "display_name">>;
export type SeedInsert = Omit<SeedRow, "created_at" | "reason" | "why_tag_ids"> &
  Partial<Pick<SeedRow, "created_at" | "reason" | "why_tag_ids">>;
export type PickInsert = Omit<PickRow, "created_at" | "llm_bridged" | "origin" | "seed_id" | "qloo_id"> &
  Partial<Pick<PickRow, "created_at" | "llm_bridged" | "origin" | "seed_id" | "qloo_id">>;
export type ReactionInsert = Omit<ReactionRow, "created_at" | "updated_at" | "why" | "tried" | "how" | "notes"> &
  Partial<Pick<ReactionRow, "why" | "tried" | "how" | "notes">>;
export type ProfileSnapshotInsert = Omit<ProfileSnapshotRow, "updated_at" | "plan"> &
  Partial<Pick<ProfileSnapshotRow, "updated_at" | "plan">>;
export type QlooCacheInsert = Omit<QlooCacheRow, "created_at" | "body"> &
  Partial<Pick<QlooCacheRow, "created_at" | "body">>;

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, ProfileInsert>;
      seeds: Table<SeedRow, SeedInsert>;
      picks: Table<PickRow, PickInsert>;
      reactions: Table<ReactionRow, ReactionInsert>;
      profile_snapshots: Table<ProfileSnapshotRow, ProfileSnapshotInsert>;
      qloo_cache: Table<QlooCacheRow, QlooCacheInsert>;
      guard_counters: Table<GuardCounterRow, GuardCounterRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      guard_consume: { Args: GuardConsumeArgs; Returns: Json };
    };
  };
};

export type AtelierDb = Database;
