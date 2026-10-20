// What the picks screen keeps between visits, in sessionStorage (per tab, works as a guest, gone when the tab
// closes). It lets a revisit show the same picks with no run at all: 0 Qloo calls and 0 model calls. The result
// carries the run `plan`, which is sent back on a re-run so even that replays from the server's cache.
//
// Parsing is pure and never trusts what it reads. The browser wrappers are guarded, so they are safe on the server.
// This is the browser's own session data. It is never written to a tracked file and never sent anywhere.

import { REACTION_STATES, isTraceEvent } from "@/types";
import type { Field, Reaction, TraceEvent } from "@/types";
import { isField } from "@/types";
import { MAX_REACTION_WORDS, MAX_TRACE_EVENTS, PICKS_STORAGE_KEY, PICKS_STORAGE_VERSION } from "./constants";
import { readResult } from "./sse";
import type { PublicRunResult, RunInputs } from "./types";

export interface StoredPicks {
  version: typeof PICKS_STORAGE_VERSION;
  /** Which taste session these picks belong to (`sessionKey`). */
  key: string;
  result: PublicRunResult;
  events: TraceEvent[];
  /** Entity ids set aside with "not me". */
  notMe: string[];
  hidden: Field[];
  /** The person's reactions by pick id. Kept in the tab only. */
  reactions: Record<string, Reaction>;
  /** "Not me" re-runs started so far. */
  reruns: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A short fingerprint of the taste session, so stored picks are never shown for a different profile. FNV-1a. */
export function sessionKey(inputs: Pick<RunInputs, "seeds" | "axes">): string {
  const text = JSON.stringify([
    inputs.seeds.map((s) => [s.id, s.qlooId, s.why]),
    inputs.axes.map((a) => [a.id, a.tags.map((t) => t.tag)]),
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function readReaction(v: unknown): Reaction | null {
  if (!isRec(v) || typeof v.at !== "string" || typeof v.state !== "string") return null;
  if (!(REACTION_STATES as readonly string[]).includes(v.state)) return null;
  const out: Reaction = { state: v.state as Reaction["state"], at: v.at };
  if (typeof v.words === "string" && v.words.length > 0) out.words = v.words.slice(0, MAX_REACTION_WORDS);
  return out;
}

/** Stored picks for this taste session, or null when there are none, they are for another session, or they do not parse. */
export function parseStored(raw: string | null, key: string): StoredPicks | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(v) || v.version !== PICKS_STORAGE_VERSION || v.key !== key) return null;
  const result = readResult(v.result);
  if (!result) return null;
  const events = Array.isArray(v.events) ? v.events.filter(isTraceEvent).slice(-MAX_TRACE_EVENTS) : [];
  const notMe = Array.isArray(v.notMe) ? v.notMe.filter((x): x is string => typeof x === "string") : [];
  const hidden = Array.isArray(v.hidden) ? v.hidden.filter(isField) : [];
  const reactions: Record<string, Reaction> = {};
  if (isRec(v.reactions)) {
    for (const [id, r] of Object.entries(v.reactions)) {
      const reaction = readReaction(r);
      if (reaction) reactions[id] = reaction;
    }
  }
  const reruns = typeof v.reruns === "number" && Number.isFinite(v.reruns) && v.reruns >= 0 ? Math.floor(v.reruns) : 0;
  return { version: PICKS_STORAGE_VERSION, key, result, events, notMe, hidden, reactions, reruns };
}

export const serializeStored = (s: StoredPicks): string => JSON.stringify(s);

// Browser wrappers. Each is a no-op (or null) outside the browser or when storage is blocked.

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStored(key: string): StoredPicks | null {
  return parseStored(store()?.getItem(PICKS_STORAGE_KEY) ?? null, key);
}

export function saveStored(s: StoredPicks): void {
  try {
    store()?.setItem(PICKS_STORAGE_KEY, serializeStored(s));
  } catch {
    // Storage full or blocked: the screen still works, it just will not survive a reload.
  }
}

export function clearStored(): void {
  store()?.removeItem(PICKS_STORAGE_KEY);
}
