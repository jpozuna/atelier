// Pure mapping between the shared contracts (src/types) and table rows. No I/O, so it is safe anywhere.
// What is stored: seeds with their reason, picks with their stored path and card (reaction removed), and the
// reaction in its own row. Reach, connection and popularity numbers are not stored.

import { isCard, isSeed } from "@/types";
import type { Card, Pick, Reaction, ReactionState, Seed } from "@/types";
import { REACTION_HOWS, type ReactionHow } from "./constants";
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

/**
 * A reaction as the UI sends it. Every field except `state` is optional, and an absent field means "leave what is
 * stored" (see `reactionToRow`), so a plain save (state or words only) never clears a follow-up answer.
 */
export interface ReactionInput {
  state: ReactionState;
  /** The "why" words (the box opened by not interested, or any words with the reaction). */
  words?: string;
  /** Did they try it. `false` clears `how`. */
  tried?: boolean;
  /** How it went. Absent = unchanged; `null` = clear the answer (not answered); needs `tried`. Never inferred. */
  how?: ReactionHow | null;
  notes?: string;
}

/** The follow-up part of a reaction row: what the user said after trying a pick. */
export interface FollowUp {
  tried: boolean;
  /** Null = not answered. */
  how: ReactionHow | null;
  notes: string | null;
}

export function rowToFollowUp(row: ReactionRow): FollowUp {
  return { tried: row.tried, how: row.how, notes: row.notes };
}

/**
 * The row to upsert for a save. Merge semantics: pass the stored row as `existing` and only the fields the input
 * carries are changed; the rest keep their stored value. With no `existing`, absent fields take their defaults
 * (words and notes null, how null = not answered, tried true only when the state is `tried`).
 *
 * `how` is never inferred from `state` or anything else. It stays as stored unless the input sets it, or sets
 * `tried: false` (which clears it, since an untried pick has no answer). Contradictions throw DbMappingError
 * rather than being silently repaired: a `how` on a pick that was not tried, an unknown `how`, or state `tried`
 * with `tried: false`.
 */
export function reactionToRow(
  userId: string,
  pickId: string,
  input: ReactionInput,
  existing?: ReactionRow | null,
): ReactionInsert {
  if (input.how !== undefined && input.how !== null && !REACTION_HOWS.includes(input.how)) {
    throw new DbMappingError(`unknown how: ${String(input.how)}`);
  }
  if (input.state === "tried" && input.tried === false) {
    throw new DbMappingError("a reaction in state tried cannot have tried: false");
  }
  if (input.tried === false && input.how) {
    throw new DbMappingError("how needs tried: a pick that was not tried has no answer");
  }
  const tried = input.state === "tried" ? true : (input.tried ?? existing?.tried ?? false);
  let how: ReactionHow | null = input.how !== undefined ? input.how : (existing?.how ?? null);
  if (input.tried === false) how = null;
  if (how !== null && !tried) throw new DbMappingError("how needs tried: a pick that was not tried has no answer");
  return {
    user_id: userId,
    pick_id: pickId,
    state: input.state,
    why: input.words !== undefined ? input.words : (existing?.why ?? null),
    tried,
    how,
    notes: input.notes !== undefined ? input.notes : (existing?.notes ?? null),
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
