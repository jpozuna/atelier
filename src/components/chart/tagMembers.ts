/*
 * Which seeds and suggestions in this run share an axis tag. Pure and computed from props: no network, no storage.
 * "Shares" means the tag id is on the path's theme hop (the same hop the explanation is written from), so the list
 * never claims a link the stored path does not hold.
 */
import type { Pick } from '@/types';

export interface TagSeed {
  /** The seed's id from the path (`Path.seedId`). */
  id: string;
  /** The seed hop's label, as the path states it. */
  label: string;
}

export interface TagMembers {
  /** The user's own seeds whose path runs through the tag. One entry per seed, in the order first met. */
  seeds: TagSeed[];
  /** Suggestions whose path runs through the tag, in input order. */
  picks: Pick[];
}

/** True when the pick's path has `tagId` on a theme hop. */
export function pickHasTag(pick: Pick, tagId: string): boolean {
  return pick.path.hops.some((hop) => hop.kind === 'theme' && (hop.tags ?? []).includes(tagId));
}

export function tagMembers(tagId: string, picks: readonly Pick[]): TagMembers {
  const seeds: TagSeed[] = [];
  const seen = new Set<string>();
  const members: Pick[] = [];
  for (const pick of picks) {
    if (!pickHasTag(pick, tagId)) continue;
    members.push(pick);
    const seedId = pick.path.seedId;
    if (seen.has(seedId)) continue;
    seen.add(seedId);
    // A path with no seed hop has no name to show, so the seed is left out rather than shown as an id.
    const seedHop = pick.path.hops.find((hop) => hop.kind === 'seed');
    if (seedHop) seeds.push({ id: seedId, label: seedHop.label });
  }
  return { seeds, picks: members };
}
