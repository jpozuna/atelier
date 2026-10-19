// Param validation and request preparation. Nothing here touches the network. The client calls these before
// building any request, and throws QlooParamError on the first problem list. Qloo silently ignores invalid
// params, so refusing here is the only protection.

import { QlooParamError, type ParamIssue } from "./errors";
import {
  ALLOWED_VALUES,
  ATELIER_SEARCH_TYPES,
  atelierRefusal,
  ENTITIES_ENDPOINT,
  INSIGHTS_PATH,
  REGISTRY,
  SEARCH_ENDPOINT,
  TAGS_ENDPOINT,
  entityTypeKeyFromUrn,
  paramStatus,
  type EntityTypeKey,
  type Registry,
} from "./registry";
import type { HttpMethod, InsightsPurpose, QlooEndpoint, QlooParams, SeedSignal } from "./types";

export type NormalizedValue = string | number | boolean | string[] | SeedSignal[];

export interface PreparedRequest {
  endpoint: QlooEndpoint;
  method: HttpMethod;
  /** Validated params, undefined and empty arrays dropped. */
  params: Record<string, NormalizedValue>;
  /** filter.type urn for insights and tag insights. */
  entityType?: string;
  /** Registry key when entityType is an entity type. */
  entityTypeKey?: EntityTypeKey;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_ID = /^urn:tag:\S+$/;
/** A tag type: urn:tag:<kind>:<namespace>. */
const TAG_TYPE = /^urn:tag:[^:\s]+:[^:\s]+$/;

/** Params whose values are entity ids. */
const ENTITY_ID_LISTS = new Set(["filter.exclude.entities", "filter.results.entities", "entity_ids"]);
/** Params whose values are tag ids from /v2/tags, never freeform strings. */
const TAG_ID_LISTS = new Set(["signal.interests.tags", "filter.tags", "filter.exclude.tags", "filter.results.tags"]);

interface Range {
  min: number;
  max: number;
  int?: boolean;
}
const RANGES: Record<string, Range> = {
  take: { min: 1, max: 50, int: true },
  offset: { min: 0, max: Number.MAX_SAFE_INTEGER, int: true },
  page: { min: 1, max: 100, int: true },
  "filter.popularity.min": { min: 0, max: 1 },
  "filter.popularity.max": { min: 0, max: 1 },
  "bias.content_based": { min: 0, max: 1 },
  "backfill.cross_domain.take": { min: 1, max: 20, int: true },
  "backfill.content_based.take": { min: 1, max: 10, int: true },
};
const TRENDS = ["off", "very_low", "low", "mid", "medium", "high", "very_high"];
const OPERATORS = ["union", "intersection"];
const GROUP_WEIGHT_WORDS = ["very_low", "low", "mid", "medium", "high", "very_high"];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Drop undefined and empty arrays, so `filter.exclude.entities: []` neither counts as sent nor trips the body gate.
 *  String lists are deduplicated (first occurrence kept). Seed lists are deduplicated later, by id with the max weight. */
export function normalizeParams(params: QlooParams): Record<string, NormalizedValue> {
  const out: Record<string, NormalizedValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = isStringArray(v) ? [...new Set(v)] : ([...v] as string[] | SeedSignal[]);
    } else {
      out[k] = v as string | number | boolean;
    }
  }
  return out;
}

function issue(issues: ParamIssue[], param: string, reason: ParamIssue["reason"], detail: string) {
  issues.push({ param, reason, detail });
}

function checkRange(issues: ParamIssue[], k: string, v: unknown, range: Range) {
  if (typeof v !== "number" || !Number.isFinite(v)) return issue(issues, k, "bad_value", "must be a finite number");
  if (range.int && !Number.isInteger(v)) return issue(issues, k, "bad_value", "must be an integer");
  if (v < range.min || v > range.max) return issue(issues, k, "bad_value", `must be between ${range.min} and ${range.max}`);
}

