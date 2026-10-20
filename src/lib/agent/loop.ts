// The agent loop. Code computes, the model chooses and explains (CLAUDE.md rule 8).
//
//   0. preflight  before any model call, the first pool's params are checked the way the Qloo client will check them,
//                 so a closed POST body gate fails with no model spend.
//   1. themes     the model picks one axis per domain among options code computed (tags that apply to the domain);
//                 that choice decides which seeds lead the domain's query. Falls back to a deterministic rotation.
//                 With a `plan` from an earlier run the themes are replayed and no model call is made.
//   2. pools      ONE insights call per domain (6), built and scored in code (frontier). Events stream as they happen.
//   3. review     code reads each pool and flags it with a reason code (signals.ts). Only if something is flagged, the
//                 model decides what to do about each flagged domain, from actions code computed as possible.
//                 At most MAX_REQUERIES_PER_RUN re-queries in all, each logged with its code, each changing a param.
//                 With a plan, its re-queries are replayed (for domains that are still flagged), no model call. A run
//                 limited to some domains still reviews a flagged domain that the plan has no re-query for.
//   4. bands      calibration, moderate, high and extreme from the one pool per domain (no call per degree).
//   5. paths      code adds `pickOnlyTags` and `distance` hints to each path, then refs add a sourced lineage hop.
//   6. cards      the model writes `why` and `different` from each pick's stored path only; code validates it and
//                 falls back to deterministic text. Lineage is added by code, attributed, as its own sentence.
//
// A run may be limited to some domains (`input.domains`, e.g. one field after a "not me"): then only those fields get
// pools, re-queries, refs and cards, the result holds only them (the client merges them into what it has), and the
// returned plan still covers every field (the incoming plan's other entries are carried over).
//
// Budget of one run: 0 profile calls (the profile is passed in), 6 pools, at most 2 re-queries: 8 live Qloo calls at
// most, 0 on a repeat of the same profile with its plan (identical requests replay from the client's cache). Model
// calls: 1 (themes) + at most 1 (review) + at most 1 per domain (cards) = 8 at most, enforced at runtime.
//
// Hard rules kept here: Qloo is reached only through the injected `insights` (the client); the connection floor is
// never lowered (a thin domain is reported thin, never padded); no random or popular fill; every pick has a stored
// path; sourced and inferred stay separate; no reach, connection or popularity reaches the model or the user.

import type { Axis, Band, DistanceHint, Field, PathHop, Pick as AtelierPick, ProfileTag, RequeryReason, TraceEvent } from "@/types";
import { FIELDS } from "@/types";
import {
  buildPool,
  EDGE_BANDS,
  scorePool,
  seedSignals,
  selectBands,
  type BandSelection,
  type FrontierContext,
  type FrontierPick,
  type InsightsFn,
  type Pool,
  type ScoredCandidate,
  type ScoredPool,
} from "@/lib/frontier";
import type { InsightsEntity, InsightsParams } from "@/lib/qloo/types";
import { QlooBudgetError, QlooCacheMissError, QlooError, QlooHttpError } from "@/lib/qloo/errors";
import { getReferences, lineageTouchingSeeds, refsTraceFields, type LineageRef, type References } from "@/lib/refs";
import { FIELD_SEARCH_TYPE } from "@/lib/seeds/field-types";
import { MAX_REQUERIES_PER_RUN, POOL_POPULARITY_MAX } from "./config";
import { explainDomain } from "./explain";
import { limitCalls, LlmError } from "./llm";
import { REVIEW_SYSTEM, reviewMessage, THEMES_SYSTEM, themesMessage } from "./prompts";
import {
  DISTANCE_OBSCURITY_MIN,
  DISTANCE_TAG_DISTANCE_MIN,
  LLM_EXPLAIN_CONCURRENCY,
  LLM_MAX_CALLS_PER_RUN,
  LLM_PLAN_MAX_TOKENS,
  LLM_REVIEW_MAX_TOKENS,
  MAX_PICK_ONLY_TAGS,
  MAX_TAGS_PER_OPTION,
  PICK_ONLY_MIN_RARITY,
  REASON_MAX_CHARS,
  REQUERY_POPULARITY_MIN,
  REQUERY_POPULARITY_STEP,
  RUN_MAX_PLAN_REQUERIES,
  RUN_PICKS_PER_BAND,
  RUN_POOL_CONCURRENCY,
} from "./run-constants";
import { readPool, REASON_PHRASE, REASON_PRIORITY, type PoolReading } from "./signals";
import { checkText, FIELD_PHRASE, restates } from "./text";
import {
  CHOOSE_THEMES_TOOL,
  DECIDE_REQUERIES_TOOL,
  parseDecisions,
  parseThemes,
  type AxisOption,
  type RequeryDecision,
  type RequeryOptions,
} from "./tools";
import type { DomainResult, DomainStatus, PlanAction, RunDeps, RunInput, RunMeta, RunPlan, RunResult } from "./types";

