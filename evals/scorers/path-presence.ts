// path-presence: every pick has a stored path from a seed to the pick (seed, theme, optional lineage, pick, in that
// order), and the path has non-empty shared tags or a lineage hop. A path made of nothing but a seed and a pick
// would be an explanation with no grounds. Also checked:
//   - the card carries the stored path, not another one (hard rule 5: the explanation is generated from the path
//     that is stored), so `card.path` must equal `pick.path`;
//   - the pick hop names the pick;
//   - when the result lists `seeds`, the path's seed is one of them, resolved clean (an ambiguous or missing seed
//     cannot anchor a path), and the seed hop's label is that seed's own words.
// The seed checks need `seeds`. A live RunResult has none (`audit.seedIds` are Qloo entity ids, not the request
// seed ids a path names), so on a case without them the seed checks are "not verifiable": a failure on a live case,
// a note on a synthetic legacy one.

import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";
import { finish, fold, isObj, list, nonEmpty, pickLabel, withResult } from "./_shared";

/** Hop kinds in the order the contract allows. */
const ORDERS = ["seed>theme>pick", "seed>theme>lineage>pick"];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

export function scorePathPresence(input: CaseInput): ScorerResult {
  return withResult(input, (r) => {
    const reasons: string[] = [];
    const unverified: string[] = [];
    const seedsById = new Map<string, { status: string; typed: string }>();
    for (const s of r.seeds ?? []) {
      if (nonEmpty(s.id)) seedsById.set(s.id, { status: nonEmpty(s.status) ? s.status : "unknown", typed: nonEmpty(s.typed) ? s.typed : "" });
    }
    if (r.seeds === null) unverified.push("the result lists no seeds, so each path's seed and its hop label cannot be matched");

    let checked = 0;
    for (const d of r.domains) {
      for (const pick of d.picks) {
        checked++;
        const who = pickLabel(d.domain, pick);
        const path = pick.path;
        if (!isObj(path)) {
          reasons.push(`${who}: no stored path`);
          continue;
        }
        const card = isObj(pick.card) ? pick.card : null;
        if (card && !deepEqual(card.path, path)) reasons.push(`${who}: card.path differs from the stored path; the card must carry the path that is stored`);

        const hops = list(path.hops).filter(isObj);
        if (!nonEmpty(path.seedId)) reasons.push(`${who}: the path names no seed`);
        else if (r.seeds !== null) {
          const seed = seedsById.get(path.seedId);
          if (!seed) reasons.push(`${who}: the path starts at a seed that is not one of the run's seeds`);
          else {
            if (seed.status !== "clean") reasons.push(`${who}: the path starts at a seed that resolved ${seed.status}; only a clean seed can anchor a path`);
            const first = hops[0];
            if (first && first.kind === "seed" && seed.typed && fold(String(first.label ?? "")) !== fold(seed.typed)) {
              reasons.push(`${who}: the seed hop's label does not match the seed the path names (${path.seedId})`);
            }
          }
        }

        const kinds = hops.map((h) => String(h.kind)).join(">");
        if (hops.length === 0) reasons.push(`${who}: the path has no hops`);
        else if (!ORDERS.includes(kinds)) reasons.push(`${who}: the path hops run ${kinds || "(none)"}; they must run seed, theme, optional lineage, pick`);
        const last = hops[hops.length - 1];
        if (last && last.kind === "pick" && nonEmpty(pick.name) && fold(String(last.label ?? "")) !== fold(pick.name)) {
          reasons.push(`${who}: the pick hop's label is not the pick`);
        }
        const tags = list(path.sharedTags).filter(nonEmpty);
        const lineage = hops.some((h) => h.kind === "lineage");
        if (tags.length === 0 && !lineage) reasons.push(`${who}: no shared tags and no lineage hop, so nothing connects the seed to the pick`);
      }
    }
    return finish(input, reasons, unverified, `${checked} pick(s) each have a seed-to-pick path with shared tags or a lineage hop, carried unchanged on the card`);
  });
}

export const pathPresence: TraceScorer = {
  kind: "trace",
  name: "path-presence",
  description: "Every pick has a stored path (seed, theme, optional lineage, pick) with shared tags or a lineage hop, and the card carries that path.",
  score: scorePathPresence,
};