/** Value checks shared by every endpoint. `takeMax` differs per endpoint. */
function checkValues(issues: ParamIssue[], params: Record<string, NormalizedValue>, takeMax: number) {
  for (const [k, v] of Object.entries(params)) {
    if (k === "signal.interests.entities") {
      if (!Array.isArray(v)) {
        issue(issues, k, "bad_value", "must be an array of ids or {id, weight}");
        continue;
      }
      for (const s of v as (string | SeedSignal)[]) {
        const sid = typeof s === "string" ? s : s !== null && typeof s === "object" ? s.id : undefined;
        if (typeof sid !== "string") {
          issue(issues, k, "bad_value", "must be an array of ids or {id, weight}");
          break;
        }
        if (!UUID.test(sid)) issue(issues, k, "not_an_id", "seed ids must be entity UUIDs from /search");
        if (typeof s === "object" && s.weight !== undefined && (typeof s.weight !== "number" || !Number.isFinite(s.weight) || s.weight < 0))
          issue(issues, k, "bad_value", "seed weight must be a number >= 0");
      }
      continue;
    }
    if (ENTITY_ID_LISTS.has(k)) {
      if (!isStringArray(v)) issue(issues, k, "bad_value", "must be an array of entity ids");
      else if (v.some((id) => !UUID.test(id))) issue(issues, k, "not_an_id", "entity ids must be UUIDs");
      continue;
    }
    if (TAG_ID_LISTS.has(k)) {
      if (!isStringArray(v)) issue(issues, k, "bad_value", "must be an array of tag ids");
      else if (v.some((id) => !TAG_ID.test(id))) issue(issues, k, "not_an_id", "tags must be ids from /v2/tags (urn:tag:...), never freeform strings");
      continue;
    }
    if (k === "take") {
      checkRange(issues, k, v, { min: 1, max: takeMax, int: true });
      continue;
    }
    if (RANGES[k]) {
      checkRange(issues, k, v, RANGES[k]);
      continue;
    }
    if (k === "bias.trends") {
      if (typeof v !== "string" || !TRENDS.includes(v)) issue(issues, k, "bad_value", `must be one of ${TRENDS.join(", ")}`);
      continue;
    }
    if (k.startsWith("operator.")) {
      if (typeof v !== "string" || !OPERATORS.includes(v)) issue(issues, k, "bad_value", "must be union or intersection");
      continue;
    }
    if (k === "signal.interests.entities.weight" || k === "signal.interests.tags.weight") {
      const ok = (typeof v === "number" && Number.isFinite(v) && v >= 0) || (typeof v === "string" && GROUP_WEIGHT_WORDS.includes(v));
      if (!ok) issue(issues, k, "bad_value", "must be a number >= 0 or very_low..very_high");
      continue;
    }
    if (k === "feature.explainability" || k === "feature.semantic_search" || k === "feature.typo_tolerance") {
      if (typeof v !== "boolean") issue(issues, k, "bad_value", "must be a boolean");
      continue;
    }
    if (typeof v === "number" && !Number.isFinite(v)) issue(issues, k, "bad_value", "must be finite");
    else if (typeof v === "object" && !isStringArray(v)) issue(issues, k, "bad_value", "unsupported value shape");
  }
  const min = params["filter.popularity.min"];
  const max = params["filter.popularity.max"];
  if (typeof min === "number" && typeof max === "number" && min > max) issue(issues, "filter.popularity.min", "bad_value", "min must be <= max");
}

function finish(endpoint: QlooEndpoint, issues: ParamIssue[]) {
  if (issues.length) throw new QlooParamError(endpoint, issues);
}

/** Body-borne gate: on POST only the spike-confirmed baseline is sent, plus whatever the manager has recorded. */
function checkBody(issues: ParamIssue[], params: Record<string, NormalizedValue>, registry: Registry) {
  for (const k of Object.keys(params)) {
    if (registry.post.baseline.includes(k) || registry.post.confirmedBodyParams.includes(k)) continue;
    if (issues.some((i) => i.param === k)) continue; // already refused for another reason
    issue(issues, k, "body_unconfirmed", "not confirmed in a POST body yet; the manager records scripts/spike/04-post-check.mjs results in registry.post.confirmedBodyParams");
  }
}

function checkRejectedValues(issues: ParamIssue[], key: EntityTypeKey, params: Record<string, NormalizedValue>, registry: Registry) {
  const rejected = registry.types[key].rejected;
  for (const [k, v] of Object.entries(params)) {
    const vals = Array.isArray(v) ? v.map(String) : [String(v)];
    for (const val of vals) {
      const why = rejected[`${k}=${val}`];
      if (why) issue(issues, k, "rejected", `${k}=${val}: ${why}`);
    }
  }
}

function checkTagTypes(issues: ParamIssue[], params: Record<string, NormalizedValue>) {
  const t = params["filter.tag.types"];
  if (t === undefined) return;
  if (!asArray(t).length || !asArray(t).every((x) => TAG_TYPE.test(x))) issue(issues, "filter.tag.types", "bad_value", "must be tag type strings shaped urn:tag:<kind>:<namespace>");
}

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : []);

export interface InsightsOptions {
  /** `picks` requires filter.exclude.entities to cover every seed, so a pick can never be a seed. Default `other`. */
  purpose?: InsightsPurpose;
}

