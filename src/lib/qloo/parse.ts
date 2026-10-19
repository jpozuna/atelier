// One parser per response envelope. They run on stripped bodies, so a live response and a cache replay take
// the same path. The four envelopes differ (see the qloo-api skill):
//   /search and /entities  { success, results: [ ... ] }               flat array
//   /v2/insights (entity)  { success, results: { entities }, query? }
//   /v2/tags               { success, results: { tags } }              items use `id`
//   /v2/insights (urn:tag) { success, results: { tags }, duration }    items use `tag_id`

import { QlooHttpError, QlooParseError } from "./errors";
import type { InsightsEntity, QlooEndpoint, SearchItem, TagItem, TasteTag } from "./types";

export interface Parsed<T> {
  items: T[];
  query?: Record<string, unknown>;
  /** Items dropped because they had no string id field. Parsing is lenient so a live call is not wasted. */
  dropped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** A 200 with `success: false` is an error, never an empty result. */
function assertSuccess(endpoint: QlooEndpoint, body: Record<string, unknown>) {
  if (body.success === false) {
    const { messages } = parseErrorBody(JSON.stringify(body));
    throw new QlooParseError(endpoint, `200 response with success:false${messages.length ? `: ${messages.join("; ")}` : ""}`);
  }
}

/** Keep items that are objects with a string id; count the rest. The list itself must be an array. */
function itemsWithId<T>(endpoint: QlooEndpoint, list: unknown, idField: string, where: string): { items: T[]; dropped: number } {
  if (!Array.isArray(list)) throw new QlooParseError(endpoint, `${where} is not an array`);
  const items = list.filter((it) => isObj(it) && typeof it[idField] === "string" && it[idField] !== "") as T[];
  return { items, dropped: list.length - items.length };
}

/** /search and /entities. */
export function parseFlatEntities(endpoint: QlooEndpoint, body: unknown): Parsed<SearchItem> {
  if (!isObj(body)) throw new QlooParseError(endpoint, "body is not an object");
  assertSuccess(endpoint, body);
  return itemsWithId<SearchItem>(endpoint, body.results, "entity_id", "results");
}

/** /v2/insights with an entity filter.type. */
export function parseInsightsEntities(body: unknown): Parsed<InsightsEntity> {
  const endpoint: QlooEndpoint = "/v2/insights";
  if (!isObj(body) || !isObj(body.results)) throw new QlooParseError(endpoint, "expected results.entities");
  assertSuccess(endpoint, body);
  const r = itemsWithId<InsightsEntity>(endpoint, body.results.entities, "entity_id", "results.entities");
  return { ...r, query: isObj(body.query) ? body.query : undefined };
}

/** /v2/tags. */
export function parseTags(body: unknown): Parsed<TagItem> {
  const endpoint: QlooEndpoint = "/v2/tags";
  if (!isObj(body) || !isObj(body.results)) throw new QlooParseError(endpoint, "expected results.tags");
  assertSuccess(endpoint, body);
  return itemsWithId<TagItem>(endpoint, body.results.tags, "id", "results.tags");
}

/** /v2/insights with filter.type=urn:tag. */
export function parseTasteAnalysis(body: unknown): Parsed<TasteTag> {
  const endpoint: QlooEndpoint = "/v2/insights";
  if (!isObj(body) || !isObj(body.results)) throw new QlooParseError(endpoint, "expected results.tags");
  assertSuccess(endpoint, body);
  return itemsWithId<TasteTag>(endpoint, body.results.tags, "tag_id", "results.tags");
}

/** What to check when a call came back 200 and empty. */
export function emptyDiagnosis(endpoint: QlooEndpoint, kind: "entity" | "tag" | "search", dropped = 0): string {
  const base = emptyDiagnosisBase(endpoint, kind);
  return dropped > 0 ? `${dropped} item(s) in the body had no id field and were dropped. ${base}` : base;
}

function emptyDiagnosisBase(endpoint: QlooEndpoint, kind: "entity" | "tag" | "search"): string {
  if (endpoint === "/v2/insights" && kind === "entity")
    return "200 with no entities: a param was probably silently ignored for this type (check the registry first), or the hackathon data has nothing for these seeds or filters";
  if (endpoint === "/v2/insights") return "200 with no tags: check that the seeds resolved to entity ids and the tag type filters are valid";
  if (endpoint === "/search") return "no entity matched this query: treat the seed as missing, not as an error";
  if (endpoint === "/entities") return "no entity matched these ids";
  return "no tag matched: widen filter.query or try feature.semantic_search";
}

export interface ErrorBody {
  messages: string[];
  html: boolean;
}

const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}...` : s);

/**
 * Error bodies seen in the spike:
 *   insights   { errors: [ { message, path | subtype } ] }
 *   search 400 { error: { reason, message, code, request_id } }
 *   flat       { code, reason, message }  (404 "No results", 429)
 *   gateway    HTML (504)
 */
export function parseErrorBody(text: string): ErrorBody {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) return { messages: [], html: true };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { messages: trimmed ? [clip(trimmed)] : [], html: false };
  }
  const messages: string[] = [];
  if (isObj(json)) {
    if (Array.isArray(json.errors)) {
      for (const e of json.errors) {
        if (isObj(e) && typeof e.message === "string") {
          const where = typeof e.path === "string" ? ` (${e.path})` : typeof e.subtype === "string" ? ` (${e.subtype})` : "";
          messages.push(clip(e.message + where));
        }
      }
    }
    if (isObj(json.error)) {
      const { message, reason } = json.error;
      if (typeof message === "string") messages.push(clip(typeof reason === "string" ? `${reason}: ${message}` : message));
    }
    if (!messages.length && typeof json.message === "string") {
      messages.push(clip(typeof json.reason === "string" ? `${json.reason}: ${json.message}` : json.message));
    }
  }
  return { messages, html: false };
}

/** Map a non-2xx response to a typed error. 404 on /search and /entities is handled by the caller as empty. */
export function httpErrorFor(endpoint: QlooEndpoint, status: number, text: string, retryAfter?: number): QlooHttpError {
  const { messages, html } = parseErrorBody(text);
  const kind =
    status === 400 ? "bad_request"
    : status === 401 ? "unauthorized"
    : status === 403 ? "forbidden"
    : status === 404 ? "not_found"
    : status === 429 ? "rate_limited"
    : status === 504 ? "gateway_timeout"
    : "server_error";
  return new QlooHttpError(kind, endpoint, status, messages, {
    html,
    retryAfter,
    retryable: status === 429 || status >= 500,
  });
}

/** The flat `{code, reason, message}` shape Qloo uses for 404 "No results" on /search and /entities. */
export function isNoResultsBody(text: string): boolean {
  try {
    const j: unknown = JSON.parse(text);
    return isObj(j) && "code" in j && typeof j.reason === "string" && typeof j.message === "string";
  } catch {
    return false;
  }
}
