// Saving for signed-in users. Every function takes an `AuthUser`, which only `requireUser()` produces, so a guest
// cannot reach these by accident; RLS is the backstop. Pass the cookie-bound client from `createUserClient()`,
// never the service client. Guests never reach this file: onboarding and picks do not touch the database.

import { isAxis } from "@/types";
import type { Card, Pick, Seed } from "@/types";
import type { AuthUser } from "./auth";
import { MAX_SEEDS_PER_USER } from "@/lib/agent/config";
import type { Json, PickRow, ProfileSnapshotData } from "./database.types";
import {
  pickToRow,
  reactionToRow,
  rowToCard,
  rowToFollowUp,
  rowToSeed,
  seedToRow,
  type FollowUp,
  type ReactionInput,
} from "./mappers";
import type { AtelierClient } from "./server";

export class DbWriteError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation} failed: ${detail}`);
    this.name = "DbWriteError";
  }
}

/** Saving would take the account past a stored limit (seeds). Nothing was written. */
export class DbLimitError extends Error {
  readonly limit: number;
  /** Seeds already stored for the user. */
  readonly existing: number;
  /** How many the user would have after the save. */
  readonly attempted: number;
  constructor(what: string, limit: number, existing: number, attempted: number) {
    super(`${what} limit is ${limit}: ${existing} stored, ${attempted} after this save`);
    this.name = "DbLimitError";
    this.limit = limit;
    this.existing = existing;
    this.attempted = attempted;
  }
}

function fail(operation: string, error: { code?: string; message: string }): never {
  throw new DbWriteError(operation, `${error.code ?? "unknown"} ${error.message}`);
}

/**
 * Save the user's seeds with their reasons. `whyTagIds` maps seed id -> Qloo tag ids found for its reason.
 * An account holds at most `MAX_SEEDS_PER_USER` seeds: the stored ids plus the new ones (an id that is already
 * stored is an update, not a new seed) may not exceed it, else `DbLimitError` is thrown and nothing is written.
 */
export async function saveSeeds(
  client: AtelierClient,
  user: AuthUser,
  seeds: readonly Seed[],
  whyTagIds: Readonly<Record<string, readonly string[]>> = {},
): Promise<void> {
  if (seeds.length === 0) return;
  const rows = seeds.map((s) => seedToRow(user.id, s, whyTagIds[s.id] ?? []));
  const stored = await client.from("seeds").select("id").eq("user_id", user.id);
  if (stored.error) fail("saveSeeds", stored.error);
  const ids = new Set((stored.data ?? []).map((r) => r.id));
  const existing = ids.size;
  for (const r of rows) ids.add(r.id);
  if (ids.size > MAX_SEEDS_PER_USER) throw new DbLimitError("seed", MAX_SEEDS_PER_USER, existing, ids.size);
  const { error } = await client.from("seeds").upsert(rows, { onConflict: "user_id,id" });
  if (error) fail("saveSeeds", error);
}

export async function listSeeds(client: AtelierClient, user: AuthUser): Promise<Seed[]> {
  const { data, error } = await client.from("seeds").select("*").eq("user_id", user.id).order("created_at");
  if (error) fail("listSeeds", error);
  return (data ?? []).map(rowToSeed);
}

/**
 * Save picks with their stored paths and cards. CALL `saveSeeds` FIRST: `picks` has a foreign key from
 * (user_id, seed_id) to the user's seeds, where seed_id is `pick.path.seedId`, so a pick whose seed is not saved
 * fails with a foreign-key error (23503) and throws `DbWriteError`. Save the seeds and the picks of one run in that
 * order. A pick without a Qloo id is accepted only when `llmBridged`.
 */
export async function savePicks(client: AtelierClient, user: AuthUser, picks: readonly Pick[]): Promise<void> {
  if (picks.length === 0) return;
  const rows = picks.map((p) => pickToRow(user.id, p));
  const { error } = await client.from("picks").upsert(rows, { onConflict: "user_id,id" });
  if (error) fail("savePicks", error);
}

/**
 * Set or change the user's reaction to a saved pick (one reaction per pick). Fields the input does not carry keep
 * their stored value: a save with only a state or words never clears `tried`, `how` or `notes`
 * (see `reactionToRow`). `how: null` clears the answer; `tried: false` clears it too.
 */
export async function saveReaction(
  client: AtelierClient,
  user: AuthUser,
  pickId: string,
  input: ReactionInput,
): Promise<void> {
  const stored = await client.from("reactions").select("*").eq("user_id", user.id).eq("pick_id", pickId).maybeSingle();
  if (stored.error) fail("saveReaction", stored.error);
  const { error } = await client
    .from("reactions")
    .upsert(reactionToRow(user.id, pickId, input, stored.data), { onConflict: "user_id,pick_id" });
  if (error) fail("saveReaction", error);
}

/**
 * Keep the user's latest profile, axes and run plan, so a follow-up re-run works on another device. One row per
 * user, replaced on each save. `plan` null when no run has produced one yet.
 */
export async function saveProfileSnapshot(
  client: AtelierClient,
  user: AuthUser,
  snapshot: ProfileSnapshotData,
): Promise<void> {
  const row = {
    user_id: user.id,
    profile: JSON.parse(JSON.stringify(snapshot.profile)) as Json,
    axes: JSON.parse(JSON.stringify(snapshot.axes)) as Json,
    plan: snapshot.plan ? (JSON.parse(JSON.stringify(snapshot.plan)) as Json) : null,
  };
  const { error } = await client.from("profile_snapshots").upsert(row, { onConflict: "user_id" });
  if (error) fail("saveProfileSnapshot", error);
}

/** The user's stored snapshot, or null when there is none or it no longer has the expected outer shape. */
export async function getProfileSnapshot(
  client: AtelierClient,
  user: AuthUser,
): Promise<(ProfileSnapshotData & { updatedAt: string }) | null> {
  const { data, error } = await client.from("profile_snapshots").select("*").eq("user_id", user.id).maybeSingle();
  if (error) fail("getProfileSnapshot", error);
  if (!data) return null;
  const { profile, axes, plan } = data;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(profile) || !Array.isArray(axes) || !axes.every(isAxis) || (plan !== null && !isObj(plan))) return null;
  return {
    profile: profile as unknown as ProfileSnapshotData["profile"],
    axes: axes as unknown as ProfileSnapshotData["axes"],
    plan: plan as unknown as ProfileSnapshotData["plan"],
    updatedAt: new Date(data.updated_at).toISOString(),
  };
}

export interface StoredPick {
  id: string;
  seedId: string | null;
  /** Null for a bridged pick with no Qloo coverage. */
  qlooId: string | null;
  name: string;
  field: PickRow["field"];
  band: PickRow["band"];
  llmBridged: boolean;
  /** The stored card (path included), with the user's reaction when there is one. */
  card: Card;
  /** What the user said after trying it; null until a reaction row exists. `how` null = not answered. */
  followUp: FollowUp | null;
  savedAt: string;
}

/** The user's stored picks, newest first, each with its card and reaction. */
export async function listPicks(client: AtelierClient, user: AuthUser): Promise<StoredPick[]> {
  const picks = await client.from("picks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (picks.error) fail("listPicks", picks.error);
  const reactions = await client.from("reactions").select("*").eq("user_id", user.id);
  if (reactions.error) fail("listPicks", reactions.error);
  const byPick = new Map((reactions.data ?? []).map((r) => [r.pick_id, r]));
  return (picks.data ?? []).map((row) => {
    const reaction = byPick.get(row.id);
    return {
      id: row.id,
      seedId: row.seed_id,
      qlooId: row.qloo_id,
      name: row.name,
      field: row.field,
      band: row.band,
      llmBridged: row.llm_bridged,
      card: rowToCard(row, reaction),
      followUp: reaction ? rowToFollowUp(reaction) : null,
      savedAt: new Date(row.created_at).toISOString(),
    };
  });
}
