// Reading the person's past signals from the private run log, as LearnSignal[]. SERVER SIDE ONLY. Reading the log makes
// no Qloo call and no model call. By account, for signed-in people only (a guest is
// never read, so two guests with the same seeds cannot see each other's signals). Only the person's own signals are used.
//
// The signals of the LEARN_RUNS_MAX runs with the most recent activity count. The themes behind each pick come from the
// stored run (`trace.audit.picks`, written by pickRecordsOf); a run logged before that has none, and its signals still
// exclude their picks but lean no theme.
//
// Never throws: any failure (a store error, a bad row) gives an empty list, so a failing log never fails a run.

import "server-only";

import { readRun, readSignalsByUser, type ReadOptions, type SignalWithRun } from "@/lib/runlog";
import { FIELDS, type Field } from "@/types";
import { LEARN_RUNS_MAX } from "@/lib/agent/config";
import { timeOf, type LearnSignal } from "./types";

export interface LearnWho {
  /** The signed-in account. Learning is for signed-in people only: a guest has no signals read. */
  userId: string;
}

interface StoredPick {
  themeTags: string[];
  field?: Field;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** `pickId -> theme tags and field` from a stored run's audit block. Empty for a run that has none. */
function storedPicks(audit: unknown): Map<string, StoredPick> {
  const out = new Map<string, StoredPick>();
  const picks = typeof audit === "object" && audit !== null ? (audit as { picks?: unknown }).picks : undefined;
  if (!Array.isArray(picks)) return out;
  for (const p of picks) {
    if (typeof p !== "object" || p === null) continue;
    const r = p as { pickId?: unknown; themeTags?: unknown; domain?: unknown };
    if (typeof r.pickId !== "string") continue;
    const field = typeof r.domain === "string" && (FIELDS as readonly string[]).includes(r.domain) ? (r.domain as Field) : undefined;
    out.set(r.pickId, { themeTags: strs(r.themeTags), ...(field ? { field } : {}) });
  }
  return out;
}

/** Keep the signals of the `max` runs with the most recent signal, in the order they arrived (oldest first). */
export function recentRunsOnly(rows: readonly SignalWithRun[], max: number): SignalWithRun[] {
  const lastAt = new Map<string, number>();
  for (const { signal } of rows) {
    const prev = lastAt.get(signal.runId);
    if (prev === undefined || timeOf(signal.createdAt) > prev) lastAt.set(signal.runId, timeOf(signal.createdAt));
  }
  const keep = new Set([...lastAt].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, Math.max(0, max)).map(([id]) => id));
  return rows.filter((r) => keep.has(r.signal.runId));
}

export async function readLearnSignals(who: LearnWho, options: ReadOptions & { runsMax?: number } = {}): Promise<LearnSignal[]> {
  try {
    // Only the person's own signals count: another account's signal on one of their runs never reaches this run.
    const rows = (await readSignalsByUser(who.userId, options)).filter(({ signal }) => signal.userId === who.userId);
    const recent = recentRunsOnly(rows, options.runsMax ?? LEARN_RUNS_MAX);
    const runIds = [...new Set(recent.map((r) => r.signal.runId))];
    const stored = new Map<string, Map<string, StoredPick>>();
    await Promise.all(
      runIds.map(async (id) => {
        try {
          stored.set(id, storedPicks((await readRun(id, options))?.trace.audit));
        } catch {
          stored.set(id, new Map());
        }
      }),
    );
    return recent.map(({ signal }): LearnSignal => {
      const pick = stored.get(signal.runId)?.get(signal.pickId);
      return {
        signal: signal.signal,
        entityId: signal.entityId,
        pickKey: `${signal.runId}:${signal.pickId}`,
        source: signal.source,
        themeTags: pick?.themeTags ?? [],
        ...(pick?.field ? { field: pick.field } : {}),
        at: signal.createdAt,
      };
    });
  } catch {
    return [];
  }
}
