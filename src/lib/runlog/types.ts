// Contracts of the private run log. SERVER-SIDE ONLY: nothing here, and no id it creates, ever reaches a browser.
// The log holds unredacted traces (hard rules 3 and 7 allow that only because of this). Pure types and constants.

import type { TraceEvent } from "@/types";
import type { RunPlan } from "@/lib/agent/types";

/** What a person did with a pick. `not_me` is also what a re-run's exclusion of a pick records. */
export const RUN_SIGNALS = ["not_me", "saved_explore", "saved_later", "saved_try", "not_interested", "tried"] as const;
export type RunSignal = (typeof RUN_SIGNALS)[number];

/**
 * How a signal was recorded:
 *  - reaction:     a save or a change of reaction (the person acted on that pick)
 *  - not_me_list:  the run request listed the newly set-aside ids explicitly (exact)
 *  - exclude:      inferred from the run request's `exclude` list, which also holds picks that were only shown, so it
 *                  is weaker evidence. Filter on this when studying "not me".
 */
export const SIGNAL_SOURCES = ["reaction", "not_me_list", "exclude"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export type RunOutcome = "ok" | "failed";

/** The request as the run took it. Seeds in the user's own words; entity ids, never names from Qloo. */
export interface RunInputRecord {
  seeds: { id: string; field: string; typed: string; why: string; qlooId: string | null }[];
  exclude: string[];
  domains: string[] | null;
}

/** The full trace of a run, unredacted: every event as emitted, plus the run's meta and audit blocks. */
export interface RunTrace {
  events: TraceEvent[];
  meta: Record<string, unknown> | null;
  audit: Record<string, unknown> | null;
}

/** One `run_log` row. */
export interface RunRow {
  id: string;
  createdAt: string;
  profileHash: string;
  userId: string | null;
  outcome: RunOutcome;
  errorCode: string | null;
  input: RunInputRecord;
  trace: RunTrace;
  plan: RunPlan | null;
  /** Parallel to `keptEntityIds`: `keptPickIds[i]` is the pick whose entity id is `keptEntityIds[i]`. */
  keptPickIds: string[];
  keptEntityIds: string[];
}

/** A run without its trace and input (they are large). What the lookups return. */
export type RunSummary = Omit<RunRow, "trace" | "input">;

/** One `run_signal` row. */
export interface SignalRow {
  id: string;
  runId: string;
  pickId: string;
  entityId: string | null;
  signal: RunSignal;
  why: string | null;
  source: SignalSource;
  userId: string | null;
  createdAt: string;
}

/** A signal to record. `id` and `createdAt` are set by the log. */
export type SignalInput = Omit<SignalRow, "id" | "createdAt">;

/** AND-combined filters. At least one of the scope fields should be set. */
export interface RunQuery {
  userId?: string;
  profileHash?: string;
  /** Runs that showed any of these entity ids. */
  entityIds?: string[];
  /** Runs that showed this pick id. */
  pickId?: string;
  /** Optional page size. Absent: every match (the server may cap it). */
  limit?: number;
}

export interface SignalQuery {
  runIds?: string[];
  userId?: string;
  pickId?: string;
}

/**
 * Where rows go. Three implementations: Supabase (service role), JSONL files under `.qloo-private/runlog/`, and a
 * no-op. Rows are plain objects; the store does the column mapping.
 */
export interface RunLogStore {
  readonly kind: "supabase" | "file" | "memory" | "off";
  insertRun(row: RunRow): Promise<void>;
  /** An upsert on (runId, pickId, signal, userId): a repeat replaces the earlier row, so a new `why` wins. */
  insertSignals(rows: SignalRow[]): Promise<void>;
  /** Newest first. */
  selectRuns(query: RunQuery): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunRow | null>;
  /** Oldest first. */
  selectSignals(query: SignalQuery): Promise<SignalRow[]>;
}
