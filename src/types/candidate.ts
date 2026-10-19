import type { Field, Origin } from './field';

export interface CandidateTag {
  /** `id` in insights, `tag_id` in search; normalised to `id` here. */
  id: string;
  name: string;
  type: string;
}

/** One input entity's contribution to a result (`feature.explainability`), 0 to 1. */
export interface ExplainabilityEntry {
  entityId: string;
  score: number;
}

/** A normalised `/v2/insights` result, before scoring. */
export interface Candidate {
  qlooId: string;
  name: string;
  field: Field;
  /** Qloo entity type urn, e.g. the insights `subtype`. */
  entityType: string;
  /** 0 to 1. */
  popularity: number;
  tags: CandidateTag[];
  /** `query.affinity`, when present. */
  affinity?: number;
  /** Top-level explainability per input entity, when it came back. */
  explainability?: ExplainabilityEntry[];
  /** `unknown` by default: Qloo returns no backfill marker (spike). Only T-08 may derive primary vs backfill. */
  origin: Origin;
  /** Lineage hints from Qloo properties (influenced_by, influenced_other_media, similar_brands), names only. */
  lineage?: string[];
}
