// Shared in-memory filtering, used by the memory and file stores (the Supabase store filters in SQL).

import type { RunQuery, RunRow, RunSummary, SignalQuery, SignalRow } from "./types";

export function summarize(row: RunRow): RunSummary {
  const { trace: _trace, input: _input, ...rest } = row;
  void _trace;
  void _input;
  return rest;
}

export function matchRuns(rows: readonly RunRow[], q: RunQuery): RunSummary[] {
  const entities = q.entityIds ? new Set(q.entityIds) : null;
  return rows
    .filter((r) => (q.userId === undefined || r.userId === q.userId) && (q.profileHash === undefined || r.profileHash === q.profileHash))
    .filter((r) => !entities || r.keptEntityIds.some((e) => entities.has(e)))
    .filter((r) => q.pickId === undefined || r.keptPickIds.includes(q.pickId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, q.limit ?? Number.POSITIVE_INFINITY)
    .map(summarize);
}

export function matchSignals(rows: readonly SignalRow[], q: SignalQuery): SignalRow[] {
  const runs = q.runIds ? new Set(q.runIds) : null;
  return rows
    .filter((s) => (!runs || runs.has(s.runId)) && (q.userId === undefined || s.userId === q.userId) && (q.pickId === undefined || s.pickId === q.pickId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** The idempotency key of a signal row. */
export const signalKey = (s: Pick<SignalRow, "runId" | "pickId" | "signal" | "userId">): string =>
  JSON.stringify([s.runId, s.pickId, s.signal, s.userId]);

/** Last write wins: of rows with the same key, the latest in file order stays (at that position). */
export function lastWins(rows: readonly SignalRow[]): SignalRow[] {
  const latest = new Map<string, SignalRow>();
  for (const r of rows) {
    const k = signalKey(r);
    latest.delete(k);
    latest.set(k, r);
  }
  return [...latest.values()];
}
