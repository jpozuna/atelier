import type { Band, Field } from './field';
import type { SeedStatus } from './seed';

export const QLOO_ENDPOINTS = ['/search', '/v2/tags', '/v2/insights', '/entities'] as const;
/** Hackathon-host endpoints the client may call. Never `/recommendations` or `/recs`. */
export type QlooEndpoint = (typeof QLOO_ENDPOINTS)[number];

export const REQUERY_REASONS = ['too_obvious', 'too_weak', 'empty', 'weak_connection'] as const;
export type RequeryReason = (typeof REQUERY_REASONS)[number];

/** Fields every trace event carries. One JSON object per line. */
interface TraceBase {
  /** ISO time. */
  t: string;
  /** A human sentence for the reasoning panel. */
  say: string;
}

export interface QlooCallEvent extends TraceBase {
  kind: 'qloo_call';
  endpoint: QlooEndpoint;
  /** HTTP method. `/v2/insights` is POST; `/search`, `/v2/tags` and `/entities` are GET. */
  method: 'GET' | 'POST';
  /** True when served from the private cache (no live call). */
  cached: boolean;
  /** Entity type, when the call is scoped to one. */
  entityType?: string;
  /** HTTP status; absent for cache hits. */
  status?: number;
}
export interface ResolveSeedEvent extends TraceBase {
  kind: 'resolve_seed';
  seedId: string;
  status: SeedStatus;
  candidateCount: number;
}
export interface ExtractTagsEvent extends TraceBase {
  kind: 'extract_tags';
  field: Field;
  tagCount: number;
}
export interface BuildAxesEvent extends TraceBase {
  kind: 'build_axes';
  axisIds: string[];
  /** Member tag count per axis id. */
  tagCounts: Record<string, number>;
  /** Tags dropped as too generic (rank-based within the pool). */
  droppedGeneric?: number;
  /** Tag types dropped for having fewer than two tags. */
  droppedTagTypes?: string[];
  /** True when fewer axes than the minimum survived; the list is never padded. */
  axisShortfall?: boolean;
  /** Who named each axis: the model (label passed the check) or the deterministic fallback. */
  naming?: Record<string, 'model' | 'fallback'>;
}
export interface MapWhyEvent extends TraceBase {
  kind: 'map_why';
  seedId: string;
  tagIds: string[];
  semanticSearch: boolean;
  /** Set when the lookup did not complete, so "no tags" is not mistaken for "nothing matched". */
  failed?: 'budget' | 'unavailable' | 'error';
}
export interface ChooseThemeEvent extends TraceBase {
  kind: 'choose_theme';
  themeTags: string[];
  reason: string;
}
export interface QueryInsightsEvent extends TraceBase {
  kind: 'query_insights';
  domain: Field;
  endpoint: QlooEndpoint;
  /** Params as sent. */
  params: Record<string, unknown>;
  resultCount: number;
  explainability: boolean;
  /** Qloo returns no backfill marker (spike); counts are derived by T-08 only, and `unknown` results count as neither. */
  primaryCount: number;
  backfillCount: number;
}
export interface ScoreEvent extends TraceBase {
  kind: 'score';
  domain: Field;
  scored: number;
  clearedFloor: number;
  /** Popularity summary of the pool (numbers only). */
  popularity: { min: number; median: number; max: number };
}
export interface RequeryEvent extends TraceBase {
  kind: 'requery';
  domain: Field;
  reason: RequeryReason;
  /** Param name to the new value. */
  paramChanges: Record<string, unknown>;
}
export interface FetchRefsEvent extends TraceBase {
  kind: 'fetch_refs';
  pickIds: string[];
  sourcedCount: number;
  inferredCount: number;
  /** Source URLs actually retrieved; the provenance scorer checks `sourceUrl`s against these. */
  sourceUrls?: string[];
}
export interface RelaxEvent extends TraceBase {
  kind: 'relax';
  /** What was relaxed: reach band only, never connection. */
  relaxed: 'reach_band';
  from: Band;
  to: Band;
  reason: string;
}
export interface ExplainEvent extends TraceBase {
  kind: 'explain';
  pickId: string;
}

export type TraceEvent =
  | QlooCallEvent
  | ResolveSeedEvent
  | ExtractTagsEvent
  | BuildAxesEvent
  | MapWhyEvent
  | ChooseThemeEvent
  | QueryInsightsEvent
  | ScoreEvent
  | RequeryEvent
  | FetchRefsEvent
  | RelaxEvent
  | ExplainEvent;

export type TraceEventKind = TraceEvent['kind'];

export const TRACE_EVENT_KINDS = [
  'qloo_call',
  'resolve_seed',
  'extract_tags',
  'build_axes',
  'map_why',
  'choose_theme',
  'query_insights',
  'score',
  'requery',
  'fetch_refs',
  'relax',
  'explain',
] as const satisfies readonly TraceEventKind[];
