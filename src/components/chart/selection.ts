/*
 * Which suggestions the chart treats as selected. Pure, so the precedence is unit-tested.
 *
 * Precedence, highest first:
 *  1. `selectedIds`, keeping only ids that name a pick (order kept, duplicates dropped), when any survive
 *  2. `selectedId`, when it names a pick
 *  3. the chart's own selection, only when the caller passed neither prop (uncontrolled)
 * A controlled caller whose ids match nothing gets an empty selection, never the chart's own.
 */
export interface SelectionInput {
  selectedId?: string | null;
  selectedIds?: readonly string[];
  /** The chart's own single selection (used only when uncontrolled). */
  innerId?: string | null;
}

export function resolveSelection(picks: readonly { id: string }[], input: SelectionInput): string[] {
  const known = new Set(picks.map((p) => p.id));
  const fromIds: string[] = [];
  for (const id of input.selectedIds ?? []) {
    if (known.has(id) && !fromIds.includes(id)) fromIds.push(id);
  }
  if (fromIds.length > 0) return fromIds;
  if (input.selectedId && known.has(input.selectedId)) return [input.selectedId];
  const controlled = input.selectedId !== undefined || input.selectedIds !== undefined;
  if (!controlled && input.innerId && known.has(input.innerId)) return [input.innerId];
  return [];
}
