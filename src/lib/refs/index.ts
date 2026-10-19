// Reference layer. `getReferences(entity, ctx)` returns sourced lineage hops and, at most, one reading, from data
// already fetched (Qloo item properties) plus Wikidata. It makes no Qloo call. It returns nothing when nothing was
// retrieved. Inferred hops are never produced here: sourced and inferred stay separate (hard rule 6).

import "server-only";

import { foldName, qlooLineage, wikidataIdOf } from "./lineage";
import { readingFor } from "./reading";
import type { LineageRef, References, RefsEntity } from "./types";
import { createWikidataClient, wikidataAppliesTo, type WikidataClient, type WikidataClientOptions } from "./wikidata";

export type { BlockState, FetchLike, WikidataCache, WikidataClient, WikidataClientOptions } from "./wikidata";
export { createMemoryCache, isRealContact, resetSharedBlock, wikidataAppliesTo } from "./wikidata";
export { REFS_LIMITS } from "./limits";
export type * from "./types";

/** State for one run: the Wikidata lookup budget (at most 6 finalists), the request log and the cache. */
export interface RefsContext {
  readonly wikidata: WikidataClient;
}

export function createRefsContext(opts: WikidataClientOptions = {}): RefsContext {
  return { wikidata: createWikidataClient(opts) };
}

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * Pass finalists only, with ONE context per run (T-08 and T-10: create it when the run starts and reuse it for every
 * finalist), so the per-run cap, the serial queue, the deadline and the block state apply. `seedNames` (the user's
 * resolved seed names) puts seed-matching related names first in a hop label; matching itself uses the full list.
 * Never throws for a Wikidata problem: the result simply has fewer hops.
 */
export async function getReferences(
  entity: RefsEntity,
  ctx: RefsContext,
  opts: { seedNames?: readonly string[] } = {},
): Promise<References> {
  const seedNames = opts.seedNames ?? [];
  const lineage: LineageRef[] = qlooLineage(entity, seedNames);
  let wikidata: References["wikidata"] = "not_applicable";
  if (wikidataAppliesTo(entity.field)) {
    const id = wikidataIdOf(entity);
    if (id) {
      const found = await ctx.wikidata.lookup(id, entity.field, seedNames);
      wikidata = found.status;
      lineage.push(...found.lineage);
    } else {
      wikidata = "no_id";
    }
  }
  const reading = readingFor(entity);
  return {
    qlooId: entity.qlooId,
    field: entity.field,
    lineage,
    ...(reading ? { reading } : {}),
    sourceUrls: unique([...lineage.map((l) => l.hop.sourceUrl ?? ""), ...(reading ? [reading.sourceUrl] : [])].filter(Boolean)),
    wikidata,
  };
}

/** Fields for the `fetch_refs` trace event. The loop adds `t`, `say` and `pickIds`. Refs never produce inferred hops. */
export function refsTraceFields(all: readonly References[]): { sourcedCount: number; inferredCount: number; sourceUrls: string[] } {
  return {
    sourcedCount: all.reduce((n, r) => n + r.lineage.length, 0),
    inferredCount: 0,
    sourceUrls: unique(all.flatMap((r) => r.sourceUrls)),
  };
}

/**
 * Hops whose full related-name list (`allNames`, not the 3 shown) includes one of the given seed names, matched
 * after case and punctuation folding. A hop that touches a seed makes the path's lineage link; the path assembler
 * decides which one to store (at most one per path).
 */
export function lineageTouchingSeeds(refs: References, seedNames: readonly string[]): LineageRef[] {
  const seeds = new Set(seedNames.map(foldName).filter(Boolean));
  return refs.lineage.filter((l) => l.allNames.some((n) => seeds.has(foldName(n))));
}
