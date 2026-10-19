import type { CardReading, Field, PathHop } from "@/types";

/**
 * The entity to look up. Built by the caller from an item it already fetched (`/v2/insights` entity or a search
 * item). Nothing here triggers a Qloo call.
 */
export interface RefsEntity {
  qlooId: string;
  name: string;
  field: Field;
  /** The item's `properties` (lineage and text fields live here). */
  properties?: Record<string, unknown>;
  /** The item's top-level `external` (insights items). Search items carry it under `properties.external`. */
  external?: Record<string, unknown>;
}

export type LineageSource = "qloo" | "wikidata";

export const LINEAGE_RELATIONS = [
  "influenced_by",
  "influenced",
  "genres_influenced",
  "influenced_other_media",
  "similar_brands",
  "based_on",
  "inspired_by",
] as const;
export type LineageRelation = (typeof LINEAGE_RELATIONS)[number];

/** One sourced lineage hop. It is never inferred, and never merged with an inferred hop. */
export interface LineageRef {
  source: LineageSource;
  relation: LineageRelation;
  /** The names shown in the hop label (at most MAX_NAMES_PER_HOP): seed matches first, then source order. */
  names: string[];
  /** Every related name retrieved, in source order. Use this, not `names`, to match against seeds. */
  allNames: string[];
  /** Ready for `Path.hops`: kind `lineage`, provenance `sourced`, `sourceUrl` set. */
  hop: PathHop;
  /** License or credit note for the source. The UI shows it with the source. */
  license: string;
  /** What the UI prints after "Source:". For `qloo` render "Source: Qloo" with NO link (`hop.sourceUrl` is a placeholder). */
  sourceLabel?: string;
}

/** An excerpt of retrieved text (markup stripped, cut at a sentence end). A reading, not a fact: the UI labels it so. */
export interface Reading extends CardReading {
  /** Always "a reading". Present so no consumer has to remember to label it. */
  label: "a reading";
  source: LineageSource;
  license: string;
  /** "Qloo": render "Source: Qloo" with no link; `sourceUrl` is a placeholder for the non-empty contract. */
  sourceLabel?: string;
}

export const WIKIDATA_STATUSES = [
  "ok",
  "cached",
  /** The field has no lineage (books, places), or Wikidata is not a lineage source for it. */
  "not_applicable",
  "no_id",
  /** ATELIER_CONTACT is unset or a placeholder. Wikidata is skipped entirely, never called with a contactless User-Agent. */
  "no_contact",
  /** The per-run lookup cap was reached. */
  "budget_exhausted",
  /** Network error, timeout, 429, 503, maxlag, deadline or unparseable body. Nothing is returned for it. */
  "unavailable",
] as const;
export type WikidataStatus = (typeof WIKIDATA_STATUSES)[number];

export interface References {
  qlooId: string;
  field: Field;
  /** Sourced lineage hops, Qloo's first (in the order of its fields), then Wikidata's. Empty when nothing was retrieved. */
  lineage: LineageRef[];
  /** At most one. Absent when no retrieved text supports it. */
  reading?: Reading;
  /** Every source link used by `lineage` and `reading`, deduplicated. For `fetch_refs.sourceUrls`. */
  sourceUrls: string[];
  wikidata: WikidataStatus;
}
