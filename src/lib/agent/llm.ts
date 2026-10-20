// The model, as the loop sees it: one function that forces a tool call and returns the tool's input. A plain fetch
// to the Anthropic Messages API (no SDK dependency, like the axis namer). Server-only.
//
// Rules:
//  - Key from ANTHROPIC_API_KEY, model from ATELIER_MODEL (default claude-sonnet-5-5). Neither is logged, thrown or
//    returned. Error messages carry the HTTP status only, never the response body.
//  - With no key the loop gets `disabledLlm` and runs its deterministic fallbacks: no call is attempted.
//  - Every call has a timeout and `redirect: "error"`. A reply that is not a tool call, or that stopped on max_tokens,
//    is a failure (the caller falls back).
//  - Replies are cached in memory by a hash of model, tool, system and input, so the same input never costs a second
//    call (a rerun of the same profile makes no model call). Failures are never cached.
//  - Entity names and tags reach the model only as JSON data in the user message, never as instructions.

import "server-only";

import { createHash } from "node:crypto";
import { LLM_CACHE_MAX, LLM_TIMEOUT_MS } from "./run-constants";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export interface ModelTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  tool: ModelTool;
  system: string;
  /** JSON text. Data only. */
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmStats {
  /** Requests sent to the API (cache hits excluded). */
  calls: number;
  cacheHits: number;
  failures: number;
}

export interface Llm {
  /** False when no key is configured: callers use their deterministic fallback and never call. */
  readonly enabled: boolean;
  /** Forces `req.tool` and returns its input, unvalidated. Throws `LlmError` on any failure. */
  call(req: LlmRequest): Promise<Record<string, unknown>>;
  stats(): LlmStats;
}

export class LlmError extends Error {
  constructor(
    readonly kind: "disabled" | "http" | "timeout" | "network" | "shape" | "truncated" | "aborted" | "budget",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmCache {
  get(key: string): Record<string, unknown> | undefined;
  set(key: string, value: Record<string, unknown>): void;
  size(): number;
}

/** In-memory, bounded, oldest entry out first. */
export function createLlmCache(max: number = LLM_CACHE_MAX): LlmCache {
  const map = new Map<string, Record<string, unknown>>();
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

export const disabledLlm: Llm = {
  enabled: false,
  async call() {
    throw new LlmError("disabled", "no model configured");
  },
  stats: () => ({ calls: 0, cacheHits: 0, failures: 0 }),
};

/**
 * Enforces a cap on the model calls one run makes. Every call counts, cache hits included (the loop makes at most
 * 8 in any case, so the cap only bites on a bug), and it is counted by this wrapper so a shared client does not carry
 * spend from an earlier run. Over the cap, `call` throws `LlmError("budget")` and nothing is sent.
 */
export function limitCalls(llm: Llm, max: number): Llm {
  let spent = 0;
  return {
    get enabled() {
      return llm.enabled;
    },
    stats: () => llm.stats(),
    async call(req) {
      if (spent >= max) throw new LlmError("budget", `model call limit of ${max} reached for this run`);
      spent += 1;
      return llm.call(req);
    },
  };
}

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  url?: string;
  timeoutMs?: number;
  cache?: LlmCache;
}

export function cacheKey(model: string, req: Pick<LlmRequest, "tool" | "system" | "user" | "maxTokens">): string {
  return createHash("sha256").update(JSON.stringify([model, req.tool.name, req.maxTokens, req.system, req.user])).digest("hex");
}

export function createAnthropicLlm(opts: AnthropicLlmOptions): Llm {
  const doFetch = opts.fetch ?? fetch;
  const stats: LlmStats = { calls: 0, cacheHits: 0, failures: 0 };
  return {
    enabled: true,
    stats: () => ({ ...stats }),
    async call(req) {
      const key = cacheKey(opts.model, req);
      const hit = opts.cache?.get(key);
      if (hit) {
        stats.cacheHits += 1;
        return structuredClone(hit);
      }
      if (req.signal?.aborted) throw new LlmError("aborted", "run was cancelled");
      stats.calls += 1;
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? LLM_TIMEOUT_MS);
      let res: Response;
      try {
        res = await doFetch(opts.url ?? ANTHROPIC_URL, {
          method: "POST",
          redirect: "error",
          signal: req.signal ? AbortSignal.any([timeout, req.signal]) : timeout,
          headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": ANTHROPIC_VERSION },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: req.maxTokens,
            system: req.system,
            tools: [req.tool],
            tool_choice: { type: "tool", name: req.tool.name },
            messages: [{ role: "user", content: req.user }],
          }),
        });
      } catch (err) {
        stats.failures += 1;
        if (req.signal?.aborted) throw new LlmError("aborted", "run was cancelled");
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new LlmError(timedOut ? "timeout" : "network", timedOut ? "model call timed out" : "model call failed");
      }
      if (!res.ok) {
        stats.failures += 1;
        throw new LlmError("http", `model call returned http ${res.status}`);
      }
      let body: { content?: { type?: string; name?: string; input?: unknown }[]; stop_reason?: string };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        stats.failures += 1;
        throw new LlmError("shape", "model reply was not JSON");
      }
      if (body.stop_reason === "max_tokens") {
        stats.failures += 1;
        throw new LlmError("truncated", "model reply was cut off");
      }
      const block = body.content?.find((c) => c.type === "tool_use" && c.name === req.tool.name);
      const input = block?.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        stats.failures += 1;
        throw new LlmError("shape", "model reply had no tool call");
      }
      opts.cache?.set(key, structuredClone(input as Record<string, unknown>));
      return input as Record<string, unknown>;
    },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** The model client when ANTHROPIC_API_KEY is set (model from ATELIER_MODEL, default claude-sonnet-5-5), else `disabledLlm`. */
export function createLlm(env: Env = process.env, extra: { cache?: LlmCache; fetch?: typeof fetch } = {}): Llm {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return disabledLlm;
  const model = env.ATELIER_MODEL?.trim() || DEFAULT_MODEL;
  return createAnthropicLlm({ apiKey, model, cache: extra.cache, fetch: extra.fetch });
}
