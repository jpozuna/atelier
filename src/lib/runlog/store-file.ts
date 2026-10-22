// JSONL store for local dev and evals without Supabase: `.qloo-private/runlog/runs.jsonl` and `signals.jsonl`, one JSON
// object per line, camelCase (the row types). `.qloo-private/` is gitignored; the directory is created on first write.
// Never write anywhere else: the traces hold Qloo ids.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lastWins, matchRuns, matchSignals } from "./query";
import type { RunLogStore, RunRow, SignalRow } from "./types";

/** Relative to the working directory, inside the private folder. */
export const RUNLOG_DIR = join(".qloo-private", "runlog");

async function readLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // A torn or hand-edited line is skipped, never fatal.
    }
  }
  return rows;
}

export interface FileStoreOptions {
  /** Directory for the two files. Default `<cwd>/.qloo-private/runlog`. Tests pass a temp directory. */
  dir?: string;
}

export function createFileStore(options: FileStoreOptions = {}): RunLogStore {
  const dir = options.dir ?? resolve(process.cwd(), RUNLOG_DIR);
  const runsFile = join(dir, "runs.jsonl");
  const signalsFile = join(dir, "signals.jsonl");
  const append = async (file: string, rows: unknown[]): Promise<void> => {
    if (rows.length === 0) return;
    await mkdir(dir, { recursive: true });
    await appendFile(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  };
  return {
    kind: "file",
    async insertRun(row) {
      await append(runsFile, [row]);
    },
    async insertSignals(rows) {
      // Append only; a repeat of (run, pick, signal, user) is a later line, and reads keep the last one.
      await append(signalsFile, rows);
    },
    async selectRuns(q) {
      return matchRuns(await readLines<RunRow>(runsFile), q);
    },
    async getRun(id) {
      return (await readLines<RunRow>(runsFile)).find((r) => r.id === id) ?? null;
    },
    async selectSignals(q) {
      return matchSignals(lastWins(await readLines<SignalRow>(signalsFile)), q);
    },
  };
}
