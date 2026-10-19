import type { Band, Field, Origin } from './field';
import type { Path } from './path';

export const REACTION_STATES = ['later', 'will_try', 'explore', 'not_interested', 'tried'] as const;
export type ReactionState = (typeof REACTION_STATES)[number];

export interface Reaction {
  state: ReactionState;
  words?: string;
  /** ISO time. */
  at: string;
}

export interface CardReading {
  text: string;
  /** Retrieved source. A reading is sourced and always labeled a reading in the UI. */
  sourceUrl: string;
}

export interface ProvenanceCounts {
  sourced: number;
  inferred: number;
}

/** Four parts: path, why, different, provenance. Plus an optional reading and the user's reaction. */
export interface Card {
  /** 1. The path. */
  path: Path;
  /** 2. Why this one, from the path only. */
  why: string;
  /** 3. What is different, from the reach parts. */
  different: string;
  /** 4. Summary of hop provenance; per-hop detail is in the path. Must equal the hop counts. */
  provenance: ProvenanceCounts;
  reading?: CardReading;
  reaction?: Reaction;
}

/** Computed in code. Reach is a position on the frontier, not a quality score. */
export interface ReachParts {
  tagDistance: number;
  obscurity: number;
  fieldUnfamiliarity: number;
  reach: number;
}

export interface Pick {
  id: string;
  qlooId: string;
  name: string;
  field: Field;
  popularity: number;
  reach: ReachParts;
  connection: number;
  band: Band;
  /** True when the field has no Qloo coverage; everything is then `inferred`. */
  llmBridged: boolean;
  /** `unknown` unless T-08 derived primary vs backfill (Qloo returns no backfill marker). */
  origin: Origin;
  path: Path;
  card: Card;
}
