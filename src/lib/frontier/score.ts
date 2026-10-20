// scorePool: reach and connection for every candidate of one pool, all in code, from that one pool.
//
// Reach = REACH_WEIGHTS . (tagDistance, obscurity, fieldUnfamiliarity), a position on the frontier, not a quality
// score.
//  - tagDistance: 1 - weighted overlap with the profile tags that can apply to the candidate's entity type.
//  - obscurity: 1 - the candidate's popularity percentile WITHIN THE POOL (popularity bunches near 1, so absolute
//    values mean little). Popularity of 0 or missing is unknown (brand long tail): it takes the neutral 0.5 and
//    is left out of the ranking.
//  - fieldUnfamiliarity: 1 - the share of the user's sent seeds that sit in the candidate's field.
//
// Connection = min(1, sum over shared tags of profileWeight * poolRarity) / CONNECTION_NORM, plus a fixed amount
// when a sourced lineage hop that touches a seed is supplied. Only shared tags count. Presence in the results
// alone, cross-domain or not, is never evidence (Qloo marks no backfill). In a field the user has no seed in, a
// shared tag counts only when the profile marks it a bridge tag or its `types` include the candidate's type.
//
// A path is distinctive when a counted shared tag has pool rarity >= DISTINCTIVE_RARITY or a sourced lineage hop is
// present. A candidate clears the floor only with a path, a distinctive path and connection >= CONNECTION_FLOOR.

import type { Candidate, Path, PathAnchor, PathHop, ProfileTag, TraceEvent } from "@/types";
import {
  CONNECTION_FLOOR,
  CONNECTION_NORM,
  DISTINCTIVE_RARITY,
  MIN_ANCHOR_CONTRIBUTION,
  MIN_PICKS_PER_FIELD,
  REACH_WEIGHTS,
} from "@/lib/agent/config";
import type { ProfileSeed } from "@/lib/profile/types";
import { LINEAGE_CONNECTION_WEIGHT, NEUTRAL_OBSCURITY } from "./constants";
import { clamp01, median, percentiles } from "./stats";
import type { FrontierContext, Pool, PoolSignals, ScoreOptions, ScoredCandidate, ScoredPool } from "./types";

const THEME_LABEL_TAGS = 3;

const isPopularityKnown = (c: Candidate): boolean => Number.isFinite(c.popularity) && c.popularity > 0;

/** Inverse frequency of each tag in the pool: 1 - (candidates with the tag / pool size). Pool-relative, 0 to 1. */
export function tagRarity(candidates: readonly Candidate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of candidates) for (const t of c.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  const n = candidates.length;
  const out = new Map<string, number>();
  for (const [id, k] of counts) out.set(id, n > 0 ? clamp01(1 - k / n) : 0);
  return out;
}

/** The profile's tags with this pool's rarity filled in (`ProfileTag.rarity`). The input is not mutated. */
export function withPoolRarity(tags: readonly ProfileTag[], rarity: ReadonlyMap<string, number>): ProfileTag[] {
  return tags.map((t) => ({ ...t, rarity: rarity.get(t.tag) ?? 1 }));
}

function appliesTo(tag: ProfileTag, entityType: string): boolean {
  return tag.types.length === 0 || tag.types.includes(entityType);
}

/** Profile tags that can apply to this entity type; every tag when none can (so overlap is never undefined). */
function applicableTags(profileTags: readonly ProfileTag[], entityType: string): readonly ProfileTag[] {
  const applicable = profileTags.filter((t) => appliesTo(t, entityType));
  return applicable.length > 0 ? applicable : profileTags;
}

interface SharedTag {
  tag: ProfileTag;
  rarity: number;
  /** profileWeight * rarity. */
  contribution: number;
}

