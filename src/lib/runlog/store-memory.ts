// In-memory store: tests, and the base the file store builds on. Nothing is written anywhere.

import { matchRuns, matchSignals, signalKey } from "./query";
import type { RunLogStore, RunRow, SignalRow } from "./types";

export interface MemoryStore extends RunLogStore {
  readonly runs: RunRow[];
  readonly signals: SignalRow[];
}

export function createMemoryStore(): MemoryStore {
  const runs: RunRow[] = [];
  const signals: SignalRow[] = [];
  return {
    kind: "memory",
    runs,
    signals,
    async insertRun(row) {
      runs.push(structuredClone(row));
    },
    async insertSignals(rows) {
      // An upsert: a repeat of (run, pick, signal, user) replaces the row, so a new `why` wins.
      for (const r of rows) {
        const at = signals.findIndex((s) => signalKey(s) === signalKey(r));
        if (at >= 0) signals[at] = { ...r };
        else signals.push({ ...r });
      }
    },
    async selectRuns(q) {
      return matchRuns(runs, q);
    },
    async getRun(id) {
      const r = runs.find((x) => x.id === id);
      return r ? structuredClone(r) : null;
    },
    async selectSignals(q) {
      return matchSignals(signals, q);
    },
  };
}

/** A store that does nothing: `ATELIER_RUNLOG=off`, and the default under test. */
export function createOffStore(): RunLogStore {
  return {
    kind: "off",
    async insertRun() {},
    async insertSignals() {},
    async selectRuns() {
      return [];
    },
    async getRun() {
      return null;
    },
    async selectSignals() {
      return [];
    },
  };
}
