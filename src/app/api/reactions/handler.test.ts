import { describe, expect, it } from "vitest";
import { AuthRequiredError } from "@/lib/db/auth";
import { DbConfigError } from "@/lib/db/server";
import { saveSeeds } from "@/lib/db/saves";
import { createFakeDb } from "@/lib/db/testing";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "@/components/deck/fixture";
import type { SaveBody } from "@/components/reactions/wire";
import { toWireItem } from "@/components/reactions/request";
import { handleSave, handleSession, handleSnapshot, handleUpdate, parseSaveBody, parseUpdateBody } from "./handler";
import type { ReactionsDeps } from "./handler";

// All data here is synthetic (the deck fixture): invented names, ids shaped 00000000-0000-4000-8000-0000000000NN.
const A = { id: "00000000-0000-4000-8000-000000000091", email: null };
const B = { id: "00000000-0000-4000-8000-000000000092", email: null };

const result = makeFixtureResult();
const picks = result.domains.flatMap((d) => d.picks);
const musicPick = picks.find((p) => p.field === "music" && p.band === "moderate")!;
const filmPick = picks.find((p) => p.field === "film" && p.band === "high")!;

function deps(db: ReturnType<typeof createFakeDb>, user: typeof A | null = A): ReactionsDeps {
  return {
    createClient: async () => db.client,
    requireUser: async () => {
      if (!user) throw new AuthRequiredError();
      return user;
    },
  };
}

