// Supabase implementation of the T-03 Qloo cache adapter (src/lib/qloo/cache.ts), backed by public.qloo_cache.
// Server-only and service role only: the table has no policies and no anon or authenticated grants. Bodies arrive
// already stripped by the Qloo client; this module stores them as given and never logs them.

import "server-only";

import type { CacheEntry, QlooCacheAdapter } from "@/lib/qloo/cache";
import type { QlooEndpoint } from "@/types";
import { CACHE_TABLE } from "./constants";
import type { Json, QlooCacheInsert, QlooCacheRow } from "./database.types";
import { createServiceClient, type AtelierClient } from "./server";

const KEY_SHAPE = /^[0-9a-f]{64}$/;

export interface SupabaseQlooCacheOptions {
  /** A service-role client. Default: created on first use, so importing this module never needs the env. */
  client?: AtelierClient;
}

/** Thrown for a database failure. Carries the Postgres/PostgREST message and code, never a request body. */
export class QlooCacheDbError extends Error {
  constructor(operation: "get" | "set", detail: string) {
    super(`qloo_cache ${operation} failed: ${detail}`);
    this.name = "QlooCacheDbError";
  }
}

function toEntry(row: QlooCacheRow): CacheEntry {
  return {
    v: row.version,
    key: row.key,
    endpoint: row.endpoint as QlooEndpoint,
    method: row.method as CacheEntry["method"],
    status: row.status,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toRow(entry: CacheEntry): QlooCacheInsert {
  return {
    key: entry.key,
    endpoint: entry.endpoint,
    method: entry.method,
    status: entry.status,
    // An empty search/entities 404 has no body: store SQL NULL, not the JSON value null.
    body: entry.body === null || entry.body === undefined ? null : (entry.body as Json),
    version: entry.v,
    created_at: entry.createdAt,
  };
}

export function createSupabaseQlooCache(options: SupabaseQlooCacheOptions = {}): QlooCacheAdapter {
  let client = options.client;
  const db = (): AtelierClient => (client ??= createServiceClient());

  return {
    async get(key) {
      if (!KEY_SHAPE.test(key)) return null;
      const { data, error } = await db().from(CACHE_TABLE).select("*").eq("key", key).maybeSingle();
      if (error) throw new QlooCacheDbError("get", `${error.code ?? "unknown"} ${error.message}`);
      return data ? toEntry(data) : null;
    },

    async set(entry) {
      if (!KEY_SHAPE.test(entry.key)) throw new QlooCacheDbError("set", "key is not a sha256 hex string");
      const { error } = await db().from(CACHE_TABLE).upsert(toRow(entry), { onConflict: "key" });
      if (error) throw new QlooCacheDbError("set", `${error.code ?? "unknown"} ${error.message}`);
    },
  };
}
