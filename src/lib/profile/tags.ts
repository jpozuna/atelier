// Turning Qloo's tags into profile tags. Pure code, no network. Every tag id comes from a Qloo item;
// nothing here invents one.
//
// `ProfileTag.fields`: the fields of the seeds whose entity type the tag applies to (its `types` includes that
// field's entity type), plus, for a why tag, the field of the seed whose why matched it. It is empty when the tag
// applies only to fields outside the seeds.
//
// Bridge rule: a tag is a bridge when its `types` include at least one Atelier entity type (the six field types)
// that none of the submitted seeds has. Such a tag can carry a theme into a field the user has not shown yet.

import type { Field, ProfileTag, Seed } from "@/types";
import type { TasteTag } from "@/lib/qloo/types";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { GENERIC_DROP_TOP_SHARE, GENERIC_MIN_POOL, MAX_TAG_ID_CHARS, WHY_TAG_WEIGHT } from "@/lib/agent/config";
import type { ProfileSeed, WhyTag } from "./types";

const TAG_PREFIX = "urn:tag:";
const TAG_TYPE_RE = /^urn:tag:[^:\s]+:[^:\s]+$/;

/** Lower-case, accent-free, single-spaced form used to dedupe tags by name. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** `urn:tag:<kind>:<namespace>:<value>` -> `urn:tag:<kind>:<namespace>`; undefined for any other shape. */
export function tagTypeFromId(tagId: string): string | undefined {
  const parts = tagId.split(":");
  return parts.length >= 5 && tagId.startsWith(TAG_PREFIX) ? parts.slice(0, 4).join(":") : undefined;
}

export const isTagId = (v: unknown): v is string => typeof v === "string" && v.startsWith(TAG_PREFIX) && v.length > TAG_PREFIX.length;
export const isTagType = (v: unknown): v is string => typeof v === "string" && TAG_TYPE_RE.test(v);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const ATELIER_TYPES: ReadonlySet<string> = new Set(Object.values(FIELD_SEARCH_TYPE));

/** The Atelier entity type of each seed's field. */
export function seedEntityTypes(seeds: readonly Pick<Seed, "field">[]): Set<string> {
  return new Set(seeds.map((s) => FIELD_SEARCH_TYPE[s.field]));
}

/** Seed fields whose entity type the tag applies to. */
function fieldsFor(types: readonly string[], seeds: readonly Pick<Seed, "field">[]): Field[] {
  const out: Field[] = [];
  for (const s of seeds) {
    if (types.includes(FIELD_SEARCH_TYPE[s.field]) && !out.includes(s.field)) out.push(s.field);
  }
  return out;
}

/** Bridge: `types` include at least one Atelier entity type that none of the seeds has. */
export function isBridge(types: readonly string[], seedTypes: ReadonlySet<string>): boolean {
  return types.some((t) => ATELIER_TYPES.has(t) && !seedTypes.has(t));
}

export interface ParsedTaste {
  tags: ProfileTag[];
  /** Qloo `popularity` per tag id. Missing or 0 means unknown. */
  popularity: Map<string, number>;
  /** Items skipped for no id, no name, no tag type or no affinity. */
  skipped: number;
}

/** Taste-analysis items to profile tags (weight = query.affinity, 0 to 1). */
export function parseTasteTags(items: readonly TasteTag[], seeds: readonly Pick<Seed, "field">[]): ParsedTaste {
  const seedTypes = seedEntityTypes(seeds);
  const byId = new Map<string, ProfileTag>();
  const popularity = new Map<string, number>();
  let skipped = 0;
  for (const it of items) {
    const id = it.tag_id;
    const tagType = (typeof it.subtype === "string" && it.subtype) || (typeof id === "string" ? tagTypeFromId(id) : undefined);
    const affinity = it.query?.affinity;
    if (!isTagId(id) || !it.name?.trim() || !tagType || !isNum(affinity)) {
      skipped++;
      continue;
    }
    const a = clamp01(affinity);
    const prior = byId.get(id);
    if (prior && prior.affinity >= a) continue;
    const types = Array.isArray(it.types) ? it.types.filter((t): t is string => typeof t === "string") : [];
    byId.set(id, {
      tag: id,
      name: it.name.trim(),
      tagType,
      affinity: a,
      types,
      weight: a,
      fields: fieldsFor(types, seeds),
      source: "taste_analysis",
      bridge: isBridge(types, seedTypes),
    });
    if (isNum(it.popularity)) popularity.set(id, it.popularity);
  }
  return { tags: [...byId.values()], popularity, skipped };
}

