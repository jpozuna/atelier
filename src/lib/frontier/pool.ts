// buildPool: ONE /v2/insights POST per domain, take=POOL_TAKE, never one per band. It builds the params, makes
// the call through the injected `insights` function (the T-03 client's `insights`), and normalises the entities
// into Candidates. No scoring here.
//
// Params sent (all but the first two wait for the manager to open the POST body gate in registry.ts):
//   filter.type, signal.interests.entities [{id, weight}], filter.popularity.max, filter.exclude.entities
//   (every sent seed, every other seed, every shown pick), feature.explainability, take.
// Never sent: bias.trends (spike: `off` equals the default and books reject it), or any other param.

import type { Candidate, CandidateTag, ExplainabilityEntry, Field, ProfileTag, TraceEvent } from "@/types";
import { FIELDS } from "@/types";
import type { InsightsEntity, InsightsParams, SeedSignal } from "@/lib/qloo/types";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import type { ProfileSeed } from "@/lib/profile/types";
import { POOL_POPULARITY_MAX, POOL_TAKE } from "@/lib/agent/config";
import { SEED_WEIGHT_OFF_AXIS, SEED_WEIGHT_ON_AXIS } from "./constants";
import { FrontierInputError, type Exclusions, type FrontierContext, type Pool, type PoolDeps, type PoolOptions } from "./types";

const EXPLAIN_KEY = "signal.interests.entities";
/** Qloo property fields that name related works or brands. Names only; T-09 retrieves the sourced hops. */
const LINEAGE_PROPERTY_KEYS = ["influenced_by", "artists_influenced", "genres_influenced", "influenced_other_media", "similar_brands"] as const;

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Does this seed sit on the axis made of these profile tags? Its field or its own why tags carry one of them. */
export function seedOnAxis(seed: ProfileSeed, focusTags: readonly ProfileTag[]): boolean {
  return focusTags.some((t) => t.fields.includes(seed.field) || (seed.whyTags ?? []).some((w) => w.tag === t.tag));
}

/** Seeds that can be sent (resolved to an entity), with per-seed weights leaning toward the axis being explored. */
export function seedSignals(seeds: readonly ProfileSeed[], profileTags: readonly ProfileTag[], focusTagIds: readonly string[] = []): SeedSignal[] {
  const sendable = seeds.filter((s): s is ProfileSeed & { qlooId: string } => isStr(s.qlooId));
  const ids = new Set(focusTagIds);
  const focusTags = profileTags.filter((t) => ids.has(t.tag));
  const anyOn = focusTags.length > 0 && sendable.some((s) => seedOnAxis(s, focusTags));
  const byId = new Map<string, number>();
  for (const s of sendable) {
    const w = anyOn && !seedOnAxis(s, focusTags) ? SEED_WEIGHT_OFF_AXIS : SEED_WEIGHT_ON_AXIS;
    byId.set(s.qlooId, Math.max(byId.get(s.qlooId) ?? 0, w));
  }
  return [...byId].map(([id, weight]) => ({ id, weight }));
}

/** Ids in a params list become a count, as in the Qloo client's own trace, so the trace holds no ids. */
export function redactForTrace(params: InsightsParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? `[${v.length} ids]` : v;
  }
  return out;
}

function namesOf(v: unknown): string[] {
  if (isStr(v)) return [v];
  if (Array.isArray(v)) return v.flatMap(namesOf);
  if (v && typeof v === "object" && isStr((v as { name?: unknown }).name)) return [(v as { name: string }).name];
  return [];
}

function explainabilityOf(item: InsightsEntity): ExplainabilityEntry[] | undefined {
  const raw = item.query?.explainability?.[EXPLAIN_KEY];
  if (!Array.isArray(raw)) return undefined;
  const out: ExplainabilityEntry[] = [];
  for (const e of raw) {
    if (e && isStr(e.entity_id) && typeof e.score === "number" && Number.isFinite(e.score)) out.push({ entityId: e.entity_id, score: e.score });
  }
  return out.length ? out : undefined;
}

