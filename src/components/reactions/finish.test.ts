import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixtureResult } from "@/components/deck/fixture";
import { CARRY_STORAGE_KEY } from "./constants";
import { loadCarry, makeCarry, serializeCarry } from "./carry";
import { finishPending, offerTo, pendingCount, recordOffer } from "./finish";
import type { SaveBody } from "./wire";
import { AT, TOKEN, fillSession, installStorages, picksRaw, tasteRaw } from "./testing";

const picks = makeFixtureResult().domains.flatMap((d) => d.picks);
const reactions = { [picks[2].id]: { state: "later" as const, words: "someday", at: AT } };
const record = (picksJson: string | null = picksRaw(reactions)) => makeCarry({ taste: tasteRaw(), picks: picksJson, now: new Date(), token: TOKEN });

afterEach(() => vi.unstubAllGlobals());

describe("finishPending", () => {
  it("saves the seeds, the reacted picks and the profile snapshot after confirmation, then forgets the record", async () => {
    const { local } = installStorages({ atelier_carry: TOKEN });
    const pending = record();
    local.setItem(CARRY_STORAGE_KEY, serializeCarry(pending));
    const bodies: SaveBody[] = [];
    const notice = await finishPending(pending, async (b) => (bodies.push(b), { kind: "saved", userId: "user-1" }));
    expect(notice).toBe("saved");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].seeds).toHaveLength(6);
    expect(bodies[0].items.map((i) => i.pick.id)).toEqual([picks[2].id]);
    expect(bodies[0].items[0].reaction).toEqual({ state: "later", words: "someday" });
    expect(bodies[0].snapshot?.plan).toEqual(makeFixtureResult().plan);
    expect(bodies[0].snapshot?.axes.length).toBeGreaterThan(0);
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
  });

  it("uses the tab's own, newer reactions when it has them", async () => {
    const { session } = installStorages();
    fillSession(session, { ...reactions, [picks[5].id]: { state: "explore", at: AT } });
    const bodies: SaveBody[] = [];
    await finishPending(record(picksRaw({})), async (b) => (bodies.push(b), { kind: "saved", userId: "u" }));
    expect(bodies[0].items.map((i) => i.pick.id).sort()).toEqual([picks[2].id, picks[5].id].sort());
  });

  it("keeps the record when the person is still signed out, the account is full, or the save fails", async () => {
    const { local } = installStorages({ atelier_carry: TOKEN });
    const pending = record();
    local.setItem(CARRY_STORAGE_KEY, serializeCarry(pending));
    expect(await finishPending(pending, async () => ({ kind: "sign_in" }))).toBe("sign_in");
    expect(await finishPending(pending, async () => ({ kind: "failed" }))).toBe("failed");
    expect(await finishPending(pending, async () => ({ kind: "not_ready" }))).toBe("not_ready");
    expect(await finishPending(pending, async () => ({ kind: "too_many_seeds" }))).toBe("too_many_seeds");
    expect(loadCarry()).not.toBeNull();
  });

  it("forgets the record when there was nothing to save, without posting", async () => {
    const { local } = installStorages();
    const pending = record(picksRaw({}));
    local.setItem(CARRY_STORAGE_KEY, serializeCarry(pending));
    const post = vi.fn();
    expect(await finishPending(pending, post)).toBe("none");
    expect(post).not.toHaveBeenCalled();
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
  });

  it("does not post a pick that is no longer in the stored result", async () => {
    installStorages();
    const post = vi.fn();
    expect(await finishPending(record(picksRaw({ "pick-gone": { state: "later", at: AT } })), post)).toBe("none");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("offering a waiting record", () => {
  it("counts the picks the question names", () => {
    installStorages();
    expect(pendingCount(record())).toBe(1);
    expect(pendingCount(record(picksRaw({})))).toBe(0);
    expect(pendingCount(record(picksRaw({ ...reactions, [picks[3].id]: { state: "explore", at: AT } })))).toBe(2);
  });

  it("offers it to the first account that turns up, and never to a different one", () => {
    const { local } = installStorages({ atelier_carry: TOKEN });
    const pending = record();
    expect(offerTo(pending, "user-1")).toBe("offer");
    const marked = recordOffer(pending, "user-1");
    expect(marked.forUser).toBe("user-1");
    expect(JSON.parse(local.getItem(CARRY_STORAGE_KEY)!).forUser).toBe("user-1");
    expect(offerTo(marked, "user-1")).toBe("offer");
    expect(offerTo(marked, "user-2")).toBe("forget");
  });
});
