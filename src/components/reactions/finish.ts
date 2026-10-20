// Saving what a guest chose before signing in. No React here, so it is tested on its own.

import { carryContents, carryFromSessionOrCarry, carryItems, carrySnapshot, clearCarry, markForUser, saveCarry } from "./carry";
import type { CarryRecord } from "./carry";
import { buildSaveBody, postSave } from "./request";
import type { SaveOutcome } from "./request";

export type Notice = "none" | "saved" | "sign_in" | "failed" | "not_ready" | "too_many_seeds";

/** How many reacted picks the waiting record holds (what the confirm question names). Counts this tab's latest, if it has one. */
export function pendingCount(pending: CarryRecord): number {
  const contents = carryContents(carryFromSessionOrCarry(pending));
  return contents ? carryItems(contents).length : 0;
}

/**
 * What to do with a waiting record when a signed-in person turns up. A record already offered to a different account
 * is deleted (it is not theirs to save); one offered to this account, or to none yet, is offered to them.
 */
export function offerTo(pending: CarryRecord, userId: string): "forget" | "offer" {
  return pending.forUser && pending.forUser !== userId ? "forget" : "offer";
}

/** Remember which account the record was offered to, so a different account never gets it. */
export function recordOffer(pending: CarryRecord, userId: string): CarryRecord {
  const marked = markForUser(pending, userId);
  saveCarry(marked);
  return marked;
}

/**
 * Save what the person chose, after they said yes. The profile and plan go with it so a follow-up can look again from
 * any device. A saved record is deleted; any other outcome leaves it for another try.
 */
export async function finishPending(pending: CarryRecord, post: typeof postSave = postSave): Promise<Notice> {
  // This tab holds the latest reactions when the person signed in here; otherwise the stored copy does.
  const fresh = carryFromSessionOrCarry(pending);
  const contents = carryContents(fresh);
  const items = contents ? carryItems(contents) : [];
  if (!contents || items.length === 0) {
    clearCarry();
    return "none";
  }
  const outcome: SaveOutcome = await post(buildSaveBody(contents.seeds, items, carrySnapshot(contents)));
  if (outcome.kind === "saved") {
    clearCarry();
    return "saved";
  }
  if (outcome.kind === "sign_in") return "sign_in";
  if (outcome.kind === "not_ready") return "not_ready";
  if (outcome.kind === "too_many_seeds") return "too_many_seeds";
  return "failed";
}
