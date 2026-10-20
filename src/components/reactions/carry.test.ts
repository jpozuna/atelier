import { afterEach, describe, expect, it, vi } from "vitest";
import { PICKS_STORAGE_KEY } from "@/components/deck/constants";
import { FIXTURE_INPUTS, makeFixtureResult } from "@/components/deck/fixture";
import { FLOW_STORAGE_KEY, TASTE_STORAGE_KEY } from "@/components/onboarding/constants";
import { CARRY_COOKIE, CARRY_PENDING_TTL_MS, CARRY_STORAGE_KEY } from "./constants";
import {
  carryContents,
  carryFromSessionOrCarry,
  carryItems,
  carrySnapshot,
  clearLocalWork,
  loadCarry,
  makeCarry,
  markForUser,
  parseCarry,
  readToken,
  restoreToSession,
  serializeCarry,
  stashFromSession,
} from "./carry";
import { AT, TOKEN, fillSession, installStorages, picksRaw, tasteRaw } from "./testing";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const picks = makeFixtureResult().domains.flatMap((d) => d.picks);
const reactions = {
  [picks[2].id]: { state: "explore" as const, words: "the quiet of it", at: AT },
  [picks[7].id]: { state: "not_interested" as const, words: "too ornate", at: AT },
};
const rec = (over: Partial<Parameters<typeof makeCarry>[0]> = {}) => makeCarry({ taste: tasteRaw(), picks: picksRaw(reactions), now: NOW, token: TOKEN, ...over });

afterEach(() => vi.unstubAllGlobals());

describe("parseCarry", () => {
  it("round-trips a record for the browser session that made it", () => {
    const back = parseCarry(serializeCarry(rec()), NOW, TOKEN);
    expect(back?.taste).toBe(tasteRaw());
    expect(back?.forUser).toBeUndefined();
  });

  it("refuses a record from another browser session, or when the session has no token", () => {
    expect(parseCarry(serializeCarry(rec()), NOW, "someone-elses-token")).toBeNull();
    expect(parseCarry(serializeCarry(rec()), NOW, null)).toBeNull();
    expect(parseCarry(serializeCarry({ ...rec(), token: "" }), NOW, "")).toBeNull();
  });

  it("forgets a record after a day", () => {
    const later = (ms: number) => new Date(NOW.getTime() + ms);
    expect(parseCarry(serializeCarry(rec()), later(CARRY_PENDING_TTL_MS - 1000), TOKEN)).not.toBeNull();
    expect(parseCarry(serializeCarry(rec()), later(CARRY_PENDING_TTL_MS + 1000), TOKEN)).toBeNull();
  });

  it("returns null for anything damaged, from the future, or another version", () => {
    expect(parseCarry(null, NOW, TOKEN)).toBeNull();
    expect(parseCarry("{nope", NOW, TOKEN)).toBeNull();
    expect(parseCarry(JSON.stringify({ ...rec(), version: 2 }), NOW, TOKEN)).toBeNull();
    expect(parseCarry(JSON.stringify({ ...rec(), at: "not a date" }), NOW, TOKEN)).toBeNull();
    expect(parseCarry(JSON.stringify({ ...rec(), at: "2027-01-01T00:00:00.000Z" }), NOW, TOKEN)).toBeNull();
    expect(parseCarry(JSON.stringify({ ...rec(), taste: 5 }), NOW, TOKEN)).toBeNull();
  });

  it("keeps which account it was offered to", () => {
    expect(parseCarry(serializeCarry(markForUser(rec(), "user-1")), NOW, TOKEN)?.forUser).toBe("user-1");
  });
});

