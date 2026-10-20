import { describe, expect, it } from "vitest";
import { DbMappingError, pickToRow, reactionToRow, rowToCard, rowToReaction, rowToSeed, seedToRow } from "./mappers";
import type { PickRow, ReactionRow } from "./database.types";
import { syntheticPick, syntheticSeed } from "./testing";

const USER = "00000000-0000-4000-8000-000000000011";

describe("seeds", () => {
  it("maps a seed with its reason and deduplicated why-tag ids", () => {
    const row = seedToRow(USER, syntheticSeed(1), ["urn:tag:fixture:theme:a", "urn:tag:fixture:theme:a", "urn:tag:fixture:theme:b"]);
    expect(row).toMatchObject({ user_id: USER, id: "seed-1", reason: "invented reason 1", qloo_id: "00000000-0000-4000-8000-000000000001", status: "clean" });
    expect(row.why_tag_ids).toEqual(["urn:tag:fixture:theme:a", "urn:tag:fixture:theme:b"]);
  });

  it("round-trips to a Seed (candidates are not stored)", () => {
    const seed = syntheticSeed(2);
    const row = { ...seedToRow(USER, seed), created_at: "2026-10-19T00:00:00Z", reason: seed.why, why_tag_ids: [] };
    expect(rowToSeed(row as never)).toEqual(seed);
  });

  it("refuses a seed that breaks the contract", () => {
    expect(() => seedToRow(USER, syntheticSeed(3, { qlooId: null }))).toThrow(DbMappingError);
  });
});

describe("picks", () => {
  it("stores the path and the card without the reaction, and no reach numbers", () => {
    const pick = syntheticPick(1);
    pick.card = { ...pick.card, reaction: { state: "later", at: "2026-10-19T00:00:00Z" } };
    const row = pickToRow(USER, pick);
    expect(row.path).toEqual(JSON.parse(JSON.stringify(pick.path)));
    expect(row.card).not.toHaveProperty("reaction");
    expect(row.seed_id).toBe("seed-1");
    const keys = Object.keys(row);
    for (const banned of ["reach", "connection", "popularity", "score", "rank"]) expect(keys).not.toContain(banned);
    expect(pick.card.reaction).toBeDefined(); // input untouched
  });

  it("allows a bridged pick with no Qloo id, and refuses any other pick without one", () => {
    const bridged = syntheticPick(4, "seed-1", { llmBridged: true, qlooId: "" });
    expect(pickToRow(USER, bridged).qloo_id).toBeNull();
    expect(() => pickToRow(USER, syntheticPick(5, "seed-1", { qlooId: "" }))).toThrow(DbMappingError);
    expect(pickToRow(USER, syntheticPick(6)).qloo_id).toBe("00000000-0000-4000-8000-000000000056");
  });

  it("refuses a card whose path differs from the pick's path", () => {
    const pick = syntheticPick(1);
    pick.card = { ...pick.card, path: { ...pick.path, sharedTags: ["urn:tag:fixture:theme:other"] } };
    expect(() => pickToRow(USER, pick)).toThrow(/differ/);
  });

  it("refuses a card that is not a valid Card", () => {
    const pick = syntheticPick(1);
    pick.card = { ...pick.card, why: 5 as unknown as string };
    expect(() => pickToRow(USER, pick)).toThrow(DbMappingError);
  });

  it("reads a stored card back, attaching the reaction from its own row", () => {
    const pick = syntheticPick(1);
    const row = { ...pickToRow(USER, pick), created_at: "2026-10-19T00:00:00Z" } as unknown as PickRow;
    expect(rowToCard(row)).toEqual(JSON.parse(JSON.stringify(pick.card)));
    const reaction = { user_id: USER, pick_id: "pick-1", state: "explore", why: "wanted more", tried: false, liked: null, notes: null, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T01:00:00Z" } as ReactionRow;
    expect(rowToCard(row, reaction).reaction).toEqual({ state: "explore", words: "wanted more", at: "2026-10-19T01:00:00.000Z" });
  });

  it("throws on a stored card that no longer satisfies the contract", () => {
    const row = { id: "pick-9", card: { nope: true } } as unknown as PickRow;
    expect(() => rowToCard(row)).toThrow(DbMappingError);
  });
});

describe("reactions", () => {
  it("defaults tried from the state and only keeps liked once tried", () => {
    expect(reactionToRow(USER, "pick-1", { state: "tried", liked: true, notes: "n" })).toMatchObject({ tried: true, liked: true, notes: "n", why: null });
    expect(reactionToRow(USER, "pick-1", { state: "later", liked: true })).toMatchObject({ tried: false, liked: null });
    expect(reactionToRow(USER, "pick-1", { state: "not_interested", words: "not for me" })).toMatchObject({ why: "not for me", tried: false });
  });

  it("reads a reaction without empty words", () => {
    const base = { user_id: USER, pick_id: "p", state: "later", why: null, tried: false, liked: null, notes: null, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" } as ReactionRow;
    expect(rowToReaction(base)).toEqual({ state: "later", at: "2026-10-19T00:00:00.000Z" });
  });
});
