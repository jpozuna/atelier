import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { TraceEvent } from "@/types";
import {
  createRunLog,
  createRunLogStore,
  hashProfile,
  readRun,
  readRunsByProfile,
  readRunsByUser,
  readSignalsByProfile,
  readSignalsByUser,
  runInBackground,
  signalOfReaction,
  RUN_SIGNALS,
  type RunEntry,
} from "./index";
import { createMemoryStore } from "./store-memory";

// Synthetic data only: invented ids shaped 00000000-0000-4000-8000-0000000000NN.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = id(91);
const OTHER = id(92);
const SEEDS = [
  { id: "s1", field: "film", typed: "Invented Film", why: "its quiet", qlooId: id(1) },
  { id: "s2", field: "music", typed: "Invented Album", why: "the hush", qlooId: id(2) },
];
const TAGS = ["urn:tag:genre:invented-a", "urn:tag:genre:invented-b"];
const event = (kind: string): TraceEvent => ({ t: 0, kind, say: "x" }) as unknown as TraceEvent;

function run(over: Partial<RunEntry> = {}): RunEntry {
  return {
    seeds: SEEDS,
    tagIds: TAGS,
    userId: null,
    events: [event("score")],
    result: {
      domains: [
        { picks: [{ id: `pick-${id(10)}`, qlooId: id(10) }, { id: `pick-${id(11)}`, qlooId: id(11) }] },
        { picks: [{ id: `pick-${id(12)}`, qlooId: id(12) }] },
      ],
      plan: { themes: [], requeries: [] },
      meta: { requeries: [] },
      audit: { seedIds: [id(1)] },
    },
    ...over,
  };
}

function setup() {
  const store = createMemoryStore();
  let n = 100;
  let tick = 0;
  const log = createRunLog(store, { newId: () => id(n++), now: () => new Date(Date.UTC(2026, 9, 22, 12, 0, tick++)) });
  return { store, log };
}

describe("hashProfile", () => {
  it("is a sha256 hex, stable under order, and ignores the person's words", () => {
    const a = hashProfile({ seeds: [{ id: "s1", qlooId: id(1) }, { id: "s2", qlooId: id(2) }], tagIds: ["b", "a"] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashProfile({ seeds: [{ id: "s2", qlooId: id(2) }, { id: "s1", qlooId: id(1) }], tagIds: ["a", "b", "a"] })).toBe(a);
  });
  it("changes when a seed or a tag changes", () => {
    const a = hashProfile({ seeds: [{ id: "s1", qlooId: id(1) }], tagIds: ["a"] });
    expect(hashProfile({ seeds: [{ id: "s1", qlooId: id(3) }], tagIds: ["a"] })).not.toBe(a);
    expect(hashProfile({ seeds: [{ id: "s1", qlooId: id(1) }], tagIds: ["a", "b"] })).not.toBe(a);
  });
});

describe("signals", () => {
  it("maps every reaction state to a run signal", () => {
    expect(signalOfReaction("later")).toBe("saved_later");
    expect(signalOfReaction("will_try")).toBe("saved_try");
    expect(signalOfReaction("explore")).toBe("saved_explore");
    expect(signalOfReaction("not_interested")).toBe("not_interested");
    expect(signalOfReaction("tried")).toBe("tried");
    expect(RUN_SIGNALS).toContain("not_me");
  });
});

describe("recordRun", () => {
  it("writes one row with the unredacted trace, the plan and the kept picks as parallel lists", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER, exclude: [id(50)], domains: ["film"] }));
    expect(store.runs).toHaveLength(1);
    const row = store.runs[0]!;
    expect(row.outcome).toBe("ok");
    expect(row.errorCode).toBeNull();
    expect(row.userId).toBe(USER);
    expect(row.profileHash).toBe(hashProfile({ seeds: SEEDS, tagIds: TAGS }));
    expect(row.keptPickIds).toEqual([`pick-${id(10)}`, `pick-${id(11)}`, `pick-${id(12)}`]);
    expect(row.keptEntityIds).toEqual([id(10), id(11), id(12)]);
    expect(row.plan).toEqual({ themes: [], requeries: [] });
    expect(row.trace.events).toHaveLength(1);
    expect(row.trace.audit).toEqual({ seedIds: [id(1)] });
    expect(row.input).toMatchObject({ exclude: [id(50)], domains: ["film"] });
    expect(row.input.seeds[0]).toMatchObject({ typed: "Invented Film", why: "its quiet" });
  });

  it("writes a failed run with its code and the events so far, and no kept picks", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ result: null, errorCode: "upstream", events: [event("score"), event("score")] }));
    const row = store.runs[0]!;
    expect(row.outcome).toBe("failed");
    expect(row.errorCode).toBe("upstream");
    expect(row.trace.events).toHaveLength(2);
    expect(row.keptPickIds).toEqual([]);
    expect(row.plan).toBeNull();
  });

  it("records an explicit not-me list as not_me against the run that showed each id, skipping unknown ids", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER }));
    const first = store.runs[0]!;
    await log.recordRun(run({ userId: USER, exclude: [id(10), id(12), id(77)], notMe: [id(10), id(77)], result: { ...run().result!, domains: [{ picks: [{ id: `pick-${id(20)}`, qlooId: id(20) }] }] } }));
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0]).toMatchObject({ runId: first.id, pickId: `pick-${id(10)}`, entityId: id(10), signal: "not_me", source: "not_me_list", userId: USER });
  });

  it("infers not_me from exclude alone, labelled as inferred, and never twice for the same pick", async () => {
    const { store, log } = setup();
    await log.recordRun(run());
    const first = store.runs[0]!;
    const rerun = () => run({ exclude: [id(10), id(11)], result: { ...run().result!, domains: [] } });
    await log.recordRun(rerun());
    await log.recordRun(rerun());
    expect(store.signals.map((s) => [s.runId, s.pickId, s.source])).toEqual([
      [first.id, `pick-${id(10)}`, "exclude"],
      [first.id, `pick-${id(11)}`, "exclude"],
    ]);
  });

  it("attributes an id to the newest run that showed it, and only within the same profile", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ tagIds: ["urn:tag:genre:other-profile"] }));
    await log.recordRun(run());
    await log.recordRun(run());
    const [, mine1, mine2] = store.runs;
    expect(mine1!.id).not.toBe(mine2!.id);
    await log.recordRun(run({ exclude: [id(12)], notMe: [id(12)] }));
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0]!.runId).toBe(mine2!.id);
  });

  it("falls back to the person's own newest run when no run of this profile showed the id", async () => {
    const { store, log } = setup();
    // The same person ran a different profile that showed the id.
    await log.recordRun(run({ userId: USER, tagIds: ["urn:tag:genre:other-profile"] }));
    const earlier = store.runs[0]!;
    await log.recordRun(run({ userId: USER, exclude: [id(11)], notMe: [id(11)], result: { ...run().result!, domains: [] } }));
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0]).toMatchObject({ runId: earlier.id, entityId: id(11), signal: "not_me", userId: USER });
    // Another person's run of another profile is not matched.
    const second = setup();
    await second.log.recordRun(run({ userId: OTHER, tagIds: ["urn:tag:genre:other-profile"] }));
    await second.log.recordRun(run({ userId: USER, exclude: [id(11)], result: { ...run().result!, domains: [] } }));
    expect(second.store.signals).toEqual([]);
  });

  it("makes no signal when nothing is excluded", async () => {
    const { store, log } = setup();
    await log.recordRun(run());
    expect(store.signals).toEqual([]);
  });
});

