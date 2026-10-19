import type { Field } from './field';

export const PROFILE_TAG_SOURCES = ['taste_analysis', 'seed_detail', 'why_search'] as const;
export type ProfileTagSource = (typeof PROFILE_TAG_SOURCES)[number];

/** A taste tag. `tag` is always a real Qloo tag id, never invented. */
export interface ProfileTag {
  /** Qloo tag id. */
  tag: string;
  /** Qloo's tag name. */
  name: string;
  /** Qloo tag type (`subtype` from taste analysis: theme, style, emotional_tone, ...). Axes group by this. */
  tagType: string;
  /** `query.affinity` from taste analysis, 0 to 1. */
  affinity: number;
  /** Entity types the tag applies to (the tag's `types`). A tag spanning two types is a bridge tag. */
  types: string[];
  /** Profile weight, derived in code from affinity and seed frequency. */
  weight: number;
  /** Fields of the seeds that carry this tag. */
  fields: Field[];
  source: ProfileTagSource;
  /**
   * Bridge tag: its `types` include at least one entity type other than the seed's own, so it can carry a theme
   * across fields. Computed in code per seed; absent when not yet computed.
   */
  bridge?: boolean;
  /** Inverse frequency in a candidate pool, 0 to 1. Pool-relative, so absent on a bare profile tag. */
  rarity?: number;
}

/** A cross-domain axis, grounded in its member tags. */
export interface Axis {
  id: string;
  /** Named by the model from the member tags only. */
  label: string;
  /** Why the label follows from the member tags (names the tags it is derived from). Required. */
  labelJustification: string;
  weight: number;
  /** The Qloo tag type the axis groups. */
  tagType: string;
  /** Member tags, so the chart can show what the axis is made of. At least 2. */
  tags: ProfileTag[];
}
