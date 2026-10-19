// Redaction and construction of the `qloo_call` trace event. Params keep their names (scorers check them
// against the registry) but ids become counts. Search text is the user's own input and is kept.

import type { NormalizedValue, PreparedRequest } from "./validate";
import type { CallSource, QlooCallTraceEvent, QlooErrorKindName, QlooMode, RedactedParams } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEYS = new Set([
  "signal.interests.entities",
  "signal.interests.tags",
  "filter.exclude.entities",
  "filter.exclude.tags",
  "filter.tags",
  "filter.results.entities",
  "filter.results.tags",
  "entity_ids",
]);

function redactOne(key: string, v: NormalizedValue): string | number | boolean | string[] {
  // Under an id key nothing raw is ever kept: lists become a count, anything else a placeholder.
  if (ID_KEYS.has(key) || key.endsWith(".ids")) {
    if (Array.isArray(v)) return `[${v.length} ids]`;
    return v !== null && typeof v === "object" ? "[ids]" : "[id]";
  }
  if (Array.isArray(v)) {
    if ((v as unknown[]).some((x) => typeof x !== "string")) return `[${v.length} ids]`;
    return (v as string[]).map((x) => (UUID.test(x) || x.startsWith("urn:tag:") ? "[id]" : x));
  }
  if (typeof v === "string" && (UUID.test(v) || v.startsWith("urn:tag:"))) return "[id]";
  return v as string | number | boolean;
}

export function redactParams(params: Record<string, NormalizedValue>): RedactedParams {
  const out: RedactedParams = {};
  for (const k of Object.keys(params).sort()) out[k] = redactOne(k, params[k]);
  return out;
}

const WHAT: Record<string, string> = {
  "/search": "looked up an entity",
  "/entities": "fetched entity details",
  "/v2/tags": "searched tags",
  "/v2/insights": "asked the taste graph",
};

export interface EventInput {
  now: Date;
  req?: PreparedRequest;
  endpointFallback: QlooCallTraceEvent["endpoint"];
  methodFallback: QlooCallTraceEvent["method"];
  rawParamsRedacted?: RedactedParams;
  cached: boolean;
  source: CallSource | "none";
  /** Only when an HTTP response was received for this event. */
  status?: number;
  ms: number;
  outcome: QlooCallTraceEvent["outcome"];
  errorKind?: QlooErrorKindName;
  resultCount?: number;
  droppedItems?: number;
  runLiveCalls: number;
  mode: QlooMode;
  requestKey?: string;
}

export function buildCallEvent(i: EventInput): QlooCallTraceEvent {
  const endpoint = i.req?.endpoint ?? i.endpointFallback;
  const how =
    i.outcome === "error" ? `was refused or failed (${i.errorKind})`
    : i.source === "cache" ? "served from the saved copy"
    : i.source === "shared" ? "shared a call already in flight"
    : "made a live call";
  const say = `Qloo: ${WHAT[endpoint]}, ${how}${i.outcome === "empty" ? ", no results" : ""}.`;
  const ev: QlooCallTraceEvent = {
    t: i.now.toISOString(),
    kind: "qloo_call",
    say,
    endpoint,
    method: i.req?.method ?? i.methodFallback,
    params: i.req ? redactParams(i.req.params) : (i.rawParamsRedacted ?? {}),
    cached: i.cached,
    source: i.source,
    ms: i.ms,
    outcome: i.outcome,
    runLiveCalls: i.runLiveCalls,
    mode: i.mode,
  };
  if (i.req?.entityType) ev.entityType = i.req.entityType;
  if (i.status !== undefined) ev.status = i.status;
  if (i.droppedItems) ev.droppedItems = i.droppedItems;
  if (i.errorKind) ev.errorKind = i.errorKind;
  if (i.resultCount !== undefined) ev.resultCount = i.resultCount;
  if (i.requestKey) ev.requestKey = i.requestKey;
  return ev;
}
