// Builds sourced lineage hops from relation names. Pure: no network, no Qloo calls. The hop label is made only from
// the retrieved names and a fixed relation phrase, so nothing in it is inferred.

import type { Field } from "@/types";
import { LICENSES, QLOO_SOURCE_URL, REFS_LIMITS, SOURCE_LABELS } from "./limits";
import type { LineageRef, LineageRelation, LineageSource, RefsEntity } from "./types";

/** `A`, `A and B`, `A, B and C`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const PHRASES: Record<LineageRelation, (names: string) => string> = {
  influenced_by: (n) => `Influenced by ${n}`,
  influenced: (n) => `Influenced ${n}`,
  genres_influenced: (n) => `Influenced the genres ${n}`,
  influenced_other_media: (n) => `Influenced other media: ${n}`,
  similar_brands: (n) => `Listed as a similar brand to ${n}`,
  based_on: (n) => `Based on ${n}`,
  inspired_by: (n) => `Inspired by ${n}`,
};

/** Case, accent and punctuation folded, for comparing a related name with a seed name. */
export const foldName = (s: string): string =>
  s.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/**
 * The one place a lineage hop is built. `sourceUrl` is required: a sourced hop without a link is a bug. All names
 * are kept in `allNames` for seed matching; the label shows at most MAX_NAMES_PER_HOP, seed matches first (stable,
 * so the rest stay in source order).
 */
export function buildLineageRef(
  source: LineageSource,
  relation: LineageRelation,
  names: readonly string[],
  sourceUrl: string,
  seedNames: readonly string[] = [],
): LineageRef | null {
  if (names.length === 0 || !sourceUrl) return null;
  const seeds = new Set(seedNames.map(foldName).filter(Boolean));
  const isSeed = (n: string) => seeds.has(foldName(n));
  const shown = [...names.filter(isSeed), ...names.filter((n) => !isSeed(n))].slice(0, REFS_LIMITS.MAX_NAMES_PER_HOP);
  return {
    source,
    relation,
    names: shown,
    allNames: [...names],
    hop: {
      kind: "lineage",
      label: PHRASES[relation](joinNames(shown)),
      provenance: "sourced",
      sourceUrl,
    },
    license: LICENSES[source],
    sourceLabel: SOURCE_LABELS[source],
  };
}

/** Qloo property that feeds each relation, per field. Only these are read; books and places have none. */
const QLOO_FIELDS: Partial<Record<Field, readonly { property: string; relation: LineageRelation }[]>> = {
  music: [
    { property: "influenced_by", relation: "influenced_by" },
    { property: "artists_influenced", relation: "influenced" },
    { property: "genres_influenced", relation: "genres_influenced" },
  ],
  film: [{ property: "influenced_other_media", relation: "influenced_other_media" }],
  tv: [{ property: "influenced_other_media", relation: "influenced_other_media" }],
  fashion: [{ property: "similar_brands", relation: "similar_brands" }],
};

/** Names from a retrieved value: a string, an array of strings, or objects with `name`, `title` or `label`. */
export function namesFromValue(value: unknown, selfName?: string): string[] {
  const raw: unknown[] = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: string[] = [];
  const self = selfName?.trim().toLowerCase();
  for (const item of raw) {
    let name: unknown = item;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      name = o.name ?? o.title ?? o.label;
    }
    if (typeof name !== "string") continue;
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || clean.toLowerCase() === self) continue;
    if (out.some((n) => n.toLowerCase() === clean.toLowerCase())) continue;
    out.push(clean);
  }
  return out;
}

/** Sourced lineage hops from the item's own properties. Reads data already fetched. */
export function qlooLineage(entity: RefsEntity, seedNames: readonly string[] = []): LineageRef[] {
  const specs = QLOO_FIELDS[entity.field];
  const props = entity.properties;
  if (!specs || !props) return [];
  const out: LineageRef[] = [];
  for (const spec of specs) {
    const ref = buildLineageRef(
      "qloo",
      spec.relation,
      namesFromValue(props[spec.property], entity.name),
      QLOO_SOURCE_URL,
      seedNames,
    );
    if (ref) out.push(ref);
  }
  return out;
}

const QID = /^Q[1-9]\d*$/;
export const isWikidataId = (v: unknown): v is string => typeof v === "string" && QID.test(v);

function idsFromExternal(external: unknown): string[] {
  const wd = external && typeof external === "object" ? (external as Record<string, unknown>).wikidata : undefined;
  const items: unknown[] = Array.isArray(wd) ? wd : wd ? [wd] : [];
  const ids: string[] = [];
  for (const it of items) {
    const id = it && typeof it === "object" ? (it as Record<string, unknown>).id : it;
    if (isWikidataId(id)) ids.push(id);
  }
  return ids;
}

/** The entity's Wikidata id from data already fetched: `properties.wikidata_id`, then `external.wikidata[].id`. */
export function wikidataIdOf(entity: RefsEntity): string | null {
  const direct = entity.properties?.wikidata_id;
  if (isWikidataId(direct)) return direct;
  return idsFromExternal(entity.external)[0] ?? idsFromExternal(entity.properties?.external)[0] ?? null;
}
