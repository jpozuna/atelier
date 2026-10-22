// A throw while building the log entry must never turn a successful save into an error. Synthetic data only.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runlog", async (original) => ({
  ...(await original<typeof import("@/lib/runlog")>()),
  hashProfile: () => {
    throw new Error("hash blew up");
  },
  signalOfReaction: () => {
    throw new Error("mapping blew up");
  },
}));

import { AuthRequiredError } from "@/lib/db/auth";
import { createFakeDb } from "@/lib/db/testing";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "@/components/deck/fixture";
import { toWireItem } from "@/components/reactions/request";
import { createRunLog } from "@/lib/runlog";
import { createMemoryStore } from "@/lib/runlog/store-memory";
import { handleSave, handleUpdate, type ReactionsDeps } from "./handler";

const A = { id: "00000000-0000-4000-8000-000000000091", email: null };
const result = makeFixtureResult();
const pick = result.domains.flatMap((d) => d.picks)[0]!;
const req = (method: string, body: unknown) =>
  new Request("http://localhost/api/reactions", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function setup() {
  const db = createFakeDb();
  const store = createMemoryStore();
  const deps: ReactionsDeps = {
    createClient: async () => db.client,
    requireUser: async () => {
      if (!A) throw new AuthRequiredError();
      return A;
    },
    runLog: createRunLog(store),
  };
  return { db, store, deps };
}

describe("a failing log entry", () => {
  it("does not fail a save (hash and mapping both throw)", async () => {
    const { store, deps } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: result.plan };
    const res = await handleSave(req("POST", { seeds: FIXTURE_SEEDS, snapshot, items: [toWireItem(pick, { state: "explore" })] }), deps);
    await new Promise((r) => setTimeout(r, 25));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, userId: A.id });
    expect(store.signals).toEqual([]);
    expect(warn).toHaveBeenCalledWith("run log: a write failed and was skipped");
    warn.mockRestore();
  });

  it("does not fail an update", async () => {
    const { deps } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleSave(req("POST", { seeds: FIXTURE_SEEDS, items: [toWireItem(pick, { state: "explore" })] }), deps);
    const res = await handleUpdate(req("PUT", { state: "will_try" }), pick.id, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, userId: A.id });
  });
});
