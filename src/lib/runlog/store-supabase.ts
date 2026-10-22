// Supabase store, backed by public.run_log and public.run_signal (supabase/migrations/20261022000000_run_log.sql).
// Server-only and service role only: both tables have RLS on, no policies, and no anon or authenticated grants.
// Rows are stored as given and never logged. A database failure throws RunLogDbError; callers swallow it.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/db/server";
import type { RunLogStore, RunRow, RunSummary, SignalRow } from "./types";

export const RUN_TABLE = "run_log";
export const SIGNAL_TABLE = "run_signal";

/** The two tables are not in the hand-written `Database` type, so this store uses an untyped client. */
export type RunLogClient = SupabaseClient;

export class RunLogDbError extends Error {
  constructor(operation: string, detail: string) {
    super(`run log ${operation} failed: ${detail}`);
    this.name = "RunLogDbError";
  }
}

type Row = Record<string, unknown>;
type Failure = { code?: string; message: string } | null;
const fail = (op: string, e: NonNullable<Failure>): never => {
  throw new RunLogDbError(op, `${e.code ?? "unknown"} ${e.message}`);
};

const SUMMARY_COLUMNS = "id,created_at,profile_hash,user_id,outcome,error_code,plan,kept_pick_ids,kept_entity_ids";

const iso = (v: unknown): string => new Date(String(v)).toISOString();

function summaryOf(r: Row): RunSummary {
  return {
    id: r.id as string,
    createdAt: iso(r.created_at),
    profileHash: r.profile_hash as string,
    userId: (r.user_id as string | null) ?? null,
    outcome: r.outcome as RunRow["outcome"],
    errorCode: (r.error_code as string | null) ?? null,
    plan: (r.plan as RunRow["plan"]) ?? null,
    keptPickIds: (r.kept_pick_ids as string[] | null) ?? [],
    keptEntityIds: (r.kept_entity_ids as string[] | null) ?? [],
  };
}

function signalOf(r: Row): SignalRow {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    pickId: r.pick_id as string,
    entityId: (r.entity_id as string | null) ?? null,
    signal: r.signal as SignalRow["signal"],
    why: (r.why as string | null) ?? null,
    source: r.source as SignalRow["source"],
    userId: (r.user_id as string | null) ?? null,
    createdAt: iso(r.created_at),
  };
}

export interface SupabaseRunLogOptions {
  /** A service-role client. Default: created on first use, so importing this module never needs the env. */
  client?: RunLogClient;
}

export function createSupabaseRunLogStore(options: SupabaseRunLogOptions = {}): RunLogStore {
  let client = options.client;
  const db = (): RunLogClient => (client ??= createServiceClient() as unknown as RunLogClient);

  return {
    kind: "supabase",

    async insertRun(row) {
      const { error } = await db().from(RUN_TABLE).insert({
        id: row.id,
        created_at: row.createdAt,
        profile_hash: row.profileHash,
        user_id: row.userId,
        outcome: row.outcome,
        error_code: row.errorCode,
        input: row.input,
        trace: row.trace,
        plan: row.plan,
        kept_pick_ids: row.keptPickIds,
        kept_entity_ids: row.keptEntityIds,
      });
      if (error) fail("insert run", error);
    },

    async insertSignals(rows) {
      if (rows.length === 0) return;
      const { error } = await db()
        .from(SIGNAL_TABLE)
        .upsert(
          rows.map((s) => ({
            id: s.id,
            run_id: s.runId,
            pick_id: s.pickId,
            entity_id: s.entityId,
            signal: s.signal,
            why: s.why,
            source: s.source,
            user_id: s.userId,
            created_at: s.createdAt,
          })),
          { onConflict: "run_id,pick_id,signal,user_id" },
        );
      if (error) fail("insert signals", error);
    },

    async selectRuns(q) {
      let query = db().from(RUN_TABLE).select(SUMMARY_COLUMNS);
      if (q.userId !== undefined) query = query.eq("user_id", q.userId);
      if (q.profileHash !== undefined) query = query.eq("profile_hash", q.profileHash);
      if (q.entityIds) query = query.overlaps("kept_entity_ids", q.entityIds);
      if (q.pickId !== undefined) query = query.contains("kept_pick_ids", [q.pickId]);
      query = query.order("created_at", { ascending: false });
      if (q.limit !== undefined) query = query.limit(q.limit);
      const { data, error } = await query;
      if (error) fail("select runs", error);
      return ((data ?? []) as unknown as Row[]).map(summaryOf);
    },

    async getRun(id) {
      const { data, error } = await db().from(RUN_TABLE).select("*").eq("id", id).maybeSingle();
      if (error) fail("get run", error);
      if (!data) return null;
      const r = data as Row;
      return { ...summaryOf(r), input: r.input as RunRow["input"], trace: r.trace as RunRow["trace"] };
    },

    async selectSignals(q) {
      let query = db().from(SIGNAL_TABLE).select("*");
      if (q.runIds) query = query.in("run_id", q.runIds);
      if (q.userId !== undefined) query = query.eq("user_id", q.userId);
      if (q.pickId !== undefined) query = query.eq("pick_id", q.pickId);
      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) fail("select signals", error);
      return ((data ?? []) as unknown as Row[]).map(signalOf);
    },
  };
}
