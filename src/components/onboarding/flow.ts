// Pure onboarding logic: validation, the draft reducer, the list rules and readiness. No React, no network,
// no browser APIs, so it runs under the node test environment.

import type { Field, ProfileSeed, TraceEvent, WhyTag } from "./types";
import { COPY } from "./copy";
import {
  MAX_QUERY_LENGTH,
  MAX_SEEDS_PER_USER,
  MAX_WHY_CHARS,
  MIN_FIELDS,
  MIN_QUERY_LENGTH,
  MIN_SEEDS,
  MIN_WHY_CHARS,
} from "@/lib/agent/config";

/** What a chip needs (a subset of the seed route's SeedChip). */
export interface Chip {
  qlooId: string;
  name: string;
  label: string;
  type?: string;
  year?: number;
  disambiguation?: string;
  imageUrl?: string;
}

export type SearchState =
  | { kind: "idle" }
  | { kind: "loading"; token: number }
  | { kind: "clean"; chip: Chip }
  | { kind: "ambiguous"; chips: Chip[]; chosenId: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string; code?: string };

/** The one thing being added right now. */
export interface Draft {
  field: Field;
  query: string;
  /** The (normalised) query the current search result belongs to. */
  searchedQuery: string;
  search: SearchState;
  why: string;
}

export const initialDraft = (field: Field): Draft => ({ field, query: "", searchedQuery: "", search: { kind: "idle" }, why: "" });

/** Collapse whitespace, including newlines, so the why stays one line. */
export function collapse(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export type Checked = { ok: true; value: string } | { ok: false; message: string };

export function validateQuery(raw: string): Checked {
  const value = collapse(raw);
  if (value.length < MIN_QUERY_LENGTH) return { ok: false, message: COPY.queryShort(MIN_QUERY_LENGTH) };
  if (value.length > MAX_QUERY_LENGTH) return { ok: false, message: COPY.queryLong(MAX_QUERY_LENGTH) };
  return { ok: true, value };
}

export function validateWhy(raw: string): Checked {
  const value = collapse(raw);
  if (value.length === 0) return { ok: false, message: COPY.whyRequired };
  if (value.length < MIN_WHY_CHARS) return { ok: false, message: COPY.whyShort(MIN_WHY_CHARS) };
  if (value.length > MAX_WHY_CHARS) return { ok: false, message: COPY.whyLong(MAX_WHY_CHARS) };
  return { ok: true, value };
}

export type DraftAction =
  | { type: "setField"; field: Field }
  | { type: "setQuery"; query: string }
  | { type: "searchStart"; token: number; query: string }
  | { type: "searchDone"; token: number; query: string; result: SearchState }
  | { type: "choose"; qlooId: string }
  | { type: "changeMatch" }
  | { type: "setWhy"; why: string }
  | { type: "reset" };

/** The chip the user has settled on, if any: the clean match, or the ambiguous one they chose. */
export function selectedChip(draft: Draft): Chip | null {
  const s = draft.search;
  if (s.kind === "clean") return s.chip;
  if (s.kind === "ambiguous" && s.chosenId) return s.chips.find((c) => c.qlooId === s.chosenId) ?? null;
  return null;
}

export function draftReducer(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "setField":
      // A match belongs to a field, so changing the field clears it. What the user typed stays.
      if (action.field === state.field) return state;
      return { ...state, field: action.field, search: { kind: "idle" }, searchedQuery: "" };
    case "setQuery": {
      // Editing the text drops a stale match, message or search in flight (a late result is then ignored by its token).
      const changed = collapse(action.query) !== state.searchedQuery;
      const drop = state.search.kind !== "idle" && changed;
      return { ...state, query: action.query, search: drop ? { kind: "idle" } : state.search };
    }
    case "searchStart":
      return { ...state, search: { kind: "loading", token: action.token }, searchedQuery: action.query };
    case "searchDone": {
      if (state.search.kind !== "loading" || state.search.token !== action.token) return state;
      // The text changed while the lookup ran: the result belongs to something else.
      if (collapse(state.query) !== action.query) return { ...state, search: { kind: "idle" } };
      return { ...state, search: action.result, searchedQuery: action.query };
    }
    case "choose": {
      if (state.search.kind !== "ambiguous") return state;
      if (!state.search.chips.some((c) => c.qlooId === action.qlooId)) return state;
      return { ...state, search: { ...state.search, chosenId: action.qlooId } };
    }
    case "changeMatch":
      return { ...state, search: { kind: "idle" }, searchedQuery: "" };
    case "setWhy":
      return { ...state, why: action.why };
    case "reset":
      return initialDraft(state.field);
  }
}

