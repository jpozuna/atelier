// The browser's side of POST /api/compare: build the body from the user's own words, read the reply. Pure plus one fetch.

import { FIELDS } from "@/types";
import type { Field } from "@/types";
import { COMPARE_URL } from "./constants";
import type { CompareRequest, CompareSeed, PlainPick } from "./types";
import { oneLine, readPlainPicks } from "./validate";

/** The route's body: the seeds as field, typed and why only (no id, candidate or tag), and the fields asked for in field order. */
export function buildCompareBody(seeds: readonly { field: Field; typed: string; why: string }[], fields: readonly Field[]): CompareRequest {
  const asked = new Set(fields);
  return {
    seeds: seeds.map((s): CompareSeed => ({ field: s.field, typed: oneLine(s.typed), why: oneLine(s.why) })),
    fields: FIELDS.filter((f) => asked.has(f)),
  };
}

export type PlainResult = { ok: true; picks: PlainPick[] } | { ok: false; code: string };

/** Where the plain list comes from. The default posts to the route; the dev preview supplies a synthetic one. */
export type PlainSource = (body: CompareRequest, signal?: AbortSignal) => Promise<PlainResult>;

export function readCompareReply(status: number, body: unknown): PlainResult {
  if (status >= 200 && status < 300) {
    const picks = readPlainPicks(body);
    return picks ? { ok: true, picks } : { ok: false, code: "unusable" };
  }
  const code = typeof body === "object" && body !== null && typeof (body as { error?: { code?: unknown } }).error?.code === "string" ? (body as { error: { code: string } }).error.code : `http_${status}`;
  return { ok: false, code: code.slice(0, 40) };
}

export const fetchPlainPicks: PlainSource = async (body, signal) => {
  try {
    const res = await fetch(COMPARE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // A reply that is not JSON is read by its status alone.
    }
    return readCompareReply(res.status, json);
  } catch {
    return { ok: false, code: "network" };
  }
};
