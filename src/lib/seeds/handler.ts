// The /api/seeds/resolve request handler. Kept out of route.ts because a Next route file may export only
// handlers and route config. Validates input, resolves one seed, and maps failures to safe JSON errors.
// It never returns raw Qloo JSON, Qloo error text, or the key.

import { FIELDS, type Field } from "@/types";
import { QlooBudgetError, QlooCacheMissError, QlooConfigError, QlooError, QlooHttpError } from "@/lib/qloo/errors";
import { MAX_BODY_CHARS, MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "./constants";
import { SeedConfigError } from "./places";
import { cleanQuery, resolveSeed, type SearchClient } from "./resolve";

export interface HandlerDeps {
  /** One client per request. */
  createClient: () => SearchClient;
  env?: () => Readonly<Record<string, string | undefined>>;
}

export type ErrorCode = "bad_request" | "lookups_off" | "budget" | "rate_limited" | "upstream" | "config" | "internal";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(status: number, code: ErrorCode, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Map a thrown error to a status and a safe message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof QlooCacheMissError) {
    return fail(503, "lookups_off", "Live lookups are off (QLOO_MODE=replay) and this search is not in the replay cache. Set QLOO_MODE=record to fetch it once.");
  }
  if (err instanceof QlooBudgetError) {
    return fail(503, "budget", "Lookups are paused to protect the monthly call budget.");
  }
  if (err instanceof QlooHttpError && err.kind === "rate_limited") {
    return fail(503, "rate_limited", "The taste graph is busy. Try again in a moment.");
  }
  // 401 and 403 mean a wrong key, host or type on our side, not a Qloo outage.
  if (err instanceof QlooHttpError && (err.kind === "unauthorized" || err.kind === "forbidden")) {
    return fail(500, "config", "Seed lookup is not configured on the server.");
  }
  if (err instanceof QlooHttpError || (err instanceof QlooError && (err.kind === "network" || err.kind === "parse"))) {
    return fail(502, "upstream", "The taste graph could not be reached. Try again.");
  }
  if (err instanceof QlooConfigError || err instanceof SeedConfigError) {
    return fail(500, "config", "Seed lookup is not configured on the server.");
  }
  return fail(500, "internal", "Something went wrong resolving that.");
}

function isField(v: unknown): v is Field {
  return typeof v === "string" && (FIELDS as readonly string[]).includes(v);
}

export async function handleResolve(request: Request, deps: HandlerDeps): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, "bad_request", "Could not read the request body.");
  }
  if (raw.length > MAX_BODY_CHARS) return fail(400, "bad_request", "Request body is too large.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "Body must be JSON: {field, query}.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "bad_request", "Body must be JSON: {field, query}.");
  const { field, query } = body as Record<string, unknown>;
  if (!isField(field)) return fail(400, "bad_request", `field must be one of: ${FIELDS.join(", ")}.`);
  if (typeof query !== "string") return fail(400, "bad_request", "query must be a string.");
  const clean = cleanQuery(query);
  if (clean.length < MIN_QUERY_LENGTH || clean.length > MAX_QUERY_LENGTH) {
    return fail(400, "bad_request", `query must be ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters.`);
  }

  try {
    const result = await resolveSeed(deps.createClient(), { field, query: clean }, deps.env?.() ?? process.env);
    return json(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
}
