import { describe, expect, it } from "vitest";
import { listPicks, listSeeds, saveReaction, savePicks, saveSeeds, DbWriteError } from "./saves";
import { createFakeDb, syntheticPick, syntheticSeed } from "./testing";

const A = { id: "00000000-0000-4000-8000-000000000011", email: null };
const B = { id: "00000000-0000-4000-8000-000000000022", email: null };

describe("saving for a signed-in user", () => {
  it("saves seeds, picks and a reaction under the user's id, and lists them back with the reaction on the card", async () => {
    const db = createFakeDb();
    await saveSeeds(db.client, A, [syntheticSeed(1)], { "seed-1": ["urn:tag:fixture:theme:a"] });
    await savePicks(db.client, A, [syntheticPick(1), syntheticPick(2)]);
    await saveReaction(db.client, A, "pick-1", { state: "will_try", words: "soon" });
    await saveReaction(db.client, A, "pick-1", { state: "tried", liked: true, notes: "good" });

    expect(db.tables.seeds[0]).toMatchObject({ user_id: A.id, why_tag_ids: ["urn:tag:fixture:theme:a"], reason: "invented reason 1" });
    expect(db.tables.picks.every((r) => r.user_id === A.id)).toBe(true);
    expect(db.tables.reactions).toHaveLength(1);
    expect(db.tables.reactions[0]).toMatchObject({ state: "tried", tried: true, liked: true });

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