describe("recordReactions", () => {
  it("records each signal on the run that showed the pick, with the person's words and the entity id", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER }));
    await log.recordReactions({ userId: USER, items: [{ pickId: `pick-${id(11)}`, signals: ["not_interested"], words: "too ornate" }, { pickId: `pick-${id(12)}`, signals: ["saved_explore", "tried"] }] });
    expect(store.signals.map((s) => [s.pickId, s.signal, s.why, s.entityId, s.source, s.userId])).toEqual([
      [`pick-${id(11)}`, "not_interested", "too ornate", id(11), "reaction", USER],
      [`pick-${id(12)}`, "saved_explore", null, id(12), "reaction", USER],
      [`pick-${id(12)}`, "tried", null, id(12), "reaction", USER],
    ]);
  });

  it("repeating a reaction records it once; a new state is a new row", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER }));
    const item = (signal: "saved_later" | "saved_try") => ({ userId: USER, items: [{ pickId: `pick-${id(10)}`, signals: [signal] }] });
    await log.recordReactions(item("saved_later"));
    await log.recordReactions(item("saved_later"));
    await log.recordReactions(item("saved_try"));
    expect(store.signals.map((s) => s.signal)).toEqual(["saved_later", "saved_try"]);
  });

  it("a repeated reaction with a new why updates the row, and without words keeps the earlier why", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER }));
    const send = (words?: string) => log.recordReactions({ userId: USER, items: [{ pickId: `pick-${id(10)}`, signals: ["not_interested"], words }] });
    await send("too ornate");
    await send("too ornate, and too long");
    expect(store.signals.map((s) => s.why)).toEqual(["too ornate, and too long"]);
    await send();
    expect(store.signals.map((s) => s.why)).toEqual(["too ornate, and too long"]);
  });

  it("finds a guest's run through the profile hash, and later through the person's earlier signal", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: null }));
    const guestRun = store.runs[0]!;
    const profileHash = hashProfile({ seeds: SEEDS, tagIds: TAGS });
    await log.recordReactions({ userId: USER, profileHash, items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later"] }] });
    expect(store.signals[0]!.runId).toBe(guestRun.id);
    // No hash this time (an update), and the run has no user: the earlier signal names the run.
    await log.recordReactions({ userId: USER, items: [{ pickId: `pick-${id(10)}`, signals: ["saved_try"] }] });
    expect(store.signals.map((s) => s.runId)).toEqual([guestRun.id, guestRun.id]);
  });

  it("does not attach one person's reaction to another person's run", async () => {
    const { store, log } = setup();
    await log.recordRun(run({ userId: OTHER }));
    await log.recordReactions({ userId: USER, items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later"] }] });
    expect(store.signals).toEqual([]);
  });

  it("skips a pick no run showed", async () => {
    const { store, log } = setup();
    await log.recordReactions({ userId: USER, items: [{ pickId: "pick-unknown", signals: ["saved_later"] }] });
    expect(store.signals).toEqual([]);
  });
});

