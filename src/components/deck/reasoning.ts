// What the reasoning area says about the selected suggestion. Pure. Everything here comes from the pick's stored
// path and card, and from the chart's own placement rule. No model call, no number about taste.

import type { Axis } from "@/types";
import { anchorAxes } from "@/components/chart/geometry";
import { PROVENANCE_LABEL, pathToDisplaySteps, safeHref } from "@/components/card/helpers";
import { toChartPick } from "./grouping";
import { stretchWord } from "./suggestions";
import type { PublicPick } from "./types";

export interface Placement {
  /** The label of the axis the chart puts the suggestion beside. Null when the profile has no axes. */
  axis: string | null;
  /** Low, medium or high for an edge suggestion. Null for a calibration pick. */
  stretch: "low" | "medium" | "high" | null;
}

/**
 * Where a suggestion sits on the chart, in words. The axis is the one the chart places it beside (`anchorAxes`:
 * the axis that shares the most tags with the pick's path, ties to the heavier axis). A path that touches no axis
 * falls back to the heaviest axis, as the chart does.
 */
export function placement(pick: PublicPick, axes: readonly Axis[]): Placement {
  const stretch = stretchWord(pick.band);
  if (axes.length === 0) return { axis: null, stretch };
  const anchors = anchorAxes(toChartPick(pick), axes as Axis[]);
  let index = 0;
  if (anchors.length > 0) index = anchors[0].index;
  else
    axes.forEach((a, i) => {
      if (a.weight > axes[index].weight) index = i;
    });
  return { axis: axes[index].label, stretch };
}

export interface SourceItem {
  /** What kind of step it is, as the card words it ("Lineage, a reading"). */
  kindLabel: string;
  /** The connecting step the source backs. */
  label: string;
  /** Always "Sourced". */
  provenance: string;
  href?: string;
  sourceLabel?: string;
  linkMissing: boolean;
}

export interface Sources {
  /** Retrieved sources, one per sourced connecting step (lineage or theme), in path order. */
  sourced: SourceItem[];
  /** A reading, when text was retrieved for one. It is a reading, not a fact about the person's taste. */
  reading: { sourceLabel?: string; href?: string } | null;
}

/**
 * Sources of the stored path: what was retrieved, and nothing that was inferred. Inferred steps are not listed or
 * counted here (the card's provenance part says it); sourced and inferred never share a line.
 */
export function sourcesOf(pick: PublicPick): Sources {
  const sourced: SourceItem[] = [];
  for (const step of pathToDisplaySteps(pick.path)) {
    if (step.badge?.provenance !== "sourced") continue;
    sourced.push({
      kindLabel: step.kindLabel,
      label: step.label,
      provenance: PROVENANCE_LABEL.sourced,
      linkMissing: step.linkMissing,
      ...(step.href ? { href: step.href } : {}),
      ...(step.sourceLabel ? { sourceLabel: step.sourceLabel } : {}),
    });
  }
  const r = pick.card.reading;
  if (!r) return { sourced, reading: null };
  // A reading keeps its link whenever it has a usable one, with or without a source label.
  const sourceLabel = r.sourceLabel?.trim();
  const href = safeHref(r.sourceUrl);
  return { sourced, reading: { ...(sourceLabel ? { sourceLabel } : {}), ...(href ? { href } : {}) } };
}
