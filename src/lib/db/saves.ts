// Saving for signed-in users. Every function takes an `AuthUser`, which only `requireUser()` produces, so a guest
// cannot reach these by accident; RLS is the backstop. Pass the cookie-bound client from `createUserClient()`,
// never the service client. Guests never reach this file: onboarding and picks do not touch the database.

import type { Card, Pick, Seed } from "@/types";
import type { AuthUser } from "./auth";
import type { PickRow } from "./database.types";
import { pickToRow, reactionToRow, rowToCard, rowToSeed, seedToRow, type ReactionInput } from "./mappers";
import type { AtelierClient } from "./server";

export class DbWriteError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation} failed: ${detail}`);
    this.name = "DbWriteError";
  }
}

function fail(operation: string, error: { code?: string; message: string }): never {
  throw new DbWriteError(operation, `${error.code ?? "unknown"} ${error.message}`);
}

/** Save the user's seeds with their reasons. `whyTagIds` maps seed id -> Qloo tag ids found for its reason. */
export async function saveSeeds(
  client: AtelierClient,
  user: AuthUser,
  seeds: readonly Seed[],
  whyTagIds: Readonly<Record<string, readonly string[]>> = {},
): Promise<void> {
  if (seeds.length === 0) return;
  const rows = seeds.map((s) => seedToRow(user.id, s, whyTagIds[s.id] ?? []));
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

/** Set or change the user's reaction to a saved pick (one reaction per pick). */
export async function saveReaction(
  client: AtelierClient,
  user: AuthUser,
  pickId: string,
  input: ReactionInput,
): Promise<void> {
  const { error } = await client
    .from("reactions")
    .upsert(reactionToRow(user.id, pickId, input), { onConflict: "user_id,pick_id" });
  if (error) fail("saveReaction", error);
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
  savedAt: string;
}

/** The user's stored picks, newest first, each with its card and reaction. */
export async function listPicks(client: AtelierClient, user: AuthUser): Promise<StoredPick[]> {
  const picks = await client.from("picks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (picks.error) fail("listPicks", picks.error);
  const reactions = await client.from("reactions").select("*").eq("user_id", user.id);
  if (reactions.error) fail("listPicks", reactions.error);
  const byPick = new Map((reactions.data ?? []).map((r) => [r.pick_id, r]));
  return (picks.data ?? []).map((row) => ({
    id: row.id,
    seedId: row.seed_id,
    qlooId: row.qloo_id,
    name: row.name,
    field: row.field,
    band: row.band,
    llmBridged: row.llm_bridged,
    card: rowToCard(row, byPick.get(row.id)),
    savedAt: new Date(row.created_at).toISOString(),
  }));
}