describe("carryContents and carryItems", () => {
  it("reads the onboarding and the picks, and lists every reacted pick with its reaction", () => {
    const contents = carryContents(rec());
    expect(contents?.seeds).toHaveLength(6);
    expect(contents?.plan).toEqual(makeFixtureResult().plan);
    const items = carryItems(contents!);
    expect(items.map((i) => i.pick.id).sort()).toEqual([picks[2].id, picks[7].id].sort());
    expect(items.find((i) => i.pick.id === picks[2].id)?.reaction).toEqual({ state: "explore", words: "the quiet of it" });
  });

  it("offers the profile, axes and plan to keep with the save", () => {
    const snap = carrySnapshot(carryContents(rec())!);
    expect(snap.profile).toEqual(FIXTURE_INPUTS.profile);
    expect(snap.axes).toEqual(FIXTURE_INPUTS.axes);
    expect(snap.plan).toEqual(makeFixtureResult().plan);
    expect(carrySnapshot(carryContents(rec({ picks: null }))!).plan).toBeNull();
  });

  it("has no items when nothing was reacted to, or the picks record is for a different profile", () => {
    expect(carryItems(carryContents(rec({ picks: picksRaw({}) }))!)).toEqual([]);
    expect(carryItems(carryContents(rec({ picks: picksRaw(reactions, { key: "00000000" }) }))!)).toEqual([]);
    expect(carryItems(carryContents(rec({ picks: null }))!)).toEqual([]);
  });

  it("returns null when the onboarding no longer parses", () => {
    expect(carryContents(rec({ taste: "{broken" }))).toBeNull();
  });

  it("sends no taste numbers: only identity, path, card and the reaction", () => {
    expect(JSON.stringify(carryItems(carryContents(rec())!))).not.toMatch(/popularity|reach|connection|contribution":0/);
  });
});

describe("browser wrappers", () => {
  it("stashing copies the tab's records to the shared store and binds them to a session cookie", () => {
    const { session, local, doc } = installStorages();
    fillSession(session, reactions);
    expect(readToken()).toBeNull();
    const carry = stashFromSession(NOW);
    expect(carry?.token).toBeTruthy();
    expect(readToken()).toBe(carry?.token);
    expect(doc.cookie).toContain(`${CARRY_COOKIE}=`);
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeTruthy();
    const stored = loadCarry(NOW);
    expect(stored?.taste).toBe(session.getItem(TASTE_STORAGE_KEY));
    expect(stored?.picks).toBe(session.getItem(PICKS_STORAGE_KEY));
  });

  it("stashes nothing when the tab has no onboarding", () => {
    const { local } = installStorages();
    expect(stashFromSession(NOW)).toBeNull();
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
  });

  it("deletes a record from another browser session when it is read", () => {
    const first = installStorages();
    fillSession(first.session, reactions);
    stashFromSession(NOW);
    const raw = first.local.getItem(CARRY_STORAGE_KEY)!;
    vi.unstubAllGlobals();

    // Same localStorage content, but this browser session has a different cookie (a shared computer, a new day).
    const other = installStorages({ [CARRY_COOKIE]: "another-session" });
    other.local.setItem(CARRY_STORAGE_KEY, raw);
    expect(loadCarry(NOW)).toBeNull();
    expect(other.local.getItem(CARRY_STORAGE_KEY)).toBeNull();
  });

  it("deletes an expired or damaged record when it is read", () => {
    const { local } = installStorages({ [CARRY_COOKIE]: TOKEN });
    local.setItem(CARRY_STORAGE_KEY, serializeCarry(rec()));
    expect(loadCarry(new Date(NOW.getTime() + CARRY_PENDING_TTL_MS + 5000))).toBeNull();
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
    local.setItem(CARRY_STORAGE_KEY, "{broken");
    expect(loadCarry(NOW)).toBeNull();
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
  });

  it("restores into a new tab of the same browser session, and leaves a tab that already has onboarding alone", () => {
    const first = installStorages();
    fillSession(first.session, reactions);
    const carry = stashFromSession(NOW)!;
    const cookie = readToken()!;
    vi.unstubAllGlobals();

    const fresh = installStorages({ [CARRY_COOKIE]: cookie });
    expect(restoreToSession(carry)).toBe(true);
    expect(fresh.session.getItem(TASTE_STORAGE_KEY)).toBe(carry.taste);
    expect(fresh.session.getItem(PICKS_STORAGE_KEY)).toBe(carry.picks);
    expect(restoreToSession(carry)).toBe(false);
  });

  it("prefers the tab's own picks record, the newest, when it has one", () => {
    const { session } = installStorages();
    const carry = rec({ picks: picksRaw({}) });
    expect(carryFromSessionOrCarry(carry)).toBe(carry);
    fillSession(session, reactions);
    expect(carryFromSessionOrCarry(carry).picks).toBe(session.getItem(PICKS_STORAGE_KEY));
  });

  it("signing out clears the record, its cookie, and the tab's onboarding, picks and flow", () => {
    const { session, local, doc } = installStorages();
    fillSession(session, reactions);
    session.setItem(FLOW_STORAGE_KEY, "{}");
    stashFromSession(NOW);
    clearLocalWork();
    expect(local.getItem(CARRY_STORAGE_KEY)).toBeNull();
    expect(doc.cookie).not.toContain(CARRY_COOKIE);
    for (const k of [TASTE_STORAGE_KEY, PICKS_STORAGE_KEY, FLOW_STORAGE_KEY]) expect(session.getItem(k)).toBeNull();
  });

  it("is a no-op on the server (no window)", () => {
    expect(loadCarry(NOW)).toBeNull();
    expect(stashFromSession(NOW)).toBeNull();
    expect(restoreToSession(rec())).toBe(false);
    expect(() => clearLocalWork()).not.toThrow();
  });
});
