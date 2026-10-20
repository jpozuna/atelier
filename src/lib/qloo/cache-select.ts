// Chooses the default Qloo cache adapter for createQlooClient. Server-side only.
//
//   QLOO_CACHE=supabase  private table via createSupabaseQlooCache (service role). Needed on Vercel, where the disk
//                        is read-only and not shared between instances.
//   QLOO_CACHE=file      .qloo-private/cache on disk (local dev, spikes, evals).
//   unset                "supabase" when NODE_ENV=production and both NEXT_PUBLIC_SUPABASE_URL and
//                        SUPABASE_SERVICE_ROLE_KEY are set; otherwise "file".
//
// Both adapters are loaded with a dynamic import on first use, so dev and tests never load Supabase, the file
// adapter is not part of a production request path, and there is no import cycle (src/lib/db/qloo-cache.ts
// imports types from ./cache).

import "server-only";

import type { CacheEntry, QlooCacheAdapter } from "./cache";

export type CacheKind = "supabase" | "file";

type Env = Record<string, string | undefined>;

/** The adapter factories, injectable so tests need neither Supabase nor the disk. */
export interface CacheLoaders {
  supabase: () => Promise<QlooCacheAdapter>;
  file: () => Promise<QlooCacheAdapter>;
}

const present = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

export function selectCacheKind(env: Env): CacheKind {
  const explicit = env.QLOO_CACHE?.trim().toLowerCase();
  if (explicit === "supabase" || explicit === "file") return explicit;
  const supabaseReady = present(env.NEXT_PUBLIC_SUPABASE_URL) && present(env.SUPABASE_SERVICE_ROLE_KEY);
  return env.NODE_ENV === "production" && supabaseReady ? "supabase" : "file";
}

const defaultLoaders: CacheLoaders = {
  supabase: async () => (await import("@/lib/db/qloo-cache")).createSupabaseQlooCache(),
  file: async () => (await import("./cache-file")).createFileCache(),
};

/** A cache adapter that resolves the real one on first use. The choice is made when this is called. */
export function createDefaultCache(env: Env = process.env as Env, loaders: CacheLoaders = defaultLoaders): QlooCacheAdapter {
  const kind = selectCacheKind(env);
  let loaded: Promise<QlooCacheAdapter> | undefined;
  const adapter = () => {
    loaded ??= loaders[kind]();
    // A failed load (for example a missing env var) is retried on the next call rather than cached.
    loaded.catch(() => {
      loaded = undefined;
    });
    return loaded;
  };
  return {
    async get(key: string): Promise<CacheEntry | null> {
      return (await adapter()).get(key);
    },
    async set(entry: CacheEntry): Promise<void> {
      return (await adapter()).set(entry);
    },
  };
}
