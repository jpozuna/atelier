import type { SearchItem } from "@/lib/qloo/types";
import { MAX_DISAMBIGUATION_CHARS } from "@/lib/agent/config";
import type { SeedChip } from "./types";

// /search item property names for a release year are not documented (the spike lists only insights fields), so
// several likely names are tried. Anything that does not hold a plausible 4-digit year is ignored.
const YEAR_KEYS = ["release_year", "release_date", "publication_year", "publication_date", "first_air_date", "year", "founded_year", "launch_year"];
const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;

function yearOf(props: Record<string, unknown> | undefined): number | undefined {
  if (!props) return undefined;
  for (const k of YEAR_KEYS) {
    const v = props[k];
    const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
    const m = YEAR.exec(s);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function imageOf(props: Record<string, unknown> | undefined): string | undefined {
  const img = props?.image;
  const url = typeof img === "string" ? img : img && typeof img === "object" ? (img as Record<string, unknown>).url : undefined;
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function shortType(urn: string | undefined): string {
  return typeof urn === "string" && urn.startsWith("urn:entity:") ? urn.slice("urn:entity:".length) : "entity";
}

/**
 * The fields a chip needs, taken from a /search item. Returns null when the item has no usable name or id.
 * `fieldType` is the entity type the search was scoped to; it wins over `item.types[0]`, which can differ.
 */
export function toChip(item: SearchItem, fieldType?: string): SeedChip | null {
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name || typeof item.entity_id !== "string" || !item.entity_id) return null;
  const year = yearOf(item.properties);
  const dis = typeof item.disambiguation === "string" ? item.disambiguation.trim().slice(0, MAX_DISAMBIGUATION_CHARS) : "";
  const detail = [year, dis].filter(Boolean).join(", ");
  const imageUrl = imageOf(item.properties);
  return {
    qlooId: item.entity_id,
    name,
    type: shortType(fieldType ?? item.types?.[0]),
    label: detail ? `${name} (${detail})` : name,
    ...(year !== undefined ? { year } : {}),
    ...(dis ? { disambiguation: dis } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}
