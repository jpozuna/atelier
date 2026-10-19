// Test helpers: a fake Wikidata endpoint and synthetic entities. All names and ids are invented.

import type { Field } from "@/types";
import type { FetchLike, FetchResponseLike } from "./wikidata";
import type { RefsEntity } from "./types";

export const synthetic = (n: number): string => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

export function entity(n: number, field: Field, extra: Partial<RefsEntity> = {}): RefsEntity {
  return { qlooId: synthetic(n), name: `Fixture ${field} ${n}`, field, ...extra };
}

export interface FakeItem {
  /** property id to related item ids */
  claims?: Record<string, { id: string; rank?: string; snaktype?: string }[]>;
  label?: string;
}

const claim = (c: { id: string; rank?: string; snaktype?: string }) => ({
  rank: c.rank ?? "normal",
  mainsnak: { snaktype: c.snaktype ?? "value", datavalue: { value: { id: c.id } } },
});

export interface FakeWikidata {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string>; ids: string[]; props: string }[];
  /** Highest number of requests in flight at once. */
  readonly maxInFlight: number;
}

export function fakeWikidata(
  items: Record<string, FakeItem>,
  respond?: (call: number) => FetchResponseLike | Promise<FetchResponseLike> | undefined,
  delayMs = 0,
): FakeWikidata {
  const calls: FakeWikidata["calls"] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async (url, init) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return await answer(url, init);
    } finally {
      inFlight -= 1;
    }
  };
  const answer: FetchLike = async (url, init) => {
    const u = new URL(url);
    const ids = (u.searchParams.get("ids") ?? "").split("|").filter(Boolean);
    const props = u.searchParams.get("props") ?? "";
    calls.push({ url, headers: init.headers, ids, props });
    const custom = respond?.(calls.length);
    if (custom) return custom;
    const entities: Record<string, unknown> = {};
    for (const id of ids) {
      const it = items[id];
      if (!it) {
        entities[id] = { id, missing: "" };
        continue;
      }
      entities[id] = {
        id,
        claims: Object.fromEntries(Object.entries(it.claims ?? {}).map(([p, cs]) => [p, cs.map(claim)])),
        labels: it.label ? { en: { language: "en", value: it.label } } : {},
      };
    }
    return { ok: true, status: 200, json: async () => ({ entities }) };
  };
  return {
    fetch,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

export const status = (code: number, retryAfter?: string): FetchResponseLike => ({
  ok: code >= 200 && code < 300,
  status: code,
  json: async () => ({}),
  headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null) },
});
