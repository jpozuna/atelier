// What the picks screen derives from a result, kept in one place so it can be tested without a renderer.
//
// `chartPicks` must keep its identity across ticking, reading, previewing and sorting: the chart resets its hover
// and focus whenever the array it gets changes. Those choices are not inputs here at all. The derivation reruns
// only when the result, the hidden fields, the set-aside ids, the seeds or the axes change (compared by reference).

import type { Axis, Field, Pick } from "@/types";
import { buildView, toChartPick } from "./grouping";
import type { View } from "./grouping";
import { placement } from "./reasoning";
import type { Placement } from "./reasoning";
import type { ProfileSeed, PublicPick, PublicRunResult } from "./types";

/** True once any pick carries a strength word, so the chart's "heavier line" sentence is true. */
export const showsConnectionWeight = (picks: readonly PublicPick[]): boolean => picks.some((p) => p.strength !== undefined);

export interface PicksDerivation {
  view: View;
  chartPicks: Pick[];
  showConnectionWeight: boolean;
  /** Where each visible pick sits on the chart, in words, by pick id. */
  placements: Map<string, Placement>;
  visibleIds: Set<string>;
}

export interface DeriveInput {
  result: PublicRunResult | null;
  hidden: readonly Field[];
  notMe: readonly string[];
  seeds: readonly ProfileSeed[];
  axes: readonly Axis[];
}

/** A derivation that returns the very same object while its inputs are the same objects. */
export function createPicksDerivation(): (input: DeriveInput) => PicksDerivation {
  let last: { input: DeriveInput; out: PicksDerivation } | null = null;
  return (input) => {
    if (last && last.input.result === input.result && last.input.hidden === input.hidden && last.input.notMe === input.notMe && last.input.seeds === input.seeds && last.input.axes === input.axes) {
      return last.out;
    }
    const view = buildView(input.result, { hidden: input.hidden, notMe: input.notMe, seeds: input.seeds });
    const out: PicksDerivation = {
      view,
      chartPicks: view.picks.map(toChartPick),
      showConnectionWeight: showsConnectionWeight(view.picks),
      placements: new Map(view.picks.map((p) => [p.id, placement(p, input.axes)] as const)),
      visibleIds: new Set(view.picks.map((p) => p.id)),
    };
    last = { input, out };
    return out;
  };
}
