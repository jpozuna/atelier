// The edge suggestions as one list, and the selection that goes with it. Pure: no React, no storage, no network.
//
//  - A row says how far out a suggestion sits as a word (low, medium or high stretch), mapped from the band. It is
//    a position, not a measure of how much the person will like it. There is no score or rank, and no sort by one
//    (hard rule 7). The screen lists by field only (there is no sort control); the stretch order stays here as a pure
//    helper (derive.test.ts uses it), and `sort` defaults to "field".
//  - Connection strength (`strength`) is never a word, number or sort key here. It only sets a line weight on the
//    chart.
//  - Three things meet on the chart: the pick being read (`focusId`, shown in the reasoning area), the ticked
//    suggestions (`checked`, shown together on the chart) and a row being hovered or focused (`previewId`, shown
//    only while it lasts). Ticking never changes which pick is read, and reading never ticks.

import { FIELDS } from "@/types";
import type { Band, Field } from "@/types";
import type { EdgeBand, EdgeDeck } from "./grouping";
import { EDGE_BANDS } from "./grouping";
import type { PublicPick } from "./types";

/** Plain words for how far out an edge suggestion sits. Moderate is low, high is medium, extreme is high. */
export const STRETCH_WORD: Record<EdgeBand, "low" | "medium" | "high"> = {
  moderate: "low",
  high: "medium",
  extreme: "high",
};

/** The stretch word for a band, or null for a calibration pick (it is close by definition, not a stretch). */
export function stretchWord(band: Band): "low" | "medium" | "high" | null {
  return band === "calibration" ? null : STRETCH_WORD[band];
}

export const SUGGESTION_SORTS = ["field", "stretch"] as const;
export type SuggestionSort = (typeof SUGGESTION_SORTS)[number];

const fieldIndex = (f: Field) => FIELDS.indexOf(f);
const bandIndex = (b: Band) => EDGE_BANDS.indexOf(b as EdgeBand);

/**
 * The visible edge suggestions as one list. Hidden fields have no picks in their deck, so they are simply absent.
 * Sorted by field (field order, then low to high stretch) or by stretch (low to high, then field order). Ties keep
 * the order the run gave them, so the result is stable and never reads a number about taste.
 */
export function edgeSuggestions(decks: readonly EdgeDeck[], sort: SuggestionSort = "field"): PublicPick[] {
  const all = decks.flatMap((d) => d.picks).map((pick, index) => ({ pick, index }));
  const byField = (a: PublicPick, b: PublicPick) => fieldIndex(a.field) - fieldIndex(b.field);
  const byStretch = (a: PublicPick, b: PublicPick) => bandIndex(a.band) - bandIndex(b.band);
  const cmp =
    sort === "field"
      ? (a: PublicPick, b: PublicPick) => byField(a, b) || byStretch(a, b)
      : (a: PublicPick, b: PublicPick) => byStretch(a, b) || byField(a, b);
  return all.sort((a, b) => cmp(a.pick, b.pick) || a.index - b.index).map((x) => x.pick);
}

/** Fields that have at least one edge suggestion on screen, in field order. */
export function fieldsWithSuggestions(picks: readonly PublicPick[]): Field[] {
  const have = new Set(picks.map((p) => p.field));
  return FIELDS.filter((f) => have.has(f));
}

/** Add the id when it is not ticked, remove it when it is. Keeps the order the person ticked them in. */
export function toggleChecked(checked: readonly string[], id: string): string[] {
  return checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
}

/**
 * What the chart draws as selected: the ticked suggestions that are still on screen, then the pick being read, then
 * the row being previewed, each only if it is on screen and not already among them. A hidden or set-aside pick is
 * simply not found. Stable for equal input.
 */
export function chartSelection(checked: readonly string[], focusId: string | null, visible: ReadonlySet<string>, previewId: string | null = null): string[] {
  const ids = checked.filter((id) => visible.has(id));
  for (const extra of [focusId, previewId]) {
    if (extra && visible.has(extra) && !ids.includes(extra)) ids.push(extra);
  }
  return ids;
}

/** A run of rows under one heading: a field when sorted by field, a stretch word when sorted by stretch. */
export interface SuggestionGroup {
  /** A field id or a stretch word. */
  key: string;
  kind: SuggestionSort;
  picks: PublicPick[];
}

/** Splits an already sorted list into consecutive groups by the sort key. Order is kept; nothing is added or dropped. */
export function groupSuggestions(picks: readonly PublicPick[], sort: SuggestionSort = "field"): SuggestionGroup[] {
  const groups: SuggestionGroup[] = [];
  for (const p of picks) {
    const key = sort === "field" ? p.field : (stretchWord(p.band) ?? "close");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.picks.push(p);
    else groups.push({ key, kind: sort, picks: [p] });
  }
  return groups;
}
