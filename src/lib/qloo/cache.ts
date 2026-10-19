// Cache contract, request normalization and response stripping. The adapter interface is what T-06 implements
// for Supabase (src/lib/db/qloo-cache.ts). Nothing here writes to disk; see cache-file.ts for the dev adapter.
// A public repo is never a cache: adapters must store privately.

import "server-only";

import { createHash } from "node:crypto";
import { LIMITS, STRIP_KEYS } from "./limits";
import type { HttpMethod, QlooEndpoint } from "./types";
import type { NormalizedValue, PreparedRequest } from "./validate";

/** Bump when the stripping policy or the stored shape changes, so old entries can be told apart. */
export const CACHE_ENTRY_VERSION = 1;

/** What an adapter stores for one request. `body` is already stripped; never put the API key in here. */
export interface CacheEntry {
  v: number;
  /** Normalized request key (sha256 hex of the canonical request). Also the lookup key. */
  key: string;
  endpoint: QlooEndpoint;
  method: HttpMethod;
  /** 200, or 404 on /search and /entities (an empty result). */
  status: number;
  /** Stripped JSON body. */
  body: unknown;
  /** ISO time of the live call. */
  createdAt: string;
}

/**
 * Persistent store for stripped responses. No TTL: the hackathon rules allow private caching with no time limit.
 *
 * Contract for implementers (T-06):
 * - `get` returns null on a miss. Throwing is treated as a miss in replay mode and ignored on write.
 * - `set` overwrites an existing entry for the same key.
 * - Keys are 64-char hex strings; treat them as opaque.
 * - Storage must be private (service role only, never exported, never committed).
 */
export interface QlooCacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
}

/** In-memory adapter for tests and one-off scripts. */
export function createMemoryCache(): QlooCacheAdapter & { size(): number; entries(): CacheEntry[] } {
  const m = new Map<string, CacheEntry>();
  return {
    async get(key) {
      const e = m.get(key);
      return e ? structuredClone(e) : null;
    },
    async set(entry) {
      m.set(entry.key, structuredClone(entry));
    },
    size: () => m.size,
    entries: () => [...m.values()].map((e) => structuredClone(e)),
  };
}

/** JSON with object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])]));
  }
  return v;
}

const TEXT_QUERY_KEYS = new Set(["query", "filter.query", "filter.results.entities.query"]);

/** Order-insensitive normal form of a param value: string arrays sorted, seeds sorted by id, search text folded. */
function normalizeValue(key: string, v: NormalizedValue): unknown {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return [...(v as string[])].sort();
    return [...(v as { id: string; weight?: number }[])]
      .map((s) => ({ id: s.id, weight: s.weight ?? 1 }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  if (typeof v === "string" && TEXT_QUERY_KEYS.has(key)) return v.trim().replace(/\s+/g, " ").toLowerCase();
  return v;
}

/** Normalized form of a prepared request: method, path, sorted params with sorted ids. */
export function normalizeRequest(req: PreparedRequest): { method: HttpMethod; endpoint: QlooEndpoint; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  for (const k of Object.keys(req.params).sort()) params[k] = normalizeValue(k, req.params[k]);
  return { method: req.method, endpoint: req.endpoint, params };
}

/** sha256 hex of the canonical normalized request. Identical requests share a key, whatever the param order. */
export function requestKey(req: PreparedRequest): string {
  return createHash("sha256").update(canonicalJson(normalizeRequest(req))).digest("hex");
}

/**
 * Remove bulky fields before storing: STRIP_KEYS at any depth, and strings longer than STRIP_MAX_STRING are
 * truncated (so lineage and biography text stays usable as a short reading source, but long text is not kept).
 * Returns a new value; the input is not mutated.
 */
export function stripBody(value: unknown, maxString = LIMITS.STRIP_MAX_STRING): unknown {
  if (typeof value === "string") return value.length > maxString ? value.slice(0, maxString) : value;
  if (Array.isArray(value)) return value.map((x) => stripBody(x, maxString));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.includes(k)) continue;
      out[k] = stripBody(v, maxString);
    }
    return out;
  }
  return value;
}