function sharedTags(candidate: Candidate, profileById: ReadonlyMap<string, ProfileTag>, rarity: ReadonlyMap<string, number>, seededField: boolean): SharedTag[] {
  const out: SharedTag[] = [];
  for (const ct of candidate.tags) {
    const tag = profileById.get(ct.id);
    if (!tag) continue;
    if (!seededField && !(tag.bridge === true || tag.types.includes(candidate.entityType))) continue;
    const r = rarity.get(ct.id) ?? 0;
    const contribution = tag.weight * r;
    if (!(contribution > 0)) continue;
    out.push({ tag, rarity: r, contribution });
  }
  // Strongest contribution first; ties by tag id so the order is deterministic.
  return out.sort((a, b) => b.contribution - a.contribution || (a.tag.tag < b.tag.tag ? -1 : 1));
}

function seedCarries(seed: ProfileSeed, tag: ProfileTag): boolean {
  return tag.fields.includes(seed.field) || (seed.whyTags ?? []).some((w) => w.tag === tag.tag);
}

/**
 * The anchor seed. With explainability, the top-scoring input entity among the seeds sent (ties: the one listed
 * first by Qloo); `thin` when its score is below MIN_ANCHOR_CONTRIBUTION. Without it, the seed with the strongest tag
 * overlap (sum of the shared tags it carries, ties: more why-tag matches, then the seed listed first), labelled
 * `tag_overlap`. Never chosen for how the story sounds.
 */
function chooseAnchor(candidate: Candidate, shared: readonly SharedTag[], seeds: readonly ProfileSeed[], sentSeedIds: readonly string[]): { seed: ProfileSeed; anchor: PathAnchor } | null {
  const sent = new Set(sentSeedIds);
  const sendable = seeds.filter((s) => s.qlooId !== null && sent.has(s.qlooId));
  if (sendable.length === 0) return null;

  let best: { seed: ProfileSeed; score: number } | null = null;
  for (const e of candidate.explainability ?? []) {
    const seed = sendable.find((s) => s.qlooId === e.entityId);
    if (seed && (best === null || e.score > best.score)) best = { seed, score: e.score };
  }
  if (best) {
    return { seed: best.seed, anchor: { contribution: best.score, source: "qloo_explainability", ...(best.score < MIN_ANCHOR_CONTRIBUTION ? { thin: true } : {}) } };
  }

  let pick = sendable[0]!;
  let pickKey: [number, number] = [-1, -1];
  for (const seed of sendable) {
    const carried = shared.filter((s) => seedCarries(seed, s.tag));
    const key: [number, number] = [carried.reduce((n, s) => n + s.contribution, 0), carried.filter((s) => (seed.whyTags ?? []).some((w) => w.tag === s.tag.tag)).length];
    if (key[0] > pickKey[0] || (key[0] === pickKey[0] && key[1] > pickKey[1])) {
      pick = seed;
      pickKey = key;
    }
  }
  return { seed: pick, anchor: { contribution: null, source: "tag_overlap" } };
}

function validLineage(hop: PathHop | undefined): hop is PathHop {
  return !!hop && hop.kind === "lineage" && hop.provenance === "sourced" && typeof hop.sourceUrl === "string" && hop.sourceUrl.length > 0;
}

function popularitySummary(candidates: readonly Candidate[]): { min: number; median: number; max: number } {
  const known = candidates.filter(isPopularityKnown).map((c) => c.popularity);
  if (known.length === 0) return { min: 0, median: 0, max: 0 };
  return { min: Math.min(...known), median: median(known)!, max: Math.max(...known) };
}

