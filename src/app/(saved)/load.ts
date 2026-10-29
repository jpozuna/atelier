// Reading a person's saved picks on the server. Everything goes through the cookie-bound client, so row-level security
// returns only the caller's own rows, and the queries are filtered to them as well. Nothing here calls Qloo: a saved
// pick is its stored row, with the card exactly as it was saved.

import "server-only";

import type { SavedItem } from "@/components/reactions/groups";
import type { FollowUpSource } from "@/components/reactions/follow-up";
import { getSessionState } from "@/lib/db/auth";
import { getProfileSnapshot, listPicks, listSeeds } from "@/lib/db/saves";
import { createUserClient, DbConfigError } from "@/lib/db/server";
import type { AtelierClient } from "@/lib/db/server";
import type { Field } from "@/types";

export interface SavedPickRow extends SavedItem {
  qlooId: string | null;
  llmBridged: boolean;
}

export type SavedLoad =
  | { kind: "guest" }
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { kind: "ok"; userId: string; email: string | null; anonymous: boolean; items: SavedPickRow[]; client: AtelierClient };

/** The person's saved picks, each with its stored card and follow-up answer. */
export async function loadSaved(clientOverride?: AtelierClient): Promise<SavedLoad> {
  try {
    const client = clientOverride ?? (await createUserClient());
    const session = await getSessionState(client);
    if (session.kind === "guest") return { kind: "guest" };
    const picks = await listPicks(client, session.user);
    const items: SavedPickRow[] = picks.map((p) => ({
      id: p.id,
      name: p.name,
      field: p.field,
      card: p.card,
      savedAt: p.savedAt,
      tried: p.followUp?.tried ?? false,
      how: p.followUp?.how ?? null,
      qlooId: p.qlooId,
      llmBridged: p.llmBridged,
    }));
    return { kind: "ok", userId: session.user.id, email: session.user.email, anonymous: session.user.anonymous === true, items, client };
  } catch (err) {
    // Supabase is not set up here, or something failed. Never repeat the error text on the page.
    return err instanceof DbConfigError ? { kind: "unavailable" } : { kind: "failed" };
  }
}

/**
 * What the follow-up needs to look at one field again: the account's own seeds and stored profile snapshot, and the
 * entity ids of the saved picks in that field (kept out of the new look). Null when the account has no snapshot yet
 * or any read fails; the follow-up then saves the answer and says nothing was looked at again.
 */
export async function loadFollowUpSource(saved: Extract<SavedLoad, { kind: "ok" }>, field: Field): Promise<FollowUpSource | null> {
  try {
    const user = { id: saved.userId, email: saved.email };
    const snapshot = await getProfileSnapshot(saved.client, user);
    if (!snapshot) return null;
    // Only matched seeds can lead a look: an unmatched one has no entity to send.
    const seeds = (await listSeeds(saved.client, user)).filter((s) => s.status === "clean" && s.qlooId);
    if (seeds.length === 0) return null;
    const shownIds = saved.items.filter((i) => i.field === field && i.qlooId).map((i) => i.qlooId as string);
    return { seeds, profile: snapshot.profile, axes: snapshot.axes, plan: snapshot.plan, shownIds };
  } catch {
    return null;
  }
}