/** The request cannot be run at all (before any call). */
export class RunInputError extends Error {
  constructor(
    readonly code: "no_usable_seeds",
    message: string,
  ) {
    super(message);
    this.name = "RunInputError";
  }
}

/** Thrown inside the preflight stub to hand back the params buildPool built, without sending anything. */
class PreflightStop extends Error {
  constructor(readonly params: InsightsParams) {
    super("preflight");
  }
}

const BANDS_SHOWN: readonly Band[] = ["calibration", ...EDGE_BANDS];
const BAND_PRIORITY: readonly Band[] = ["extreme", "high", "moderate", "calibration"];

const round2 = (n: number): number => Number(n.toFixed(2));
const capitalise = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A failure that affects one domain only (this domain is unavailable, the others still run). */
function isDomainLevel(err: unknown): boolean {
  if (err instanceof QlooCacheMissError) return true;
  if (err instanceof QlooHttpError) return err.kind === "rate_limited" || err.kind === "server_error" || err.kind === "gateway_timeout";
  if (err instanceof QlooError) return err.kind === "network" || err.kind === "parse";
  return false;
}

/** Runs `fn` over `items` with at most `limit` in flight. Stops starting new work after the first failure. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface DomainState {
  domain: Field;
  /** Axis whose tags lead this domain's query. Undefined: every seed weighs the same. */
  axisId?: string;
  focusTagIds?: string[];
  popularityMax: number;
  /** Axes already used for this domain, so a re-query never repeats one. */
  tried: Set<string>;
  pool?: Pool;
  scored?: ScoredPool;
  reading?: PoolReading;
  error?: unknown;
  requeried?: RequeryReason;
  requeryResult?: "improved" | "kept_first";
}