const post = (body: unknown, type = "application/json") =>
  new Request("http://localhost/api/reactions", { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
const put = (body: unknown) =>
  new Request("http://localhost/api/reactions/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const saveBody = (): SaveBody => ({
  seeds: FIXTURE_SEEDS,
  items: [toWireItem(musicPick, { state: "explore", words: " the quiet of it " }), toWireItem(filmPick, { state: "not_interested", words: "too ornate" })],
});

describe("POST /api/reactions", () => {
  it("refuses a guest with 401 and writes nothing", async () => {
    const db = createFakeDb();
    const res = await handleSave(post(saveBody()), deps(db, null));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("sign_in_required");
    expect(db.calls).toHaveLength(0);
  });

  it("saves the seeds, then the picks with their stored paths and cards, then the reactions, all under the user's id", async () => {
    const db = createFakeDb();
    const res = await handleSave(post(saveBody()), deps(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 2, userId: A.id });

    // Writes happen in this order (the reads in between are the merge and the seed-limit check).
    expect(db.calls.filter((c) => c.op === "upsert").map((c) => c.table)).toEqual(["seeds", "picks", "reactions", "reactions"]);
    expect(db.tables.seeds).toHaveLength(6);
    expect(db.tables.picks).toHaveLength(2);
    for (const t of ["seeds", "picks", "reactions"]) expect(db.tables[t].every((r) => r.user_id === A.id)).toBe(true);

    const row = db.tables.picks.find((r) => r.id === musicPick.id)!;
    expect(row.seed_id).toBe(musicPick.path.seedId);
    expect((row.path as { hops: unknown[] }).hops).toHaveLength(musicPick.path.hops.length);
    expect(row.card).not.toHaveProperty("reaction");
    // The stored path carries no explainability contribution, and no taste numbers are stored on the row.
    expect((row.path as { anchor: { contribution: unknown } }).anchor.contribution).toBeNull();
    expect(Object.keys(row).sort()).toEqual(["band", "card", "created_at", "field", "id", "llm_bridged", "name", "origin", "path", "qloo_id", "seed_id", "user_id"]);

    const reactions = db.tables.reactions;
    expect(reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "explore", why: "the quiet of it", tried: false, how: null });
    expect(reactions.find((r) => r.pick_id === filmPick.id)).toMatchObject({ state: "not_interested", why: "too ornate" });
  });

  it("is safe to repeat: the same save twice leaves one row each", async () => {
    const db = createFakeDb();
    await handleSave(post(saveBody()), deps(db));
    await handleSave(post(saveBody()), deps(db));
    expect(db.tables.picks).toHaveLength(2);
    expect(db.tables.reactions).toHaveLength(2);
    expect(db.tables.seeds).toHaveLength(6);
  });

  it("keeps two people's rows apart", async () => {
    const db = createFakeDb();
    await handleSave(post(saveBody()), deps(db, A));
    await handleSave(post(saveBody()), deps(db, B));
    expect(db.tables.picks.filter((r) => r.user_id === A.id)).toHaveLength(2);
    expect(db.tables.picks.filter((r) => r.user_id === B.id)).toHaveLength(2);
  });

  it("refuses a pick whose seed was not sent (every pick keeps its path back to a seed)", async () => {
    const db = createFakeDb();
    const body = saveBody();
    body.seeds = body.seeds.filter((s) => s.id !== musicPick.path.seedId);
    const res = await handleSave(post(body), deps(db));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("seed_missing");
    expect(db.tables.picks ?? []).toHaveLength(0);
  });

  it("refuses a body that is not what the contracts list, and one that is not JSON", async () => {
    const db = createFakeDb();
    const bad = [
      { seeds: FIXTURE_SEEDS, items: [] },
      { seeds: "x", items: [] },
      { seeds: FIXTURE_SEEDS, items: [{ pick: { ...musicPick, field: "cars" }, reaction: { state: "explore" } }] },
      { seeds: FIXTURE_SEEDS, items: [{ pick: musicPick, reaction: { state: "adore" } }] },
      { seeds: FIXTURE_SEEDS, items: [{ pick: { ...musicPick, path: { ...musicPick.path, hops: musicPick.path.hops.slice(0, 2) } }, reaction: { state: "explore" } }] },
    ];
    for (const b of bad) expect((await handleSave(post(b), deps(db))).status).toBe(400);
    expect((await handleSave(post("{nope"), deps(db))).status).toBe(400);
    expect((await handleSave(post(saveBody(), "text/plain"), deps(db))).status).toBe(400);
    expect(db.tables.picks ?? []).toHaveLength(0);
  });

  it("refuses a pick whose card path differs from its path", async () => {
    const db = createFakeDb();
    const item = toWireItem(musicPick, { state: "later" });
    item.pick = { ...item.pick, card: { ...item.pick.card, path: { ...item.pick.card.path, sharedTags: ["urn:tag:fixture:theme:other"] } } };
    const res = await handleSave(post({ seeds: FIXTURE_SEEDS, items: [item] }), deps(db));
    expect(res.status).toBe(400);
  });

  it("answers 503 not_ready when Supabase is not configured, and never repeats database text", async () => {
    const db = createFakeDb();
    const unconfigured: ReactionsDeps = {
      createClient: async () => {
        throw new DbConfigError("NEXT_PUBLIC_SUPABASE_URL is not set.");
      },
      requireUser: async () => A,
    };
    const res = await handleSave(post(saveBody()), unconfigured);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/SUPABASE/);

    db.failNext({ code: "XX000", message: "relation secret_table exploded" });
    const failed = await handleSave(post(saveBody()), deps(db));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toMatch(/secret_table|XX000/);
  });

  it("treats a foreign-key failure as a missing seed", async () => {
    const db = createFakeDb();
    // The seeds upsert succeeds; the picks upsert is the second call.
    const target = db.client as unknown as { from: (table: string) => unknown };
    const real = target.from.bind(target);
    let n = 0;
    target.from = (table: string) => {
      n += 1;
      if (n === 2) db.failNext({ code: "23503", message: "violates foreign key" });
      return real(table);
    };
    const res = await handleSave(post(saveBody()), deps(db));
    expect(res.status).toBe(422);
  });

  it("keeps the profile snapshot with a save, and refuses a snapshot that is not what a run produced", async () => {
    const db = createFakeDb();
    const snapshot = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: result.plan };
    const res = await handleSave(post({ ...saveBody(), snapshot }), deps(db));
    expect(res.status).toBe(200);
    expect(db.tables.profile_snapshots).toHaveLength(1);
    expect(db.tables.profile_snapshots[0]).toMatchObject({ user_id: A.id });

    const bad = createFakeDb();
    for (const broken of [{ ...snapshot, axes: [{ id: 1 }] }, { ...snapshot, profile: { seedIds: [] } }, { ...snapshot, plan: { themes: "x" } }, "nope"]) {
      expect((await handleSave(post({ ...saveBody(), snapshot: broken }), deps(bad))).status).toBe(400);
    }
    expect(bad.tables.picks ?? []).toHaveLength(0);
  });

  it("answers 422 too_many_seeds when the account is at its seed limit and the save would add more", async () => {
    const db = createFakeDb();
    const others = Array.from({ length: 10 }, (_, i) => ({ ...FIXTURE_SEEDS[0], id: `other-${i}`, qlooId: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}` }));
    await saveSeeds(db.client, A, others);
    const res = await handleSave(post(saveBody()), deps(db));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("too_many_seeds");
    expect(db.tables.picks ?? []).toHaveLength(0);
  });

  it("caps the words kept", () => {
    const parsed = parseSaveBody({ seeds: FIXTURE_SEEDS, items: [toWireItem(musicPick, { state: "later" })].map((i) => ({ ...i, reaction: { state: "later", words: "x".repeat(5000) } })) });
    expect(typeof parsed).toBe("object");
    if (typeof parsed === "object") expect(parsed.items[0].reaction.words).toHaveLength(2000);
  });

  it("passes blank words through as a clear, and absent words as keep", () => {
    const item = toWireItem(musicPick, { state: "later" });
    const parsed = parseSaveBody({ seeds: FIXTURE_SEEDS, items: [item, { ...toWireItem(filmPick, { state: "later" }), reaction: { state: "later" } }] });
    expect(typeof parsed).toBe("object");
    if (typeof parsed === "object") {
      expect(parsed.items[0].reaction).toEqual({ state: "later", words: "" });
      expect(parsed.items[1].reaction).toEqual({ state: "later" });
    }
  });
});

describe("PUT /api/reactions/<pickId>", () => {
  async function saved() {
    const db = createFakeDb();
    await handleSave(post(saveBody()), deps(db));
    return db;
  }

  it("refuses a guest", async () => {
    const db = await saved();
    expect((await handleUpdate(put({ state: "later" }), musicPick.id, deps(db, null))).status).toBe(401);
  });

  it("changes the reaction on a saved pick", async () => {
    const db = await saved();
    const res = await handleUpdate(put({ state: "will_try", words: "on a quiet weekend" }), musicPick.id, deps(db));
    expect(res.status).toBe(200);
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "will_try", why: "on a quiet weekend" });
  });

  it("records the follow-up (tried and how it went) and saves a liked pick as a seed", async () => {
    const db = await saved();
    const addSeed = { id: `tried-${musicPick.id}`, field: "music", typed: musicPick.name, why: "it held its silences", qlooId: musicPick.qlooId, status: "clean" };
    const res = await handleUpdate(put({ state: "tried", tried: true, how: "liked", words: "it held its silences", addSeed }), musicPick.id, deps(db));
    expect(res.status).toBe(200);
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "tried", tried: true, how: "liked", why: "it held its silences" });
    expect(db.tables.seeds.find((s) => s.id === addSeed.id)).toMatchObject({ user_id: A.id, status: "clean", reason: "it held its silences" });
  });

  it("records each answer as its own value: liked, mixed, not_liked", async () => {
    const db = await saved();
    for (const how of ["liked", "mixed", "not_liked"] as const) {
      await handleUpdate(put({ state: "tried", tried: true, how }), musicPick.id, deps(db));
      expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ tried: true, how });
    }
  });

  it("a plain state or words change never wipes the follow-up answer", async () => {
    const db = await saved();
    await handleUpdate(put({ state: "tried", tried: true, how: "not_liked", words: "too slow" }), musicPick.id, deps(db));
    // What the card's reaction area sends: a state, and words only when it has some.
    expect((await handleUpdate(put({ state: "later" }), musicPick.id, deps(db))).status).toBe(200);
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "later", tried: true, how: "not_liked", why: "too slow" });
    await handleUpdate(put({ state: "explore", words: "worth another go" }), musicPick.id, deps(db));
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "explore", tried: true, how: "not_liked", why: "worth another go" });
  });

  it("clears the words only when told to with an empty string", async () => {
    const db = await saved();
    await handleUpdate(put({ state: "explore", words: "" }), musicPick.id, deps(db));
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)?.why).toBe("");
  });

  it("refuses a how on a pick that was not tried, and an unknown how", async () => {
    const db = await saved();
    expect((await handleUpdate(put({ state: "later", how: "liked" }), musicPick.id, deps(db))).status).toBe(400);
    expect((await handleUpdate(put({ state: "tried", how: "loved" }), musicPick.id, deps(db))).status).toBe(400);
    expect((await handleUpdate(put({ state: "tried", tried: false, how: "liked" }), musicPick.id, deps(db))).status).toBe(400);
  });

  it("answers 422 too_many_seeds, with fixed copy, when a follow-up seed would pass the account's limit", async () => {
    const db = await saved();
    const others = Array.from({ length: 10 }, (_, i) => ({ ...FIXTURE_SEEDS[0], id: `other-${i}`, qlooId: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}` }));
    await saveSeeds(db.client, A, others.slice(0, 4));
    expect(db.tables.seeds).toHaveLength(10);
    const addSeed = { id: "tried-x", field: "music", typed: "Invented", why: "", qlooId: musicPick.qlooId, status: "clean" };
    const res = await handleUpdate(put({ state: "tried", tried: true, how: "liked", addSeed }), musicPick.id, deps(db));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("too_many_seeds");
    expect(JSON.stringify(body)).not.toMatch(/limit is|stored|existing/);
    // Nothing was written: the answer waits until the person can be told.
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ state: "explore", tried: false });
  });

  it("will not touch another person's pick", async () => {
    const db = await saved();
    const res = await handleUpdate(put({ state: "later" }), musicPick.id, deps(db, B));
    expect(res.status).toBe(404);
    expect(db.tables.reactions.find((r) => r.pick_id === musicPick.id)).toMatchObject({ user_id: A.id, state: "explore" });
    expect(db.tables.reactions.filter((r) => r.user_id === B.id)).toHaveLength(0);
  });

  it("answers 404 for a pick that was never saved", async () => {
    const db = await saved();
    expect((await handleUpdate(put({ state: "later" }), "pick-unknown", deps(db))).status).toBe(404);
  });

  it("refuses a malformed update", async () => {
    const db = await saved();
    for (const b of [{}, { state: "adore" }, { state: "tried", tried: "yes" }, { state: "tried", how: 3 }, { state: "tried", addSeed: { id: "x" } }]) {
      expect((await handleUpdate(put(b), musicPick.id, deps(db))).status).toBe(400);
    }
  });

  it("only accepts a clean, matched seed to add", () => {
    const base = { state: "tried", addSeed: { id: "s", field: "music", typed: "T", why: "", qlooId: null, status: "missing" } };
    expect(parseUpdateBody(base)).toBe("bad_request");
  });
});

