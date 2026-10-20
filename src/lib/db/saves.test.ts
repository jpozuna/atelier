import { describe, expect, it } from "vitest";
import { MAX_SEEDS_PER_USER } from "@/lib/agent/config";
import {
  DbLimitError,
  DbWriteError,
  getProfileSnapshot,
  listPicks,
  listSeeds,
  saveProfileSnapshot,
  saveReaction,
  savePicks,
  saveSeeds,
} from "./saves";
import { createFakeDb, syntheticAxis, syntheticPick, syntheticPlan, syntheticProfile, syntheticSeed } from "./testing";

const A = { id: "00000000-0000-4000-8000-000000000011", email: null };
const B = { id: "00000000-0000-4000-8000-000000000022", email: null };

describe("saving for a signed-in user", () => {
  it("saves seeds, picks and a reaction under the user's id, and lists them back with the reaction on the card", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, [syntheticSeed(1)], { "seed-1": ["urn:tag:fixture:theme:a"] });
    await savePicks(db.client, A, [syntheticPick(1), syntheticPick(2)]);
    await saveReaction(db.client, A, "pick-1", { state: "will_try", words: "soon" });
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: "liked", notes: "good" });

    expect(db.tables.seeds[0]).toMatchObject({ user_id: A.id, why_tag_ids: ["urn:tag:fixture:theme:a"], reason: "invented reason 1" });
    expect(db.tables.picks.every((r) => r.user_id === A.id)).toBe(true);
    expect(db.tables.reactions).toHaveLength(1);
    expect(db.tables.reactions[0]).toMatchObject({ state: "tried", tried: true, how: "liked" });

    expect((await listSeeds(db.client, A)).map((s) => s.id)).toEqual(["seed-1"]);
    const picks = await listPicks(db.client, A);
    expect(picks.map((p) => p.id).sort()).toEqual(["pick-1", "pick-2"]);
    expect(picks.find((p) => p.id === "pick-1")?.card.reaction?.state).toBe("tried");
    expect(picks.find((p) => p.id === "pick-2")?.card.reaction).toBeUndefined();
    expect(picks.find((p) => p.id === "pick-2")?.card.path.hops[0].kind).toBe("seed");
  });

  it("only lists the caller's rows", async () => {
    const db = createFakeDb();
    await savePicks(db.client, A, [syntheticPick(1)]);
    await savePicks(db.client, B, [syntheticPick(2)]);
    expect((await listPicks(db.client, A)).map((p) => p.id)).toEqual(["pick-1"]);
    expect((await listPicks(db.client, B)).map((p) => p.id)).toEqual(["pick-2"]);
  });

  it("does nothing for an empty batch and throws a typed error on failure", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, []);
    await savePicks(db.client, A, []);
    expect(db.calls).toHaveLength(0);
    db.failNext({ code: "42501", message: "denied" });
    await expect(saveSeeds(db.client, A, [syntheticSeed(1)])).rejects.toBeInstanceOf(DbWriteError);
  });
});

describe("reaction merge semantics", () => {
  async function setup() {
    const db = createFakeDb();
    await saveSeeds(db.client, A, [syntheticSeed(1)]);
    await savePicks(db.client, A, [syntheticPick(1)]);
    return db;
  }
  const row = (db: ReturnType<typeof createFakeDb>) => db.tables.reactions.find((r) => r.pick_id === "pick-1");

  it("a save without tried or how does not clear an existing answer", async () => {
    const db = await setup();
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: "mixed", words: "complicated", notes: "slow start" });
    await saveReaction(db.client, A, "pick-1", { state: "explore" });
    expect(row(db)).toMatchObject({ state: "explore", tried: true, how: "mixed", why: "complicated", notes: "slow start" });
    await saveReaction(db.client, A, "pick-1", { state: "explore", words: "again" });
    expect(row(db)).toMatchObject({ why: "again", how: "mixed" });
  });

  it("mixed and not answered stay different, and the answer can be cleared", async () => {
    const db = await setup();
    await saveReaction(db.client, A, "pick-1", { state: "tried" });
    expect(row(db)?.how).toBeNull();
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: "mixed" });
    expect(row(db)?.how).toBe("mixed");
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: null });
    expect(row(db)?.how).toBeNull();
  });

  it("saying it was not tried clears how", async () => {
    const db = await setup();
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: "not_liked" });
    await saveReaction(db.client, A, "pick-1", { state: "will_try", tried: false });
    expect(row(db)).toMatchObject({ tried: false, how: null });
  });

  it("writes nothing for a contradictory input", async () => {
    const db = await setup();
    await expect(saveReaction(db.client, A, "pick-1", { state: "later", how: "liked" })).rejects.toThrow();
    expect(db.tables.reactions ?? []).toHaveLength(0);
  });

  it("lists the follow-up with the pick, null until a reaction exists", async () => {
    const db = await setup();
    await savePicks(db.client, A, [syntheticPick(2)]);
    await saveReaction(db.client, A, "pick-1", { state: "tried", how: "mixed" });
    const picks = await listPicks(db.client, A);
    expect(picks.find((p) => p.id === "pick-1")?.followUp).toEqual({ tried: true, how: "mixed", notes: null });
    expect(picks.find((p) => p.id === "pick-2")?.followUp).toBeNull();
  });
});