export async function runAgent(input: RunInput, deps: RunDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const emit = (e: TraceEvent) => deps.emit?.(e);
  const checkAbort = () => {
    if (deps.signal?.aborted) throw new Error("run cancelled");
  };
  const llm = limitCalls(deps.llm, LLM_MAX_CALLS_PER_RUN);
  const llmStart = deps.llm.stats();

  // The domains this run covers, in field order. Unlisted fields are not queried, re-queried, referenced or explained.
  const active: readonly Field[] = input.domains ? FIELDS.filter((d) => input.domains!.includes(d)) : FIELDS;

  const sendable = input.seeds.filter((s) => typeof s.qlooId === "string" && s.qlooId.length > 0);
  if (sendable.length === 0) throw new RunInputError("no_usable_seeds", "Add at least one seed that has been matched to an entity.");

  const ctx: FrontierContext = { profile: input.profile, seeds: input.seeds };
  const seedNames = sendable.map((s) => s.typed);
  const exclusions = { entityIds: input.exclude ?? [] };
  const axisById = new Map(input.axes.map((a) => [a.id, a]));
  const tagNames = new Map<string, string>();
  for (const t of [...input.profile.tags, ...input.axes.flatMap((a) => a.tags)]) tagNames.set(t.tag, t.name);
  const pickTagNames = new Map<string, string>();
  const seedFields = new Map(input.seeds.map((s) => [s.id, s.field]));
  const seedWhys = new Map(input.seeds.map((s) => [s.id, s.why]));
  const idToSeedId = new Map(sendable.map((s) => [s.qlooId as string, s.id]));
  const fallbacks: string[] = [];

  // Raw insights items by entity id, kept so refs can read lineage properties without any further call.
  const raw = new Map<string, InsightsEntity>();
  const insights: InsightsFn = async (params, opts) => {
    checkAbort();
    const res = await deps.insights(params, opts);
    for (const item of res.items) if (typeof item.entity_id === "string") raw.set(item.entity_id, item);
    return res;
  };

  // ---- 0. preflight ----------------------------------------------------------------------------------------
  checkAbort();
  if (deps.preflight) {
    let built: InsightsParams | null = null;
    try {
      await buildPool(active[0] ?? FIELDS[0], ctx, exclusions, {
        insights: async (params) => {
          throw new PreflightStop(params);
        },
      });
    } catch (err) {
      if (err instanceof PreflightStop) built = err.params;
      else throw err;
    }
    if (built) for (const d of active) deps.preflight({ ...built, "filter.type": FIELD_SEARCH_TYPE[d] }, { purpose: "picks" });
  }

  // ---- 1. themes -------------------------------------------------------------------------------------------
  const applicableTags = (axis: Axis, domain: Field): ProfileTag[] => axis.tags.filter((t) => t.types.includes(FIELD_SEARCH_TYPE[domain]));
  const offered = Object.fromEntries(
    FIELDS.map((d) => [
      d,
      input.axes
        .filter((a) => applicableTags(a, d).length > 0)
        .map((a): AxisOption => ({ id: a.id, label: a.label, tagNames: applicableTags(a, d).slice(0, MAX_TAGS_PER_OPTION).map((t) => t.name) })),
    ]),
  ) as Record<Field, AxisOption[]>;

  // What the model may choose from: only the domains this run covers.
  const offeredActive = Object.fromEntries(FIELDS.map((d) => [d, active.includes(d) ? offered[d] : []])) as Record<Field, AxisOption[]>;

  const replay = sanitizePlan(input.plan, offered);
  const states = new Map<Field, DomainState>(active.map((d) => [d, { domain: d, popularityMax: POOL_POPULARITY_MAX, tried: new Set<string>() }]));
  const plan: RunPlan = { themes: [], requeries: [] };

  await chooseThemes();

  async function chooseThemes(): Promise<void> {
    // Deterministic plan: axes in profile order, a different axis per domain where the options allow. Worked out over
    // every field (not just the active ones) so a domain's fallback axis does not depend on which fields run.
    const used = new Set<string>();
    const fallbackAxis = new Map<Field, string>();
    for (const d of FIELDS) {
      const opts = offered[d];
      if (opts.length === 0) continue;
      const pick = opts.find((o) => !used.has(o.id)) ?? opts[0]!;
      used.add(pick.id);
      fallbackAxis.set(d, pick.id);
    }
    if (!active.some((d) => fallbackAxis.has(d))) return;

    const chosen = new Map<Field, { axisId: string; reason: string }>();
    // A plan from an earlier run means no themes model call, even for a field the plan does not cover (deterministic axis).
    if (replay) {
      for (const t of replay.themes) if (active.includes(t.domain)) chosen.set(t.domain, { axisId: t.axisId, reason: t.reason });
    } else if (llm.enabled) {
      try {
        const reply = await llm.call({
          tool: CHOOSE_THEMES_TOOL,
          system: THEMES_SYSTEM,
          user: themesMessage(offeredActive, sendable),
          maxTokens: LLM_PLAN_MAX_TOKENS,
          signal: deps.signal,
        });
        for (const t of parseThemes(reply, offeredActive)) chosen.set(t.domain, { axisId: t.axisId, reason: t.reason });
      } catch (err) {
        if (err instanceof LlmError && err.kind === "aborted") throw err;
        fallbacks.push("themes");
      }
    } else {
      fallbacks.push("themes");
    }

    for (const d of active) {
      const axisId = chosen.get(d)?.axisId ?? fallbackAxis.get(d);
      if (!axisId) continue;
      const axis = axisById.get(axisId)!;
      const tags = applicableTags(axis, d);
      const say = `Carrying "${axis.label}" into ${FIELD_PHRASE[d]}.`;
      const modelReason = chosen.get(d)?.reason ?? "";
      const allowed = [axis.label, ...tags.map((t) => t.name), ...Object.values(FIELD_PHRASE)];
      const ok = modelReason.trim() !== "" && checkText(modelReason, { allowed, maxChars: REASON_MAX_CHARS, noLineage: false }).length === 0 && !restates(modelReason, say);
      if (chosen.has(d) && !ok) fallbacks.push(`themes:${d} reason`);
      const reason = ok ? modelReason.trim() : `Its tags carry over to ${FIELD_PHRASE[d]}, so the seeds that carry them lead the search there.`;
      const state = states.get(d)!;
      state.axisId = axisId;
      state.focusTagIds = tags.map((t) => t.tag);
      state.tried.add(axisId);
      const weights = seedSignals(ctx.seeds, ctx.profile.tags, state.focusTagIds);
      const top = Math.max(...weights.map((w) => w.weight ?? 1));
      plan.themes.push({ domain: d, axisId, reason, leadSeedIds: weights.filter((w) => (w.weight ?? 1) === top).map((w) => idToSeedId.get(w.id)).filter((x): x is string => !!x) });
      emit({ kind: "choose_theme", t: now().toISOString(), say, themeTags: state.focusTagIds, reason });
    }
  }

  // ---- 2. pools --------------------------------------------------------------------------------------------
  async function buildDomain(state: DomainState): Promise<void> {
    checkAbort();
    try {
      const built = await buildPool(state.domain, ctx, exclusions, { insights, emit, now }, { focusTagIds: state.focusTagIds, popularityMax: state.popularityMax });
      state.pool = built;
      state.scored = scorePool(built, ctx, { emit, now });
    } catch (err) {
      if (!isDomainLevel(err)) throw err;
      state.error = err;
    }
  }

  checkAbort();
  await mapLimit(active.map((d) => states.get(d)!), RUN_POOL_CONCURRENCY, buildDomain);
  const live = [...states.values()].filter((s) => s.scored);
  if (live.length === 0) {
    // Every domain failed the same way: surface it as the run's error.
    throw [...states.values()].find((s) => s.error)?.error ?? new Error("no domain could be queried");
  }

  // ---- 3. review and re-query -------------------------------------------------------------------------------
  checkAbort();
  const requeries: RunMeta["requeries"] = [];
  const notRequeried: RunMeta["notRequeried"] = [];
  await reviewAndRequery();

  function optionsFor(state: DomainState, reason: RequeryReason): RequeryOptions {
    const tightened = round2(state.popularityMax - REQUERY_POPULARITY_STEP);
    const tightenTo = reason !== "empty" && tightened >= REQUERY_POPULARITY_MIN ? tightened : null;
    const current = JSON.stringify(seedSignals(ctx.seeds, ctx.profile.tags, state.focusTagIds));
    const axisIds = offered[state.domain]
      .filter((o) => !state.tried.has(o.id))
      .filter((o) => {
        const tags = applicableTags(axisById.get(o.id)!, state.domain).map((t) => t.tag);
        return JSON.stringify(seedSignals(ctx.seeds, ctx.profile.tags, tags)) !== current;
      })
      .map((o) => o.id);
    return { reason, tightenTo, axisIds };
  }

  async function reviewAndRequery(): Promise<void> {
    const flagged: { state: DomainState; options: RequeryOptions }[] = [];
    for (const d of active) {
      const state = states.get(d)!;
      if (!state.pool || !state.scored) continue;
      state.reading = readPool(state.pool, state.scored, seedNames);
      const reason = state.reading.reason;
      if (!reason) continue;
      const options = optionsFor(state, reason);
      if (options.tightenTo === null && options.axisIds.length === 0) notRequeried.push({ domain: d, reason });
      else flagged.push({ state, options });
    }
    if (flagged.length === 0) return;
    flagged.sort(
      (a, b) => REASON_PRIORITY.indexOf(a.options.reason) - REASON_PRIORITY.indexOf(b.options.reason) || FIELDS.indexOf(a.state.domain) - FIELDS.indexOf(b.state.domain),
    );
    const budget = MAX_REQUERIES_PER_RUN;
    const optionMap = new Map(flagged.map((f) => [f.state.domain, f.options]));

    // A plan replays its own re-queries for domains that are flagged again (the cached pools make them the same).
    const replayed: RequeryDecision[] = replay
      ? replay.requeries
          .filter((r, i, all) => all.findIndex((x) => x.domain === r.domain) === i)
          .filter((r) => optionMap.has(r.domain))
          .filter((r) => (r.action.kind === "lean_axis" ? offered[r.domain].some((o) => o.id === (r.action as { axisId: string }).axisId) : true))
          .slice(0, budget)
      : [];
    // A full replay never asks the model. A run limited to some domains has new pools (its `exclude` changes the request),
    // so a flagged domain the plan has no re-query for is reviewed as in a new run.
    const open = replay && !input.domains ? [] : flagged.filter((f) => !replayed.some((r) => r.domain === f.state.domain));
    const openBudget = budget - replayed.length;

    let decisions: RequeryDecision[] | null = replay && open.length === 0 ? replayed : null;
    if (decisions === null && openBudget <= 0) decisions = replayed;
    if (decisions === null) {
      if (llm.enabled) {
        try {
          const axisInfo = new Map(active.flatMap((d) => offered[d]).map((a) => [a.id, a]));
          const reply = await llm.call({
            tool: DECIDE_REQUERIES_TOOL,
            system: REVIEW_SYSTEM,
            user: reviewMessage(
              open.map((f) => ({
                domain: f.state.domain,
                options: f.options,
                counts: { results: f.state.reading!.scored, connected: f.state.reading!.clearedFloor, distinctive: f.state.reading!.distinctive },
              })),
              axisInfo,
              openBudget,
            ),
            maxTokens: LLM_REVIEW_MAX_TOKENS,
            signal: deps.signal,
          });
          if (!Array.isArray((reply as { decisions?: unknown }).decisions)) throw new LlmError("shape", "no decisions");
          decisions = [...replayed, ...parseDecisions(reply, new Map(open.map((f) => [f.state.domain, f.options])), openBudget)];
        } catch (err) {
          if (err instanceof LlmError && err.kind === "aborted") throw err;
          fallbacks.push("review");
        }
      } else {
        fallbacks.push("review");
      }
      if (decisions === null) decisions = [...replayed, ...fallbackDecisions(open, openBudget)];
    }

    const decided = new Set(decisions.map((d) => d.domain));
    for (const f of flagged) if (!decided.has(f.state.domain)) notRequeried.push({ domain: f.state.domain, reason: f.options.reason });

    for (const decision of decisions.slice(0, MAX_REQUERIES_PER_RUN)) {
      checkAbort();
      await requery(decision, optionMap.get(decision.domain)!.reason);
    }
  }

  /** No model: the first action that suits the reason. too_obvious tightens popularity; the others try another axis first. */
  function fallbackDecisions(flagged: { state: DomainState; options: RequeryOptions }[], budget: number): RequeryDecision[] {
    const out: RequeryDecision[] = [];
    for (const f of flagged) {
      if (out.length >= budget) break;
      const { options, state } = f;
      const tighten = options.tightenTo !== null ? ({ kind: "tighten_popularity", popularityMax: options.tightenTo } as const) : null;
      const lean = options.axisIds.length > 0 ? ({ kind: "lean_axis", axisId: options.axisIds[0]! } as const) : null;
      const action = options.reason === "too_obvious" ? (tighten ?? lean) : (lean ?? tighten);
      if (action) out.push({ domain: state.domain, action });
    }
    return out;
  }

  async function requery(decision: RequeryDecision, reason: RequeryReason): Promise<void> {
    const state = states.get(decision.domain)!;
    const action: PlanAction = decision.action;
    let focusTagIds = state.focusTagIds;
    let popularityMax = state.popularityMax;
    let axisId = state.axisId;
    let paramChanges: Record<string, unknown>;
    if (action.kind === "tighten_popularity") {
      popularityMax = action.popularityMax;
      paramChanges = { "filter.popularity.max": popularityMax };
    } else {
      const axis = axisById.get(action.axisId)!;
      axisId = axis.id;
      focusTagIds = applicableTags(axis, state.domain).map((t) => t.tag);
      paramChanges = { "signal.interests.entities": `seed weights leaned toward ${axis.label}` };
    }
    requeries.push({ domain: state.domain, reason });
    plan.requeries.push({ domain: state.domain, action });
    state.requeried = reason;
    if (axisId) state.tried.add(axisId);

    const previous = { scored: state.scored!, reading: state.reading! };
    // The second pool's events are held until its result is known, so the `requery` event can say whether the new
    // results replaced the first. Order stays: requery, then the pool's own events.
    const held: TraceEvent[] = [];
    let outcome: "improved" | "kept_first" = "kept_first";
    try {
      const built = await buildPool(state.domain, ctx, exclusions, { insights, emit: (e) => held.push(e), now }, { focusTagIds, popularityMax });
      const scored = scorePool(built, ctx, { emit: (e) => held.push(e), now });
      const reading = readPool(built, scored, seedNames);
      const better =
        reason === "too_obvious"
          ? !scored.signals.thin && (reading.reason !== "too_obvious" || (reading.obviousShare ?? 1) < (previous.reading.obviousShare ?? 1))
          : scored.signals.clearedFloor > previous.scored.signals.clearedFloor ||
            (scored.signals.clearedFloor === previous.scored.signals.clearedFloor && reading.distinctive > previous.reading.distinctive);
      if (better) {
        outcome = "improved";
        state.pool = built;
        state.scored = scored;
        state.reading = reading;
        state.focusTagIds = focusTagIds;
        state.popularityMax = popularityMax;
        state.axisId = axisId;
      }
    } catch (err) {
      // The first pool stays. A failed re-query costs its call but never the run.
      if (!isDomainLevel(err) && !(err instanceof QlooBudgetError)) throw err;
    }
    state.requeryResult = outcome;
    const lead = `Looking again in ${FIELD_PHRASE[state.domain]}: ${REASON_PHRASE[reason]}`;
    emit({
      kind: "requery",
      t: now().toISOString(),
      say: outcome === "improved" ? `${lead}. The new results replace the first.` : `${lead}. Nothing better turned up, so the first results stay.`,
      domain: state.domain,
      reason,
      paramChanges,
    });
    for (const e of held) emit(e);
  }

  // ---- 4. bands --------------------------------------------------------------------------------------------
  checkAbort();
  const selections = new Map<Field, BandSelection>();
  for (const d of active) {
    const st = states.get(d)!;
    if (!st.scored) continue;
    selections.set(d, selectBands(st.scored, { bands: BANDS_SHOWN, perBand: RUN_PICKS_PER_BAND, emit, now }));
  }

  // ---- 5a. path details computed in code -------------------------------------------------------------------
  const profileTagIds = new Set(input.profile.tags.map((t) => t.tag));
  for (const d of active) {
    const sel = selections.get(d);
    const scored = states.get(d)?.scored;
    if (!sel || !scored) continue;
    const byId = new Map<string, ScoredCandidate>(scored.scored.map((s) => [s.candidate.qlooId, s]));
    for (const s of scored.scored) for (const t of s.candidate.tags) if (t.name.trim() && !pickTagNames.has(t.id)) pickTagNames.set(t.id, t.name.trim());
    for (const pick of sel.picks) {
      const sc = byId.get(pick.qlooId);
      if (!sc) continue;
      const pickOnly = sc.candidate.tags
        .filter((t) => !profileTagIds.has(t.id) && t.name.trim() && (scored.tagRarity.get(t.id) ?? 0) >= PICK_ONLY_MIN_RARITY)
        .sort((a, b) => (scored.tagRarity.get(b.id) ?? 0) - (scored.tagRarity.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1))
        .slice(0, MAX_PICK_ONLY_TAGS)
        .map((t) => t.id);
      const seedField = seedFields.get(pick.path.seedId);
      const distance: DistanceHint[] = [];
      if (seedField && seedField !== pick.field) distance.push("other_field");
      if (sc.reach.tagDistance >= DISTANCE_TAG_DISTANCE_MIN) distance.push("farther_from_tags");
      if (sc.popularityRank !== null && sc.reach.obscurity >= DISTANCE_OBSCURITY_MIN) distance.push("less_familiar");
      pick.path = { ...pick.path, ...(pickOnly.length ? { pickOnlyTags: pickOnly } : {}), ...(distance.length ? { distance } : {}) };
    }
  }

  // ---- 5b. references for the finalists --------------------------------------------------------------------
  checkAbort();
  const refs = new Map<string, References>();
  await fetchRefs();

  async function fetchRefs(): Promise<void> {
    // Round-robin across domains, farthest band first, so a capped lookup budget is spread over the fields.
    const lists = active.map((d) => [...(selections.get(d)?.picks ?? [])].sort((a, b) => BAND_PRIORITY.indexOf(a.band) - BAND_PRIORITY.indexOf(b.band)));
    const order: FrontierPick[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) order.push(l[i]!);
    if (order.length === 0) return;

    for (const pick of order) {
      checkAbort();
      const item = raw.get(pick.qlooId);
      try {
        refs.set(
          pick.qlooId,
          await getReferences(
            { qlooId: pick.qlooId, name: pick.name, field: pick.field, ...(item?.properties ? { properties: item.properties } : {}), ...(item?.external ? { external: item.external } : {}) },
            deps.refs,
            { seedNames },
          ),
        );
      } catch {
        // A refs problem only means fewer hops. It never stops a run.
      }
    }
    const all = [...refs.values()];
    const fields = refsTraceFields(all);
    emit({
      kind: "fetch_refs",
      t: now().toISOString(),
      say: "Looked up documented lineage and readings for the finalists.",
      pickIds: order.map((p) => p.id),
      sourcedCount: fields.sourcedCount,
      inferredCount: fields.inferredCount,
      sourceUrls: fields.sourceUrls,
    });
    for (const pick of order) {
      const r = refs.get(pick.qlooId);
      const touching = r ? lineageTouchingSeeds(r, seedNames)[0] : undefined;
      if (touching) pick.path = withLineage(pick.path, touching);
    }
  }

  // ---- 6. cards --------------------------------------------------------------------------------------------
  checkAbort();
  const readings = new Map([...refs].map(([id, r]) => [id, r.reading]));
  const explainCtx = { tagNames, pickTagNames, seedFields, seedWhys, seedNames, llm, signal: deps.signal, checkAbort, emit, now };
  const explained = new Map<Field, AtelierPick[]>();
  await mapLimit(active.filter((d) => selections.has(d)), LLM_EXPLAIN_CONCURRENCY, async (d) => {
    checkAbort();
    const out = await explainDomain(d, selections.get(d)!.picks, readings, explainCtx);
    explained.set(d, out.picks);
    fallbacks.push(...out.fallbacks);
  });

  // ---- result ----------------------------------------------------------------------------------------------
  const domains: DomainResult[] = active.map((d) => {
    const st = states.get(d)!;
    const sel = selections.get(d);
    const picks = explained.get(d) ?? [];
    const byBand = { calibration: [], moderate: [], high: [], extreme: [] } as Record<Band, AtelierPick[]>;
    for (const p of picks) byBand[p.band].push(p);
    const status: DomainStatus = !sel ? "unavailable" : picks.length === 0 ? "empty" : sel.thin ? "thin" : "ok";
    const note = noteFor(d, status);
    return {
      domain: d,
      status,
      picks,
      byBand,
      emptyBands: sel?.emptyBands ?? [],
      thin: sel?.thin ?? status === "unavailable",
      ...(st.requeried ? { requeried: st.requeried } : {}),
      ...(st.requeryResult ? { requeryResult: st.requeryResult } : {}),
      ...(note ? { note } : {}),
    };
  });

  const fullPlan = input.domains ? mergePlan(replay, plan, active) : plan;
  const stats = deps.qlooStats?.();
  const llmEnd = deps.llm.stats();
  return {
    domains,
    plan: fullPlan,
    meta: {
      qloo: stats ? { live: stats.liveCalls, cached: stats.cacheHits } : null,
      requeries,
      notRequeried,
      anthropic: { calls: llmEnd.calls - llmStart.calls, cacheHits: llmEnd.cacheHits - llmStart.cacheHits, failures: llmEnd.failures - llmStart.failures },
      fallbacks,
    },
  };
}

