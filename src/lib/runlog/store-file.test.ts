import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunLog } from "./index";
import { RUNLOG_DIR, createFileStore } from "./store-file";
import { appendFile } from "node:fs/promises";

// Synthetic data only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atelier-runlog-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = () => ({
  seeds: [{ id: "s1", field: "film", typed: "Invented Film", why: "quiet", qlooId: id(1) }],
  tagIds: ["urn:tag:genre:invented"],
  userId: null,
  events: [],
  result: { domains: [{ picks: [{ id: `pick-${id(10)}`, qlooId: id(10) }] }], plan: { themes: [], requeries: [] }, meta: {}, audit: {} },
});

describe("file store", () => {
  it("keeps its files inside the private folder by default", () => {
    expect(RUNLOG_DIR).toBe(join(".qloo-private", "runlog"));
  });

  it("writes JSONL, one object per run and per signal, and reads them back", async () => {
    const store = createFileStore({ dir });
    const log = createRunLog(store);
    await log.recordRun(entry());
    await log.recordReactions({ userId: id(91), profileHash: undefined, items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later"] }] });
    // The reaction finds no run (user differs, guest run, no hash): nothing is written for it.
    expect(await readdir(dir)).toEqual(["runs.jsonl"]);
    const lines = (await readFile(join(dir, "runs.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]!);
    expect(row.keptEntityIds).toEqual([id(10)]);
    expect((await store.selectRuns({ pickId: `pick-${id(10)}` }))[0]!.id).toBe(row.id);
    expect((await store.getRun(row.id))?.trace.events).toEqual([]);
  });

  it("reads one signal per key with the last write winning, and survives a torn line", async () => {
    const store = createFileStore({ dir });
    const log = createRunLog(store);
    await log.recordRun({ ...entry(), userId: id(91) });
    const item = (words?: string) => ({ userId: id(91), items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later" as const], words }] });
    await log.recordReactions(item("first words"));
    await log.recordReactions(item("second words"));
    await appendFile(join(dir, "signals.jsonl"), '{"torn":\n', "utf8");
    const rows = await store.selectSignals({ userId: id(91) });
    expect(rows.map((r) => r.why)).toEqual(["second words"]);
    // Append only: both writes are in the file.
    expect((await readFile(join(dir, "signals.jsonl"), "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("reads nothing from a folder that does not exist yet", async () => {
    const store = createFileStore({ dir: join(dir, "missing") });
    expect(await store.selectRuns({ userId: id(1) })).toEqual([]);
    expect(await store.selectSignals({ userId: id(1) })).toEqual([]);
    expect(await store.getRun(id(1))).toBeNull();
  });
});