export function prepareInsights(raw: QlooParams, registry: Registry = REGISTRY, opts: InsightsOptions = {}): PreparedRequest {
  const endpoint: QlooEndpoint = INSIGHTS_PATH;
  const params = normalizeParams(raw);
  const issues: ParamIssue[] = [];
  const typeUrn = params["filter.type"];
  let key: EntityTypeKey | null = null;
  if (typeof typeUrn !== "string") {
    issue(issues, "filter.type", "missing_required", "filter.type is required");
  } else if (typeUrn === registry.tagInsights.urn) {
    issue(issues, "filter.type", "bad_value", "urn:tag goes through tasteAnalysis()");
  } else {
    key = entityTypeKeyFromUrn(typeUrn);
    if (!key) issue(issues, "filter.type", "bad_value", `not a supported entity type urn: ${typeUrn}`);
  }
  if (key) {
    for (const k of Object.keys(params)) {
      if (k === "filter.type") continue;
      const status = paramStatus(key, k, registry);
      if (status === "rejected") issue(issues, k, "rejected", registry.types[key].rejected[k]);
      else if (status === "ignored") issue(issues, k, "ignored", `the spike showed ${k} changes nothing for ${key}`);
      else if (status === "unknown") issue(issues, k, "unknown", `not listed or confirmed for ${key}`);
      else if (atelierRefusal(k)) issue(issues, k, "atelier_refused", atelierRefusal(k) as string);
      else if (ALLOWED_VALUES[k] && !asArray(params[k]).every((x) => ALLOWED_VALUES[k].includes(x)))
        issue(issues, k, "bad_value", `only ${ALLOWED_VALUES[k].join(", ")} is usable`);
    }
    checkRejectedValues(issues, key, params, registry);
    for (const need of registry.types[key].requiredSignals) {
      if (params[need] === undefined) issue(issues, need, "missing_required", `${key} requires ${need}`);
    }
  }
  checkValues(issues, params, 50);
  if (opts.purpose === "picks") checkSeedsExcluded(issues, params);
  checkBody(issues, params, registry);
  finish(endpoint, issues);
  return { endpoint, method: "POST", params: withSeedWeights(params), entityType: typeUrn as string, entityTypeKey: key ?? undefined };
}

/** Seed ids, whether given as strings or {id, weight} objects. */
function seedIds(params: Record<string, NormalizedValue>): string[] {
  const seeds = params["signal.interests.entities"];
  if (!Array.isArray(seeds)) return [];
  return (seeds as (string | SeedSignal)[]).map((s) => (typeof s === "string" ? s : s.id));
}

/** For picks, every seed must be in filter.exclude.entities. Checked even while that body param is gated. */
function checkSeedsExcluded(issues: ParamIssue[], params: Record<string, NormalizedValue>) {
  const excluded = new Set(asArray(params["filter.exclude.entities"]));
  const missing = [...new Set(seedIds(params))].filter((s) => !excluded.has(s));
  if (missing.length) issue(issues, "filter.exclude.entities", "missing_required", `purpose "picks" requires every seed to be excluded; ${missing.length} seed id(s) are missing`);
}

/** Seeds always go as [{id, weight}], weight defaulting to 1. A repeated id is sent once, with its largest weight. */
function withSeedWeights(params: Record<string, NormalizedValue>): Record<string, NormalizedValue> {
  const seeds = params["signal.interests.entities"];
  if (!seeds) return params;
  const byId = new Map<string, number>();
  for (const s of seeds as (string | SeedSignal)[]) {
    const id = typeof s === "string" ? s : s.id;
    const w = typeof s === "string" ? 1 : (s.weight ?? 1);
    byId.set(id, Math.max(byId.get(id) ?? -Infinity, w));
  }
  return { ...params, "signal.interests.entities": [...byId].map(([id, weight]) => ({ id, weight })) };
}

export function prepareTasteAnalysis(raw: QlooParams, method: HttpMethod = "GET", registry: Registry = REGISTRY): PreparedRequest {
  const endpoint: QlooEndpoint = INSIGHTS_PATH;
  const params = normalizeParams({ ...raw, "filter.type": registry.tagInsights.urn });
  const issues: ParamIssue[] = [];
  const allowed = new Set<string>([...registry.tagInsights.listed, ...registry.tagInsights.confirmed]);
  for (const k of Object.keys(params)) {
    if (!allowed.has(k)) issue(issues, k, "unknown", "not listed or confirmed for urn:tag");
  }
  if (!registry.tagInsights.requiredOneOf.some((k) => params[k] !== undefined)) {
    issue(issues, "signal.interests.entities", "missing_required", "tag insights needs entity seeds (a call with no signal is a 400)");
  }
  for (const k of ["filter.parents.types"]) {
    if (params[k] !== undefined && !asArray(params[k]).every((x) => x.startsWith("urn:entity:")))
      issue(issues, k, "bad_value", "must be entity type urns (urn:entity:...)");
  }
  checkTagTypes(issues, params);
  checkValues(issues, params, 50);
  let out = params;
  const seeds = params["signal.interests.entities"];
  if (seeds && method === "GET") {
    // GET carries ids only, so per-seed weights cannot be expressed. Duplicates collapse first (max weight).
    const deduped = withSeedWeights(params)["signal.interests.entities"] as { id: string; weight: number }[];
    if (deduped.some((s) => s.weight !== 1)) issue(issues, "signal.interests.entities", "bad_value", "per-seed weights need POST");
    out = { ...params, "signal.interests.entities": deduped.map((s) => s.id) };
  } else if (seeds) {
    out = withSeedWeights(params);
  }
  if (method === "POST") checkBody(issues, out, registry);
  finish(endpoint, issues);
  return { endpoint, method, params: out, entityType: registry.tagInsights.urn };
}