/**
 * The plan of a run limited to some domains, completed with the incoming plan's entries for the other domains, so it
 * still covers every field. Re-queries stay within RUN_MAX_PLAN_REQUERIES (the plan parser refuses more): this run's
 * come first, then the carried ones.
 */
function mergePlan(incoming: RunPlan | null, fresh: RunPlan, active: readonly Field[]): RunPlan {
  const kept = incoming ?? { themes: [], requeries: [] };
  const themes = [...kept.themes.filter((t) => !active.includes(t.domain)), ...fresh.themes].sort((a, b) => FIELDS.indexOf(a.domain) - FIELDS.indexOf(b.domain));
  const requeries = [...fresh.requeries, ...kept.requeries.filter((r) => !active.includes(r.domain))].slice(0, RUN_MAX_PLAN_REQUERIES);
  return { themes, requeries };
}

/** A plan from the request, reduced to what this run can honour: offered axes, bounded values, at most 2 re-queries. */
function sanitizePlan(plan: RunPlan | undefined, offered: Readonly<Record<Field, readonly AxisOption[]>>): RunPlan | null {
  if (!plan) return null;
  const themes: RunPlan["themes"] = [];
  const seen = new Set<Field>();
  for (const t of plan.themes) {
    if (!FIELDS.includes(t.domain) || seen.has(t.domain) || !offered[t.domain].some((o) => o.id === t.axisId)) continue;
    seen.add(t.domain);
    themes.push({ domain: t.domain, axisId: t.axisId, reason: typeof t.reason === "string" ? t.reason : "" });
  }
  const requeries: RunPlan["requeries"] = [];
  for (const r of plan.requeries) {
    if (requeries.length >= RUN_MAX_PLAN_REQUERIES || !FIELDS.includes(r.domain)) continue;
    const a = r.action;
    if (a.kind === "tighten_popularity" && Number.isFinite(a.popularityMax) && a.popularityMax >= REQUERY_POPULARITY_MIN && a.popularityMax < POOL_POPULARITY_MAX) {
      requeries.push({ domain: r.domain, action: { kind: "tighten_popularity", popularityMax: round2(a.popularityMax) } });
    } else if (a.kind === "lean_axis" && offered[r.domain].some((o) => o.id === a.axisId)) {
      requeries.push({ domain: r.domain, action: { kind: "lean_axis", axisId: a.axisId } });
    }
  }
  return { themes, requeries };
}

