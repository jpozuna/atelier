import type { Provenance } from './field';

export const HOP_KINDS = ['seed', 'theme', 'lineage', 'pick'] as const;
export type HopKind = (typeof HOP_KINDS)[number];

export interface PathHop {
  kind: HopKind;
  label: string;
  /** Tag ids, for theme hops. */
  tags?: string[];
  provenance: Provenance;
  /** Required when `provenance` is `sourced`. */
  sourceUrl?: string;
  /**
   * Set when the source has no page of its own (Qloo has no per-entity page). The UI shows "Source: <label>"
   * as text and never links `sourceUrl`, which then only satisfies the non-empty contract.
   */
  sourceLabel?: string;
}

export const ANCHOR_SOURCES = ['qloo_explainability', 'tag_overlap'] as const;
export type AnchorSource = (typeof ANCHOR_SOURCES)[number];

export interface PathAnchor {
  /**
   * Explainability contribution, 0 to 1. Null when the anchor came from tag overlap, and also null on every
   * public path: `/api/run` strips it before the browser (hard rule 7).
   */
  contribution: number | null;
  source: AnchorSource;
  /** True when the top contribution is below the minimum anchor contribution (loosely tied to any one seed). */
  thin?: boolean;
}

/** seed -> shared theme -> [lineage hop] -> pick. The explanation is generated from this and nothing else. */
export interface Path {
  seedId: string;
  anchor: PathAnchor;
  /** In order: seed, theme, optional lineage, pick. */
  hops: PathHop[];
  /** Tag ids shared by the seed side and the pick. */
  sharedTags: string[];
  /** At least one shared tag at or above the distinctive rarity, or a sourced lineage hop. */
  distinctive: boolean;
  /** Up to 3 tag ids the pick carries and the seed side does not (Qloo tags), so "what is different" has grounded content. */
  pickOnlyTags?: string[];
  /** Plain distance words computed in code, never numbers. The explanation may use them; the UI may show them as words. */
  distance?: DistanceHint[];
}

export const DISTANCE_HINTS = ['other_field', 'farther_from_tags', 'less_familiar'] as const;
export type DistanceHint = (typeof DISTANCE_HINTS)[number];
