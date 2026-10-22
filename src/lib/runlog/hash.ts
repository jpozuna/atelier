// The profile hash: a stable id for "this person's seeds and profile", so a re-run finds the run that showed a pick
// and signals can be grouped by profile without storing a name. sha256 hex of the sorted seed (id, entity id) pairs and
// the sorted profile tag ids. The user's own words are left out so a small edit to a reason does not split a profile.

import { createHash } from "node:crypto";

export interface HashInput {
  seeds: readonly { id: string; qlooId: string | null }[];
  /** Tag ids of the profile (`profile.tags[].tag`). */
  tagIds: readonly string[];
}

export function hashProfile(input: HashInput): string {
  const seeds = input.seeds.map((s) => [s.id, s.qlooId ?? ""] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const tags = [...new Set(input.tagIds)].sort();
  return createHash("sha256").update(JSON.stringify({ seeds, tags })).digest("hex");
}