function noteFor(domain: Field, status: DomainStatus): string | undefined {
  const phrase = FIELD_PHRASE[domain];
  if (status === "thin") return `Only a few picks in ${phrase} connected closely enough, so the list is short. A seed from a nearby field could widen it.`;
  if (status === "empty") return `Nothing in ${phrase} connected closely enough to your seeds this time.`;
  if (status === "unavailable") return `${capitalise(phrase)} could not be reached just now. Try again in a moment.`;
  return undefined;
}

/**
 * Inserts the sourced lineage hop between the theme and the pick. The path stays seed, theme, lineage, pick. A sourced
 * hop counts as a distinctive link (the path is then distinctive whatever the tag rarity). Qloo-sourced hops carry
 * the "Qloo" label so no one links the placeholder URL; Wikidata hops keep their item link.
 */
export function withLineage(path: AtelierPick["path"], ref: LineageRef): AtelierPick["path"] {
  const hop: PathHop = { ...ref.hop, ...(ref.source === "qloo" && ref.sourceLabel ? { sourceLabel: ref.sourceLabel } : {}) };
  const hops = path.hops.filter((h) => h.kind !== "lineage");
  const pickIndex = hops.findIndex((h) => h.kind === "pick");
  hops.splice(pickIndex < 0 ? hops.length : pickIndex, 0, hop);
  return { ...path, hops, distinctive: true };
}