/**
 * Drop generic tags by rank. Among taste-analysis tags with a known popularity (above 0), the top
 * GENERIC_DROP_TOP_SHARE by popularity are dropped; ties go to the lower affinity first, then the tag id. Nothing
 * is dropped when fewer than GENERIC_MIN_POOL tags have a known popularity. Tags with unknown popularity are kept.
 */
export function dropGeneric(tags: readonly ProfileTag[], popularity: ReadonlyMap<string, number>): { kept: ProfileTag[]; dropped: ProfileTag[] } {
  const known = tags.filter((t) => (popularity.get(t.tag) ?? 0) > 0);
  if (known.length < GENERIC_MIN_POOL) return { kept: [...tags], dropped: [] };
  const ranked = [...known].sort(
    (a, b) => (popularity.get(b.tag) ?? 0) - (popularity.get(a.tag) ?? 0) || a.affinity - b.affinity || a.tag.localeCompare(b.tag),
  );
  const drop = new Set(ranked.slice(0, Math.floor(known.length * GENERIC_DROP_TOP_SHARE)).map((t) => t.tag));
  return { kept: tags.filter((t) => !drop.has(t.tag)), dropped: tags.filter((t) => drop.has(t.tag)) };
}

/**
 * Add the why tags each seed carries to the kept pool. They are exempt from generic dropping and never ranked with
 * taste tags. Same name within a seed collapses; a tag already in the pool keeps its taste-analysis entry and gains
 * the seed's field. A new one enters with `affinity: 0` (Qloo gave none) and weight WHY_TAG_WEIGHT. Returns the tag
 * ids each seed contributed.
 */
export function mergeWhyTags(pool: ProfileTag[], seeds: readonly ProfileSeed[]): Map<string, string[]> {
  const matched = new Map<string, string[]>();
  const byId = new Map(pool.map((t) => [t.tag, t]));
  for (const seed of seeds) {
    if (!seed.whyTags) continue;
    const seenNames = new Set<string>();
    const ids: string[] = [];
    for (const w of seed.whyTags) {
      const nk = nameKey(w.name);
      if (!nk || seenNames.has(nk)) continue;
      seenNames.add(nk);
      ids.push(w.tag);
      const existing = byId.get(w.tag);
      if (existing) {
        if (!existing.fields.includes(seed.field)) existing.fields = [...existing.fields, seed.field];
        continue;
      }
      const tag: ProfileTag = {
        tag: w.tag,
        name: w.name,
        tagType: w.tagType,
        affinity: 0,
        types: [FIELD_SEARCH_TYPE[seed.field]],
        weight: WHY_TAG_WEIGHT,
        fields: [seed.field],
        source: "why_search",
        bridge: false,
      };
      byId.set(w.tag, tag);
      pool.push(tag);
    }
    matched.set(seed.id, ids);
  }
  return matched;
}

/** Weight descending, then name, then id, so order is stable. */
export function byWeight(a: ProfileTag, b: ProfileTag): number {
  return b.weight - a.weight || a.name.localeCompare(b.name) || a.tag.localeCompare(b.tag);
}

/** Validate and trim tags carried on a request seed. Returns null when any entry is malformed. */
export function cleanWhyTags(raw: unknown, max: number, maxName: number): WhyTag[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: WhyTag[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") return null;
    const { tag, name, tagType } = w as Record<string, unknown>;
    if (!isTagId(tag) || tag.length > MAX_TAG_ID_CHARS || typeof name !== "string" || !name.trim() || name.length > maxName || !isTagType(tagType)) return null;
    out.push({ tag, name: name.trim(), tagType });
  }
  return out;
}
