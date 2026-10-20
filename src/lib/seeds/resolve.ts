// Seed resolution: one typed thing plus its field -> a clean entity, a short candidate list, or missing.
// Exactly one /search call per resolve (take <= 10), through the Qloo client only. Repeats are served by the
// client's private cache (0 live calls).

import type { Field } from "@/types";
import type { QlooResponse, SearchItem, SearchParams } from "@/lib/qloo/types";
import { toChip } from "./chip";
import { MAX_CANDIDATES, SEARCH_TAKE } from "@/lib/agent/config";
import { FIELD_SEARCH_TYPE, LOCATION_FIELDS } from "./field-types";
import { placesLocation } from "./places";
import type { ResolveResult, SeedChip } from "./types";

/** The only client method resolution uses. */
export interface SearchClient {
  search(params: SearchParams): Promise<QlooResponse<SearchItem>>;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Collapse whitespace so "  A   B " and "A B" send (and cache) the same query. */
export function cleanQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/** Comparison form of a name: no diacritics, case, punctuation or leading article. */
export function nameKey(s: string): string {
  const base = s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const noArticle = base.replace(/^(the|a|an) /, "");
  return noArticle || base;
}

export async function resolveSeed(
  client: SearchClient,
  input: { field: Field; query: string },
  env: Env = process.env,
): Promise<ResolveResult> {
  const query = cleanQuery(input.query);
  const type = FIELD_SEARCH_TYPE[input.field];
  const place = LOCATION_FIELDS.has(input.field) ? placesLocation(env) : null;
  const params: SearchParams = {
    query,
    types: [type],
    take: SEARCH_TAKE,
    ...(place ? { "filter.location": place.location, "filter.radius": place.radius } : {}),
  };

  const res = await client.search(params);
  if (res.outcome === "empty") return { status: "missing", candidates: [] };

  // Scope defensively to the field's type, drop unusable items, dedupe by id. Qloo order (relevance) is kept.
  const seen = new Set<string>();
  const chips: SeedChip[] = [];
  for (const item of res.items) {
    if (item.types?.length && !item.types.includes(type)) continue;
    const chip = toChip(item, type);
    if (!chip || seen.has(chip.qlooId)) continue;
    seen.add(chip.qlooId);
    chips.push(chip);
  }
  if (!chips.length) return { status: "missing", candidates: [] };

  const want = nameKey(query);
  const exact = chips.filter((c) => nameKey(c.name) === want);
  if (exact.length === 1) return { status: "clean", entity: exact[0], candidates: [] };

  // Several exact-name matches, or none: the user chooses. Exact matches lead, relevance order otherwise.
  const rest = chips.filter((c) => !exact.includes(c));
  return { status: "ambiguous", candidates: [...exact, ...rest].slice(0, MAX_CANDIDATES) };
}