/** A seed on the list: what is sent to /api/profile, plus the matched name for display. */
export interface Entry {
  seed: ProfileSeed;
  /** The entity's display label as chosen on the chip. Kept for the list; never sent to the server. */
  matchedLabel: string;
  /** True when the why was mapped to tags (even to none). False when the lookup did not complete. */
  whyMapped: boolean;
  /** The `map_why` trace event for this seed, kept for the reasoning panel. */
  whyEvent?: TraceEvent;
}

/** Build the entry for a validated draft. Null when there is no chosen match or the inputs fail validation. */
export function buildEntry(draft: Draft, id: string, whyTags: WhyTag[] | undefined, whyEvent?: TraceEvent): Entry | null {
  const chip = selectedChip(draft);
  const why = validateWhy(draft.why);
  // `typed` is the text the match was searched with, not whatever the box says now.
  const query = validateQuery(draft.searchedQuery);
  if (!chip || !why.ok || !query.ok) return null;

  const search = draft.search;
  const base = { id, field: draft.field, typed: query.value, why: why.value, qlooId: chip.qlooId };
  // A seed is `ambiguous` only when several candidates were offered; with one candidate the user's choice is a clean match.
  const seed: ProfileSeed =
    search.kind === "ambiguous" && search.chips.length > 1
      ? {
          ...base,
          status: "ambiguous",
          candidates: search.chips.map((c) => ({ qlooId: c.qlooId, label: c.label })),
        }
      : { ...base, status: "clean" };
  if (whyTags) seed.whyTags = whyTags;
  const entry: Entry = { seed, matchedLabel: chip.label, whyMapped: whyTags !== undefined };
  if (whyEvent) entry.whyEvent = whyEvent;
  return entry;
}

export type AddResult = { ok: true; entries: Entry[] } | { ok: false; message: string };

/** Add an entry: at most MAX_SEEDS_PER_USER, and the same entity only once. */
export function addEntry(entries: readonly Entry[], entry: Entry): AddResult {
  if (entries.length >= MAX_SEEDS_PER_USER) return { ok: false, message: COPY.atMax(MAX_SEEDS_PER_USER) };
  if (entries.some((e) => e.seed.qlooId === entry.seed.qlooId)) return { ok: false, message: COPY.duplicate };
  return { ok: true, entries: [...entries, entry] };
}

export function removeEntry(entries: readonly Entry[], id: string): Entry[] {
  return entries.filter((e) => e.seed.id !== id);
}

export interface Readiness {
  count: number;
  fieldCount: number;
  ready: boolean;
  atMax: boolean;
  /** 0 to 1, for a quiet bar. Never shown as a number. */
  progress: number;
  /** One plain sentence on what is left. */
  text: string;
}

export function readiness(entries: readonly Entry[]): Readiness {
  const count = entries.length;
  const fieldCount = new Set(entries.map((e) => e.seed.field)).size;
  const moreSeeds = Math.max(0, MIN_SEEDS - count);
  const moreFields = Math.max(0, MIN_FIELDS - fieldCount);
  const ready = moreSeeds === 0 && moreFields === 0;
  const atMax = count >= MAX_SEEDS_PER_USER;
  const progress = (Math.min(count, MIN_SEEDS) / MIN_SEEDS + Math.min(fieldCount, MIN_FIELDS) / MIN_FIELDS) / 2;

  let text: string;
  if (ready) {
    text = atMax ? COPY.readyFull(MAX_SEEDS_PER_USER) : COPY.readyNow;
  } else if (atMax) {
    // Full but not across enough fields: adding is impossible, so say to swap one.
    text = COPY.fullNeedsField(MAX_SEEDS_PER_USER);
  } else if (count === 0) {
    text = COPY.needFirst(MIN_SEEDS, MIN_FIELDS);
  } else {
    text = COPY.needMore(Math.max(moreSeeds, moreFields), moreFields);
  }
  return { count, fieldCount, ready, atMax, progress, text };
}

/**
 * The seeds POST /api/profile needs, and no more. The server never reads `candidates` or tells ambiguous from
 * clean; the user's choice is the match. So an ambiguous seed goes as `clean` with its chosen id and no
 * candidate list, which keeps ten seeds far under the server's body cap. Display labels never go.
 */
export function profileSeeds(entries: readonly Entry[]): ProfileSeed[] {
  return entries.map(({ seed }) => {
    const out: ProfileSeed = {
      id: seed.id,
      field: seed.field,
      typed: seed.typed,
      why: seed.why,
      qlooId: seed.qlooId,
      status: "clean",
    };
    if (seed.whyTags) out.whyTags = seed.whyTags;
    return out;
  });
}

/** Stable JSON (sorted keys), to tell whether two seed lists are the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const sameSeeds = (a: readonly ProfileSeed[], b: readonly ProfileSeed[]): boolean => canonical(a) === canonical(b);

/** Seed id -> what the user typed, for the reasoning panel. */
export function seedNames(entries: readonly Entry[]): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.seed.id, e.seed.typed]));
}