describe("read API", () => {
  async function seeded() {
    const { store, log } = setup();
    await log.recordRun(run({ userId: USER }));
    await log.recordRun(run({ userId: null, tagIds: ["urn:tag:genre:guest-profile"] }));
    await log.recordReactions({ userId: USER, items: [{ pickId: `pick-${id(10)}`, signals: ["saved_later"] }] });
    await log.recordRun(run({ userId: USER, exclude: [id(11)], notMe: [id(11)], result: { ...run().result!, domains: [] } }));
    return { store, log };
  }

  it("reads signals by user, each with its run summary and no trace", async () => {
    const { store } = await seeded();
    const rows = await readSignalsByUser(USER, { store });
    expect(rows.map((r) => r.signal.signal)).toEqual(["saved_later", "not_me"]);
    for (const r of rows) {
      expect(r.run.id).toBe(r.signal.runId);
      expect(r.run.plan).toEqual({ themes: [], requeries: [] });
      expect(r.run).not.toHaveProperty("trace");
    }
    expect(await readSignalsByUser(OTHER, { store })).toEqual([]);
  });

  it("reads signals by profile hash, covering guests", async () => {
    const { store } = await seeded();
    const hash = hashProfile({ seeds: SEEDS, tagIds: TAGS });
    expect((await readSignalsByProfile(hash, { store })).map((r) => r.signal.signal)).toEqual(["saved_later", "not_me"]);
    expect(await readSignalsByProfile(hashProfile({ seeds: [], tagIds: [] }), { store })).toEqual([]);
  });

  it("lists runs by user and profile, newest first, and reads one run with its trace", async () => {
    const { store } = await seeded();
    const byUser = await readRunsByUser(USER, { store });
    expect(byUser).toHaveLength(2);
    expect(byUser[0]!.createdAt >= byUser[1]!.createdAt).toBe(true);
    expect(await readRunsByProfile(hashProfile({ seeds: SEEDS, tagIds: TAGS }), { store })).toHaveLength(2);
    const full = await readRun(byUser[0]!.id, { store });
    expect(full?.trace.events).toHaveLength(1);
    expect(await readRun(id(999), { store })).toBeNull();
  });
});

describe("runInBackground", () => {
  it("returns at once even when the task never finishes", () => {
    expect(runInBackground(() => new Promise(() => {}))).toBeUndefined();
  });

  it("swallows a rejection and a synchronous throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let handed: Promise<unknown> | undefined;
    runInBackground(() => Promise.reject(new Error("db said: secret row text")), (p) => (handed = p));
    runInBackground(() => {
      throw new Error("sync");
    });
    await expect(handed).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    // A fixed line, never the error's own text.
    expect(warn.mock.calls.every((c) => c.join(" ") === "run log: a write failed and was skipped")).toBe(true);
    warn.mockRestore();
  });

  it("swallows a host hook that throws", () => {
    expect(() =>
      runInBackground(
        async () => {},
        () => {
          throw new Error("outside a request");
        },
      ),
    ).not.toThrow();
  });
});

describe("createRunLogStore", () => {
  it("is off when ATELIER_RUNLOG=off, and under test", () => {
    expect(createRunLogStore({ ATELIER_RUNLOG: "off" }).kind).toBe("off");
    expect(createRunLogStore({ NODE_ENV: "test" }).kind).toBe("off");
  });
  it("is off on Vercel without Supabase env (read-only filesystem), and still uses Supabase there with it", () => {
    expect(createRunLogStore({ VERCEL: "1" }).kind).toBe("off");
    expect(createRunLogStore({ VERCEL: "1", ATELIER_RUNLOG: "file" }).kind).toBe("file");
    expect(createRunLogStore({ VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x" }).kind).toBe("supabase");
  });
  it("uses files without Supabase env, and Supabase with the service role env", () => {
    expect(createRunLogStore({}).kind).toBe("file");
    expect(createRunLogStore({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).kind).toBe("file");
    expect(createRunLogStore({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "x" }).kind).toBe("supabase");
    expect(createRunLogStore({ ATELIER_RUNLOG: "file", NODE_ENV: "test" }).kind).toBe("file");
  });
});
