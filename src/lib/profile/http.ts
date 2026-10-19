// Small request helpers shared by the profile and why handlers.

import { QlooBudgetError, QlooCacheMissError, QlooConfigError, QlooError, QlooHttpError, QlooParamError } from "@/lib/qloo/errors";

export type ErrorCode =
  | "bad_request"
  | "no_usable_seeds"
  | "empty_profile"
  | "lookups_off"
  | "budget"
  | "rate_limited"
  | "upstream"
  | "rejected"
  | "config"
  | "internal";

export function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, code: ErrorCode, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message }, ...extra }, status);
}

/** Read and parse a JSON body, refusing early on a declared or actual size over `max`. Returns a Response on failure. */
export async function readJson(request: Request, max: number, shape: string): Promise<unknown | Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return fail(400, "bad_request", "Request body is too large.");
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, "bad_request", "Could not read the request body.");
  }
  if (raw.length > max) return fail(400, "bad_request", "Request body is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", `Body must be JSON: ${shape}.`);
  }
}

/**
 * What a failed Qloo lookup means for a trace's `map_why.failed`: `budget`, `unavailable` (cache miss, busy,
 * outage), or `error`. Undefined for errors that are our own bug (params, config, 400, 401, 403): those surface.
 */
export function failedKind(err: unknown): "budget" | "unavailable" | "error" | undefined {
  if (err instanceof QlooBudgetError) return "budget";
  if (err instanceof QlooCacheMissError) return "unavailable";
  if (err instanceof QlooHttpError) {
    if (err.kind === "rate_limited" || err.kind === "server_error" || err.kind === "gateway_timeout") return "unavailable";
    return undefined;
  }
  if (err instanceof QlooError && err.kind === "network") return "unavailable";
  if (err instanceof QlooError && err.kind === "parse") return "error";
  return undefined;
}

/** Map a thrown Qloo error to a status and a fixed, safe message. */
export function qlooErrorResponse(err: unknown, extra: Record<string, unknown> = {}): Response {
  if (err instanceof QlooCacheMissError) return fail(503, "lookups_off", "Lookups are unavailable right now.", extra);
  if (err instanceof QlooBudgetError) return fail(503, "budget", "Lookups are paused to protect the monthly call budget.", extra);
  if (err instanceof QlooHttpError && err.kind === "rate_limited") return fail(503, "rate_limited", "The taste graph is busy. Try again in a moment.", extra);
  if (err instanceof QlooHttpError && (err.kind === "unauthorized" || err.kind === "forbidden")) {
    return fail(500, "config", "The profile service is not configured on the server.");
  }
  if (err instanceof QlooHttpError && err.kind === "bad_request") return fail(500, "rejected", "The taste graph rejected the request.");
  if (err instanceof QlooHttpError || (err instanceof QlooError && (err.kind === "network" || err.kind === "parse"))) {
    return fail(502, "upstream", "The taste graph could not be reached. Try again.", extra);
  }
  if (err instanceof QlooConfigError || err instanceof QlooParamError) return fail(500, "config", "The profile service is not configured on the server.");
  return fail(500, "internal", "Something went wrong.");
}
