// Synthetic fixtures for the frontier tests. Invented names; entity ids shaped 00000000-0000-4000-8000-0000000000NN;
// tag ids shaped urn:tag:fixture:... Test-only: production code never imports this file. No Qloo data.

import type { Field, ProfileTag } from "@/types";
import type { InsightsEntity, InsightsParams, QlooResponse } from "@/lib/qloo/types";
import type { Profile, ProfileSeed, WhyTag } from "@/lib/profile/types";
import { id } from "@/lib/qloo/testing";
import type { FrontierContext, InsightsFn } from "./types";

export { id };
export const MOVIE = "urn:entity:movie";
export const ARTIST = "urn:entity:artist";
const ALL_TYPES = ["urn:entity:artist", "urn:entity:movie", "urn:entity:tv_show", "urn:entity:book", "urn:entity:place", "urn:entity:brand"];

/** Tag id for fixture tag n. */
export const tg = (n: number) => `urn:tag:fixture:theme:t${n}`;

export function profileTag(n: number, weight: number, over: Partial<ProfileTag> = {}): ProfileTag {
  return {
    tag: tg(n),
    name: `Fixture Tag ${n}`,
    tagType: "urn:tag:fixture:theme",
    affinity: weight,
    types: ALL_TYPES,
    weight,
    fields: ["music", "film"],
    source: "taste_analysis",
    ...over,
  };
}

export function profileOf(tags: ProfileTag[], seedIds: string[] = [], fields: Field[] = ["music", "film"]): Profile {
  return {
    seedIds,
    skippedSeeds: [],
    fields,
    tags,
    bridgeTagIds: tags.filter((t) => t.bridge).map((t) => t.tag),
    droppedGenericCount: 0,
    droppedAxisTagTypes: [],
    naming: {},
  };
}

export function seedOf(n: number, field: Field, over: Partial<ProfileSeed> = {}): ProfileSeed {
  return { id: `seed-${n}`, field, typed: `Invented Work ${n}`, why: `reason ${n}`, qlooId: id(n), status: "clean", ...over };
}

export const whyTagOf = (n: number): WhyTag => ({ tag: tg(n), name: `Fixture Tag ${n}`, tagType: "urn:tag:fixture:theme" });

export interface EntitySpec {
  n: number;
  popularity?: number;
  tags: number[];
  affinity?: number;
  /** [seed entity n, score] pairs for query.explainability. */
  explain?: [number, number][];
  subtype?: string;
  properties?: Record<string, unknown>;
  name?: string;
}

/** An insights entity shaped like the spike's. Candidate ids start at 100 so they never collide with seeds 1..9. */
export function entity(s: EntitySpec): InsightsEntity {
  return {
    entity_id: id(s.n),
    name: s.name ?? `Invented Pick ${s.n}`,
    type: "urn:entity",
    subtype: s.subtype ?? MOVIE,
    ...(s.popularity === undefined ? {} : { popularity: s.popularity }),
    tags: s.tags.map((t) => ({ id: tg(t), name: `Fixture Tag ${t}`, type: "urn:tag:fixture:theme" })),
    query: {
      affinity: s.affinity ?? 0.8,
      ...(s.explain ? { explainability: { "signal.interests.entities": s.explain.map(([n, score]) => ({ entity_id: id(n), score })) } } : {}),
    },
    ...(s.properties ? { properties: s.properties } : {}),
  };
}

export interface FakeInsights {
  fn: InsightsFn;
  calls: { params: InsightsParams; purpose: string }[];
}

/** A fake of the client's `insights`: returns the given items and records every call. */
export function fakeInsights(items: InsightsEntity[]): FakeInsights {
  const calls: FakeInsights["calls"] = [];
  const fn: InsightsFn = async (params, opts) => {
    calls.push({ params, purpose: opts.purpose });
    const res: QlooResponse<InsightsEntity> = {
      outcome: items.length ? "ok" : "empty",
      items,
      meta: { endpoint: "/v2/insights", method: "POST", requestKey: "fixture", cached: true, source: "cache", status: 200, ms: 0, remaining: null },
    };
    return res;
  };
  return { fn, calls };
}

/** Three seeds: two music, one film. The pool domain in most tests is film (fieldUnfamiliarity 2/3). */
export function threeSeeds(): ProfileSeed[] {
  return [seedOf(1, "music"), seedOf(2, "music"), seedOf(3, "film")];
}

/**
 * The shared synthetic pool: 40 film candidates in four tiers of ten, from close to far.
 *  - Profile tags 1 to 7 (weights .9 .8 .7 .6 .55 .5 .45).
 *  - Tier 0 shares 1, 2, 3. Tier 1 shares 3, 7. Tier 2 shares 4, 5. Tier 3 shares 6.
 *  - Popularity falls with the index, so the far tiers are the least popular.
 * Tag 3 is carried by half the pool (generic, rarity .5); every other shared tag is distinctive (rarity .75).
 */
export function tieredPool(): { ctx: FrontierContext; items: InsightsEntity[] } {
  const tags = [profileTag(1, 0.9), profileTag(2, 0.8), profileTag(3, 0.7), profileTag(4, 0.6), profileTag(5, 0.55), profileTag(6, 0.5), profileTag(7, 0.45)];
  const seeds = threeSeeds();
  const tierTags: number[][] = [[1, 2, 3], [3, 7], [4, 5], [6]];
  const items: InsightsEntity[] = [];
  for (let i = 0; i < 40; i++) {
    const tier = Math.floor(i / 10);
    items.push(entity({ n: 100 + i, popularity: Number((0.58 - i * 0.012).toFixed(3)), tags: tierTags[tier]!, affinity: Number((0.95 - i * 0.01).toFixed(2)), explain: [[1 + (i % 3), 0.5]] }));
  }
  return { ctx: { profile: profileOf(tags, seeds.map((s) => s.id)), seeds }, items };
}

/**
 * A pool where tag distance and obscurity disagree. 30 film candidates in three groups of ten:
 *  - A shares tags 1, 2, 3 (close by tags) and is the LEAST popular (most obscure).
 *  - B shares tag 4 only (far by tags) and is the MOST popular.
 *  - C shares tag 5 only (far by tags) and sits in the middle on popularity.
 * By tags B and C are far out and A is close; by popularity A is far out and B is close. Each tag is carried by a
 * third of the pool (rarity .67, distinctive).
 */
export function disagreeingPool(): { ctx: FrontierContext; items: InsightsEntity[] } {
  const tags = [profileTag(1, 0.9), profileTag(2, 0.8), profileTag(3, 0.7), profileTag(4, 0.6), profileTag(5, 0.55)];
  const seeds = threeSeeds();
  const items: InsightsEntity[] = [];
  for (let i = 0; i < 10; i++) {
    items.push(entity({ n: 100 + i, popularity: 0.05 + i * 0.01, tags: [1, 2, 3], affinity: 0.9 - i * 0.01, explain: [[1, 0.5]] }));
    items.push(entity({ n: 200 + i, popularity: 0.55 + i * 0.004, tags: [4], affinity: 0.7 - i * 0.01, explain: [[2, 0.5]] }));
    items.push(entity({ n: 300 + i, popularity: 0.3 + i * 0.01, tags: [5], affinity: 0.6 - i * 0.01, explain: [[3, 0.5]] }));
  }
  return { ctx: { profile: profileOf(tags, seeds.map((s) => s.id)), seeds }, items };
}