describe("seed cap", () => {
  const many = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => syntheticSeed(from + i));

  it("accepts exactly the cap and refuses one more, writing nothing", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, many(1, MAX_SEEDS_PER_USER));
    expect(db.tables.seeds).toHaveLength(MAX_SEEDS_PER_USER);
    const err = await saveSeeds(db.client, A, [syntheticSeed(99)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbLimitError);
    expect(err).toMatchObject({ limit: MAX_SEEDS_PER_USER, existing: MAX_SEEDS_PER_USER, attempted: MAX_SEEDS_PER_USER + 1 });
    expect(db.tables.seeds).toHaveLength(MAX_SEEDS_PER_USER);
  });

  it("lets an already stored seed be updated at the cap", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, many(1, MAX_SEEDS_PER_USER));
    await saveSeeds(db.client, A, [syntheticSeed(3, { why: "changed" })]);
    expect(db.tables.seeds.find((r) => r.id === "seed-3")?.reason).toBe("changed");
  });

  it("refuses a single batch over the cap, and counts per user", async () => {
    const db = createFakeDb();
    await expect(saveSeeds(db.client, A, many(1, MAX_SEEDS_PER_USER + 1))).rejects.toBeInstanceOf(DbLimitError);
    expect(db.tables.seeds ?? []).toHaveLength(0);
    await saveSeeds(db.client, A, many(1, MAX_SEEDS_PER_USER));
    await saveSeeds(db.client, B, many(1, 2));
    expect(db.tables.seeds.filter((r) => r.user_id === B.id)).toHaveLength(2);
  });

  it("counts a seed repeated inside one batch once", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, [...many(1, MAX_SEEDS_PER_USER), syntheticSeed(1)]);
    expect(db.tables.seeds).toHaveLength(MAX_SEEDS_PER_USER);
  });
});

describe("profile snapshot", () => {
  it("returns null when there is none", async () => {
    expect(await getProfileSnapshot(createFakeDb().client, A)).toBeNull();
  });

  it("saves and reads back the profile, axes and plan, one row per user, replaced on each save", async () => {
    const db = createFakeDb();
    await saveProfileSnapshot(db.client, A, { profile: syntheticProfile(), axes: [syntheticAxis(1)], plan: null });
    expect((await getProfileSnapshot(db.client, A))?.plan).toBeNull();
    await saveProfileSnapshot(db.client, A, { profile: syntheticProfile(), axes: [syntheticAxis(1), syntheticAxis(3)], plan: syntheticPlan() });
    await saveProfileSnapshot(db.client, B, { profile: syntheticProfile(), axes: [syntheticAxis(5)], plan: null });
    expect(db.tables.profile_snapshots).toHaveLength(2);
    const got = await getProfileSnapshot(db.client, A);
    expect(got).toMatchObject({ profile: syntheticProfile(), axes: [syntheticAxis(1), syntheticAxis(3)], plan: syntheticPlan() });
    expect(typeof got?.updatedAt).toBe("string");
    expect((await getProfileSnapshot(db.client, B))?.axes).toHaveLength(1);
  });

  it("writes under the caller's id only, and throws a typed error on failure", async () => {
    const db = createFakeDb();
    await saveProfileSnapshot(db.client, A, { profile: syntheticProfile(), axes: [], plan: null });
    expect(db.tables.profile_snapshots[0]).toMatchObject({ user_id: A.id });
    db.failNext({ code: "42501", message: "denied" });
    await expect(saveProfileSnapshot(db.client, A, { profile: syntheticProfile(), axes: [], plan: null })).rejects.toBeInstanceOf(DbWriteError);
    db.failNext({ code: "42501", message: "denied" });
    await expect(getProfileSnapshot(db.client, A)).rejects.toBeInstanceOf(DbWriteError);
  });

  it("reads a stored snapshot with a broken shape as none", async () => {
    const db = createFakeDb({ profile_snapshots: [{ user_id: A.id, profile: { seedIds: [] }, axes: [{ id: 1 }], plan: null, updated_at: "2026-10-19T00:00:00Z" }] });
    expect(await getProfileSnapshot(db.client, A)).toBeNull();
  });
});
