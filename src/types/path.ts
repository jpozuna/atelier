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
}

export const ANCHOR_SOURCES = ['qloo_explainability', 'tag_overlap'] as const;
export type AnchorSource = (typeof ANCHOR_SOURCES)[number];

export interface PathAnchor {
  /** Explainability contribution, 0 to 1. Null when the anchor came from tag overlap. */
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
}
