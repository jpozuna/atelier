// Hand-written types for the public schema in supabase/migrations/. Keep in step with the migrations
// (migrations.test.ts checks the value lists). Plain `type` aliases, not interfaces, so they satisfy supabase-js's
// `Record<string, unknown>` table constraint. Not generated: `supabase gen types` needs a running database.

import type { Band, Field, Origin, ReactionState, SeedStatus } from "@/types";

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
  liked: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type QlooCacheRow = {
  key: string;
  endpoint: string;
  method: string;
  status: number;
  body: Json | null;
  version: number;
  created_at: string;
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
export type ReactionInsert = Omit<ReactionRow, "created_at" | "updated_at" | "why" | "tried" | "liked" | "notes"> &
  Partial<Pick<ReactionRow, "why" | "tried" | "liked" | "notes">>;
export type QlooCacheInsert = Omit<QlooCacheRow, "created_at" | "body"> &
  Partial<Pick<QlooCacheRow, "created_at" | "body">>;

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, ProfileInsert>;
      seeds: Table<SeedRow, SeedInsert>;
      picks: Table<PickRow, PickInsert>;
      reactions: Table<ReactionRow, ReactionInsert>;
      qloo_cache: Table<QlooCacheRow, QlooCacheInsert>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export type AtelierDb = Database;
