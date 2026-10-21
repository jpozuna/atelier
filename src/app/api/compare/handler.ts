// POST /api/compare request handler. Kept out of route.ts because a Next route file may export only handlers and config.
//
// Request  (JSON, at most COMPARE_MAX_BODY_CHARS):  { seeds: [{ field, typed, why }], fields: Field[] }
//   Only `field`, `typed` and `why` of each seed are read (the user's own words). Anything else a client sends is dropped.
// Response 200: { picks: [{ name, field, why }] }. Names and one plain line each: no id, link, number or score.
//   Every item is ungrounded by construction: it has no Qloo link and no source. The screen says so on each one.
// Response 400 bad_request | 502 upstream, unusable | 503 model_off: { error: { code, message } }, fixed messages.
//   Rate limits and the daily allowance are the deploy guard's (src/lib/guard), which answers before this handler runs.
//
// Cost: at most ONE model call per request. The validated reply is cached in memory by a hash of the model and the input
// (seeds in sorted order), so the same profile makes no second call; concurrent identical requests share one call. With no ANTHROPIC_API_KEY the
// request is refused and nothing is sent. This route makes no Qloo call and reads no stored run.

import { createHash } from "node:crypto";
import { LlmError } from "@/lib/agent/llm";
import type { Llm } from "@/lib/agent/llm";
import { COMPARE_MAX_BODY_CHARS, COMPARE_MAX_TOKENS } from "@/lib/agent/config";
import type { CompareErrorCode, CompareRequest, PlainPick } from "@/components/compare/types";
import { cleanPlainPicks, parseCompareRequest } from "@/components/compare/validate";
import { COMPARE_SYSTEM, COMPARE_TOOL, compareUserMessage } from "./prompt";

export const MESSAGES: Record<CompareErrorCode, string> = {
  bad_request: "That request could not be read.",
  model_off: "The plain-model side is not available here.",
  upstream: "The plain model could not be reached. Try again.",
  unusable: "The plain model gave nothing that could be shown. Try again.",
};

const STATUS: Record<CompareErrorCode, number> = { bad_request: 400, model_off: 503, upstream: 502, unusable: 502 };

function reply(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function refuse(code: CompareErrorCode): Response {
  return reply({ error: { code, message: MESSAGES[code] } }, STATUS[code]);
}

/** Validated replies by input hash, bounded, oldest out first. */
export interface CompareCache {
  get(key: string): PlainPick[] | undefined;
  set(key: string, picks: PlainPick[]): void;
  size(): number;
}

export function createCompareCache(max: number): CompareCache {
  const map = new Map<string, PlainPick[]>();
  return {
    get: (k) => map.get(k),
    set(k, v) {
      map.delete(k);
      map.set(k, v);
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    size: () => map.size,
  };
}

export interface CompareHandlerDeps {
  llm: Llm;
  /** Part of the cache key, so a changed model never serves an older model's list. */
  model: string;
  cache: CompareCache;
  /** Calls running now, by input hash, so identical concurrent requests share one. Cleared when the call ends. */
  inflight?: Map<string, Promise<PlainPick[] | CompareErrorCode>>;
}

/** A stable hash of the model and the input the model would see. */
export function inputHash(model: string, ask: CompareRequest): string {
  return createHash("sha256").update(JSON.stringify([model, COMPARE_TOOL.name, ask.fields, ask.seeds.map((s) => JSON.stringify([s.field, s.typed, s.why])).sort()])).digest("hex");
}

/**
 * The one shared model call. It takes no request signal: a caller that leaves must not cancel the call other waiters
 * share. It never rejects (every failure is a code), and it clears its own in-flight entry whatever happens.
 */
async function askModel(deps: CompareHandlerDeps, ask: CompareRequest, key: string): Promise<PlainPick[] | CompareErrorCode> {
  try {
    let raw: Record<string, unknown>;
    try {
      raw = await deps.llm.call({ tool: COMPARE_TOOL, system: COMPARE_SYSTEM, user: compareUserMessage(ask), maxTokens: COMPARE_MAX_TOKENS });
    } catch (err) {
      return err instanceof LlmError && err.kind === "disabled" ? "model_off" : "upstream";
    }
    const picks = cleanPlainPicks(raw, ask);
    if (picks.length === 0) return "unusable";
    // Failures are never cached; a good reply is, so the same profile costs one call.
    deps.cache.set(key, picks);
    return picks;
  } catch {
    return "upstream";
  }
}

export async function handleCompare(request: Request, deps: CompareHandlerDeps): Promise<Response> {
  if (!deps.llm.enabled) return refuse("model_off");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > COMPARE_MAX_BODY_CHARS) return refuse("bad_request");
  let text: string;
  try {
    text = await request.text();
  } catch {
    return refuse("bad_request");
  }
  if (text.length > COMPARE_MAX_BODY_CHARS) return refuse("bad_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("bad_request");
  }
  const parsed = parseCompareRequest(body);
  if (!parsed.ok) return refuse("bad_request");
  const ask = parsed.value;

  const key = inputHash(deps.model, ask);
  const hit = deps.cache.get(key);
  if (hit) return reply({ picks: hit }, 200);

  let pending = deps.inflight?.get(key);
  if (!pending) {
    pending = askModel(deps, ask, key);
    const inflight = deps.inflight;
    if (inflight) {
      inflight.set(key, pending);
      // Both branches clear the entry, so the cleanup chain can never end in an unhandled rejection.
      const clear = () => void inflight.delete(key);
      void pending.then(clear, clear);
    }
  }
  const result = await pending;
  return typeof result === "string" ? refuse(result) : reply({ picks: result }, 200);
}
