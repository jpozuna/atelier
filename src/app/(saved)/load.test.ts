import { describe, expect, it } from "vitest";
import { saveProfileSnapshot, saveReaction, savePicks, saveSeeds } from "@/lib/db/saves";
import { createFakeAuthClient, createFakeDb, syntheticPick, syntheticSeed } from "@/lib/db/testing";
import type { AtelierClient } from "@/lib/db/server";
import { FIXTURE_INPUTS, makeFixtureResult } from "@/components/deck/fixture";
import { loadFollowUpSource, loadSaved } from "./load";

const A = { id: "00000000-0000-4000-8000-000000000091", email: "reader@example.test" };
const B = { id: "00000000-0000-4000-8000-000000000092", email: null };

/** The fake database for `from`, and a scripted session for `auth`. */
function client(db: ReturnType<typeof createFakeDb>, claims: Record<string, unknown> | null): AtelierClient {
  const auth = createFakeAuthClient({ claims }).client as unknown as { auth: unknown };
  return { from: (db.client as unknown as { from: unknown }).from, auth: auth.auth } as unknown as AtelierClient;
}

async function seeded() {
  const db = createFakeDb();
  await saveSeeds(db.client, A, [syntheticSeed(1)]);
  await savePicks(db.client, A, [syntheticPick(1), syntheticPick(2), syntheticPick(3)]);
  await saveReaction(db.client, A, "pick-1", { state: "explore", words: "the quiet of it" });
  await saveReaction(db.client, A, "pick-2", { state: "tried", how: "liked", words: "it held up" });
  await saveSeeds(db.client, B, [syntheticSeed(1)]);
  await savePicks(db.client, B, [syntheticPick(9)]);
  await saveReaction(db.client, B, "pick-9", { state: "later", words: "not yours" });
  return db;
}

describe("loadSaved", () => {
  it("is a guest for no session, and reads nothing", async () => {
    const db = await seeded();
    const before = db.calls.length;
    expect(await loadSaved(client(db, null))).toEqual({ kind: "guest" });
    expect(db.calls.length).toBe(before);
  });

  it("returns only the signed-in person's picks, each with its stored card, reaction and how it went", async () => {
    const db = await seeded();
    const out = await loadSaved(client(db, { sub: A.id, email: A.email }));
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.userId).toBe(A.id);
    expect(out.items.map((i) => i.id).sort()).toEqual(["pick-1", "pick-2", "pick-3"]);
    expect(out.items.some((i) => i.id === "pick-9")).toBe(false);
    const one = out.items.find((i) => i.id === "pick-1")!;
    expect(one.card.reaction).toMatchObject({ state: "explore", words: "the quiet of it" });
    expect(one.card.path.hops.map((h) => h.kind)).toEqual(["seed", "theme", "pick"]);
    expect(out.items.find((i) => i.id === "pick-2")).toMatchObject({ tried: true, how: "liked" });
    expect(out.items.find((i) => i.id === "pick-1")).toMatchObject({ tried: false, how: null });
    expect(out.items.find((i) => i.id === "pick-3")?.card.reaction).toBeUndefined();
    // Every read was filtered to the caller, and the follow-up comes from the same two reads (no extra query).
    const reads = db.calls.slice(-2);
    expect(reads.map((c) => c.table)).toEqual(["picks", "reactions"]);
    for (const c of reads) expect(c.filters).toContainEqual(["user_id", A.id]);
  });

  it("shows another person only their own", async () => {
    const db = await seeded();
    const out = await loadSaved(client(db, { sub: B.id }));
    expect(out.kind === "ok" && out.items.map((i) => i.id)).toEqual(["pick-9"]);
  });

  it("answers failed on a database error and unavailable when Supabase is not configured, with no error text", async () => {
    const db = await seeded();
    const c = client(db, { sub: A.id });
    db.failNext({ code: "XX000", message: "secret detail" });
    const failed = await loadSaved(c);
    expect(failed).toEqual({ kind: "failed" });

    const { DbConfigError } = await import("@/lib/db/server");
    const unconfigured = {
      auth: {
        getClaims: async () => {
          throw new DbConfigError("NEXT_PUBLIC_SUPABASE_URL is not set");
        },
      },
    } as unknown as AtelierClient;
    expect(await loadSaved(unconfigured)).toEqual({ kind: "unavailable" });
  });
});

describe("loadFollowUpSource", () => {
  const snapshot = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: makeFixtureResult().plan };

  it("reads the account's own seeds and snapshot, so the follow-up works on any device", async () => {
    const db = await seeded();
    await saveProfileSnapshot(db.client, A, snapshot);
    await saveProfileSnapshot(db.client, B, { ...snapshot, plan: null });
    const saved = await loadSaved(client(db, { sub: A.id }));
    if (saved.kind !== "ok") throw new Error("expected ok");
    const source = await loadFollowUpSource(saved, "film");
    expect(source?.seeds.map((s) => s.id)).toEqual(["seed-1"]);
    expect(source?.plan).toEqual(snapshot.plan);
    expect(source?.axes).toEqual(snapshot.axes);
    // Saved picks of that field only, the person's own.
    expect(source?.shownIds.sort()).toEqual(saved.items.filter((i) => i.field === "film").map((i) => i.qlooId as string).sort());
  });

  it("is null when the account has no snapshot yet, or a read fails", async () => {
    const db = await seeded();
    const saved = await loadSaved(client(db, { sub: A.id }));
    if (saved.kind !== "ok") throw new Error("expected ok");
    expect(await loadFollowUpSource(saved, "film")).toBeNull();
    await saveProfileSnapshot(db.client, A, snapshot);
    db.failNext({ message: "boom" });
    expect(await loadFollowUpSource(saved, "film")).toBeNull();
  });
});
