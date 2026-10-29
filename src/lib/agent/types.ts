// Contracts of the agent loop. Pure types.

import type { Axis, Band, Field, Pick, RequeryReason, TraceEvent } from "@/types";
import type { InsightsParams, InsightsPurpose } from "@/lib/qloo/types";
import type { InsightsFn } from "@/lib/frontier";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import type { RefsContext } from "@/lib/refs";
import type { Llm } from "./llm";

/** What the picks screen posts: the profile it already has (no profile call is made), its axes and the seeds behind it. */
export interface RunInput {
  seeds: ProfileSeed[];
  profile: Profile;
  axes: Axis[];
  /** Entity ids of picks already shown (a "show more" run). Seeds are always excluded. */
  exclude?: string[];
  /** The plan a previous run returned. With it the themes and re-queries are replayed, so the Qloo requests are identical (0 live calls on a repeat) and no themes or review model call is made. */
  plan?: RunPlan;
  /**
   * Run only these domains (non-empty, unique): pools, re-queries, refs and cards for them alone. The result then holds
   * only them, in field order, and the client merges them into its existing result; `plan` still covers every field.
   * Absent: all six. `exclude` applies to these domains' pools only.
   */
  domains?: Field[];
}

/** A re-query action, as the plan records it. */
export type PlanAction = { kind: "tighten_popularity"; popularityMax: number } | { kind: "lean_axis"; axisId: string };

/**
 * What the run decided, returned with the result and accepted back on a repeat. Words and ids only: which axis
 * carries each domain (code derives the seed weights from it, the same way every time) and the re-queries that ran.
 */
export interface RunPlan {
  /** `leadSeedIds` is informational (the seeds that lead the domain); on replay code recomputes the weights from `axisId`. */
  themes: { domain: Field; axisId: string; reason: string; leadSeedIds?: string[] }[];
  requeries: { domain: Field; action: PlanAction }[];
}

export interface RunDeps {
  /** The Qloo client's `insights`, the only way a pool is built. Tests inject a fake. */
  insights: InsightsFn;
  /** ONE refs context per run. */
  refs: RefsContext;
  llm: Llm;
  /** Every trace event, as it happens. Every event passes `isTraceEvent`. */
  emit?: (event: TraceEvent) => void;
  now?: () => Date;
  signal?: AbortSignal;
  /** The run's Qloo client stats, read once at the end for `meta.qloo`. */
  qlooStats?: () => { liveCalls: number; cacheHits: number };
  /**
   * Called with the first pool's params before any model call, so a request the Qloo client would refuse (a closed
   * POST body gate) fails before any model spend. Production passes `prepareInsights` with the client's registry.
   */
  preflight?: (params: InsightsParams, opts: { purpose: InsightsPurpose }) => void;
}

export type DomainStatus = "ok" | "thin" | "empty" | "unavailable";

/** Picks of one domain. `picks` and `byBand` hold complete cards. */
export interface DomainResult<P = Pick> {
  domain: Field;
  status: DomainStatus;
  /** Lowest band first. */
  picks: P[];
  byBand: Record<Band, P[]>;
  /** Requested bands that had no pick of their own. Read the `relax` events for what was shown instead. */
  emptyBands: Band[];
  /** Fewer picks connected closely enough than a field should show. Never padded. */
  thin: boolean;
  /** Set when this domain was re-queried, with the code that triggered it. */
  requeried?: RequeryReason;
  /** What the re-query changed: the second pool replaced the first, or the first results stayed. */
  requeryResult?: "improved" | "kept_first";
  /** A fixed sentence for the user when the domain is thin, empty or unavailable. No numbers, no internal terms. */
  note?: string;
}

