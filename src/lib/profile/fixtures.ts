// Synthetic fixtures for profile tests. Invented names; entity ids shaped 00000000-0000-4000-8000-0000000000NN;
// tag ids shaped urn:tag:fixture:... Test-only: production code never imports this file. No Qloo data.

import type { ProfileSeed, WhyTag } from "./types";
import { id } from "@/lib/qloo/testing";

export const MOVIE = "urn:entity:movie";
export const ARTIST = "urn:entity:artist";
export const BOOK = "urn:entity:book";

export const tid = (type: string, n: number) => `urn:tag:fixture:${type}:t${n}`;
export const ttype = (type: string) => `urn:tag:fixture:${type}`;

export interface TasteSpec {
  type: string;
  n: number;
  affinity?: number;
  popularity?: number;
  types?: string[];
}

/** A taste-analysis item shaped like the spike's: { tag_id, name, types[], subtype, tag_value, popularity, query }. */
export function tasteItem({ type, n, affinity = 0.7, popularity = 0, types = [MOVIE] }: TasteSpec) {
  return {
    tag_id: tid(type, n),
    name: `Fixture ${type} ${n}`,
    types,
    subtype: ttype(type),
    tag_value: `v${n}`,
    popularity,
    query: { affinity },
  };
}

export const tasteResponse = (items: object[]) => ({ success: true, duration: 5, results: { tags: items } });

/** 9 tag types with 2 to 4 tags each, plus one type with a single tag (to be dropped). Popularity unknown (0). */
export function richTaste(): ReturnType<typeof tasteItem>[] {
  const types = ["theme", "style", "mood", "setting", "era", "pace", "form", "palette", "texture"];
  const items: ReturnType<typeof tasteItem>[] = [];
  types.forEach((type, i) => {
    const count = 2 + (i % 3);
    for (let n = 1; n <= count; n++) items.push(tasteItem({ type, n, affinity: Math.max(0.2, 0.9 - i * 0.07 - n * 0.02) }));
  });
  items.push(tasteItem({ type: "lonely", n: 1 }));
  return items;
}

/** A tag a why was mapped to (what POST /api/profile/why returns). */
export const whyTag = (n: number, type = "theme"): WhyTag => ({ tag: tid(type, n), name: `Why ${type} ${n}`, tagType: ttype(type) });

export function seed(n: number, over: Partial<ProfileSeed> = {}): ProfileSeed {
  return { id: `seed-${n}`, field: "film", typed: `Invented Title ${n}`, why: `fixture reason ${n}`, qlooId: id(n), status: "clean", ...over };
}

export const tagsResponse = (items: { id: string; name: string; type: string; popularity?: number }[]) => ({
  success: true,
  duration: 5,
  results: { tags: items.map((t) => ({ parents: [], ...t })) },
});
