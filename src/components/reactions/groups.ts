// The saved list, grouped by the state the person chose. Pure: no React, no storage, no network.

import type { Card, Field, ReactionState } from "@/types";
import type { ReactionHow } from "@/lib/db/constants";
import { GROUP_COPY, GROUP_ORDER, COPY } from "./copy";

/** What the list and the stored card need of a saved pick. Built on the server from the person's own rows. */
export interface SavedItem {
  id: string;
  name: string;
  field: Field;
  /** The stored card, with the person's reaction attached when there is one. */
  card: Card;
  savedAt: string;
  /** From the follow-up: did they try it, and how it went. `how` null means not answered, and nothing is said for it. */
  tried: boolean;
  how: ReactionHow | null;
}

export type GroupKey = (typeof GROUP_ORDER)[number] | "unsorted";

export interface SavedGroup {
  key: GroupKey;
  title: string;
  gloss: string;
  items: SavedItem[];
}

const lastTouched = (i: SavedItem): string => i.card.reaction?.at ?? i.savedAt;

/** Groups in a fixed order, empty groups left out, newest first inside each. A pick with no reaction goes last. */
export function groupSaved(items: readonly SavedItem[]): SavedGroup[] {
  const sorted = [...items].sort((a, b) => (lastTouched(a) < lastTouched(b) ? 1 : lastTouched(a) > lastTouched(b) ? -1 : a.id < b.id ? -1 : 1));
  const groups: SavedGroup[] = [];
  for (const key of GROUP_ORDER) {
    const inGroup = sorted.filter((i) => i.card.reaction?.state === key);
    if (inGroup.length > 0) groups.push({ key, ...GROUP_COPY[key], items: inGroup });
  }
  const loose = sorted.filter((i) => !i.card.reaction || !(GROUP_ORDER as readonly ReactionState[]).includes(i.card.reaction.state));
  if (loose.length > 0) groups.push({ key: "unsorted", title: COPY.savedNotSorted, gloss: COPY.savedNotSortedGloss, items: loose });
  return groups;
}

export const savedHref = (id: string): string => `/saved/${encodeURIComponent(id)}`;

/** How a tried pick went, in words. Null unless the person recorded it: nothing is said for them. */
export function outcomeWord(item: Pick<SavedItem, "tried" | "how">): string | null {
  if (!item.tried) return null;
  if (item.how === "liked") return COPY.likedWord;
  if (item.how === "mixed") return COPY.mixedWord;
  if (item.how === "not_liked") return COPY.notForMeWord;
  return null;
}

/** The seed and theme as the stored path states them, for the one line under a pick's name. */
export function pathLine(card: Card): string {
  const seed = card.path.hops.find((h) => h.kind === "seed")?.label ?? null;
  const theme = card.path.hops.find((h) => h.kind === "theme")?.label ?? null;
  return COPY.fromThrough(seed, theme);
}
