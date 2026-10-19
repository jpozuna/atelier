// param-validity: every Qloo call in the trace sends only params the registry allows for that endpoint and
// entity type. The qloo_call events (params with ids redacted by the T-03 client) and the query_insights events
// (params as sent) are both checked, by the same prepare* functions the client runs before sending, so the
// scorer and the client cannot drift apart. Ids come back as redacted placeholders ("[3 ids]"); they are
// restored as synthetic ids of the right shape so the id-shape rules still run.
//
// Also failed here: an endpoint outside the allowed four (legacy /recommendations and /recs included), the wrong
// HTTP method, and a 200 with no results on /v2/insights or /v2/tags (a silently ignored param is the usual
// cause, so an empty result is a finding, not a success). An empty /search is a missing seed, not an error.

import { QLOO_ENDPOINTS } from "@/types";
import { QlooParamError } from "@/lib/qloo/errors";
import { REGISTRY } from "@/lib/qloo/registry";
import { prepareEntities, prepareInsights, prepareSearch, prepareTags, prepareTasteAnalysis } from "@/lib/qloo/validate";
import type { HttpMethod, QlooParams } from "@/lib/qloo/types";
import type { TraceEvent } from "@/types";
import type { CaseInput, ScorerResult, TraceScorer } from "../harness/types";

const ENTITY_ID_KEYS = new Set(["signal.interests.entities", "filter.exclude.entities", "filter.results.entities", "entity_ids"]);
const TAG_ID_KEYS = new Set(["signal.interests.tags", "filter.tags", "filter.exclude.tags", "filter.results.tags"]);
const PLACEHOLDER = /^\[(\d+) ids?\]$/;
const ONE_PLACEHOLDER = "[id]";

const synthEntity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const synthTag = (n: number) => `urn:tag:fixture:restored:tag-${n}`;

/** Turn the client's redaction placeholders back into ids of the right shape. Raw values pass through unchanged. */
export function restoreRedacted(params: Record<string, unknown>): QlooParams {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const isEntity = ENTITY_ID_KEYS.has(k) || k.endsWith(".ids");
    const isTag = TAG_ID_KEYS.has(k);
    const make = (n: number) => (isTag ? synthTag(n) : synthEntity(n));
    if ((isEntity || isTag) && typeof v === "string") {
      const m = PLACEHOLDER.exec(v);
      if (m) out[k] = Array.from({ length: Number(m[1]) }, (_, i) => make(i + 1));
      else if (v === ONE_PLACEHOLDER || v === "[ids]") out[k] = [make(1)];
      else out[k] = v;
    } else if ((isEntity || isTag) && Array.isArray(v)) {
      out[k] = v.map((x, i) => (x === ONE_PLACEHOLDER ? make(i + 1) : x));
    } else if (k === "filter.tag.types") {
      // The client redacts every urn:tag: string, tag types included, so a placeholder here cannot be checked further.
      const swap = (x: unknown) => (x === ONE_PLACEHOLDER ? "urn:tag:fixture:type" : x);
      out[k] = Array.isArray(v) ? v.map(swap) : swap(v);
    } else {
      out[k] = v;
    }
  }
  return out as QlooParams;
}

function describeIssues(e: unknown): string[] {
  if (e instanceof QlooParamError) return e.issues.map((i) => `${i.param}: ${i.reason} (${i.detail})`);
  return [`could not be validated: ${e instanceof Error ? e.message : String(e)}`];
}

/** Validate one call's endpoint, method and params. Returns the problems found (empty when valid). */
export function validateCall(endpoint: string, method: string | undefined, rawParams: Record<string, unknown>): string[] {
  if (!(QLOO_ENDPOINTS as readonly string[]).includes(endpoint)) {
    return [`endpoint ${endpoint} is not allowed; the only endpoints are ${QLOO_ENDPOINTS.join(", ")} (never /recommendations or /recs)`];
  }
  const params = restoreRedacted(rawParams);
  const isTagInsights = endpoint === "/v2/insights" && params["filter.type"] === REGISTRY.tagInsights.urn;
  const problems: string[] = [];

  // Method: /v2/insights for entity types is POST (docs/DECISIONS.md); taste analysis takes either; the rest are GET.
  const wantsPost = endpoint === "/v2/insights" && !isTagInsights;
  if (method !== undefined) {
    if (wantsPost && method !== "POST") problems.push(`method ${method} on /v2/insights for an entity type; it must be POST`);
    if (!wantsPost && !isTagInsights && method !== "GET") problems.push(`method ${method} on ${endpoint}; it must be GET`);
  }

  try {
    if (endpoint === "/search") prepareSearch(params);
    else if (endpoint === "/v2/tags") prepareTags(params);
    else if (endpoint === "/entities") prepareEntities(params);
    else if (isTagInsights) prepareTasteAnalysis(params, (method as HttpMethod | undefined) ?? "GET");
    else prepareInsights(params);
  } catch (e) {
    problems.push(...describeIssues(e));
  }
  return problems;
}

export function scoreParamValidity(input: CaseInput): ScorerResult {
  const reasons: string[] = [];
  let checked = 0;
  input.trace.forEach((e: TraceEvent, i) => {
    const at = `event ${i + 1}`;
    if (e.kind === "qloo_call") {
      const x = e as { params?: Record<string, unknown>; outcome?: string; resultCount?: number };
      const params = x.params ?? {};
      checked++;
      for (const p of validateCall(e.endpoint, e.method, params)) reasons.push(`${at} (qloo_call ${e.endpoint}): ${p}`);
      const empty = x.outcome === "empty" || (x.outcome === undefined && x.resultCount === 0);
      if (empty && (e.endpoint === "/v2/insights" || e.endpoint === "/v2/tags")) {
        reasons.push(`${at} (qloo_call ${e.endpoint}): a 200 with no results is not a success; a param was probably silently ignored, check the registry for this type`);
      }
    } else if (e.kind === "query_insights") {
      checked++;
      // Taste analysis and entity pools share this event; the method follows from filter.type.
      for (const p of validateCall(e.endpoint, undefined, e.params)) reasons.push(`${at} (query_insights ${e.domain}): ${p}`);
    }
  });
  if (reasons.length) return { pass: false, reasons };
  return { pass: true, reasons: [`${checked} call event(s) checked against the registry`] };
}

export const paramValidity: TraceScorer = {
  kind: "trace",
  name: "param-validity",
  description: "Every Qloo call event sends only registry-listed or confirmed params for its endpoint and type, with the right method.",
  score: scoreParamValidity,
};
