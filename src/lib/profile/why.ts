// Mapping a "why" to tags: ONE semantic /v2/tags call (cached by the client), scoped to the seed's entity type.
// Made at onboarding when the user submits the why; the result travels with the seed into the profile build.

import type { Field } from "@/types";
import type { QlooResponse, TagItem, TagsParams } from "@/lib/qloo/types";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { MAX_TAG_NAME_CHARS, MAX_WHY_CHARS, WHY_TAGS_PER_SEED, WHY_TAKE } from "./constants";
import { isTagId, isTagType, nameKey, tagTypeFromId } from "./tags";
import type { WhyTag } from "./types";

/** The only client method a why lookup uses. */
export interface WhyClient {
  tags(params: TagsParams): Promise<QlooResponse<TagItem>>;
}

export function cleanWhy(why: string): string {
  return why.replace(/\s+/g, " ").trim().slice(0, MAX_WHY_CHARS).trim();
}

/** Qloo tag items to WhyTags: ids and types must be well-formed, same name collapses, at most WHY_TAGS_PER_SEED, Qloo's order. */
export function toWhyTags(items: readonly TagItem[]): WhyTag[] {
  const seen = new Set<string>();
  const out: WhyTag[] = [];
  for (const it of items) {
    if (out.length >= WHY_TAGS_PER_SEED) break;
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const tagType = (isTagType(it.type) && it.type) || (isTagId(it.id) ? tagTypeFromId(it.id) : undefined);
    const nk = nameKey(name);
    if (!isTagId(it.id) || !name || name.length > MAX_TAG_NAME_CHARS || !tagType || !nk || seen.has(nk)) continue;
    seen.add(nk);
    out.push({ tag: it.id, name, tagType });
  }
  return out;
}

/** One /v2/tags call. An empty result is a valid answer: nothing matched. Errors throw (the handler decides). */
export async function mapWhy(client: WhyClient, input: { field: Field; why: string }): Promise<WhyTag[]> {
  const res = await client.tags({
    "filter.query": cleanWhy(input.why),
    "feature.semantic_search": true,
    "filter.parents.types": FIELD_SEARCH_TYPE[input.field],
    take: WHY_TAKE,
  });
  return res.outcome === "ok" ? toWhyTags(res.items) : [];
}
