// The one line a save leaves on screen. Pure.

import { COPY } from "./copy";
import { PICKS_PATH, SIGN_IN_PATH } from "./constants";
import type { SaveOutcome } from "./request";

export type SaveStatus = "idle" | "saving" | SaveOutcome["kind"];

/** The sentence for a status. Empty for idle. The sign-in sentence is followed by a link, which the component adds. */
export function statusMessage(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return COPY.saving;
    case "saved":
      return COPY.saved;
    case "sign_in":
      return COPY.signInToKeep;
    case "not_ready":
      return COPY.saveNotReady;
    case "seed_missing":
      return COPY.saveSeedMissing;
    case "too_many_seeds":
      return COPY.saveTooManySeeds;
    case "failed":
      return COPY.saveFailed;
    default:
      return "";
  }
}

/** Where the sign-in link leads, and where it should bring the person back to (a site path). */
export function signInHref(next: string = PICKS_PATH): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
