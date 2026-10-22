// The private run log: one row per finished or failed run (full, unredacted trace) and a row per signal a person gives
// on a pick later. SERVER-SIDE ONLY. Nothing here, no id it makes and none of its contents, reaches a browser.
//
// Writing (used by /api/run and /api/reactions):
//   runLog.recordRun(entry)         one run_log row, then `not_me` signals for the ids a re-run set aside
//   runLog.recordReactions(entry)   one run_signal row per saved reaction
//   runInBackground(task, after?)   fire-and-forget: never throws, never delays the response
//
// Reading (for later work that learns from the log, e.g. T-28):
//   readSignalsByUser(userId), readSignalsByProfile(profileHash), readRunsByUser, readRunsByProfile, readRun(id)
//
// Where rows go (`ATELIER_RUNLOG`): `off` writes nothing; `file` writes JSONL under `.qloo-private/runlog/`; `supabase`
// uses the service role; unset means supabase when NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both
// set, else file; off under test (NODE_ENV=test) and on Vercel without Supabase (a read-only filesystem). Nothing is
// ever written to a tracked path.

import { randomUUID } from "node:crypto";
import type { TraceEvent } from "@/types";
import { hashProfile } from "./hash";
import { createFileStore } from "./store-file";
import { createOffStore } from "./store-memory";
import { createSupabaseRunLogStore } from "./store-supabase";
import type { RunInputRecord, RunLogStore, RunOutcome, RunRow, RunSignal, RunSummary, SignalRow, SignalSource } from "./types";

export { hashProfile } from "./hash";
export { signalOfReaction } from "./signals";
export type * from "./types";
export { RUN_SIGNALS, SIGNAL_SOURCES } from "./types";

// ---------------------------------------------------------------------------------------------------------------
// Choosing a store
// ---------------------------------------------------------------------------------------------------------------

export function createRunLogStore(env: Record<string, string | undefined> = process.env): RunLogStore {
  const mode = env.ATELIER_RUNLOG?.trim().toLowerCase();
  if (mode === "off") return createOffStore();
  if (mode === "file") return createFileStore();
  if (mode === "supabase") return createSupabaseRunLogStore();
  if (env.NODE_ENV === "test") return createOffStore();
  const hasSupabase = Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (hasSupabase) return createSupabaseRunLogStore();
  // A deployed function's filesystem is read-only: a file store there would only warn on every run.
  return env.VERCEL ? createOffStore() : createFileStore();
}

let shared: RunLog | undefined;

/** The process-wide run log for the routes. Chosen from the environment on first use. */
export function getRunLog(): RunLog {
  return (shared ??= createRunLog(createRunLogStore()));
}