export interface RunMeta {
  /** Live and cached Qloo calls of this run's client. Null when the caller gave no stats. */
  qloo: { live: number; cached: number } | null;
  requeries: { domain: Field; reason: RequeryReason }[];
  /** Flagged domains that could not be re-queried (no budget left, no action possible, or the model skipped them). */
  notRequeried: { domain: Field; reason: RequeryReason }[];
  anthropic: { calls: number; cacheHits: number; failures: number };
  /** Which steps used the deterministic fallback instead of the model: "themes", "review", "cards:<domain>", "cards:<domain>:<n> lines",
   *  "themes:<domain> reason", "review:<domain> invalid" (the model chose an action that was not offered; the domain is not re-queried). */
  fallbacks: string[];
}

/**
 * What the code scorers need to check a run, ids and numbers only. SERVER-SIDE ONLY: `toPublicResult` drops it, so it
 * never reaches the browser (hard rule 7). Qloo entity ids, never names.
 */
export interface RunAudit {
  /** Qloo entity ids of the request's seeds that were matched to an entity (`RunInput.seeds[].qlooId`, unique, request order). */
  seedIds: string[];
  /**
   * The `filter.exclude.entities` list the loop handed to the Qloo client for each domain it queried (seeds first, then
   * the request's `exclude`, unique). The same list for every call of a domain (re-queries included). A domain that was
   * not queried (not in `RunInput.domains`) has no entry.
   */
  exclude: Partial<Record<Field, string[]>>;
  /**
   * Pool rarity (0 to 1; 1 = one candidate has the tag) per tag id, per domain, from the pool the shown picks came from
   * (the one the distinctive decision used). Holds the tags in the shown picks' `path.sharedTags` and `path.pickOnlyTags`.
   * A domain with no shown picks has no entry.
   */
  tagRarity: Partial<Record<Field, Record<string, number>>>;
  /** The request's seeds as the paths name them (`path.seedId` is `id`), so evals can match each seed hop. */
  seeds: Array<{ id: string; typed: string; status: string; qlooId: string | null }>;
}

export interface RunResult {
  /** In field order. One entry per domain, including unavailable ones. */
  domains: DomainResult[];
  plan: RunPlan;
  meta: RunMeta;
  /** Server-side only (see `RunAudit`). */
  audit: RunAudit;
}

/** A path as the browser receives it: the anchor keeps its source and `thin`, never the explainability contribution. */
export type PublicPath = Omit<Pick["path"], "anchor"> & { anchor: { contribution: null; source: Pick["path"]["anchor"]["source"]; thin?: boolean } };

/** A pick as the browser receives it: no reach, connection, popularity or contribution (hard rule 7). */
export type PublicPick = Omit<Pick, "reach" | "connection" | "popularity" | "path" | "card"> & { path: PublicPath; card: Omit<Pick["card"], "path"> & { path: PublicPath } };

/** The result as the browser receives it. Nothing numeric about taste, and no model or fallback bookkeeping. */
export interface PublicRunResult {
  domains: DomainResult<PublicPick>[];
  plan: RunPlan;
  meta: { requeries: RunMeta["requeries"]; notRequeried: RunMeta["notRequeried"] };
}

/** What one explanation sees of a pick: its path and nothing else. */
export interface ExplainInput {
  pickId: string;
  /** `why` is the user's own words for this seed (from the request), or null. */
  seed: { label: string; field: Field; why: string | null };
  /** Names of the shared tags in the path (resolved from the profile by id). */
  themeTags: string[];
  /** Names of up to 3 of the pick's own tags that the profile lacks (`Path.pickOnlyTags`). */
  pickOnlyTags: string[];
  /** `Path.distance` as plain words, never numbers. */
  distance: string[];
  /** The retrieved lineage hop, when the path has one. The model must not restate it; code adds it with its source. */
  lineage: { text: string; source: string; /** The retrieved names include one of the user's seeds. */ touchesSeed: boolean } | null;
  pick: { label: string; field: Field };
  /** `graph_link` when the graph reported this seed as the top contributor, else `shared_tags`. */
  anchorBasis: "graph_link" | "shared_tags";
}
