// Saving from the browser: the request bodies and the calls to our own routes. The fetch is injectable for tests.
// Nothing here talks to Qloo or Supabase directly; both live behind /api/reactions.

import type { Reaction } from "@/types";
import type { ProfileSeed } from "@/lib/profile/types";
import type { PublicPick } from "@/lib/agent/types";
import { MAX_REACTION_WORDS } from "@/lib/agent/config";
import { REACTIONS_URL, SESSION_URL, SNAPSHOT_URL } from "./constants";
import type { SaveBody, SaveErrorCode, SaveItemWire, SnapshotWire, UpdateBody } from "./wire";

export type SaveOutcome =
  | { kind: "saved"; userId: string | null }
  | { kind: "sign_in" }
  | { kind: "not_ready" }
  | { kind: "seed_missing" }
  | { kind: "too_many_seeds" }
  | { kind: "failed" };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Words as sent: trimmed and capped, or undefined when blank. */
export function trimWords(words: string | undefined): string | undefined {
  const t = (words ?? "").trim().slice(0, MAX_REACTION_WORDS);
  return t.length > 0 ? t : undefined;
}

/** A pick reduced to its identity, path and card. Anything else on the object (and any reaction on the card) is left behind. */
export function pickForWire(p: PublicPick): PublicPick {
  const { path, why, different, provenance, reading } = p.card;
  return {
    id: p.id,
    qlooId: p.qlooId,
    name: p.name,
    field: p.field,
    band: p.band,
    llmBridged: p.llmBridged,
    origin: p.origin,
    path: p.path,
    card: { path, why, different, provenance, ...(reading ? { reading } : {}) },
  };
}

/** The words are always sent, "" when blank, so a save from the picks screen can clear what an earlier save stored. */
export function toWireItem(pick: PublicPick, reaction: Pick<Reaction, "state" | "words">): SaveItemWire {
  return { pick: pickForWire(pick), reaction: { state: reaction.state, words: trimWords(reaction.words) ?? "" } };
}

export function buildSaveBody(seeds: readonly ProfileSeed[], items: readonly SaveItemWire[], snapshot?: SnapshotWire): SaveBody {
  return { seeds: [...seeds], items: [...items], ...(snapshot ? { snapshot } : {}) };
}

/**
 * The update a change on a saved card sends: its state, and its words only when the card gave some. NEVER the follow-up
 * (tried, how): the database keeps what is stored for a field that is absent, so a plain state change cannot wipe
 * what the person said after trying the pick. Only the follow-up form sends `tried` and `how`.
 */
export function reactionUpdate(reaction: Pick<Reaction, "state" | "words">): UpdateBody {
  const words = trimWords(reaction.words);
  return { state: reaction.state, ...(words ? { words } : {}) };
}

async function send(method: "POST" | "PUT", url: string, body: unknown, fetchFn: FetchLike): Promise<SaveOutcome> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "failed" };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON: the status alone decides.
  }
  if (res.ok) {
    const id = typeof data === "object" && data !== null ? (data as { userId?: unknown }).userId : null;
    return { kind: "saved", userId: typeof id === "string" ? id : null };
  }
  const code = typeof data === "object" && data !== null ? ((data as { error?: { code?: unknown } }).error?.code as SaveErrorCode | undefined) : undefined;
  if (res.status === 401 || code === "sign_in_required") return { kind: "sign_in" };
  if (code === "not_ready") return { kind: "not_ready" };
  if (code === "seed_missing") return { kind: "seed_missing" };
  if (code === "too_many_seeds") return { kind: "too_many_seeds" };
  return { kind: "failed" };
}

/** Save picks with their reactions (and the seeds they came from). 401 means the person is a guest. */
export function postSave(body: SaveBody, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<SaveOutcome> {
  return send("POST", REACTIONS_URL, body, fetchFn);
}

/** Change the reaction on a saved pick, or record the follow-up. */
export function putReaction(pickId: string, body: UpdateBody, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<SaveOutcome> {
  return send("PUT", `${REACTIONS_URL}/${encodeURIComponent(pickId)}`, body, fetchFn);
}

/** Keep the profile, axes and plan on the account (after a follow-up changed the plan). Best effort. */
export function putSnapshot(snapshot: SnapshotWire, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<SaveOutcome> {
  return send("PUT", SNAPSHOT_URL, snapshot, fetchFn);
}

/** Who is signed in: the account id, or null for a guest. Null too when the answer cannot be read. */
export async function fetchSessionUser(fetchFn: (url: string) => Promise<Pick<Response, "ok" | "json">> = (u) => fetch(u, { cache: "no-store" })): Promise<string | null> {
  try {
    const res = await fetchFn(SESSION_URL);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const id = typeof data === "object" && data !== null ? (data as { userId?: unknown }).userId : null;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