/** For tests: forget the shared log so the next `getRunLog()` reads the environment again. */
export function resetRunLog(): void {
  shared = undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Fire and forget
// ---------------------------------------------------------------------------------------------------------------

/**
 * Run a logging task without making anyone wait for it. A failure (a throw, a rejection, an unreachable database) is
 * swallowed: logging must never fail a run or a save. `after` hands the promise to the host so a serverless function
 * stays alive until the write lands (the routes pass Next's `after`); its own failure is swallowed too.
 */
export function runInBackground(task: () => Promise<unknown>, after?: (done: Promise<unknown>) => void): void {
  const done: Promise<unknown> = Promise.resolve()
    .then(task)
    .catch(() => {
      // A fixed line: an error from the store could carry row text, so it is never printed.
      console.warn("run log: a write failed and was skipped");
    });
  try {
    after?.(done);
  } catch {
    // Outside a request scope there is nothing to hand it to; the write still runs.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------

/** What a finished or failed run gives the log. Structural, so it needs no import of the loop. */
export interface RunEntry {
  seeds: { id: string; field: string; typed: string; why: string; qlooId: string | null }[];
  /** `profile.tags[].tag` */
  tagIds: string[];
  exclude?: string[];
  /** Entity ids the request says were newly set aside ("not me"), a subset of `exclude`. Exact when present. */
  notMe?: string[];
  domains?: string[];
  userId: string | null;
  /** Every trace event as emitted (before anything was stripped for the browser). */
  events: TraceEvent[];
  /** Null when the run failed. */
  result: {
    domains: { picks: { id: string; qlooId: string }[] }[];
    plan: RunRow["plan"];
    meta: unknown;
    audit: unknown;
  } | null;
  /** The fixed code of the failure, when it failed. */
  errorCode?: string | null;
}

export interface ReactionEntry {
  userId: string;
  /** Hash of the person's seeds and profile, when the request carried them (a save does). Finds runs made as a guest. */
  profileHash?: string;
  items: { pickId: string; signals: RunSignal[]; words?: string }[];
}

export interface RunLog {
  readonly store: RunLogStore;
  recordRun(entry: RunEntry): Promise<void>;
  recordReactions(entry: ReactionEntry): Promise<void>;
}

export interface RunLogOptions {
  now?: () => Date;
  newId?: () => string;
}

const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function createRunLog(store: RunLogStore, options: RunLogOptions = {}): RunLog {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;

  /** The pick id a run gave an entity id, or null. */
  const pickIdOf = (run: RunSummary, entityId: string): string | null => {
    const i = run.keptEntityIds.indexOf(entityId);
    return i >= 0 ? (run.keptPickIds[i] ?? null) : null;
  };

  async function recordNotMe(entry: RunEntry, runId: string, profileHash: string): Promise<void> {
    const explicit = entry.notMe && entry.notMe.length > 0 ? entry.notMe : null;
    const ids = [...new Set(explicit ?? entry.exclude ?? [])];
    if (ids.length === 0) return;
    const source: SignalSource = explicit ? "not_me_list" : "exclude";
    // The run that showed an id: the newest earlier run of this profile that kept it, else (when signed in) the newest
    // run of this person that kept it. Unknown ids are skipped.
    const byProfile = await store.selectRuns({ profileHash, entityIds: ids });
    const byUser = entry.userId ? await store.selectRuns({ userId: entry.userId, entityIds: ids }) : [];
    const runs = [...byProfile, ...byUser].filter((r) => r.id !== runId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const rows: SignalRow[] = [];
    for (const entityId of ids) {
      for (const run of runs) {
        const pickId = pickIdOf(run, entityId);
        if (!pickId) continue;
        rows.push({ id: newId(), runId: run.id, pickId, entityId, signal: "not_me", why: null, source, userId: entry.userId, createdAt: now().toISOString() });
        break;
      }
    }
    await store.insertSignals(rows);
  }

  return {
    store,

    async recordRun(entry) {
      const profileHash = hashProfile({ seeds: entry.seeds, tagIds: entry.tagIds });
      const picks = new Map<string, string>();
      for (const d of entry.result?.domains ?? []) for (const p of d.picks) if (!picks.has(p.id)) picks.set(p.id, p.qlooId);
      const outcome: RunOutcome = entry.result ? "ok" : "failed";
      const input: RunInputRecord = {
        seeds: entry.seeds.map((s) => ({ id: s.id, field: s.field, typed: s.typed, why: s.why, qlooId: s.qlooId })),
        exclude: entry.exclude ?? [],
        domains: entry.domains ?? null,
      };
      const row: RunRow = {
        id: newId(),
        createdAt: now().toISOString(),
        profileHash,
        userId: entry.userId,
        outcome,
        errorCode: entry.result ? null : (entry.errorCode ?? "internal"),
        input,
        trace: { events: entry.events, meta: asRecord(entry.result?.meta), audit: asRecord(entry.result?.audit) },
        plan: entry.result?.plan ?? null,
        keptPickIds: [...picks.keys()],
        keptEntityIds: [...picks.values()],
      };
      // This run is stored first; the not-me lookup then skips it by id, so only earlier runs can be matched.
      await store.insertRun(row);
      await recordNotMe(entry, row.id, profileHash);
    },

    async recordReactions(entry) {
      const rows: SignalRow[] = [];
      for (const item of entry.items) {
        if (item.signals.length === 0) continue;
        let run: RunSummary | undefined = (await store.selectRuns({ userId: entry.userId, pickId: item.pickId }))[0];
        if (!run && entry.profileHash) run = (await store.selectRuns({ profileHash: entry.profileHash, pickId: item.pickId }))[0];
        let runId: string | undefined = run?.id;
        // A guest ran, then signed in: an earlier signal of this person on this pick already names the run.
        if (!runId) runId = (await store.selectSignals({ userId: entry.userId, pickId: item.pickId })).at(-1)?.runId;
        if (!runId) continue;
        const known = run ?? (await store.getRun(runId));
        const entityId = known ? (known.keptEntityIds[known.keptPickIds.indexOf(item.pickId)] ?? null) : null;
        const words = item.words && item.words.length > 0 ? item.words : null;
        // A repeat updates the row (last write wins), so words given earlier are carried over when none come now.
        const earlier = words ? [] : await store.selectSignals({ runIds: [runId], userId: entry.userId, pickId: item.pickId });
        for (const signal of item.signals) {
          const why = words ?? earlier.find((e) => e.signal === signal)?.why ?? null;
          rows.push({ id: newId(), runId, pickId: item.pickId, entityId, signal, why, source: "reaction", userId: entry.userId, createdAt: now().toISOString() });
        }
      }
      await store.insertSignals(rows);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading (server code only)
// ---------------------------------------------------------------------------------------------------------------

/** A signal with the run it was given on (without the run's trace: `readRun(run.id)` has it). */
export interface SignalWithRun {
  signal: SignalRow;
  run: RunSummary;
}

export interface ReadOptions {
  /** Default: the store chosen from the environment (`getRunLog().store`). */
  store?: RunLogStore;
}

const storeOf = (o?: ReadOptions): RunLogStore => o?.store ?? getRunLog().store;

async function withRuns(store: RunLogStore, signals: SignalRow[], known: RunSummary[]): Promise<SignalWithRun[]> {
  const byId = new Map(known.map((r) => [r.id, r]));
  const missing = [...new Set(signals.map((s) => s.runId))].filter((id) => !byId.has(id));
  for (const id of missing) {
    const full = await store.getRun(id);
    if (full) {
      const { trace: _t, input: _i, ...summary } = full;
      void _t;
      void _i;
      byId.set(id, summary);
    }
  }
  const out: SignalWithRun[] = [];
  for (const signal of signals) {
    const run = byId.get(signal.runId);
    if (run) out.push({ signal, run });
  }
  return out;
}

/** Runs made by (or, for a guest, later claimed by a save of) one account, newest first. */
export async function readRunsByUser(userId: string, options?: ReadOptions): Promise<RunSummary[]> {
  return storeOf(options).selectRuns({ userId });
}

/** Runs of one profile hash (see `hashProfile`), newest first. */
export async function readRunsByProfile(profileHash: string, options?: ReadOptions): Promise<RunSummary[]> {
  return storeOf(options).selectRuns({ profileHash });
}

/** One run with its input and full unredacted trace, or null. */
export async function readRun(runId: string, options?: ReadOptions): Promise<RunRow | null> {
  return storeOf(options).getRun(runId);
}

/**
 * Every signal one account gave, plus every signal on runs the account made, oldest first. A signal is
 * `{signal, run}`: `signal.signal` is one of RUN_SIGNALS, `signal.pickId` and `entityId` name the pick, `run.plan` and
 * `run.keptPickIds` say what the run did, and `readRun(run.id)` returns its trace.
 */
export async function readSignalsByUser(userId: string, options?: ReadOptions): Promise<SignalWithRun[]> {
  const store = storeOf(options);
  const runs = await store.selectRuns({ userId });
  const given = await store.selectSignals({ userId });
  const onRuns = runs.length > 0 ? await store.selectSignals({ runIds: runs.map((r) => r.id) }) : [];
  const merged = new Map<string, SignalRow>();
  for (const s of [...given, ...onRuns]) merged.set(s.id, s);
  const ordered = [...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return withRuns(store, ordered, runs);
}

/** Every signal on the runs of one profile hash, oldest first. Includes guests, who have no user id. */
export async function readSignalsByProfile(profileHash: string, options?: ReadOptions): Promise<SignalWithRun[]> {
  const store = storeOf(options);
  const runs = await store.selectRuns({ profileHash });
  if (runs.length === 0) return [];
  return withRuns(store, await store.selectSignals({ runIds: runs.map((r) => r.id) }), runs);
}