/** Scores every candidate of one pool. Makes no Qloo call and no other I/O. */
export function scorePool(pool: Pool, ctx: FrontierContext, options: ScoreOptions = {}): ScoredPool {
  const { domain, candidates } = pool;
  const profileTags = ctx.profile.tags;
  const profileById = new Map(profileTags.map((t) => [t.tag, t]));
  const rarity = tagRarity(candidates);

  const sentSeeds = ctx.seeds.filter((s) => s.qlooId !== null && pool.sentSeedIds.includes(s.qlooId));
  const seededFields = new Set(sentSeeds.map((s) => s.field));
  const fieldShare = sentSeeds.length > 0 ? sentSeeds.filter((s) => s.field === domain).length / sentSeeds.length : 0;
  const fieldUnfamiliarity = clamp01(1 - fieldShare);

  // Obscurity: popularity percentile within the pool, known values only.
  const knownIdx = candidates.map((c, i) => (isPopularityKnown(c) ? i : -1)).filter((i) => i >= 0);
  const pct = percentiles(knownIdx.map((i) => candidates[i]!.popularity));
  const rankByIndex = new Map<number, number>(knownIdx.map((i, k) => [i, pct[k]!]));

  const scored: ScoredCandidate[] = candidates.map((c, i) => {
    const rank = rankByIndex.get(i) ?? null;
    const obscurity = rank === null ? NEUTRAL_OBSCURITY : clamp01(1 - rank);

    const applicable = applicableTags(profileTags, c.entityType);
    const total = applicable.reduce((n, t) => n + t.weight, 0);
    const have = new Set(c.tags.map((t) => t.id));
    const overlap = total > 0 ? applicable.filter((t) => have.has(t.tag)).reduce((n, t) => n + t.weight, 0) / total : 0;
    const tagDistance = clamp01(1 - overlap);

    const reach = clamp01(REACH_WEIGHTS.tagDistance * tagDistance + REACH_WEIGHTS.obscurity * obscurity + REACH_WEIGHTS.fieldUnfamiliarity * fieldUnfamiliarity);

    const shared = sharedTags(c, profileById, rarity, seededFields.has(domain));
    const lineageHop = options.lineage?.get(c.qlooId);
    const lineage = validLineage(lineageHop) ? lineageHop : undefined;
    const sum = shared.reduce((n, s) => n + s.contribution, 0) + (lineage ? LINEAGE_CONNECTION_WEIGHT : 0);
    const connection = clamp01(Math.min(1, sum) / CONNECTION_NORM);

    const parts = { tagDistance, obscurity, fieldUnfamiliarity, reach };
    const anchored = shared.length > 0 ? chooseAnchor(c, shared, ctx.seeds, pool.sentSeedIds) : null;
    if (!anchored) return { candidate: c, reach: parts, connection, popularityRank: rank, path: null, clearsFloor: false };

    const distinctive = shared.some((s) => s.rarity >= DISTINCTIVE_RARITY) || lineage !== undefined;
    const hops: PathHop[] = [
      { kind: "seed", label: anchored.seed.typed, provenance: "inferred" },
      {
        kind: "theme",
        label: shared.slice(0, THEME_LABEL_TAGS).map((s) => s.tag.name).join(", "),
        tags: shared.map((s) => s.tag.tag),
        provenance: "inferred",
      },
      ...(lineage ? [lineage] : []),
      { kind: "pick", label: c.name, provenance: "inferred" },
    ];
    const path: Path = {
      seedId: anchored.seed.id,
      anchor: anchored.anchor,
      hops,
      sharedTags: shared.map((s) => s.tag.tag),
      distinctive,
    };
    return { candidate: c, reach: parts, connection, popularityRank: rank, path, clearsFloor: distinctive && connection >= CONNECTION_FLOOR };
  });

  const cleared = scored.filter((s) => s.clearsFloor);
  const signals: PoolSignals = {
    scored: scored.length,
    clearedFloor: cleared.length,
    distinctive: scored.filter((s) => s.path?.distinctive).length,
    thin: cleared.length < MIN_PICKS_PER_FIELD,
    clearedMedianReach: median(cleared.map((s) => s.reach.reach)),
    clearedMedianPopularity: median(cleared.filter((s) => isPopularityKnown(s.candidate)).map((s) => s.candidate.popularity)),
  };

  const now = options.now ?? (() => new Date());
  const event: TraceEvent = {
    kind: "score",
    t: now().toISOString(),
    say: `Scored ${scored.length} candidates in ${domain}; ${cleared.length} are connected closely enough to show.`,
    domain,
    scored: scored.length,
    clearedFloor: cleared.length,
    popularity: popularitySummary(candidates),
  };
  options.emit?.(event);

  return { domain, scored, tagRarity: rarity, signals, events: [event] };
}
