import { COMPARE_CACHE_MAX } from "@/lib/agent/config";
import { DEFAULT_MODEL, createLlm } from "@/lib/agent/llm";
import type { CompareErrorCode, PlainPick } from "@/components/compare/types";
import { createCompareCache, handleCompare } from "./handler";

// Server-side only: the Anthropic key never reaches the browser. This route makes no Qloo call.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One cache and one in-flight table per server process: the same profile costs one model call. Rate limits are the
// deploy guard's (/api/compare in src/lib/guard).
const cache = createCompareCache(COMPARE_CACHE_MAX);
const inflight = new Map<string, Promise<PlainPick[] | CompareErrorCode>>();

/** POST /api/compare  { seeds: [{ field, typed, why }], fields }  ->  { picks: [{ name, field, why }] }. See ./handler.ts. */
export async function POST(request: Request): Promise<Response> {
  return handleCompare(request, {
    llm: createLlm(process.env),
    model: process.env.ATELIER_MODEL?.trim() || DEFAULT_MODEL,
    cache,
    inflight,
  });
}
