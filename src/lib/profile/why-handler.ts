// The POST /api/profile/why request handler: { field, why, seedId? } -> the tags that why maps to.
// One cached semantic /v2/tags call. Never returns raw Qloo JSON, Qloo error text, or any key.

import type { TraceEvent } from "@/types";
import { FIELDS, type Field } from "@/types";
import type { QlooCallTraceEvent } from "@/lib/qloo/types";
import { fail, failedKind, json, qlooErrorResponse, readJson } from "./http";
import { MAX_WHY_BODY_CHARS } from "./constants";
import { cleanWhy, mapWhy, type WhyClient } from "./why";

export interface WhyHandlerDeps {
  /** One client per request. It must report its calls to `onTrace`. */
  createClient: (onTrace: (e: QlooCallTraceEvent) => void) => WhyClient & { stats?: () => { liveCalls: number; cacheHits: number } };
  now?: () => Date;
}

const isField = (v: unknown): v is Field => typeof v === "string" && (FIELDS as readonly string[]).includes(v);

export async function handleWhy(request: Request, deps: WhyHandlerDeps): Promise<Response> {
  const body = await readJson(request, MAX_WHY_BODY_CHARS, "{field, why, seedId?}");
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "bad_request", "Body must be JSON: {field, why, seedId?}.");
  const { field, why, seedId } = body as Record<string, unknown>;
  if (!isField(field)) return fail(400, "bad_request", `field must be one of: ${FIELDS.join(", ")}.`);
  if (typeof why !== "string" || !cleanWhy(why)) return fail(400, "bad_request", "why must be a non-empty string.");
  if (seedId !== undefined && !(typeof seedId === "string" && seedId.length <= 100)) return fail(400, "bad_request", "seedId must be a short string.");

  const now = deps.now ?? (() => new Date());
  const trace: TraceEvent[] = [];
  const mapEvent = (tagIds: string[], failed?: "budget" | "unavailable" | "error"): TraceEvent => ({
    t: now().toISOString(),
    kind: "map_why",
    say: failed ? "Could not map this reason to tags right now." : `Mapped this reason to ${tagIds.length} tags.`,
    seedId: seedId ?? "",
    tagIds,
    semanticSearch: true,
    ...(failed ? { failed } : {}),
  });
  try {
    const client = deps.createClient((e) => trace.push(e));
    const tags = await mapWhy(client, { field, why });
    trace.push(mapEvent(tags.map((t) => t.tag)));
    const stats = client.stats?.();
    return json({ tags, trace, ...(stats ? { calls: { live: stats.liveCalls, cached: stats.cacheHits } } : {}) }, 200);
  } catch (err) {
    const failed = failedKind(err);
    if (failed) trace.push(mapEvent([], failed));
    return qlooErrorResponse(err, { trace });
  }
}
