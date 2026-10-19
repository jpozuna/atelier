// Profile build: resolved seeds (each with the tags its why was mapped to at onboarding) -> weighted tags ->
// axes. Qloo calls (through the client only): exactly ONE taste-analysis call with all seeds (take 50) and
// nothing else. The why tags come from POST /api/profile/why (why.ts), made at onboarding and cached.
// Code groups and weights; the model (through an AxisNamer) only names an axis from its listed tags.

import type { Axis, Field, TraceEvent } from "@/types";
import { FIELDS } from "@/types";
import type { QlooResponse, TasteAnalysisParams, TasteTag } from "@/lib/qloo/types";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { axisWeights, groupIntoAxes } from "./axes";
import { MIN_AXES, NAMER_CONCURRENCY, TASTE_TAKE } from "./constants";
import { mapLimit, nameAxis, nameCacheKey, tagKind, type AxisNamer, type NameCache } from "./naming";
import { byWeight, dropGeneric, mergeWhyTags, parseTasteTags } from "./tags";
import type { NamingSource, Profile, ProfileSeed, SkippedSeed } from "./types";

/** The only client method a profile build uses. */
export interface ProfileClient {
  tasteAnalysis(params: TasteAnalysisParams): Promise<QlooResponse<TasteTag>>;
}

export interface BuildDeps {
  client: ProfileClient;
  namer: AxisNamer;
  /** Remembers model-named axes by tag-id set so a repeat build makes no model call. */
  nameCache?: NameCache;
  /** Receives each trace event as it happens. */
  emit?: (event: TraceEvent) => void;
  now?: () => Date;
}

export interface BuildResult {
  profile: Profile;
  axes: Axis[];
  /** Internal only (never serialized by the route): axis id to why the model's name was rejected. */
  namingRejections: Record<string, string>;
}

type OwnEvent = Extract<TraceEvent, { kind: "extract_tags" | "map_why" | "build_axes" }>;
type ProfileEventBody = OwnEvent extends infer E ? (E extends OwnEvent ? Omit<E, "t"> : never) : never;

/** The input cannot produce a profile (no seed has an entity id, or no usable tags). Maps to a 422. */
export class ProfileInputError extends Error {
  constructor(
    readonly code: "no_usable_seeds" | "empty_profile",
    message: string,
  ) {
    super(message);
    this.name = "ProfileInputError";
  }
}

/** Seeds that can feed taste analysis: they have a Qloo entity id, first one per entity. */
export function usableSeeds<S extends ProfileSeed>(seeds: readonly S[]): { used: S[]; skipped: SkippedSeed[] } {
  const used: S[] = [];
  const skipped: SkippedSeed[] = [];
  const seen = new Set<string>();
  for (const s of seeds) {
    if (!s.qlooId) skipped.push({ id: s.id, reason: "no_entity" });
    else if (seen.has(s.qlooId)) skipped.push({ id: s.id, reason: "duplicate_entity" });
    else {
      seen.add(s.qlooId);
      used.push(s);
    }
  }
  return { used, skipped };
}

export async function buildProfile(seeds: readonly ProfileSeed[], deps: BuildDeps): Promise<BuildResult> {
  const now = deps.now ?? (() => new Date());
  const emit = (e: ProfileEventBody) => deps.emit?.({ t: now().toISOString(), ...e } as TraceEvent);

  const { used, skipped } = usableSeeds(seeds);
  if (!used.length) throw new ProfileInputError("no_usable_seeds", "No seed has a resolved entity yet.");
  const fields = FIELDS.filter((f) => used.some((s) => s.field === f));

  // 1. The one Qloo call: taste analysis over every seed.
  const taste = await deps.client.tasteAnalysis({ "signal.interests.entities": used.map((s) => s.qlooId as string), take: TASTE_TAKE });
  if (taste.outcome === "empty") throw new ProfileInputError("empty_profile", "The taste graph returned no tags for these seeds.");
  const parsed = parseTasteTags(taste.items, used);
  if (!parsed.tags.length) throw new ProfileInputError("empty_profile", "None of the returned tags could be used.");
  for (const field of fields) {
    const type = FIELD_SEARCH_TYPE[field];
    const count = parsed.tags.filter((t) => t.types.includes(type)).length;
    emit({ kind: "extract_tags", say: `Read ${count} tags from the taste graph that apply to ${field}.`, field, tagCount: count });
  }

  // 2. Drop generic taste tags by rank, then add the why tags each seed carries (exempt from the drop).
  const { kept, dropped } = dropGeneric(parsed.tags, parsed.popularity);
  const pool = [...kept];
  const matched = mergeWhyTags(pool, used);
  for (const seed of used) {
    if (!seed.why.trim()) continue;
    const ids = matched.get(seed.id) ?? [];
    emit({
      kind: "map_why",
      say: seed.whyTags
        ? `This reason was mapped to ${ids.length} tags when it was entered.`
        : "This reason was never mapped to tags, so the profile uses taste analysis only for it.",
      seedId: seed.id,
      tagIds: ids,
      semanticSearch: true,
      ...(seed.whyTags ? {} : { failed: "unavailable" as const }),
    });
  }

  // 3. Group by tag type, drop thin axes, keep 6 to 8.
  pool.sort(byWeight);
  const grouped = groupIntoAxes(pool);

  // 4. Name each axis from its own tags only, at most NAMER_CONCURRENCY at a time.
  const named = await mapLimit(grouped.groups, NAMER_CONCURRENCY, (g) =>
    nameAxis({ tagType: g.tagType, kind: tagKind(g.tagType), tagNames: g.tags.map((t) => t.name) }, deps.namer, {
      cache: deps.nameCache,
      cacheKey: nameCacheKey(g.tags.map((t) => t.tag)),
    }),
  );
  const weights = axisWeights(grouped.groups);
  const naming: Record<string, NamingSource> = {};
  const namingRejections: Record<string, string> = {};
  const axes: Axis[] = grouped.groups.map((g, i) => {
    naming[g.id] = named[i].source;
    const reason = named[i].reason;
    if (reason) namingRejections[g.id] = reason;
    return {
      id: g.id,
      label: named[i].label,
      labelJustification: named[i].labelJustification,
      weight: weights.get(g.id) ?? 0,
      tagType: g.tagType,
      tags: g.tags,
    };
  });

  const shortfall = axes.length < MIN_AXES;
  const profile: Profile = {
    seedIds: used.map((s) => s.id),
    skippedSeeds: skipped,
    fields: fields as Field[],
    tags: pool,
    bridgeTagIds: pool.filter((t) => t.bridge).map((t) => t.tag),
    droppedGenericCount: dropped.length,
    droppedAxisTagTypes: grouped.droppedTagTypes,
    naming,
    ...(shortfall ? { axisShortfall: { wanted: MIN_AXES, got: axes.length } } : {}),
  };
  emit({
    kind: "build_axes",
    say: `Grouped ${pool.length} tags into ${axes.length} axes by tag type.` + (shortfall ? ` Only ${axes.length} of ${MIN_AXES} axes had enough tags.` : ""),
    axisIds: axes.map((a) => a.id),
    tagCounts: Object.fromEntries(axes.map((a) => [a.id, a.tags.length])),
    droppedGeneric: dropped.length,
    droppedTagTypes: grouped.droppedTagTypes,
    axisShortfall: shortfall,
    naming,
  });
  return { profile, axes, namingRejections };
}
