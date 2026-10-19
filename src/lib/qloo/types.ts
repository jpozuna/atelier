// Local types for the Qloo client: what it sends and parses (raw Qloo item shapes, which src/types does not
// model; src/types/candidate.ts is the normalised form T-08 builds from them). The trace event extends the
// shared `qloo_call` variant of TraceEvent from src/types.

import type { QlooCallEvent, QlooEndpoint } from "@/types";

export type { QlooEndpoint };
export type QlooMode = "replay" | "record" | "live";
export type HttpMethod = "GET" | "POST";

/** A seed signal in a POST body. The API wants `id` (the docs say `entity`). */
export interface SeedSignal {
  id: string;
  weight?: number;
}

export type ParamValue = string | number | boolean | readonly string[] | readonly SeedSignal[] | readonly (string | SeedSignal)[];
export type QlooParams = Readonly<Record<string, ParamValue | undefined>>;

export interface SearchParams extends QlooParams {
  query: string;
  types?: string | readonly string[];
  take?: number;
  "filter.location"?: string;
  "filter.radius"?: number;
}

export interface EntitiesParams extends QlooParams {
  entity_ids?: readonly string[];
}

export interface TagsParams extends QlooParams {
  "filter.query"?: string;
  "feature.semantic_search"?: boolean;
  "feature.typo_tolerance"?: boolean;
  "filter.parents.types"?: string | readonly string[];
  "filter.tag.types"?: string | readonly string[];
  take?: number;
}

export interface TasteAnalysisParams extends QlooParams {
  "signal.interests.entities": readonly (string | SeedSignal)[];
  "filter.parents.types"?: string | readonly string[];
  "filter.tag.types"?: string | readonly string[];
  take?: number;
}

export interface InsightsParams extends QlooParams {
  "filter.type": string;
  "signal.interests.entities"?: readonly SeedSignal[];
  take?: number;
}

// Item shapes (fields per docs/spike-report.md "Item fields"). Index signatures keep unknown fields.

export interface SearchItem {
  entity_id: string;
  name?: string;
  types?: string[];
  popularity?: number;
  disambiguation?: string;
  /** In search items the tag id is `tag_id`. */
  tags?: { tag_id?: string; name?: string; type?: string; value?: string }[];
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface InsightsEntity {
  entity_id: string;
  name?: string;
  type?: string;
  subtype?: string;
  popularity?: number;
  disambiguation?: string;
  /** In insights items the tag id is `id`. */
  tags?: { id?: string; name?: string; type?: string }[];
  external?: Record<string, unknown>;
  query?: {
    affinity?: number;
    /** The key is the literal dotted string. */
    explainability?: { "signal.interests.entities"?: { entity_id: string; score: number }[] } & Record<string, unknown>;
    [k: string]: unknown;
  };
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

/** An item from /v2/tags. Note `id`, not `tag_id`. */
export interface TagItem {
  id: string;
  name?: string;
  type?: string;
  parents?: unknown;
  popularity?: number;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

/** An item from tag insights (taste analysis). */
export interface TasteTag {
  tag_id: string;
  name?: string;
  types?: string[];
  subtype?: string;
  tag_value?: string;
  popularity?: number;
  query?: { affinity?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export type CallSource = "live" | "cache" | "shared";

export interface CallMeta {
  endpoint: QlooEndpoint;
  method: HttpMethod;
  /** Normalized request key (sha256 hex). */
  requestKey: string;
  /** True when no live call was made for this response (cache hit or shared in-flight call). */
  cached: boolean;
  source: CallSource;
  status: number;
  ms: number;
  /** x-month-ratelimit-remaining from the most recent live response, if known. */
  remaining: number | null;
}

/**
 * `ok` has items. `empty` is a 200 (or a 404 on /search and /entities) with no items: callers must diagnose it
 * (param validity first) and must never treat it as success. `diagnosis` says what to check.
 */
export interface QlooResponse<T> {
  outcome: "ok" | "empty";
  items: T[];
  /** Top-level `query` metadata on insights (explainability aggregate and so on), when present. */
  query?: Record<string, unknown>;
  diagnosis?: string;
  /** Items in the body that had no id field and were dropped (parsing is lenient so a live call is not wasted). */
  droppedItems?: number;
  meta: CallMeta;
}

/** Parameter values with ids redacted. Keys are kept so scorers can check them against the registry. */
export type RedactedParams = Record<string, string | number | boolean | string[]>;

/** Why insights is being called. `picks` requires every seed to be excluded from the results. */
export type InsightsPurpose = "picks" | "other";

export type QlooErrorKindName =
  | "config"
  | "param_invalid"
  | "cache_miss"
  | "budget"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "gateway_timeout"
  | "network"
  | "parse";

/**
 * The shared `qloo_call` TraceEvent variant plus what the scorers need. `status` follows the shared contract:
 * present only when an HTTP response was received for this event (absent for cache hits, shared calls and
 * refusals). `cached` is true when no live call was made.
 */
export interface QlooCallTraceEvent extends QlooCallEvent {
  /** Params with ids redacted. Keys are kept so scorers can check them against the registry. */
  params: RedactedParams;
  source: CallSource | "none";
  ms: number;
  outcome: "ok" | "empty" | "error";
  errorKind?: QlooErrorKindName;
  resultCount?: number;
  /** Items dropped for a missing id field. */
  droppedItems?: number;
  /** Live calls made so far in this run, including this one if it was live. */
  runLiveCalls: number;
  mode: QlooMode;
  requestKey?: string;
}

export type TraceSink = (event: QlooCallTraceEvent) => void;

export interface ClientStats {
  liveCalls: number;
  httpAttempts: number;
  cacheHits: number;
  sharedCalls: number;
  remaining: number | null;
}
