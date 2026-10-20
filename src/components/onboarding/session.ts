// What onboarding keeps between screens, in sessionStorage (per tab, works as a guest, gone when the tab closes).
// Parsing is pure and never trusts what it reads. The browser wrappers are guarded, so they are safe on the server.
//
// Two records:
//  - FlowSession: the list as it is being built (seeds with their why tags), so a reload does not lose it.
//  - TasteSession: the result of POST /api/profile. This is what the picks screen reads (see readTasteSession).

import { isAxis, isField, isSeed, isTraceEvent } from "@/types";
import type { Axis, Field, Profile, ProfileSeed, TraceEvent } from "./types";
import { MAX_SEEDS_PER_USER } from "@/lib/agent/config";
import { FLOW_STORAGE_KEY, TASTE_STORAGE_KEY } from "./constants";
import { cleanWhyTags, isRec, readProfileShape } from "./check";
import type { Entry } from "./flow";

export const SESSION_VERSION = 1;

export interface FlowSession {
  version: typeof SESSION_VERSION;
  /** The field last chosen, so the dropdown comes back where it was. */
  field: Field;
  entries: Entry[];
}

/** The record the picks screen reads. `seeds` is exactly what was sent to /api/profile. */
export interface TasteSession {
  version: typeof SESSION_VERSION;
  seeds: ProfileSeed[];
  profile: Profile;
  axes: Axis[];
  /** Events so far, in order, for the reasoning panel: resolved seeds, mapped reasons, then the profile build. */
  trace: TraceEvent[];
}

function readSeed(v: unknown): ProfileSeed | null {
  if (!isSeed(v)) return null;
  const rawTags = (v as unknown as Record<string, unknown>).whyTags;
  const whyTags = rawTags === undefined ? undefined : cleanWhyTags(rawTags);
  if (whyTags === null) return null;
  const { id, field, typed, why, qlooId, status, candidates } = v;
  const seed: ProfileSeed = { id, field, typed, why, qlooId, status };
  if (candidates) seed.candidates = candidates.map((c) => ({ qlooId: c.qlooId, label: c.label }));
  if (whyTags) seed.whyTags = whyTags;
  return seed;
}

function readEntry(v: unknown): Entry | null {
  if (!isRec(v) || typeof v.matchedLabel !== "string" || typeof v.whyMapped !== "boolean") return null;
  const seed = readSeed(v.seed);
  if (!seed || seed.qlooId === null) return null;
  const entry: Entry = { seed, matchedLabel: v.matchedLabel, whyMapped: v.whyMapped };
  if (isTraceEvent(v.whyEvent) && v.whyEvent.kind === "map_why") entry.whyEvent = v.whyEvent;
  return entry;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseFlowSession(raw: string | null): FlowSession | null {
  const v = parseJson(raw);
  if (!isRec(v) || v.version !== SESSION_VERSION || !isField(v.field) || !Array.isArray(v.entries)) return null;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const e of v.entries) {
    const entry = readEntry(e);
    if (!entry || seen.has(entry.seed.id) || seen.has(entry.seed.qlooId ?? "")) continue;
    seen.add(entry.seed.id);
    if (entry.seed.qlooId) seen.add(entry.seed.qlooId);
    entries.push(entry);
  }
  return { version: SESSION_VERSION, field: v.field, entries: entries.slice(0, MAX_SEEDS_PER_USER) };
}

export function parseTasteSession(raw: string | null): TasteSession | null {
  const v = parseJson(raw);
  if (!isRec(v) || v.version !== SESSION_VERSION) return null;
  if (!Array.isArray(v.seeds) || v.seeds.length > MAX_SEEDS_PER_USER || !Array.isArray(v.axes)) return null;
  const profile = readProfileShape(v.profile);
  if (!profile) return null;
  const seeds = v.seeds.map(readSeed);
  if (seeds.some((s) => s === null) || seeds.length === 0) return null;
  if (!v.axes.every(isAxis)) return null;
  const trace = Array.isArray(v.trace) ? v.trace.filter(isTraceEvent) : [];
  return {
    version: SESSION_VERSION,
    seeds: seeds as ProfileSeed[],
    profile,
    axes: v.axes as Axis[],
    trace,
  };
}

/**
 * The reasoning events for the whole onboarding, in order: one `resolve_seed` per seed (from what the user
 * confirmed), the seed's `map_why` event if it has one, then the profile build's own events.
 */
export function assembleTrace(entries: readonly Entry[], profileTrace: readonly TraceEvent[], now: Date = new Date()): TraceEvent[] {
  const t = now.toISOString();
  const out: TraceEvent[] = [];
  for (const e of entries) {
    out.push({
      kind: "resolve_seed",
      t,
      say: "Confirmed a seed.",
      seedId: e.seed.id,
      status: e.seed.status,
      candidateCount: e.seed.candidates?.length ?? 1,
    });
    if (e.whyEvent && e.whyEvent.kind === "map_why" && e.whyEvent.seedId === e.seed.id) out.push(e.whyEvent);
  }
  out.push(...profileTrace);
  return out;
}

// Browser wrappers. Each is a no-op (or null) outside the browser or when storage is blocked.

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadFlowSession(): FlowSession | null {
  return parseFlowSession(store()?.getItem(FLOW_STORAGE_KEY) ?? null);
}

export function saveFlowSession(session: FlowSession): void {
  try {
    store()?.setItem(FLOW_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage full or blocked: the flow still works, it just will not survive a reload.
  }
}

export function clearFlowSession(): void {
  store()?.removeItem(FLOW_STORAGE_KEY);
}

/** The raw string, for `useSyncExternalStore` snapshots (a stable string compares equal between reads). */
export function rawTasteSession(): string | null {
  return store()?.getItem(TASTE_STORAGE_KEY) ?? null;
}

/** Read the profile result onboarding produced. The picks screen calls this. Null when there is none. */
export function readTasteSession(): TasteSession | null {
  return parseTasteSession(rawTasteSession());
}

export function saveTasteSession(session: TasteSession): void {
  try {
    store()?.setItem(TASTE_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Blocked storage: the chart screen then asks the user to start again.
  }
}

export function clearTasteSession(): void {
  store()?.removeItem(TASTE_STORAGE_KEY);
}
