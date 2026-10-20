// What waits while a guest signs in. Pending work only: once it is saved (or forgotten) the record is deleted, and
// the account's own copy of the profile lives in the database (profile_snapshots), not here.
//
// Onboarding and picks live in sessionStorage, which belongs to one tab. A magic link usually opens a new tab, so when
// a guest asks to save, the two records are copied here (localStorage, shared by the tabs of one browser, the same
// browser the link must be opened in anyway).
//
// Safeguards, because this is the person's taste data on a device that may be shared:
//  - The record carries a random token that is also set as a session cookie. A record whose token does not match the
//    cookie was made in another browser session; it is deleted, never used.
//  - A record is forgotten after a day, and deleted on read when it is expired, damaged or from another session.
//  - Nothing is saved into an account without the person confirming it (PendingSave asks first), and a record that
//    was offered to one account is deleted if a different account turns up.
//  - Signing out clears it, with the tab's onboarding and picks (`clearLocalWork`).
//
// Parsing is pure and never trusts what it reads. The browser wrappers are guarded, so they are safe on the server.

import type { Reaction } from "@/types";
import { PICKS_STORAGE_KEY } from "@/components/deck/constants";
import { cleanExclude } from "@/components/deck/request";
import { parseStored, sessionKey } from "@/components/deck/storage";
import type { PublicRunResult, RunInputs, RunPlan } from "@/components/deck/types";
import { FLOW_STORAGE_KEY, TASTE_STORAGE_KEY } from "@/components/onboarding/constants";
import { parseTasteSession } from "@/components/onboarding/session";
import type { ProfileSeed } from "@/lib/profile/types";
import { CARRY_COOKIE, CARRY_PENDING_TTL_MS, CARRY_STORAGE_KEY, CARRY_VERSION, MAX_SAVE_ITEMS, MAX_SAVE_SEEDS } from "./constants";
import { toWireItem } from "./request";
import type { SaveItemWire, SnapshotWire } from "./wire";

export interface CarryRecord {
  version: typeof CARRY_VERSION;
  /** ISO time the record was written. */
  at: string;
  /** Binds the record to the browser session that made it (see the session cookie). */
  token: string;
  /** The account this record was first offered to, once a signed-in person has seen the confirm question. */
  forUser?: string;
  /** The onboarding record, exactly as sessionStorage held it. */
  taste: string;
  /** The picks record, exactly as sessionStorage held it (null when there was none). */
  picks: string | null;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function makeCarry(input: { taste: string; picks: string | null; now: Date; token: string; forUser?: string }): CarryRecord {
  return {
    version: CARRY_VERSION,
    at: input.now.toISOString(),
    token: input.token,
    ...(input.forUser ? { forUser: input.forUser } : {}),
    taste: input.taste,
    picks: input.picks,
  };
}

export const serializeCarry = (c: CarryRecord): string => JSON.stringify(c);

/**
 * A stored record, or null when it is missing, damaged, too old, from another browser session (its token is not the
 * session cookie's), or written in the future.
 */
export function parseCarry(raw: string | null, now: Date, sessionToken: string | null): CarryRecord | null {
  if (!raw || !sessionToken) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(v) || v.version !== CARRY_VERSION || typeof v.at !== "string" || typeof v.taste !== "string") return null;
  if (typeof v.token !== "string" || v.token.length === 0 || v.token !== sessionToken) return null;
  const at = Date.parse(v.at);
  if (!Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  if (age < 0 || age > CARRY_PENDING_TTL_MS) return null;
  const forUser = typeof v.forUser === "string" && v.forUser.length > 0 ? v.forUser : undefined;
  return makeCarry({ taste: v.taste, picks: typeof v.picks === "string" ? v.picks : null, now: new Date(at), token: v.token, forUser });
}

/** What a record holds, parsed. Null when the onboarding part no longer parses. */
export interface CarryContents {
  inputs: RunInputs;
  seeds: ProfileSeed[];
  result: PublicRunResult | null;
  reactions: Record<string, Reaction>;
  plan: RunPlan | undefined;
  /** Entity ids set aside with "not me". */
  exclude: string[];
}

export function carryContents(carry: CarryRecord): CarryContents | null {
  const taste = parseTasteSession(carry.taste);
  if (!taste) return null;
  const base: RunInputs = { seeds: taste.seeds, profile: taste.profile, axes: taste.axes };
  const stored = carry.picks ? parseStored(carry.picks, sessionKey(base)) : null;
  return {
    inputs: base,
    seeds: taste.seeds.slice(0, MAX_SAVE_SEEDS),
    result: stored?.result ?? null,
    reactions: stored?.reactions ?? {},
    plan: stored?.result.plan,
    exclude: cleanExclude(stored?.notMe ?? []),
  };
}

/** Every pick the person reacted to, with its reaction, ready to send. Picks no longer in the result are skipped. */
export function carryItems(contents: CarryContents): SaveItemWire[] {
  if (!contents.result) return [];
  const items: SaveItemWire[] = [];
  const seen = new Set<string>();
  for (const d of contents.result.domains) {
    for (const pick of d.picks) {
      const reaction = contents.reactions[pick.id];
      if (!reaction || seen.has(pick.id)) continue;
      seen.add(pick.id);
      items.push(toWireItem(pick, reaction));
    }
  }
  return items.slice(0, MAX_SAVE_ITEMS);
}

/** The profile, axes and plan to keep on the account with the save. */
export function carrySnapshot(contents: CarryContents): SnapshotWire {
  return { profile: contents.inputs.profile, axes: contents.inputs.axes, plan: contents.plan ?? null };
}

/** The record, marked as offered to this account. */
export function markForUser(carry: CarryRecord, userId: string): CarryRecord {
  return { ...carry, forUser: userId };
}

// ---- Browser wrappers: each is a no-op (or null) outside the browser or when storage is blocked. ----

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function cookieJar(): { cookie: string } | null {
  try {
    return typeof document === "undefined" ? null : document;
  } catch {
    return null;
  }
}

/** The session cookie's token, or null when there is none. */
export function readToken(): string | null {
  const doc = cookieJar();
  if (!doc) return null;
  for (const part of doc.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CARRY_COOKIE) return rest.join("=") || null;
  }
  return null;
}

