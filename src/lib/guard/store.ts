// Counters behind the guard: per-visitor rate limits and the global daily meters. One interface, so a durable
// store (Supabase service role, see below) can replace the in-memory one without touching the policy.
//
// Which store is used: see getGuardStore in ./store-supabase.ts. In production with Supabase configured, the durable
// store (guard_counters table and guard_consume RPC) holds one count for every instance; this in-memory store is its
// per-request fallback and the only store in dev and tests. On its own it lives in the proxy's process, so it resets
// on a cold start and each serverless instance counts on its own.
//
// Rolling windows: each key holds the timestamps and costs of what it admitted. Admission is all-or-nothing across a
// request's hits, so a request that fails one limit uses none of the others.

export interface Hit {
  /** Counter key, e.g. "ip:1.2.3.4:run-hour" or "global:model". */
  key: string;
  /** Amount committed when the request is admitted. 0 commits nothing. */
  cost: number;
  /** Amount that must still fit under `limit` for the request to be admitted. Defaults to `cost`. */
  gate?: number;
  limit: number;
  windowMs: number;
}

export type ConsumeResult = { ok: true } | { ok: false; index: number; key: string; retryAfterMs: number };

export interface CounterStore {
  /** Admit and commit, or refuse and commit nothing. `index` is the first hit that failed. */
  consume(hits: readonly Hit[], now: number): Promise<ConsumeResult>;
  /** The same decision without committing. */
  check(hits: readonly Hit[], now: number): Promise<ConsumeResult>;
}

interface Entry {
  at: number;
  cost: number;
}

const GLOBAL_PREFIX = "global:";

export interface MemoryStoreOptions {
  /** Cap on tracked visitor keys. Global keys are exempt. */
  maxKeys?: number;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): CounterStore {
  const maxKeys = options.maxKeys ?? 5000;
  const visitors = new Map<string, Entry[]>();
  const globals = new Map<string, Entry[]>();
  const mapFor = (key: string) => (key.startsWith(GLOBAL_PREFIX) ? globals : visitors);

  /** Live entries of a key (expired ones dropped), and their total cost. */
  function live(key: string, windowMs: number, now: number): { entries: Entry[]; used: number } {
    const map = mapFor(key);
    const all = map.get(key);
    if (!all) return { entries: [], used: 0 };
    const cutoff = now - windowMs;
    const entries = all.filter((e) => e.at > cutoff);
    if (entries.length === 0) map.delete(key);
    else if (entries.length !== all.length) map.set(key, entries);
    return { entries, used: entries.reduce((s, e) => s + e.cost, 0) };
  }

  function evaluate(hits: readonly Hit[], now: number): ConsumeResult {
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const need = h.gate ?? h.cost;
      if (need <= 0) continue;
      const { entries, used } = live(h.key, h.windowMs, now);
      if (used + need <= h.limit) continue;
      // Wait until enough of the oldest entries have aged out for `need` to fit.
      let over = used + need - h.limit;
      let retryAfterMs = h.windowMs;
      for (const e of entries) {
        over -= e.cost;
        if (over <= 0) {
          retryAfterMs = Math.max(0, e.at + h.windowMs - now);
          break;
        }
      }
      // A request bigger than the whole limit can never fit: report the full window.
      if (need > h.limit) retryAfterMs = h.windowMs;
      return { ok: false, index: i, key: h.key, retryAfterMs };
    }
    return { ok: true };
  }

  function commit(hits: readonly Hit[], now: number): void {
    for (const h of hits) {
      if (h.cost <= 0) continue;
      const map = mapFor(h.key);
      const { entries } = live(h.key, h.windowMs, now);
      entries.push({ at: now, cost: h.cost });
      // Re-insert so the least recently used visitor key is first in line for eviction.
      map.delete(h.key);
      map.set(h.key, entries);
    }
    while (visitors.size > maxKeys) visitors.delete(visitors.keys().next().value as string);
  }

  return {
    async check(hits, now) {
      return evaluate(hits, now);
    },
    async consume(hits, now) {
      const result = evaluate(hits, now);
      if (result.ok) commit(hits, now);
      return result;
    },
  };
}

const STORE_SYMBOL = Symbol.for("atelier.guard.store");

/** One store per process, kept on globalThis so a dev reload or a second import of this module shares it. */
export function getProcessStore(maxKeys?: number): CounterStore {
  const g = globalThis as unknown as Record<symbol, CounterStore | undefined>;
  return (g[STORE_SYMBOL] ??= createMemoryStore({ maxKeys }));
}
