// A durable CounterStore: one count for every server instance, kept in the private guard_counters table through the
// guard_consume RPC (supabase/migrations/20261021000000_guard_counters.sql), with the service role.
//
// Never throws and never blocks a request on the database: an error, a malformed reply or a timeout
// (GUARD_STORE_TIMEOUT_MS) answers that request from the in-memory store instead. A fallback can only be looser than
// the durable count (that instance's own memory), never stricter than the limits themselves.
//
// No caller address leaves the process: visitor keys (`ip:<ip>:<limit>`) are sent as `v:<sha256 hex>`. The global
// meters keep their names. Results come back with the caller's original key.
//
// Which store the proxy uses (getGuardStore):
//   ATELIER_GUARD_STORE=supabase  this store, falling back to memory per request.
//   ATELIER_GUARD_STORE=memory    the in-memory store only.
//   unset                         "supabase" when NODE_ENV=production and both NEXT_PUBLIC_SUPABASE_URL and
//                                 SUPABASE_SERVICE_ROLE_KEY are set; otherwise "memory" (the rule
//                                 src/lib/qloo/cache-select.ts uses for the Qloo cache).

import { createHash } from "node:crypto";
import { GUARD_STORE_TIMEOUT_MS } from "@/lib/agent/config";
import { GUARD_CONSUME_FN } from "@/lib/db/constants";
import { getProcessStore, type ConsumeResult, type CounterStore, type Hit } from "./store";

type Env = Record<string, string | undefined>;

/** One guard_consume call. Resolves with the RPC's JSON reply; rejects on any error. */
export type GuardRpc = (hits: Hit[], now: number, commit: boolean, signal: AbortSignal) => Promise<unknown>;

export interface SupabaseStoreOptions {
  /** Answers a request when the RPC fails. */
  fallback: CounterStore;
  timeoutMs?: number;
  /** Told the failure kind only (never a key or an address). */
  onFallback?: (reason: "error" | "timeout" | "bad_reply") => void;
}

const GLOBAL_KEY = /^global:[a-z_]+$/;

/** The key as stored: global meters by name, everything else hashed. */
export function storedKey(key: string): string {
  return GLOBAL_KEY.test(key) ? key : `v:${createHash("sha256").update(key).digest("hex")}`;
}

function readReply(reply: unknown, hits: readonly Hit[]): ConsumeResult | null {
  if (typeof reply !== "object" || reply === null) return null;
  const r = reply as Record<string, unknown>;
  if (r.ok === true) return { ok: true };
  if (r.ok !== false) return null;
  const index = r.index;
  const retryAfterMs = r.retryAfterMs;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= hits.length) return null;
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) return null;
  return { ok: false, index, key: hits[index].key, retryAfterMs };
}

class RpcTimeout extends Error {}

export function createSupabaseStore(rpc: GuardRpc, options: SupabaseStoreOptions): CounterStore {
  const timeoutMs = options.timeoutMs ?? GUARD_STORE_TIMEOUT_MS;

  async function run(hits: readonly Hit[], now: number, commit: boolean): Promise<ConsumeResult> {
    const sent = hits.map((h) => ({ ...h, key: storedKey(h.key) }));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RpcTimeout());
      }, timeoutMs);
    });
    let reason: "error" | "timeout" | "bad_reply" = "error";
    try {
      const result = readReply(await Promise.race([rpc(sent, now, commit, controller.signal), timeout]), hits);
      if (result) return result;
      reason = "bad_reply";
    } catch (err) {
      reason = err instanceof RpcTimeout ? "timeout" : "error";
    } finally {
      clearTimeout(timer);
    }
    options.onFallback?.(reason);
    return commit ? options.fallback.consume(hits, now) : options.fallback.check(hits, now);
  }

  return {
    consume: (hits, now) => run(hits, now, true),
    check: (hits, now) => run(hits, now, false),
  };
}

export type GuardStoreKind = "supabase" | "memory";

const present = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

export function selectGuardStoreKind(env: Env): GuardStoreKind {
  const explicit = env.ATELIER_GUARD_STORE?.trim().toLowerCase();
  if (explicit === "supabase" || explicit === "memory") return explicit;
  const supabaseReady = present(env.NEXT_PUBLIC_SUPABASE_URL) && present(env.SUPABASE_SERVICE_ROLE_KEY);
  return env.NODE_ENV === "production" && supabaseReady ? "supabase" : "memory";
}

/** The real RPC, with the service-role client created on first use. The db module is loaded lazily. */
function serviceRpc(): GuardRpc {
  let client: Promise<import("@/lib/db/server").AtelierClient> | undefined;
  return async (hits, now, commit, signal) => {
    client ??= import("@/lib/db/server").then((m) => m.createServiceClient());
    // A failed client (for example a missing env var) is retried on the next call rather than kept.
    client.catch(() => {
      client = undefined;
    });
    const { data, error } = await (await client)
      .rpc(GUARD_CONSUME_FN, { hits: hits as unknown as import("@/lib/db/database.types").Json, now_ms: now, do_commit: commit })
      .abortSignal(signal);
    if (error) throw new Error(`guard_consume failed (${error.code ?? "unknown"})`);
    return data;
  };
}

const STORE_SYMBOL = Symbol.for("atelier.guard.durable-store");

/** The proxy's store: durable when configured (see the top of this file), else the per-process memory store. */
export function getGuardStore(maxKeys?: number, env: Env = process.env as Env): CounterStore {
  const memory = getProcessStore(maxKeys);
  if (selectGuardStoreKind(env) === "memory") return memory;
  const g = globalThis as unknown as Record<symbol, CounterStore | undefined>;
  return (g[STORE_SYMBOL] ??= createSupabaseStore(serviceRpc(), {
    fallback: memory,
    // The failure kind only: never a key, an address or the database's message.
    onFallback: (reason) => console.warn(`[guard] counter store ${reason}, using memory for this request`),
  }));
}