function newToken(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** The session cookie's token, set (as a session cookie, gone when the browser closes) when there is none yet. */
function ensureToken(): string | null {
  const doc = cookieJar();
  if (!doc) return null;
  const existing = readToken();
  if (existing) return existing;
  const token = newToken();
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  doc.cookie = `${CARRY_COOKIE}=${token}; path=/; SameSite=Lax${secure}`;
  return readToken();
}

function dropToken(): void {
  const doc = cookieJar();
  if (doc) doc.cookie = `${CARRY_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

/** The waiting record, or null. An expired, damaged or other-session record is deleted on the way. */
export function loadCarry(now: Date = new Date()): CarryRecord | null {
  const store = local();
  const raw = store?.getItem(CARRY_STORAGE_KEY) ?? null;
  if (raw === null) return null;
  const carry = parseCarry(raw, now, readToken());
  if (!carry) clearCarry();
  return carry;
}

export function saveCarry(carry: CarryRecord): void {
  try {
    local()?.setItem(CARRY_STORAGE_KEY, serializeCarry(carry));
  } catch {
    // Storage full or blocked: the sign-in still works; only a new tab would not find the work.
  }
}

export function clearCarry(): void {
  try {
    local()?.removeItem(CARRY_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Forget everything this browser holds of a person's work: the waiting record and its cookie, and this tab's
 * onboarding, picks and flow records. For sign-out, so the next person on the device starts clean.
 */
export function clearLocalWork(): void {
  clearCarry();
  dropToken();
  try {
    const s = session();
    for (const key of [TASTE_STORAGE_KEY, PICKS_STORAGE_KEY, FLOW_STORAGE_KEY]) s?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Copy this tab's onboarding and picks records to the shared store, for a guest about to sign in, and bind them to
 * this browser session. Null when the tab has no onboarding to keep.
 */
export function stashFromSession(now: Date = new Date()): CarryRecord | null {
  const s = session();
  const taste = s?.getItem(TASTE_STORAGE_KEY) ?? null;
  if (!taste || !parseTasteSession(taste)) return null;
  const token = ensureToken();
  if (!token) return null;
  const carry = makeCarry({ taste, picks: s?.getItem(PICKS_STORAGE_KEY) ?? null, now, token });
  saveCarry(carry);
  return carry;
}

/**
 * Put a record's onboarding and picks into this tab's sessionStorage when the tab has none of its own (a magic link
 * opened in a new tab). A tab that already has onboarding keeps it, since it is the newer. Returns true when it wrote.
 */
export function restoreToSession(carry: CarryRecord): boolean {
  const s = session();
  if (!s || s.getItem(TASTE_STORAGE_KEY)) return false;
  try {
    s.setItem(TASTE_STORAGE_KEY, carry.taste);
    if (carry.picks) s.setItem(PICKS_STORAGE_KEY, carry.picks);
    return true;
  } catch {
    return false;
  }
}

/** This tab's own records, when it has them: the freshest source for what to save (the tab holds the latest reactions). */
export function carryFromSessionOrCarry(carry: CarryRecord): CarryRecord {
  const s = session();
  const taste = s?.getItem(TASTE_STORAGE_KEY) ?? null;
  if (!taste || !parseTasteSession(taste)) return carry;
  return { ...carry, taste, picks: s?.getItem(PICKS_STORAGE_KEY) ?? carry.picks };
}
