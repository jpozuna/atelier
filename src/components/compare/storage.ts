// What the comparison keeps between visits, in sessionStorage (per tab, gone when the tab closes): the plain model's list
// for one taste session and one set of fields, so a revisit makes no model call. The browser's own session data; never
// written to a tracked file. Parsing is pure and never trusts what it reads. The wrappers are safe on the server.

import type { Field } from "@/types";
import { COMPARE_STORAGE_KEY, COMPARE_STORAGE_VERSION } from "./constants";
import type { PlainPick } from "./types";
import { readPlainPicks } from "./validate";

export interface StoredCompare {
  version: typeof COMPARE_STORAGE_VERSION;
  /** Which taste session and which fields this list answers (`compareKey`). */
  key: string;
  picks: PlainPick[];
}

/** The picks screen's session fingerprint plus the fields asked for, so a stored list is never shown for another ask. */
export const compareKey = (sessionKey: string, fields: readonly Field[]): string => `${sessionKey}|${fields.join(",")}`;

export function parseStoredCompare(raw: string | null, key: string): PlainPick[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const rec = v as Record<string, unknown>;
  if (rec.version !== COMPARE_STORAGE_VERSION || rec.key !== key) return null;
  return readPlainPicks({ picks: rec.picks });
}

export const serializeStoredCompare = (s: StoredCompare): string => JSON.stringify(s);

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStoredCompare(key: string): PlainPick[] | null {
  return parseStoredCompare(store()?.getItem(COMPARE_STORAGE_KEY) ?? null, key);
}

export function saveStoredCompare(key: string, picks: PlainPick[]): void {
  try {
    store()?.setItem(COMPARE_STORAGE_KEY, serializeStoredCompare({ version: COMPARE_STORAGE_VERSION, key, picks }));
  } catch {
    // Storage full or blocked: the list still shows, it just will not survive a reload.
  }
}