describe("PUT /api/reactions/snapshot", () => {
  const snapshot = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: result.plan };
  const req = (body: unknown) => new Request("http://localhost/api/reactions/snapshot", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("refuses a guest, keeps the caller's snapshot, and refuses a malformed one", async () => {
    const db = createFakeDb();
    expect((await handleSnapshot(req(snapshot), deps(db, null))).status).toBe(401);
    expect(db.tables.profile_snapshots ?? []).toHaveLength(0);
    expect((await handleSnapshot(req(snapshot), deps(db))).status).toBe(200);
    expect(db.tables.profile_snapshots).toHaveLength(1);
    expect((await handleSnapshot(req({ ...snapshot, axes: "x" }), deps(db))).status).toBe(400);
    // Replaced, not added to.
    await handleSnapshot(req({ ...snapshot, plan: null }), deps(db));
    expect(db.tables.profile_snapshots).toHaveLength(1);
    expect(db.tables.profile_snapshots[0].plan).toBeNull();
  });

  it("keeps two people's snapshots apart", async () => {
    const db = createFakeDb();
    await handleSnapshot(req(snapshot), deps(db, A));
    await handleSnapshot(req(snapshot), deps(db, B));
    expect(db.tables.profile_snapshots.map((r) => r.user_id).sort()).toEqual([A.id, B.id].sort());
  });
});

describe("GET /api/reactions/session", () => {
  it("says who is signed in, null for a guest or when Supabase is not set up, and writes nothing", async () => {
    const db = createFakeDb();
    expect(await (await handleSession(deps(db, A))).json()).toEqual({ userId: A.id });
    expect(await (await handleSession(deps(db, null))).json()).toEqual({ userId: null });
    const unconfigured: ReactionsDeps = {
      createClient: async () => {
        throw new DbConfigError("x");
      },
      requireUser: async () => A,
    };
    expect(await (await handleSession(unconfigured)).json()).toEqual({ userId: null });
    expect(db.calls).toHaveLength(0);
  });
});
