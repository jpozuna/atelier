import { describe, expect, it } from "vitest";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "@/components/deck/fixture";
import { buildSaveBody, fetchSessionUser, postSave, putReaction, putSnapshot, pickForWire, reactionUpdate, toWireItem, trimWords } from "./request";
import type { FetchLike } from "./request";

const pick = makeFixtureResult().domains[0].picks[0];
const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("what is sent", () => {
  it("trims the words and drops blank ones", () => {
    expect(trimWords("  a few words  ")).toBe("a few words");
    expect(trimWords("   ")).toBeUndefined();
    expect(trimWords(undefined)).toBeUndefined();
    expect(trimWords("x".repeat(3000))).toHaveLength(2000);
  });

  it("sends the pick's identity, path and card and nothing else, and no reaction timestamp", () => {
    const messy = { ...pick, secret: "x", reach: { reach: 0.9 }, card: { ...pick.card, reaction: { state: "later", at: "t" }, extra: 1 } } as unknown as typeof pick;
    const wire = pickForWire(messy);
    expect(Object.keys(wire).sort()).toEqual(["band", "card", "field", "id", "llmBridged", "name", "origin", "path", "qlooId"]);
    expect(Object.keys(wire.card).sort()).toEqual(["different", "path", "provenance", "why"]);
    expect(JSON.stringify(wire)).not.toMatch(/reach|secret|popularity|connection/);
    const item = toWireItem(pick, { state: "explore", words: " w ", at: "ignored" } as never);
    expect(item.reaction).toEqual({ state: "explore", words: "w" });
    // Blank words are sent as "", so a save from the picks screen can clear what an earlier save stored.
    expect(toWireItem(pick, { state: "explore" }).reaction).toEqual({ state: "explore", words: "" });
  });

  it("a change on a saved card sends the state and words only, never the follow-up", () => {
    expect(reactionUpdate({ state: "will_try", words: " later " })).toEqual({ state: "will_try", words: "later" });
    // No words from the card: none sent, so the stored words (maybe the follow-up's why) are kept.
    expect(reactionUpdate({ state: "later" })).toEqual({ state: "later" });
    for (const body of [reactionUpdate({ state: "tried", words: "w" }), reactionUpdate({ state: "later" })]) {
      expect(Object.keys(body)).not.toContain("tried");
      expect(Object.keys(body)).not.toContain("how");
      expect(Object.keys(body)).not.toContain("addSeed");
    }
  });

  it("keeps a reading on the card when there is one", () => {
    const withReading = { ...pick, card: { ...pick.card, reading: { text: "a reading", sourceUrl: "https://example.org/r" } } };
    expect(pickForWire(withReading).card.reading?.text).toBe("a reading");
  });

  it("builds the save body from seeds and items", () => {
    const body = buildSaveBody(FIXTURE_SEEDS, [toWireItem(pick, { state: "later" })]);
    expect(body.seeds).toHaveLength(6);
    expect(body.items).toHaveLength(1);
    expect(body.snapshot).toBeUndefined();
    const snap = { profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: null };
    expect(buildSaveBody(FIXTURE_SEEDS, [], snap).snapshot).toEqual(snap);
  });
});

describe("what comes back", () => {
  it("reads success, with the account id when given", async () => {
    expect(await postSave({ seeds: [], items: [] }, reply(200, { saved: 1, userId: "u1" }))).toEqual({ kind: "saved", userId: "u1" });
    expect(await putReaction("p", { state: "later" }, reply(200, { ok: true }))).toEqual({ kind: "saved", userId: null });
  });

  it("reads 401 as a guest, and the fixed codes", async () => {
    expect(await postSave({ seeds: [], items: [] }, reply(401, { error: { code: "sign_in_required" } }))).toEqual({ kind: "sign_in" });
    expect(await postSave({ seeds: [], items: [] }, reply(503, { error: { code: "not_ready" } }))).toEqual({ kind: "not_ready" });
    expect(await postSave({ seeds: [], items: [] }, reply(422, { error: { code: "seed_missing" } }))).toEqual({ kind: "seed_missing" });
    expect(await postSave({ seeds: [], items: [] }, reply(422, { error: { code: "too_many_seeds" } }))).toEqual({ kind: "too_many_seeds" });
    expect(await postSave({ seeds: [], items: [] }, reply(500, { error: { code: "save_failed" } }))).toEqual({ kind: "failed" });
  });

  it("treats a network error or a body that is not JSON as a failure", async () => {
    const down: FetchLike = async () => {
      throw new Error("offline");
    };
    expect(await postSave({ seeds: [], items: [] }, down)).toEqual({ kind: "failed" });
    const html: FetchLike = async () => ({ ok: false, status: 502, json: async () => Promise.reject(new Error("not json")) });
    expect(await postSave({ seeds: [], items: [] }, html)).toEqual({ kind: "failed" });
  });

  it("puts to the encoded pick path with JSON", async () => {
    const seen: { url: string; method: string; type: string }[] = [];
    const spy: FetchLike = async (url, init) => {
      seen.push({ url, method: init.method, type: init.headers["Content-Type"] });
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await putReaction("pick a/b", { state: "later" }, spy);
    await postSave({ seeds: [], items: [] }, spy);
    expect(seen).toEqual([
      { url: "/api/reactions/pick%20a%2Fb", method: "PUT", type: "application/json" },
      { url: "/api/reactions", method: "POST", type: "application/json" },
    ]);
  });
});

describe("snapshot and session", () => {
  it("puts the snapshot to its route", async () => {
    const seen: string[] = [];
    const spy: FetchLike = async (url, init) => (seen.push(`${init.method} ${url}`), { ok: true, status: 200, json: async () => ({ ok: true }) });
    await putSnapshot({ profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: null }, spy);
    expect(seen).toEqual(["PUT /api/reactions/snapshot"]);
  });

  it("reads who is signed in: an id, or null for a guest or a failure", async () => {
    const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });
    expect(await fetchSessionUser(ok({ userId: "user-1" }))).toBe("user-1");
    expect(await fetchSessionUser(ok({ userId: null }))).toBeNull();
    expect(await fetchSessionUser(async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await fetchSessionUser(async () => Promise.reject(new Error("offline")))).toBeNull();
  });
});