/** A raw insights entity as a Candidate; null when it has no id or no name. Origin is always `unknown`. */
export function toCandidate(item: InsightsEntity, domain: Field): Candidate | null {
  if (!isStr(item.entity_id) || !isStr(item.name)) return null;
  const seen = new Set<string>();
  const tags: CandidateTag[] = [];
  for (const t of item.tags ?? []) {
    if (!isStr(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    tags.push({ id: t.id, name: t.name ?? "", type: t.type ?? "" });
  }
  const popularity = typeof item.popularity === "number" && Number.isFinite(item.popularity) ? Math.min(1, Math.max(0, item.popularity)) : 0;
  const lineage = unique(LINEAGE_PROPERTY_KEYS.flatMap((k) => namesOf(item.properties?.[k])));
  const explainability = explainabilityOf(item);
  const affinity = item.query?.affinity;
  return {
    qlooId: item.entity_id,
    name: item.name,
    field: domain,
    entityType: isStr(item.subtype) ? item.subtype : FIELD_SEARCH_TYPE[domain],
    popularity,
    tags,
    ...(typeof affinity === "number" && Number.isFinite(affinity) ? { affinity } : {}),
    ...(explainability ? { explainability } : {}),
    origin: "unknown",
    ...(lineage.length ? { lineage } : {}),
  };
}

/**
 * ONE insights POST for this domain. Throws `FrontierInputError` when there is no resolved seed to send, and lets
 * the client's errors (budget, param, HTTP) through. A 200 with no usable entities returns `outcome: "empty"`
 * (reason `empty` for the loop), it is never treated as success.
 */
export async function buildPool(
  domain: Field,
  ctx: FrontierContext,
  exclusions: Exclusions,
  deps: PoolDeps,
  options: PoolOptions = {},
): Promise<Pool> {
  if (!(FIELDS as readonly string[]).includes(domain)) throw new FrontierInputError("bad_domain", `unknown domain: ${domain}`);
  const entityType = FIELD_SEARCH_TYPE[domain];
  const signals = seedSignals(ctx.seeds, ctx.profile.tags, options.focusTagIds);
  if (signals.length === 0) throw new FrontierInputError("no_seeds", "no resolved seed to send as a signal");
  const popularityMax = options.popularityMax ?? POOL_POPULARITY_MAX;

  // Exclude every seed (the client requires it for picks) and every pick already shown.
  const seedIds = ctx.seeds.map((s) => s.qlooId).filter(isStr);
  const excluded = unique([...seedIds, ...exclusions.entityIds]);
  const excludedSet = new Set(excluded);

  const params: InsightsParams = {
    "filter.type": entityType,
    "signal.interests.entities": signals,
    "filter.popularity.max": popularityMax,
    "filter.exclude.entities": excluded,
    "feature.explainability": true,
    take: POOL_TAKE,
  };

  const now = deps.now ?? (() => new Date());
  const events: TraceEvent[] = [];
  const res = await deps.insights(params, { purpose: "picks" });

  const candidates: Candidate[] = [];
  const seenIds = new Set<string>();
  let droppedExcluded = 0;
  let droppedMalformed = 0;
  for (const item of res.items) {
    const c = toCandidate(item, domain);
    if (!c) droppedMalformed++;
    else if (excludedSet.has(c.qlooId)) droppedExcluded++;
    else if (!seenIds.has(c.qlooId)) {
      seenIds.add(c.qlooId);
      candidates.push(c);
    }
  }
  const explainabilityPresent = candidates.some((c) => c.explainability !== undefined);

  const event: TraceEvent = {
    kind: "query_insights",
    t: now().toISOString(),
    say: `Asked for one pool of candidates in ${domain}.`,
    domain,
    endpoint: "/v2/insights",
    params: redactForTrace(params),
    resultCount: res.items.length,
    explainability: explainabilityPresent,
    // Qloo marks no backfill (spike), so nothing is derived here: `unknown` results count as neither.
    primaryCount: 0,
    backfillCount: 0,
  };
  events.push(event);
  deps.emit?.(event);

  return {
    domain,
    entityType,
    candidates,
    outcome: candidates.length > 0 ? "ok" : "empty",
    sentSeedIds: signals.map((s) => s.id),
    popularityMax,
    returned: res.items.length,
    droppedExcluded,
    droppedMalformed,
    explainabilityPresent,
    events,
  };
}
