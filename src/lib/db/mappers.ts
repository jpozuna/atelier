// Pure mapping between the shared contracts (src/types) and table rows. No I/O, so it is safe anywhere.
// What is stored: seeds with their reason, picks with their stored path and card (reaction removed), and the
// reaction in its own row. Reach, connection and popularity numbers are not stored.

import { isCard, isSeed } from "@/types";
import type { Card, Pick, Reaction, ReactionState, Seed } from "@/types";
import type { Json, PickInsert, PickRow, ReactionInsert, ReactionRow, SeedInsert, SeedRow } from "./database.types";

export class DbMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbMappingError";
  }
}

/** JSON round trip: drops `undefined` and anything that is not JSON, and detaches from the caller's object. */
function toJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function seedToRow(userId: string, seed: Seed, whyTagIds: readonly string[] = []): SeedInsert {
  if (!isSeed(seed)) throw new DbMappingError("seed does not satisfy the Seed contract");
  return {
    user_id: userId,
    id: seed.id,
    field: seed.field,
    typed: seed.typed,
    reason: seed.why,
    qloo_id: seed.qlooId,
    status: seed.status,
    why_tag_ids: [...new Set(whyTagIds)],
  };
}

/** Candidates are not stored (they are Qloo names), so an ambiguous row reads back without them. */
export function rowToSeed(row: SeedRow): Seed {
  return { id: row.id, field: row.field, typed: row.typed, why: row.reason, qlooId: row.qloo_id, status: row.status };
}

export function pickToRow(userId: string, pick: Pick): PickInsert {
  if (!isCard(pick.card)) throw new DbMappingError("pick.card does not satisfy the Card contract");
  const path = toJson(pick.path);
  const { reaction: _reaction, ...card } = pick.card;
  void _reaction;
  const cardJson = toJson(card);
  if (JSON.stringify(sortKeys(path)) !== JSON.stringify(sortKeys((cardJson as { path: Json }).path))) {
    throw new DbMappingError("pick.path and pick.card.path differ; the card is generated from the path");
  }
  // A bridged pick (no Qloo coverage in its field) may have no Qloo id; any other pick must have one.
  const qlooId = pick.qlooId ? pick.qlooId : null;
  if (qlooId === null && !pick.llmBridged) throw new DbMappingError("a pick that is not llmBridged needs a Qloo id");
  return {
    user_id: userId,
    id: pick.id,
    seed_id: pick.path.seedId,
    field: pick.field,
    band: pick.band,
    name: pick.name,
    qloo_id: qlooId,
    llm_bridged: pick.llmBridged,
    origin: pick.origin,
    path,
    card: cardJson,
  };
}

/** The Card as stored, with the user's reaction (from the reactions table) attached when there is one. */
export function rowToCard(row: PickRow, reaction?: ReactionRow | null): Card {
  const card: unknown = row.card;
  if (!isCard(card)) throw new DbMappingError(`stored card for pick ${row.id} does not satisfy the Card contract`);
  return reaction ? { ...card, reaction: rowToReaction(reaction) } : card;
}

export interface ReactionInput {
  state: ReactionState;
  /** The "why" words (the box opened by not interested, or any words with the reaction). */
  words?: string;
  tried?: boolean;
  liked?: boolean | null;
  notes?: string;
}

export function reactionToRow(userId: string, pickId: string, input: ReactionInput): ReactionInsert {
  const tried = input.tried ?? input.state === "tried";
  return {
    user_id: userId,
    pick_id: pickId,
    state: input.state,
    why: input.words ?? null,
    tried,
    // liked only means something once the user has tried it.
    liked: tried ? (input.liked ?? null) : null,
    notes: input.notes ?? null,
  };
}

export function rowToReaction(row: ReactionRow): Reaction {
  return { state: row.state, ...(row.why ? { words: row.why } : {}), at: new Date(row.updated_at).toISOString() };
}

function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, Json>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}