export function prepareSearch(raw: QlooParams): PreparedRequest {
  const endpoint: QlooEndpoint = SEARCH_ENDPOINT.path;
  const params = normalizeParams(raw);
  const issues: ParamIssue[] = [];
  const allowed = new Set<string>(SEARCH_ENDPOINT.params);
  for (const k of Object.keys(params)) if (!allowed.has(k)) issue(issues, k, "unknown", "not a /search param");
  const q = params.query;
  if (typeof q !== "string" || !q.trim()) issue(issues, "query", "missing_required", "query must be a non-empty string");
  const okTypes = new Set<string>(ATELIER_SEARCH_TYPES);
  if (params.types !== undefined) {
    const types = asArray(params.types);
    if (!types.length || !types.every((t) => okTypes.has(t))) issue(issues, "types", "bad_value", "must be one of Atelier's six types (artist, movie, tv_show, book, place, brand)");
  }
  for (const k of ["filter.popularity", "filter.rating"]) {
    if (params[k] !== undefined) checkRange(issues, k, params[k], { min: 0, max: 1 });
  }
  const sort = params.sort_by;
  if (sort !== undefined && !(SEARCH_ENDPOINT.sortBy as readonly unknown[]).includes(sort)) issue(issues, "sort_by", "bad_value", "match, distance or popularity");
  const radius = params["filter.radius"];
  if (radius !== undefined && (typeof radius !== "number" || !(radius > 0 && radius <= 100))) issue(issues, "filter.radius", "bad_value", "miles, above 0 and at most 100");
  checkValues(issues, params, SEARCH_ENDPOINT.takeMax);
  finish(endpoint, issues);
  return { endpoint, method: "GET", params };
}

export function prepareTags(raw: QlooParams): PreparedRequest {
  const endpoint: QlooEndpoint = TAGS_ENDPOINT.path;
  const params = normalizeParams(raw);
  const issues: ParamIssue[] = [];
  const allowed = new Set<string>(TAGS_ENDPOINT.params);
  for (const k of Object.keys(params)) if (!allowed.has(k)) issue(issues, k, "unknown", "not a /v2/tags param");
  const fq = params["filter.query"];
  if (params["feature.semantic_search"] === true && !(typeof fq === "string" && fq.trim()))
    issue(issues, "feature.semantic_search", "missing_required", "semantic search needs a non-empty filter.query");
  checkTagTypes(issues, params);
  if (params["filter.parents.types"] !== undefined && !asArray(params["filter.parents.types"]).every((x) => x.startsWith("urn:")))
    issue(issues, "filter.parents.types", "bad_value", "must be urns");
  checkValues(issues, params, TAGS_ENDPOINT.takeMax);
  finish(endpoint, issues);
  return { endpoint, method: "GET", params };
}

export function prepareEntities(raw: QlooParams): PreparedRequest {
  const endpoint: QlooEndpoint = ENTITIES_ENDPOINT.path;
  const params = normalizeParams(raw);
  const issues: ParamIssue[] = [];
  const allowed = new Set<string>(ENTITIES_ENDPOINT.params);
  for (const k of Object.keys(params)) if (!allowed.has(k)) issue(issues, k, "unknown", "not an /entities param");
  if (Object.keys(params).length === 0) issue(issues, "entity_ids", "missing_required", "entity_ids (or an external.<source>.ids lookup) is required");
  finish(endpoint, issues);
  checkValues(issues, params, 50);
  finish(endpoint, issues);
  return { endpoint, method: "GET", params };
}

/** GET query string: arrays comma-joined, booleans as true/false, keys in sorted order. */
export function encodeQuery(params: Record<string, NormalizedValue>): string {
  const u = new URLSearchParams();
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    u.set(k, Array.isArray(v) ? (v as (string | SeedSignal)[]).map((x) => (typeof x === "string" ? x : x.id)).join(",") : String(v));
  }
  return u.toString();
}
