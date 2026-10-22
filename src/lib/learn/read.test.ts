import { describe, expect, it } from "vitest";
import { id } from "@/lib/agent/testing";
import { createMemoryStore } from "@/lib/runlog/store-memory";
import type { RunRow, SignalRow } from "@/lib/runlog";
import { readLearnSignals, recentRunsOnly } from "./read";

const USER = id(91);
const HASH = "synthetic-profile-hash"; // the stored runs carry a profile hash; reads no longer use it

function run(n: number, over: Partial<RunRow> = {}, picks: unknown = undefined): RunRow {
  return {
    id: id(500 + n),
    createdAt: `2026-10-22T0${n}:00:00.000Z`,
    profileHash: HASH,
    userId: USER,
    outcome: "ok",
    errorCode: null,
    input: { seeds: [], exclude: [], domains: null },
    trace: { events: [], meta: null, audit: picks === undefined ? null : { picks } },
    plan: null,
    keptPickIds: [`pick-${n}a`, `pick-${n}b`],
    keptEntityIds: [id(600 + n * 10), id(601 + n * 10)],
    ...over,
  };
}
let seq = 0;
const signal = (r: RunRow, i: number, s: SignalRow["signal"], over: Partial<SignalRow> = {}): SignalRow => ({
  id: id(800 + seq++),
  runId: r.id,
  pickId: r.keptPickIds[i]!,
  entityId: r.keptEntityIds[i]!,
  signal: s,
  why: null,
  source: "reaction",
  userId: USER,
  createdAt: `2026-10-22T1${r.id.slice(-1)}:00:0${i}.000Z`,
  ...over,
});

async function seeded() {
  const store = createMemoryStore();
  const r1 = run(1, {}, [{ pickId: "pick-1a", domain: "film", themeTags: ["t1", "t2"] }, { pickId: "pick-1b", domain: "music", themeTags: ["t3"] }]);
  const r2 = run(2); // logged before pick records existed: no audit.picks
  for (const r of [r1, r2]) await store.insertRun(r);
  await store.insertSignals([signal(r1, 0, "not_me", { source: "not_me_list" }), signal(r1, 1, "saved_later"), signal(r2, 0, "not_interested")]);
  return { store, r1, r2 };
}

describe("readLearnSignals", () => {
  it("returns each signal with the themes and field the stored run recorded for its pick", async () => {
    const { store } = await seeded();
    const out = await readLearnSignals({ userId: USER }, { store });
    expect(out).toHaveLength(3);
    const a = out.find((s) => s.signal === "not_me")!;
    expect(a).toMatchObject({ themeTags: ["t1", "t2"], field: "film", source: "not_me_list" });
    expect(out.find((s) => s.signal === "saved_later")).toMatchObject({ themeTags: ["t3"], field: "music" });
    // A run logged before pick records: the signal is kept (it still excludes), with no themes.
    expect(out.find((s) => s.signal === "not_interested")).toMatchObject({ themeTags: [] });
  });

  it("reads nothing for a signal that has no account, even on the person's run (guests are never read)", async () => {
    const { store, r1 } = await seeded();
    await store.insertSignals([signal(r1, 0, "saved_try", { userId: null })]);
    const out = await readLearnSignals({ userId: USER }, { store });
    expect(out.map((s) => s.signal)).not.toContain("saved_try");
  });

  it("drops another account's signal", async () => {
    const { store, r1 } = await seeded();
    await store.insertSignals([signal(r1, 1, "not_me", { userId: id(92) })]);
    const out = await readLearnSignals({ userId: USER }, { store });
    expect(out).toHaveLength(3);
  });

  it("reads only the most recently active runs", async () => {
    const { store } = await seeded();
    const out = await readLearnSignals({ userId: USER }, { store, runsMax: 1 });
    expect(out.map((s) => s.signal)).toEqual(["not_interested"]);
  });

  it("returns nothing, and never throws, when the store fails", async () => {
    const { store } = await seeded();
    store.selectRuns = async () => {
      throw new Error("db down");
    };
    expect(await readLearnSignals({ userId: USER }, { store })).toEqual([]);
  });

  it("reads a malformed audit block as no themes", async () => {
    const store = createMemoryStore();
    const r = run(3, {}, "not a list");
    await store.insertRun(r);
    await store.insertSignals([signal(r, 0, "not_me")]);
    const out = await readLearnSignals({ userId: USER }, { store });
    expect(out).toHaveLength(1);
    expect(out[0]!.themeTags).toEqual([]);
  });

  it("recentRunsOnly ranks runs by the instant of their latest signal, whatever the time format", async () => {
    const { store, r1, r2 } = await seeded();
    const at = (r: RunRow, iso: string) => ({ ...signal(r, 0, "not_me"), createdAt: iso });
    // r1's latest is 11:00 at +00:00; r2's is 10:30Z. As strings r2 sorts later; as instants r1 is.
    const rows = [at(r2, "2026-10-22T10:30:00.000Z"), at(r1, "2026-10-22T11:00:00.000+00:00")].map((signalRow) => ({ signal: signalRow, run: {} as never }));
    expect(recentRunsOnly(rows, 1).map((x) => x.signal.runId)).toEqual([r1.id]);
    expect(store.kind).toBe("memory");
  });

  it("recentRunsOnly keeps arrival order", async () => {
    const { store } = await seeded();
    const rows = (await store.selectSignals({ userId: USER })).map((signalRow) => ({ signal: signalRow, run: {} as never }));
    expect(recentRunsOnly(rows, 5)).toEqual(rows);
    expect(recentRunsOnly(rows, 0)).toEqual([]);
  });
});
