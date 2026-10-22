// The private run log as seen from /api/reactions: saves and "not interested" become signals on the run that showed the
// pick, fire-and-forget, never failing a save and never visible to the browser. All data is synthetic.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthRequiredError } from "@/lib/db/auth";
import { createFakeDb } from "@/lib/db/testing";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "@/components/deck/fixture";
import { toWireItem } from "@/components/reactions/request";
import type { SaveBody } from "@/components/reactions/wire";
import { createRunLog, hashProfile, type RunLog } from "@/lib/runlog";
import { createMemoryStore } from "@/lib/runlog/store-memory";
import { handleSave, handleUpdate, type ReactionsDeps } from "./handler";

const A = { id: "00000000-0000-4000-8000-000000000091", email: null };
const result = makeFixtureResult();
const picks = result.domains.flatMap((d) => d.picks);
const musicPick = picks.find((p) => p.field === "music" && p.band === "moderate")!;
const filmPick = picks.find((p) => p.field === "film" && p.band === "high")!;

const post = (body: unknown) =>
  new Request("http://localhost/api/reactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = (body: unknown) =>
  new Request("http://localhost/api/reactions/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 25));

function setup(user: typeof A | null = A) {
  const db = createFakeDb();
  const store = createMemoryStore();
  let n = 700;
  const runLog = createRunLog(store, { newId: () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}` });
  const deps: ReactionsDeps = {
    createClient: async () => db.client,
    requireUser: async () => {
      if (!user) throw new AuthRequiredError();
      return user;
    },
    runLog,
  };
  return { db, store, runLog, deps };
}

/** A run that showed both picks, made by the person (or by a guest). */
async function showRun(runLog: RunLog, userId: string | null) {
  await runLog.recordRun({
    seeds: FIXTURE_SEEDS.map((s) => ({ id: s.id, field: s.field, typed: s.typed, why: s.why, qlooId: s.qlooId })),
    tagIds: ["urn:tag:genre:invented"],
    userId,
    events: [],
    result: { domains: [{ picks: [musicPick, filmPick].map((p) => ({ id: p.id, qlooId: p.qlooId })) }], plan: { themes: [], requeries: [] }, meta: {}, audit: {} },
  });
}

const body = (snapshot?: SaveBody["snapshot"]): SaveBody => ({
  seeds: FIXTURE_SEEDS,
  ...(snapshot ? { snapshot } : {}),
  items: [toWireItem(musicPick, { state: "explore", words: "the quiet" }), toWireItem(filmPick, { state: "not_interested", words: "too ornate" })],
});

describe("POST /api/reactions logs signals", () => {
  it("records a save and a not-interested against the run that showed them, with the words", async () => {
    const { store, runLog, deps } = setup();
    await showRun(runLog, A.id);
    const res = await handleSave(post(body()), deps);
    expect(res.status).toBe(200);
    await settle();
    expect(store.signals.map((s) => [s.pickId, s.signal, s.why, s.source, s.userId])).toEqual([
      [musicPick.id, "saved_explore", "the quiet", "reaction", A.id],
      [filmPick.id, "not_interested", "too ornate", "reaction", A.id],
    ]);
    expect(store.signals.every((s) => s.runId === store.runs[0]!.id)).toBe(true);
  });

  it("finds a run made as a guest through the snapshot's profile hash", async () => {
    const { store, runLog, deps } = setup();
    await runLog.recordRun({
      seeds: FIXTURE_SEEDS.map((s) => ({ id: s.id, field: s.field, typed: s.typed, why: s.why, qlooId: s.qlooId })),
      tagIds: FIXTURE_SNAPSHOT.profile.tags.map((t) => t.tag),
      userId: null,
      events: [],
      result: { domains: [{ picks: [{ id: musicPick.id, qlooId: musicPick.qlooId }] }], plan: null, meta: {}, audit: {} },
    });
    await handleSave(post(body(FIXTURE_SNAPSHOT)), deps);
    await settle();
    expect(store.signals.map((s) => [s.pickId, s.signal])).toEqual([[musicPick.id, "saved_explore"]]);
    expect(hashProfile({ seeds: FIXTURE_SEEDS, tagIds: FIXTURE_SNAPSHOT.profile.tags.map((t) => t.tag) })).toBe(store.runs[0]!.profileHash);
  });

  it("writes nothing for a guest (the save is refused)", async () => {
    const { store, runLog, deps } = setup(null);
    await showRun(runLog, null);
    expect((await handleSave(post(body()), deps)).status).toBe(401);
    await settle();
    expect(store.signals).toEqual([]);
  });

  it("does not fail the save when the log fails, and the answer carries no log data", async () => {
    const { store, runLog, deps } = setup();
    await showRun(runLog, A.id);
    store.insertSignals = async () => {
      throw new Error("db down: log row");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleSave(post(body()), deps);
    const text = await res.text();
    await settle();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ saved: 2, userId: A.id });
    expect(text).not.toContain(store.runs[0]!.id);
    warn.mockRestore();
  });

  it("is fire-and-forget: the answer comes back while the write is pending", async () => {
    const { store, runLog, deps } = setup();
    await showRun(runLog, A.id);
    store.insertSignals = () => new Promise(() => {});
    const res = await handleSave(post(body()), deps);
    expect(res.status).toBe(200);
  });

  it("logs nothing when no log is given or it is off", async () => {
    const { store, runLog, deps } = setup();
    await showRun(runLog, A.id);
    await handleSave(post(body()), { ...deps, runLog: undefined });
    await handleSave(post(body()), { ...deps, runLog: { ...runLog, store: { ...store, kind: "off" } } });
    await settle();
    expect(store.signals).toEqual([]);
  });
});

describe("PUT /api/reactions/<pickId> logs signals", () => {
  async function saved() {
    const s = setup();
    await showRun(s.runLog, A.id);
    await handleSave(post(body()), s.deps);
    await settle();
    s.store.signals.length = 0;
    return s;
  }

  it("records a change of state, and a follow-up that says the person tried it", async () => {
    const { store, deps } = await saved();
    expect((await handleUpdate(put({ state: "will_try" }), musicPick.id, deps)).status).toBe(200);
    expect((await handleUpdate(put({ state: "explore", tried: true, how: "liked", words: "worth it" }), musicPick.id, deps)).status).toBe(200);
    await settle();
    expect(store.signals.map((s) => [s.signal, s.why])).toEqual([
      ["saved_try", null],
      ["saved_explore", "worth it"],
      ["tried", "worth it"],
    ]);
  });

  it("records the not-interested reason", async () => {
    const { store, deps } = await saved();
    await handleUpdate(put({ state: "not_interested", words: "not for me" }), filmPick.id, deps);
    await settle();
    expect(store.signals.map((s) => [s.pickId, s.signal, s.why])).toEqual([[filmPick.id, "not_interested", "not for me"]]);
  });

  it("writes no signal when the pick is not the person's saved pick", async () => {
    const { store, deps } = await saved();
    expect((await handleUpdate(put({ state: "later" }), "pick-unknown", deps)).status).toBe(404);
    await settle();
    expect(store.signals).toEqual([]);
  });
});

// The deck fixture's profile and axes (synthetic), so the profile hash has something to hash.
const FIXTURE_SNAPSHOT = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: result.plan };
