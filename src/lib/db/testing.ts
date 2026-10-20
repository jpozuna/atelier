// Test helpers for the db layer: a tiny in-memory stand-in for the parts of the supabase-js query builder that
// src/lib/db uses (select, eq, order, maybeSingle, upsert), and a fake auth surface. Synthetic data only.
// Not imported by production code. It does NOT enforce RLS or constraints: those are tested in SQL
// (migrations.test.ts statically, rls.live.test.ts against a real database).

import type { AtelierClient } from "./server";

type Row = Record<string, unknown>;
export interface FakeError {
  code?: string;
  message: string;
}
interface Result<T> {
  data: T;
  error: FakeError | null;
}

export interface FakeCall {
  table: string;
  op: "select" | "upsert";
  filters: [string, unknown][];
  onConflict?: string;
  rows?: Row[];
}

export interface FakeDb {
  client: AtelierClient;
  tables: Record<string, Row[]>;
  calls: FakeCall[];
  /** Make the next query fail with this error. */
  failNext(error: FakeError): void;
}

const PRIMARY_KEYS: Record<string, string[]> = {
  qloo_cache: ["key"],
  seeds: ["user_id", "id"],
  picks: ["user_id", "id"],
  reactions: ["user_id", "pick_id"],
  profiles: ["id"],
};

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = structuredClone(v);
  const calls: FakeCall[] = [];
  let pendingError: FakeError | null = null;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const call: FakeCall = { table, op: "select", filters: [] };
    let order: { col: string; ascending: boolean } | null = null;
    let single = false;
    let write: Row[] | null = null;
    let pk: string[] = PRIMARY_KEYS[table] ?? ["id"];

    const run = (): Result<unknown> => {
      calls.push(call);
      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        return { data: null, error };
      }
      if (write) {
        for (const r of write) {
          const i = rows.findIndex((x) => pk.every((k) => x[k] === r[k]));
          // Stand-ins for the column defaults and the updated_at trigger.
          const now = new Date().toISOString();
          if (i >= 0) {
            rows[i] = { ...rows[i], ...structuredClone(r) };
            if (table === "reactions" || table === "profiles") rows[i].updated_at = now;
          } else {
            const fresh: Row = { created_at: now, ...structuredClone(r) };
            if (table === "reactions" || table === "profiles") fresh.updated_at = now;
            rows.push(fresh);
          }
        }
        return { data: null, error: null };
      }
      let out = rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
      if (order) {
        const { col, ascending } = order;
        out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (ascending ? 1 : -1));
      }
      out = out.map((r) => structuredClone(r));
      return { data: single ? (out[0] ?? null) : out, error: null };
    };

    const builder = {
      select(_cols?: string) {
        void _cols;
        return builder;
      },
      eq(col: string, value: unknown) {
        call.filters.push([col, value]);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        order = { col, ascending: opts?.ascending ?? true };
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      upsert(input: Row | Row[], opts?: { onConflict?: string }) {
        call.op = "upsert";
        write = Array.isArray(input) ? input : [input];
        call.rows = structuredClone(write);
        call.onConflict = opts?.onConflict;
        if (opts?.onConflict) pk = opts.onConflict.split(",").map((s) => s.trim());
        return builder;
      },
      then<T1, T2>(onOk?: (v: Result<unknown>) => T1, onErr?: (e: unknown) => T2) {
        return Promise.resolve().then(run).then(onOk, onErr);
      },
    };
    return builder;
  }

  return {
    client: { from } as unknown as AtelierClient,
    tables,
    calls,
    failNext(error) {
      pendingError = error;
    },
  };
}

export interface FakeAuthOptions {
  claims?: Record<string, unknown> | null;
  claimsError?: boolean;
  otpError?: { status?: number; code?: string; message: string } | null;
  exchangeError?: boolean;
}

/** A client whose `auth` surface is scripted; `from` is absent. Records the calls made. */
export function createFakeAuthClient(opts: FakeAuthOptions = {}) {
  const otpCalls: unknown[] = [];
  const exchangeCalls: string[] = [];
  let signedOut = 0;
  const client = {
    auth: {
      async getClaims() {
        if (opts.claimsError) return { data: null, error: { message: "bad jwt" } };
        return { data: opts.claims === null || opts.claims === undefined ? null : { claims: opts.claims }, error: null };
      },
      async signInWithOtp(args: unknown) {
        otpCalls.push(args);
        return { data: {}, error: opts.otpError ?? null };
      },
      async exchangeCodeForSession(code: string) {
        exchangeCalls.push(code);
        return { data: {}, error: opts.exchangeError ? { message: "invalid code" } : null };
      },
      async signOut() {
        signedOut += 1;
        return { error: null };
      },
    },
  } as unknown as AtelierClient;
  return { client, otpCalls, exchangeCalls, signedOutCount: () => signedOut };
}

/** In-memory cookie jar with the shape `CookieJar` in auth.ts expects. */
export function createFakeJar() {
  const store = new Map<string, string>();
  const options = new Map<string, Record<string, unknown>>();
  return {
    store,
    options,
    get: (name: string) => (store.has(name) ? { value: store.get(name) as string } : undefined),
    set(name: string, value: string, opts?: Record<string, unknown>) {
      store.set(name, value);
      options.set(name, opts ?? {});
    },
    delete(name: string) {
      store.delete(name);
      options.delete(name);
    },
  };
}

// ---- Synthetic contract fixtures (invented names; ids shaped 00000000-0000-4000-8000-0000000000NN) ----

import type { Pick, Seed } from "@/types";

const qid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function syntheticSeed(n: number, over: Partial<Seed> = {}): Seed {
  return { id: `seed-${n}`, field: "film", typed: `Invented Title ${n}`, why: `invented reason ${n}`, qlooId: qid(n), status: "clean", ...over };
}

export function syntheticPick(n: number, seedId = "seed-1", over: Partial<Pick> = {}): Pick {
  const path: Pick["path"] = {
    seedId,
    anchor: { contribution: 0.6, source: "qloo_explainability" },
    hops: [
      { kind: "seed", label: "Invented Title 1", provenance: "inferred" },
      { kind: "theme", label: "invented theme", tags: ["urn:tag:fixture:theme:invented"], provenance: "inferred" },
      { kind: "pick", label: `Invented Pick ${n}`, provenance: "inferred" },
    ],
    sharedTags: ["urn:tag:fixture:theme:invented"],
    distinctive: true,
  };
  return {
    id: `pick-${n}`,
    qlooId: qid(50 + n),
    name: `Invented Pick ${n}`,
    field: "music",
    popularity: 0.2,
    reach: { tagDistance: 0.5, obscurity: 0.5, fieldUnfamiliarity: 0.5, reach: 0.5 },
    connection: 0.5,
    band: "moderate",
    llmBridged: false,
    origin: "unknown",
    path,
    card: {
      path,
      why: "invented why",
      different: "invented difference",
      provenance: { sourced: 0, inferred: 2 },
    },
    ...over,
  };
}
