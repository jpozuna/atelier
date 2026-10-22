// Signals to adjustments. Pure: no I/O, no clock, no model. The person's past signals change the next run's input in
// two ways and no other:
//
//   1. Entities they turned down (not_me, not_interested; exact signals only) join `exclude`, so those picks stay out. Newest first, at most
//      LEARN_MAX_EXCLUDED added, and the whole list stays within RUN_MAX_EXCLUDE (the request's own entries come first).
//   2. Profile tags that appear ONLY in turned-down picks' theme hops get a lower weight, and tags in saved picks' theme
//      hops a higher one, each by LEARN_LEAN_STEP of the weight (never above 1).
//
// Only exact signals count (source `reaction` or `not_me_list`). A signal with source `exclude` is inferred and is ignored
// here entirely; it stays in the log for analysis (the report counts it as "shown again").
//
// Nothing else changes: the connection floor, the edge cap, the bands, the seeds, the plan and the domains are untouched
// (hard rule 4). Code computes, the model chooses (hard rule 8): the model never sees a number from here.
//
// The latest stance on a pick wins: a pick saved and later turned down counts as turned down. `tried` is neutral.

import type { Axis } from "@/types";
import type { RunInput } from "@/lib/agent/types";
import { LEARN_LEAN_STEP, LEARN_MAX_EXCLUDED, RUN_MAX_EXCLUDE } from "@/lib/agent/config";
import { SAVED, TURNED_DOWN, timeOf, type Adjustment, type LearnSignal } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Stance = "down" | "up";

interface Resolved {
  stance: Stance;
  entityId: string | null;
  themeTags: string[];
  at: number;
}

/**
 * The latest stance per pick, from exact signals only. A signal with source `exclude` is inferred (a re-run's exclude
 * list also holds picks that were only shown), so it is ignored here: it neither excludes, leans, nor overrides an
 * earlier save. A pick is one pick however it was named: by run and pick id, or by entity id when a signal knows it
 * (a reaction may lack the entity id that a not_me on the same pick carries, and the same entity shown in two runs is
 * one pick).
 */
function resolve(signals: readonly LearnSignal[]): Resolved[] {
  const entityOf = new Map<string, string>();
  for (const s of signals) if (s.entityId) entityOf.set(s.pickKey, s.entityId);
  const ordered = signals.map((s, i) => ({ s, i })).sort((a, b) => timeOf(a.s.at) - timeOf(b.s.at) || a.i - b.i);
  const latest = new Map<string, Resolved>();
  for (const { s } of ordered) {
    if (s.source === "exclude") continue;
    const stance: Stance | null = TURNED_DOWN.includes(s.signal) ? "down" : SAVED.includes(s.signal) ? "up" : null;
    if (!stance) continue;
    const entityId = s.entityId ?? entityOf.get(s.pickKey) ?? null;
    const key = entityId ?? s.pickKey;
    const earlier = latest.get(key);
    // The themes of a pick come from the stored run; keep the ones an earlier signal on the same pick found if this one has none.
    const themeTags = s.themeTags.length > 0 ? s.themeTags : (earlier?.themeTags ?? []);
    latest.set(key, { stance, entityId, themeTags, at: timeOf(s.at) });
  }
  return [...latest.values()];
}

/** What the signals ask for, without applying it. */
export function planAdjustment(input: RunInput, signals: readonly LearnSignal[]): Adjustment {
  const resolved = resolve(signals);
  const known = new Set<string>([...(input.exclude ?? []), ...input.seeds.map((s) => s.qlooId).filter((x): x is string => typeof x === "string")]);

  const room = Math.max(0, Math.min(LEARN_MAX_EXCLUDED, RUN_MAX_EXCLUDE - (input.exclude ?? []).length));
  const exclude: string[] = [];
  for (const r of resolved.filter((x) => x.stance === "down" && x.entityId !== null).sort((a, b) => b.at - a.at)) {
    const id = r.entityId as string;
    if (exclude.length >= room) break;
    if (!UUID.test(id) || known.has(id)) continue;
    known.add(id);
    exclude.push(id);
  }

  const inProfile = new Set<string>([...input.profile.tags.map((t) => t.tag), ...input.axes.flatMap((a) => a.tags.map((t) => t.tag))]);
  const down = new Set<string>();
  const up = new Set<string>();
  for (const r of resolved) {
    for (const t of r.themeTags) if (inProfile.has(t)) (r.stance === "down" ? down : up).add(t);
  }
  const awayTags = [...down].filter((t) => !up.has(t)).sort();
  const towardTags = [...up].sort();
  return { exclude, awayTags, towardTags, step: LEARN_LEAN_STEP };
}

/** Is there anything to apply? */
export const isEmptyAdjustment = (a: Adjustment): boolean => a.exclude.length === 0 && a.awayTags.length === 0 && a.towardTags.length === 0;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * The input with the adjustment applied. Returns the SAME object when nothing changes, so a person with no signals gets
 * exactly today's input. Never mutates its argument.
 */
export function applyAdjustment(input: RunInput, adjustment: Adjustment): RunInput {
  const away = new Set(adjustment.awayTags);
  const toward = new Set(adjustment.towardTags);
  let changed = false;

  const lean = <T extends { tag: string; weight: number }>(t: T): T => {
    if (!away.has(t.tag) && !toward.has(t.tag)) return t;
    const w = away.has(t.tag) ? t.weight * (1 - adjustment.step) : Math.min(1, t.weight * (1 + adjustment.step));
    const weight = round4(w);
    if (weight === t.weight) return t;
    changed = true;
    return { ...t, weight };
  };

  const tags = input.profile.tags.map(lean);
  const axes: Axis[] = input.axes.map((a) => {
    const t = a.tags.map(lean);
    return t.some((x, i) => x !== a.tags[i]) ? { ...a, tags: t } : a;
  });
  const exclude = adjustment.exclude.length > 0 ? [...(input.exclude ?? []), ...adjustment.exclude] : input.exclude;
  if (adjustment.exclude.length > 0) changed = true;
  if (!changed) return input;

  return { ...input, profile: { ...input.profile, tags }, axes, ...(exclude ? { exclude } : {}) };
}

/**
 * The run input after the person's past signals. `signals` may be in any order. With no signals (or none that matter)
 * the same input object comes back.
 */
export function adjustFromSignals(input: RunInput, signals: readonly LearnSignal[]): RunInput {
  return applyAdjustment(input, planAdjustment(input, signals));
}
